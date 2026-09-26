import test from "node:test";
import assert from "node:assert/strict";
import { queueView, scheduledTicket, serviceInitials, ticketState, TICKET_STATES } from "../frontend/queue-model.mjs";

const establishment = {
  queuePrefix: "B",
  availableTimes: ["08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"],
  professionals: ["João", "Maria", "Ricardo"],
};
const clock = { date: "2026-09-25", minutes: 10 * 60 };

test("senha usa inicial do profissional, serviço e posição na grade completa", () => {
  assert.equal(scheduledTicket(establishment, "12:00", "Ricardo", "Cabelo Tesoura"), "RCT-08");
  assert.equal(scheduledTicket(establishment, "12:00", "Ricardo", "Cabelo Máquina"), "RCM-08");
  assert.equal(scheduledTicket(establishment, "12:00", "Ricardo", "Cabelo Completo"), "RCC-08");
  assert.equal(scheduledTicket(establishment, "08:30", "João", "Cabelo Tesoura"), "JCT-01");
  assert.equal(scheduledTicket(establishment, "12:00", "Maria", "Cabelo Tesoura"), "MCT-08");
});

test("horário atual mostra todos os profissionais e SI sem reserva", () => {
  const view = queueView(establishment, {
    todaySlots: [{ date: clock.date, time: "10:00", professional: "Ricardo", service: "Cabelo Tesoura" }],
  }, { ...clock, minutes: 10 * 60 + 15 });
  assert.deepEqual(view.current.map((item) => [item.professional, item.time, item.ticket]), [
    ["João", "10:00", "JSI-04"],
    ["Maria", "10:00", "MSI-04"],
    ["Ricardo", "10:00", "RCT-04"],
  ]);
  assert.equal(view.current[0].unbooked, true);
  assert.deepEqual(view.waiting, []);
});

test("fila avulsa antiga não adiciona senhas ao painel dos três profissionais", () => {
  const view = queueView(establishment, { queue: [
    { ticket: "R-023", status: "atendendo" },
    { ticket: "R-024", status: "aguardando" },
    { ticket: "R-025", status: "aguardando" },
    { ticket: "RCT-04", status: "atendendo" },
  ] }, clock);
  assert.equal(view.current.length, 3);
  assert.deepEqual(view.current.map((item) => item.ticket), ["JSI-04", "MSI-04", "RSI-04"]);
  assert.deepEqual(view.waiting, []);
});

test("registros duplicados ou profissionais não cadastrados não criam senhas extras", () => {
  const duplicate = { date: clock.date, time: "10:00", professional: "Ricardo", service: "Cabelo Tesoura", status: "atendendo" };
  const view = queueView({ ...establishment, professionals: [...establishment.professionals, "Ricardo"] }, {
    todaySlots: [duplicate, duplicate, { ...duplicate, time: "09:30" }, { ...duplicate, professional: "Roberto" }],
    staffStatuses: [
      { professional: "Ricardo", currentDate: clock.date, currentTime: "10:00" },
      { professional: "Roberto", currentDate: clock.date, currentTime: "10:00" },
    ],
  }, clock);
  assert.equal(view.current.length, 3);
  assert.equal(new Set(view.current.map((item) => item.professional)).size, 3);
  assert.equal(view.current.find((item) => item.professional === "Ricardo").ticket, "RCT-04");
  assert.ok(view.current.every((item) => /^[A-Z]{3}-\d{2,}$/.test(item.ticket)));
  assert.ok(view.waiting.every((item) => establishment.professionals.includes(item.professional)));
});

test("horários fora da grade e ausência de profissionais não geram senhas", () => {
  const data = {
    todaySlots: [{ date: clock.date, time: "18:00", professional: "Ricardo", service: "Cabelo Tesoura", status: "atendendo" }],
    staffStatuses: [{ professional: "Ricardo", currentDate: clock.date, currentTime: "18:00", currentService: "Cabelo Tesoura" }],
    queue: [{ ticket: "R-023", status: "atendendo" }],
  };
  assert.deepEqual(queueView({ ...establishment, professionals: [] }, data, clock), { current: [], waiting: [] });
  const view = queueView(establishment, data, clock);
  assert.equal(view.current.find((item) => item.professional === "Ricardo").ticket, "RSI-04");
  assert.deepEqual(view.waiting, []);
});

test("senha SI muda ao avançar na grade e não usa serviço de outro horário ou dia", () => {
  const data = { todaySlots: [
    { date: clock.date, time: "09:30", professional: "Ricardo", service: "Cabelo Tesoura" },
    { date: "2026-09-24", time: "10:00", professional: "Maria", service: "Cabelo Máquina" },
  ] };
  const current = queueView(establishment, data, clock).current;
  assert.equal(current.find((item) => item.professional === "Ricardo").ticket, "RSI-04");
  assert.equal(current.find((item) => item.professional === "Maria").ticket, "MSI-04");
  assert.equal(queueView(establishment, data, { ...clock, minutes: 10 * 60 + 30 }).current[0].ticket, "JSI-05");
});

