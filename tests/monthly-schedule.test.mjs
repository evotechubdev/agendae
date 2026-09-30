import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { calendarMonthDays } from "../frontend/calendar-model.mjs";
import { businessDayIsClosed, lunchBreakFor, scheduleFromPeriods, scheduleMatrix, serviceAvailableAt, serviceFitsSlot } from "../frontend/schedule-model.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const context = vm.createContext({
  state: { calendarMonth: "2026-09", booking: { date: "2026-09-28" } },
  isoDate: () => "2026-09-28", currentSaoPauloClock: () => ({ minutes: 8 * 60 }),
  calendarMonthDays, businessDayIsClosed, scheduleMatrix, serviceAvailableAt, serviceFitsSlot,
  lunchBreakFor, scheduleFromPeriods, escapeHTML: String, prettyDate: value => value,
});
vm.runInContext(source.slice(source.indexOf("function professionalDirectory("), source.indexOf("function staffStatusFor(")), context);
vm.runInContext(source.slice(source.indexOf("function lunchSchedulesMarkup("), source.indexOf("function workPeriodRow(")), context);
vm.runInContext(source.slice(source.indexOf("function monthlyScheduleMarkup("), source.indexOf("function publicSchedule(")), context);

test("admin escolhe almoço em todos ou em dias específicos", () => {
  const store = { professionals: [{ name: "Ana", availableTimes: ["09:00"] }], professionalLunchBreaks: { Ana: { start: "12:00", end: "13:00", days: ["seg", "qua"] } } };
  const html = context.lunchSchedulesMarkup(store);
  assert.match(html, /name="dayMode" data-lunch-day-mode/);
  assert.match(html, /value="custom" selected>Selecionar dias/);
  assert.match(html, /value="seg" checked/);
  assert.match(html, /value="ter" /);
  assert.match(html, /value="qua" checked/);
  assert.match(html, /value="all" >Todos os dias/);
});

test("grade mensal distingue dia com expediente e dia fechado", () => {
  const store = {
    hours: [{ label: "Segunda", value: "09:00 - 11:00" }, { label: "Terça", value: "Fechado" }],
    professionals: [{ name: "Ana", availableTimes: ["09:00", "09:20"], workPeriods: [{ start: "09:00", end: "10:00" }], slotDuration: 20 }],
    services: [{ name: "Corte", duration: 20 }],
  };
  const html = context.monthlyScheduleMarkup(store);
  assert.match(html, /Grade mensal de agendamento/);
  assert.match(html, /data-monthly-date="2026-09-28"[^>]*><strong>28<\/strong><small>Expediente<\/small>/);
  assert.match(html, /data-monthly-date="2026-09-29"[^>]*><strong>29<\/strong><small>Fechado<\/small>/);
  assert.match(html, /data-monthly-date="2026-09-27"[^>]*disabled/);
});
