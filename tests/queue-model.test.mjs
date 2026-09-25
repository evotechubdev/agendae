import test from "node:test";
import assert from "node:assert/strict";
import { queueView, scheduledTicket } from "../frontend/queue-model.mjs";

const establishment = { queuePrefix: "B" };
const clock = { date: "2026-09-25", minutes: 10 * 60 };

test("senha do painel é estável e distingue profissionais no mesmo horário", () => {
  const first = scheduledTicket(establishment, "10:30", "João");
  assert.match(first, /^B-1030-[A-Z0-9]{4}$/);
  assert.equal(first, scheduledTicket(establishment, "10:30", "João"));
  assert.notEqual(first, scheduledTicket(establishment, "10:30", "Maria"));
  assert.notEqual(first, scheduledTicket(establishment, "11:00", "João"));
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