test("grade individual mantém posições pausadas sem código dentro e fora do expediente", () => {
  const individual = { professionals: [
    { name: "João", availableTimes: ["09:00", "10:00", "11:00"] },
    { name: "Maria", availableTimes: ["11:00", "12:00"] },
    { name: "Ricardo", availableTimes: ["09:30", "10:30", "11:30"] },
  ] };
  const view = queueView(individual, { todaySlots: [], staffStatuses: [
    { professional: "João", paused: true, pausedDate: clock.date, currentDate: clock.date, currentTime: "10:00" },
  ] }, clock);
  assert.deepEqual(view.current.map((item) => [item.professional, item.ticket, item.ticketState]), [["João", null, "paused"], ["Maria", null, "paused"], ["Ricardo", "RSI-01", "in-service"]]);
  for (const minutes of [8 * 60, 13 * 60]) {
    const outside = queueView(individual, {}, { ...clock, minutes }).current;
    assert.deepEqual(outside.map((item) => item.professional), ["João", "Maria", "Ricardo"]);
    assert.ok(outside.every((item) => item.ticketState === "paused" && item.ticket === null));
  }
});

test("horários livres, reservados, atuais, pausados e encerrados usam estados distintos", () => {
  const future = { date: clock.date, time: "10:30" };
  assert.equal(ticketState(future, clock), "free");
  assert.equal(ticketState({ ...future, booked: true }, clock), "reserved");
  assert.equal(ticketState({ ...future, paused: true, booked: true }, clock), "reserved");
  const current = { date: clock.date, time: "10:00", currentTime: "10:00" };
  assert.equal(ticketState(current, clock), "in-service");
  assert.equal(ticketState({ ...current, booked: true }, clock), "in-service");
  assert.equal(ticketState({ ...current, paused: true }, clock), "paused");
  assert.equal(ticketState({ ...current, status: "concluido" }, clock), "closed");
  assert.equal(ticketState({ date: clock.date, time: "09:00", booked: true }, clock), "closed");
  assert.equal(ticketState({ ...current, date: "2026-09-24" }, clock), "closed");
  assert.equal(ticketState({ ...current, date: "2026-09-26" }, clock), "free");
  assert.deepEqual(Object.values(TICKET_STATES), ["Livre", "Reservado", "Em Atendimento", "Pausado", "Encerrado"]);
});

test("pausar esconde o código e retomar recupera a senha do atendimento atual", () => {
  const data = {
    todaySlots: [
      { date: clock.date, time: "10:00", professional: "Ricardo", service: "Cabelo Tesoura" },
      { date: clock.date, time: "10:30", professional: "Ricardo", service: "Cabelo Máquina" },
    ],
    staffStatuses: [{ professional: "Ricardo", currentDate: clock.date, currentTime: "10:00", paused: true, pausedDate: clock.date }],
  };
  const paused = queueView({ ...establishment, professionals: ["Ricardo"] }, data, clock);
  assert.equal(paused.current[0].ticket, null);
  assert.equal(paused.current[0].ticketState, "paused");
  assert.equal(paused.waiting[0].ticketState, "reserved");
  const resumed = queueView({ ...establishment, professionals: ["Ricardo"] }, { ...data, staffStatuses: [{ ...data.staffStatuses[0], paused: false }] }, clock);
  assert.equal(resumed.current[0].ticket, "RCT-04");
  assert.equal(resumed.current[0].ticketState, "in-service");
});

test("grade compartilhada usa horário e posição do estabelecimento", () => {
  const view = queueView({ ...establishment, scheduleMode: "establishment", professionals: [
    { name: "Ricardo", availableTimes: ["11:00", "12:00"] },
  ] }, {}, clock);
  assert.equal(view.current[0].ticket, "RSI-04");
});

test("atendimento concluído no horário atual não reaparece como SI", () => {
  const view = queueView({ ...establishment, professionals: ["Ricardo"] }, { todaySlots: [
    { date: clock.date, time: "10:00", professional: "Ricardo", service: "Cabelo Tesoura", status: "concluido" },
  ] }, clock);
  assert.equal(view.current.length, 1);
  assert.equal(view.current[0].ticket, null);
  assert.equal(view.current[0].ticketState, "paused");
});

test("fim do expediente pausa as posições mesmo com atendimento antigo salvo no banco", () => {
  const data = {
    todaySlots: [{ date: clock.date, time: "10:00", professional: "Ricardo", service: "Cabelo Tesoura", status: "atendendo" }],
    staffStatuses: [{ professional: "Ricardo", currentDate: clock.date, currentTime: "10:00", currentService: "Cabelo Tesoura" }],
  };
  const before = queueView(establishment, data, clock).current;
  assert.equal(before[2].ticket, "RCT-04");
  const after = queueView(establishment, data, { ...clock, minutes: 13 * 60 }).current;
  assert.deepEqual(after.map((item) => item.professional), before.map((item) => item.professional));
  assert.equal(after.length, 3);
  assert.ok(after.every((item) => item.ticketState === "paused" && item.ticket === null && item.time === null));
});

