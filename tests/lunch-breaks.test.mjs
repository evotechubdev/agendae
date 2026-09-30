import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { renderBookingCalendar } from "../frontend/calendar-model.mjs";
import { lunchBreakFor, isLunchTime, scheduleMatrix, scheduleBands, scheduleTimeline, scheduleDayPeriods, businessDayIsClosed, serviceAvailableAt, serviceFitsSlot, appointmentDurationMinutes } from "../frontend/schedule-model.mjs";
import { queueView, scheduledTicket, ticketState, ticketSubstatus, TICKET_STATES } from "../frontend/queue-model.mjs";

const establishment = {
  slug: "demo",
  availableTimes: ["11:30", "12:00", "12:30", "13:00", "13:30", "14:00"],
  professionals: ["Renam", "Carlos", "Marcos"],
  services: [{ name: "Cabelo Tesoura", duration: 20 }],
  professionalLunchBreaks: {
    Renam: { start: "12:00", end: "13:00" },
    Carlos: { start: "13:00", end: "14:00" },
    Marcos: { start: "12:15", end: "13:15" },
  },
};
const date = "2026-09-26";

test("almoço é individual, inclui o início e libera no horário final", () => {
  const interval = lunchBreakFor(establishment, "Renam");
  assert.equal(isLunchTime(interval, "11:59"), false);
  assert.equal(isLunchTime(interval, "12:00"), true);
  assert.equal(isLunchTime(interval, 12 * 60 + 59), true);
  assert.equal(isLunchTime(interval, "13:00"), false);
  assert.equal(lunchBreakFor(establishment, "Sem cadastro"), null);
});

test("intervalos inválidos não criam pausa e remoção explícita prevalece sobre o cadastro", () => {
  for (const interval of [{ start: "13:00", end: "12:00" }, { start: "12:00", end: "12:00" }, { start: "12:60", end: "14:00" }, { start: "12:00", end: "24:00" }]) {
    assert.equal(lunchBreakFor({ professionalLunchBreaks: { Renam: interval } }, "Renam"), null);
  }
  assert.equal(lunchBreakFor({ professionals: [{ name: "Renam", lunchBreak: establishment.professionalLunchBreaks.Renam }], professionalLunchBreaks: { Renam: null } }, "Renam"), null);
});

test("almoço aparece na linha do tempo mesmo sem horário de atendimento no início do intervalo", () => {
  for (const scheduleMode of ["employee", "establishment"]) {
    const matrix = scheduleMatrix({ ...establishment, scheduleMode });
    assert.ok(matrix.times.includes("12:15"));
    assert.ok(matrix.times.includes("13:15"));
    const index = matrix.times.indexOf("12:15");
    assert.equal(matrix.professionals[2].periods[index], "12:15");
    assert.equal(matrix.professionals[1].periods[index], null);
    assert.equal(matrix.professionals[2].availableTimes.includes("12:15"), false);
  }
});

test("painel pausa apenas os profissionais em almoço e retoma automaticamente sem renumerar", () => {
  const data = { todaySlots: [], staffStatuses: [] };
  const atNoon = queueView(establishment, data, { date, minutes: 12 * 60 });
  assert.deepEqual(atNoon.current.map((item) => [item.professional, item.ticketState]), [["Renam", "paused"], ["Carlos", "in-service"], ["Marcos", "in-service"]]);
  assert.equal(atNoon.current[0].ticket, null);
  assert.equal(atNoon.current[0].pauseReason, "Almoço");
  const atOne = queueView(establishment, data, { date, minutes: 13 * 60 });
  assert.deepEqual(atOne.current.map((item) => item.ticketState), ["in-service", "paused", "paused"]);
  assert.equal(atOne.current[0].ticket, "RSI-04");
  const manuallyPaused = queueView(establishment, { ...data, staffStatuses: [{ professional: "Renam", paused: true, pausedDate: date }] }, { date, minutes: 13 * 60 });
  assert.equal(manuallyPaused.current[0].ticketState, "paused");
});

