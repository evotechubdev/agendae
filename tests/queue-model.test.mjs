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

test("grade individual mostra pausados e exclui profissionais fora do expediente", () => {
  const individual = { professionals: [
    { name: "João", availableTimes: ["09:00", "10:00", "11:00"] },
    { name: "Maria", availableTimes: ["11:00", "12:00"] },
    { name: "Ricardo", availableTimes: ["09:30", "10:30", "11:30"] },
  ] };
  const view = queueView(individual, { todaySlots: [], staffStatuses: [
    { professional: "João", paused: true, pausedDate: clock.date, currentDate: clock.date, currentTime: "10:00" },
  ] }, clock);
  assert.deepEqual(view.current.map((item) => [item.ticket, item.ticketState]), [["RSI-01", "in-service"], ["JSI-02", "paused"]]);
  assert.deepEqual(queueView(individual, {}, { ...clock, minutes: 8 * 60 }).current, []);
  assert.deepEqual(queueView(individual, {}, { ...clock, minutes: 13 * 60 }).current, []);
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

test("pausar e retomar mantém a senha e muda apenas o estado do atendimento atual", () => {
  const data = {
    todaySlots: [
      { date: clock.date, time: "10:00", professional: "Ricardo", service: "Cabelo Tesoura" },
      { date: clock.date, time: "10:30", professional: "Ricardo", service: "Cabelo Máquina" },
    ],
    staffStatuses: [{ professional: "Ricardo", currentDate: clock.date, currentTime: "10:00", paused: true, pausedDate: clock.date }],
  };
  const paused = queueView({ ...establishment, professionals: ["Ricardo"] }, data, clock);
  assert.equal(paused.current[0].ticket, "RCT-04");
  assert.equal(paused.current[0].ticketState, "paused");
  assert.equal(paused.waiting[0].ticketState, "reserved");
  const resumed = queueView({ ...establishment, professionals: ["Ricardo"] }, { ...data, staffStatuses: [{ ...data.staffStatuses[0], paused: false }] }, clock);
  assert.equal(resumed.current[0].ticket, paused.current[0].ticket);
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
  assert.deepEqual(view.current, []);
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
  assert.equal(scheduledTicket(individual, "12:00", "Álvaro", "Cabelo Máquina"), "ACM---");
  assert.equal(serviceInitials("Barba"), "BA");
});

test("profissionais com a mesma inicial não ocultam agendamentos da fila", () => {
  const view = queueView({ ...establishment, professionals: [] }, {
    appointments: [
      { date: clock.date, time: "10:30", professional: "João", service: "Cabelo Tesoura", status: "atendendo" },
      { date: clock.date, time: "10:30", professional: "José", service: "Cabelo Tesoura", status: "confirmado" },
    ],
  }, clock);
  assert.equal(view.current.length, 1);
  assert.equal(view.waiting[0].professional, "José");
});

test("atendimento sem agendamento carregado usa o serviço salvo no status", () => {
  const view = queueView({ ...establishment, professionals: [] }, {
    todaySlots: [],
    staffStatuses: [{ currentDate: clock.date, currentTime: "12:00", professional: "Ricardo", currentService: "Cabelo Tesoura" }],
  }, clock);
  assert.equal(view.current[0].ticket, "RCT-08");
});

test("painel público liga atendimento atual ao horário e ordena próximos agendamentos", () => {
  const view = queueView({ ...establishment, professionals: [] }, {
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
  assert.deepEqual(view.waiting.map((item) => item.time || item.ticket), ["10:30", "11:00", "B-001"]);
});

test("painel administrativo ignora concluídos e mostra horários atrasados ainda pendentes", () => {
  const view = queueView({ ...establishment, professionals: [] }, {
    appointments: [
      { date: clock.date, time: "08:30", professional: "João", status: "presente" },
      { date: clock.date, time: "09:00", professional: "Maria", status: "concluido" },
      { date: clock.date, time: "10:30", professional: "Maria", status: "atendendo" },
    ],
    staffStatuses: [],
    queue: [{ ticket: "B-002", status: "atendendo" }],
  }, clock);

  assert.deepEqual(view.current.map((item) => item.kind), ["scheduled", "walk-in"]);
  assert.deepEqual(view.waiting.map((item) => item.time), ["08:30"]);
});

test("dois profissionais em atendimento recebem senhas distintas", () => {
  const view = queueView({ ...establishment, professionals: [] }, {
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
  const view = queueView({ ...establishment, professionals: [] }, {
    todaySlots: [
      { date: clock.date, time: "10:30", professional: "João", status: "concluido" },
      { date: clock.date, time: "11:00", professional: "Maria", status: "atendendo" },
    ],
    staffStatuses: [],
    queue: [],
  }, clock);

  assert.deepEqual(view.current.map((item) => item.time), ["11:00"]);
  assert.deepEqual(view.waiting, []);
});