test("pausa sem atendimento salvo mantém a posição e não reaproveita a pausa de ontem", () => {
  const paused = queueView(establishment, { staffStatuses: [{ professional: "Maria", paused: true, pausedDate: clock.date }] }, clock);
  assert.deepEqual(paused.current.map((item) => item.professional), establishment.professionals);
  assert.equal(paused.current[1].ticketState, "paused");
  assert.equal(paused.current[1].ticket, null);
  const active = queueView(establishment, { staffStatuses: [{ professional: "Maria", paused: true, pausedDate: "2026-09-24" }] }, clock);
  assert.equal(active.current[1].ticket, "MSI-04");
  assert.equal(active.current[1].ticketState, "in-service");
});

test("serviço ausente ou vazio recebe SI", () => {
  assert.equal(serviceInitials(), "SI");
  assert.equal(serviceInitials("  "), "SI");
  assert.equal(scheduledTicket(establishment, "12:00", "Ricardo"), "RSI-08");
});

test("numeração respeita grade individual, ordenação e horários duplicados", () => {
  const individual = { ...establishment, professionals: [{ name: "Álvaro", availableTimes: ["11:00", "09:00", "09:00", "10:00"] }] };
  assert.equal(scheduledTicket(individual, "11:00", "Álvaro", "Cabelo de Máquina"), "ACM-03");
  assert.equal(scheduledTicket({ ...individual, scheduleMode: "establishment" }, "11:00", "Álvaro", "Cabelo Máquina"), "ACM-06");
  assert.equal(scheduledTicket(individual, "12:00", "Álvaro", "Cabelo Máquina"), "");
  assert.equal(serviceInitials("Barba"), "BA");
});

test("profissionais com a mesma inicial não ocultam agendamentos da fila", () => {
  const view = queueView({ ...establishment, professionals: ["João", "José"] }, {
    appointments: [
      { date: clock.date, time: "10:30", professional: "João", service: "Cabelo Tesoura", status: "atendendo" },
      { date: clock.date, time: "10:30", professional: "José", service: "Cabelo Tesoura", status: "confirmado" },
    ],
  }, clock);
  assert.equal(view.current.length, 2);
  assert.equal(view.waiting[0].professional, "José");
});

test("atendimento sem agendamento carregado usa o serviço salvo no status", () => {
  const view = queueView({ ...establishment, professionals: ["Ricardo"] }, {
    todaySlots: [],
    staffStatuses: [{ currentDate: clock.date, currentTime: "12:00", professional: "Ricardo", currentService: "Cabelo Tesoura" }],
  }, clock);
  assert.equal(view.current[0].ticket, "RCT-08");
});

test("painel público liga atendimento atual ao horário e ordena próximos agendamentos", () => {
  const view = queueView({ ...establishment, professionals: ["João", "Maria"] }, {
    todaySlots: [
      { date: clock.date, time: "11:00", professional: "Maria" },
      { date: clock.date, time: "09:00", professional: "João" },
      { date: clock.date, time: "10:30", professional: "João" },
      { date: "2026-09-26", time: "10:15", professional: "Maria" },
    ],
    staffStatuses: [{ currentDate: clock.date, currentTime: "09:00", professional: "João" }],
    queue: [{ ticket: "B-001", status: "aguardando" }],
  }, clock);

  assert.equal(view.current[0].ticket, scheduledTicket(establishment, "09:00", "João"));
  assert.deepEqual(view.waiting.map((item) => item.time), ["10:30", "11:00"]);
});

test("painel administrativo ignora concluídos e mostra horários atrasados ainda pendentes", () => {
  const view = queueView({ ...establishment, professionals: ["João", "Maria"] }, {
    appointments: [
      { date: clock.date, time: "08:30", professional: "João", status: "presente" },
      { date: clock.date, time: "09:00", professional: "Maria", status: "concluido" },
      { date: clock.date, time: "10:30", professional: "Maria", status: "atendendo" },
    ],
    staffStatuses: [],
    queue: [{ ticket: "B-002", status: "atendendo" }],
  }, clock);

  assert.deepEqual(view.current.map((item) => item.kind), ["scheduled", "scheduled"]);
  assert.deepEqual(view.waiting.map((item) => item.time), ["08:30"]);
});

test("dois profissionais em atendimento recebem senhas distintas", () => {
  const view = queueView({ ...establishment, professionals: ["João", "Maria"] }, {
    todaySlots: [],
    staffStatuses: [
      { currentDate: clock.date, currentTime: "10:00", professional: "João" },
      { currentDate: clock.date, currentTime: "10:00", professional: "Maria" },
    ],
    queue: [],
  }, clock);

  assert.equal(view.current.length, 2);
  assert.notEqual(view.current[0].ticket, view.current[1].ticket);
});

test("horário concluído antes da hora não volta para a lista de próximas senhas", () => {
  const view = queueView({ ...establishment, professionals: ["João", "Maria"] }, {
    todaySlots: [
      { date: clock.date, time: "10:30", professional: "João", status: "concluido" },
      { date: clock.date, time: "11:00", professional: "Maria", status: "atendendo" },
    ],
    staffStatuses: [],
    queue: [],
  }, clock);

  assert.deepEqual(view.current.map((item) => item.time), ["10:00", "11:00"]);
  assert.deepEqual(view.waiting, []);
});