test("agenda exibe Pausado em vermelho para almoço em vez de senha agendável", () => {
  const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
  const start = source.indexOf("function publicSchedule(");
  const end = source.indexOf("function restoreScheduleScroll(", start);
  const context = vm.createContext({
    window: { innerWidth: 1366 }, state: { booking: { date, dateMode: "today", step: 1 } },
    getData: () => ({ slots: [] }), currentSaoPauloClock: () => ({ date, minutes: 12 * 60 }),
    professionalIsPaused: () => false, professionalIsClosed: () => false, professionalIsOnShift: () => true, currentProfessionalSlot: () => "12:00", staffStatusFor: () => ({}),
    isoDate: () => date, prettyDate: () => "", ticketStatusLegend: () => "", escapeHTML: (value) => String(value),
    scheduleTimeline, scheduleBands, scheduleDayPeriods, businessDayIsClosed, serviceAvailableAt, serviceFitsSlot, renderBookingCalendar, isLunchTime, scheduledTicket, ticketState, ticketSubstatus, TICKET_STATES,
  });
  vm.runInContext(source.slice(start, end), context);
  const html = context.publicSchedule(establishment);
  assert.match(html, /class="matrix-slot ticket-state-paused"[^>]*disabled/);
  assert.match(html, /Pausado, almoço de Marcos, 12:15 às 13:15/);
  assert.match(html, /matrix-ticket-code">Pausado<\/strong>/);
  assert.match(html, /<strong class="matrix-ticket-code">Pausado<\/strong><small class="matrix-pause-reason">Almoço<\/small>/);
  assert.match(html, /<time datetime="\d{2}:\d{2}" title="\d{2}:\d{2}">\d{2}:\d{2}<\/time>/);
  assert.match(html, /<small class="matrix-start-time">12:00<\/small>/);
});

const apiSource = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
function apiContext() {
  let saved = establishment;
  const writes = [];
  const context = vm.createContext({
    db: {}, doc: (_db, ...parts) => parts.join("/"), collection: () => "appointments",
    documentKey: (value) => value, appointmentLookupKey: async () => "name", appointmentCodeLookupKey: async () => "code",
    lunchBreakFor, isLunchTime, businessDayIsClosed, serviceAvailableAt, appointmentDurationMinutes, serverTimestamp: () => "timestamp",
    runTransaction: async (_db, callback) => callback({
      get: async (ref) => ref === "establishments/demo" ? { exists: () => true, data: () => saved } : { exists: () => false },
      update: (ref, value) => { writes.push({ ref, value }); saved = { ...saved, ...value }; },
      set: (ref, value) => writes.push({ ref, value }),
    }),
  });
  for (const [name, next] of [["updateProfessionalLunchBreak", "updateProfessionalWorkPeriods"], ["createAppointment", "getOrCreateCheckInConfig"]]) {
    const start = apiSource.indexOf(`export async function ${name}(`);
    const end = apiSource.indexOf(`export async function ${next}(`, start);
    vm.runInContext(apiSource.slice(start, end).replace("export ", ""), context);
  }
  return { context, writes };
}

test("salvar ou remover almoço preserva os intervalos dos demais profissionais", async () => {
  const { context } = apiContext();
  const changed = await context.updateProfessionalLunchBreak("demo", "Renam", { start: "11:30", end: "12:30" });
  assert.equal(changed.Renam.start, "11:30");
  assert.equal(changed.Carlos.start, "13:00");
  const removed = await context.updateProfessionalLunchBreak("demo", "Renam", null);
  assert.equal(removed.Renam, null);
  assert.equal(removed.Marcos.start, "12:15");
  await assert.rejects(context.updateProfessionalLunchBreak("demo", "Outro", { start: "12:00", end: "13:00" }), /Profissional não encontrado/);
});

test("reserva no almoço é rejeitada antes de gravar e outro profissional permanece disponível", async () => {
  const { context, writes } = apiContext();
  const appointment = { date, time: "12:30", client: "Cliente", checkInCode: "ABC123", professional: "Renam", service: "Cabelo Tesoura" };
  await assert.rejects(context.createAppointment("demo", appointment), /horário de almoço/);
  assert.equal(writes.length, 0);
  await context.createAppointment("demo", { ...appointment, professional: "Carlos" });
  assert.ok(writes.length > 0);
});
