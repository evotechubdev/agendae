import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as schedule from "../frontend/schedule-model.mjs";
import * as queue from "../frontend/queue-model.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const establishment = {
  hours: [{ label: "Seg a sex", value: "08:00 - 18:00" }, { label: "Sábado", value: "08:00 - 17:00" }, { label: "Domingo", value: "Fechado" }],
  professionals: [{ name: "Renam", availableTimes: ["10:20", "10:40"] }],
  availableTimes: ["10:20", "10:40"],
};

test("dia fechado explícito ou ausente no expediente não usa a grade diária como disponibilidade", () => {
  assert.equal(schedule.businessDayIsClosed(establishment, "2026-09-27"), true);
  const withoutSunday = { ...establishment, hours: establishment.hours.slice(0, 2) };
  assert.equal(schedule.businessDayIsClosed(withoutSunday, "2026-09-27"), true);
  assert.equal(schedule.businessOpeningMinutes(withoutSunday, "2026-09-27"), null);
  assert.equal(schedule.businessDayIsClosed(establishment, "2026-09-28"), false);
  assert.equal(schedule.businessDayIsClosed({ ...establishment, hours: [] }, "2026-09-27"), false);
  assert.equal(schedule.businessDayIsClosed({ hours: [{ label: "Todos os dias", value: "08:00 - 18:00" }] }, "2026-09-27"), false);
});

test("domingo às dez não mostra horários nem formulário e permite escolher segunda-feira", () => {
  const state = { booking: { step: 2, date: "2026-09-27", dateMode: "today", time: "10:20", professional: "Renam" } };
  const context = vm.createContext({ ...schedule, ...queue, state,
    getData: () => ({ slots: [] }), currentSaoPauloClock: () => ({ date: "2026-09-27", minutes: 600 }),
    isoDate: () => "2026-09-27", prettyDate: value => value, ticketStatusLegend: () => "", escapeHTML: value => String(value),
    staffStatusFor: () => ({}), professionalIsPaused: () => false, professionalIsOnShift: () => false,
  });
  for (const [start, end] of [["selectedBookingPopup", "publicAccessMenu"], ["bookingContent", "publicSchedule"], ["publicSchedule", "moveScheduleTurn"]]) {
    vm.runInContext(source.slice(source.indexOf(`function ${start}(`), source.indexOf(`function ${end}(`)), context);
  }
  const html = context.publicSchedule(establishment);
  assert.match(html, /Sem expediente neste dia/);
  assert.match(html, /data-booking-date/);
  assert.doesNotMatch(html, /data-public-slot|matrix-slot|data-schedule-turn-step|data-schedule-turn-auto/);
  assert.equal(context.selectedBookingPopup(establishment), "");
  assert.equal(context.bookingContent(establishment), "");
  vm.runInContext(source.slice(source.indexOf("function professionalAvailability("), source.indexOf("function staffSchedulesMarkup(")), context);
  context.professionalDirectory = value => value.professionals;
  context.usesEmployeeSchedules = value => value.scheduleMode !== "establishment";
  context.slotHasPassed = () => false;
  for (const scheduleMode of ["employee", "establishment"]) {
    assert.equal(context.availableTimesFor({ ...establishment, scheduleMode }, {}, state.booking.date).length, 0);
  }
  assert.ok(context.professionalAvailability(establishment, {}, state.booking.date).every(item => item.freeTimes.length === 0));
  state.booking.date = "2026-09-28";
  assert.equal(context.availableTimesFor(establishment, {}, state.booking.date).length, 2);
  assert.match(context.publicSchedule(establishment), /data-public-slot/);
  assert.doesNotMatch(context.publicSchedule(establishment), /Sem expediente neste dia/);
});

test("validação da reserva consulta o expediente salvo e rejeita domingo antes de gravar", async () => {
  const apiSource = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
  const writes = [];
  const context = vm.createContext({ ...schedule, db: {},
    collection: () => "appointments", doc: (_db, ...parts) => parts.join("/"), documentKey: value => value,
    appointmentLookupKey: async () => "name", appointmentCodeLookupKey: async () => "code", serverTimestamp: () => "now",
    runTransaction: async (_db, callback) => callback({
      get: async ref => ref === "establishments/demo" ? { data: () => establishment } : { exists: () => false },
      set: (ref, value) => writes.push({ ref, value }),
    }),
  });
  vm.runInContext(apiSource.slice(apiSource.indexOf("export async function createAppointment("), apiSource.indexOf("export async function getOrCreateCheckInConfig(")).replace("export ", ""), context);
  const appointment = { date: "2026-09-27", time: "10:20", professional: "Renam", client: "Cliente", checkInCode: "ABC123" };
  await assert.rejects(context.createAppointment("demo", appointment), error => error.code === "agendae/slot-unavailable" && /Sem expediente/.test(error.message));
  assert.equal(writes.length, 0);
  await context.createAppointment("demo", { ...appointment, date: "2026-09-28" });
  assert.ok(writes.length > 0);
});
