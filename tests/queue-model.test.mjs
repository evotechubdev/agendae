import test from "node:test";
import assert from "node:assert/strict";
import { queueView, scheduledTicket, serviceInitials } from "../frontend/queue-model.mjs";

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

test("numeração respeita grade individual, ordenação e horários duplicados", () => {
  const individual = { ...establishment, professionals: [{ name: "Álvaro", availableTimes: ["11:00", "09:00", "09:00", "10:00"] }] };
  assert.equal(scheduledTicket(individual, "11:00", "Álvaro", "Cabelo de Máquina"), "ACM-03");
  assert.equal(scheduledTicket({ ...individual, scheduleMode: "establishment" }, "11:00", "Álvaro", "Cabelo Máquina"), "ACM-06");
  assert.equal(scheduledTicket(individual, "12:00", "Álvaro", "Cabelo Máquina"), "ACM---");
  assert.equal(serviceInitials("Barba"), "BA");
});

test("profissionais com a mesma inicial não ocultam agendamentos da fila", () => {
  const view = queueView({ ...establishment, professionals: ["João", "José"] }, {
    appointments: [
      { date: clock.date, time: "10:30", professional: "João", service: "Cabelo Tesoura", status: "atendendo" },
      { date: clock.date, time: "10:30", professional: "José", service: "Cabelo Tesoura", status: "confirmado" },
    ],
  }, clock);
  assert.equal(view.current.length, 1);
  assert.equal(view.waiting[0].professional, "José");
});

test("atendimento sem agendamento carregado usa o serviço salvo no status", () => {
  const view = queueView(establishment, {
    todaySlots: [],
    staffStatuses: [{ currentDate: clock.date, currentTime: "12:00", professional: "Ricardo", currentService: "Cabelo Tesoura" }],
  }, clock);
  assert.equal(view.current[0].ticket, "RCT-08");
});

test("painel público liga atendimento atual ao horário e ordena próximos agendamentos", () => {
  const view = queueView(establishment, {
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
  const view = queueView(establishment, {
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
  const view = queueView(establishment, {
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
  const view = queueView(establishment, {
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
