import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { calendarMonthDays, renderBookingCalendar, shiftCalendarMonth } from "../frontend/calendar-model.mjs";

test("calendário exibe somente as datas do mês, com espaços vazios nas outras posições", () => {
  for (const [month, count] of [["2026-09", 30], ["2026-10", 31], ["2027-02", 28], ["2028-02", 29]]) {
    const days = calendarMonthDays(month);
    assert.equal(days.length % 7, 0);
    assert.equal(days.filter(Boolean).length, count);
    assert.ok(days.filter(Boolean).every(date => date.startsWith(month)));
    const html = renderBookingCalendar({ selectedDate: `${month}-15`, today: "2026-09-01", month, open: true });
    const rendered = [...html.matchAll(/data-calendar-date="([^"]+)"/g)].map(match => match[1]);
    assert.equal(rendered.length, count);
    assert.ok(rendered.every(date => date.startsWith(month)));
  }
  assert.equal(shiftCalendarMonth("2026-12", 1), "2027-01");
  assert.equal(shiftCalendarMonth("2027-01", -1), "2026-12");
});

test("data de domingo ou de outro mês não é desabilitada por falta de disponibilidade", () => {
  const html = renderBookingCalendar({ selectedDate: "2026-10-04", today: "2026-09-27", open: true });
  assert.match(html, /outubro de 2026/);
  assert.match(html, /data-calendar-date="2026-10-04"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(html, /data-calendar-date="2026-10-04"[^>]*disabled/);
  assert.doesNotMatch(html, /data-calendar-date="2026-09-|data-calendar-date="2026-11-/);
  const september = renderBookingCalendar({ selectedDate: "2026-09-27", today: "2026-09-27", open: true });
  assert.match(september, /data-calendar-date="2026-09-26"[^>]*data passada[^>]*disabled/);
  assert.doesNotMatch(september, /data-calendar-date="2026-09-27"[^>]*disabled/);
});

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
function fixture() {
  const state = { booking: { date: "2026-09-27", dateMode: "today", step: 1 }, calendarOpen: false, calendarMonth: null, scheduleAuto: true };
  const listeners = {}, cleared = [];
  const checkbox = { checked: true };
  const element = { outerHTML: "" };
  const context = vm.createContext({ state, renderBookingCalendar, shiftCalendarMonth, scheduleTurnTimer: 1,
    clearTimeout: value => cleared.push(value), document: { addEventListener: (type, listener) => { listeners[type] = listener; }, querySelector: selector => selector === "[data-schedule-turn-auto]" ? checkbox : selector === "[data-booking-calendar]" ? element : null },
    requestAnimationFrame: callback => callback(), isoDate: () => "2026-09-27", render: () => {}, toast: () => {},
    startScheduleTurnTimer: () => {},
    activeEstablishment: () => ({ slug: "demo" }), cloudCache: new Map(), publicCacheKey: () => "demo",
  });
  vm.runInContext(source.slice(source.indexOf("function pauseScheduleTurn("), source.indexOf("function restoreScheduleScroll(")), context);
  vm.runInContext(source.slice(source.indexOf("function refreshBookingCalendar("), source.indexOf('document.addEventListener("input",')), context);
  const click = (selector, dataset = {}) => listeners.click({ target: { closest: value => value === selector || value === "[data-booking-calendar]" && selector.startsWith("[data-calendar-") ? { dataset } : null, matches: () => false } });
  return { state, context, listeners, cleared, checkbox, element, click };
}

test("foco e toque no calendário interrompem o temporizador e desmarcam a alternância", () => {
  for (const type of ["pointerdown", "focusin"]) {
    const f = fixture();
    f.listeners[type]({ target: { closest: () => ({}) } });
    assert.equal(f.state.scheduleAuto, false);
    assert.equal(f.checkbox.checked, false);
    assert.ok(f.cleared.includes(1));
  }
});

test("navegar, selecionar outra data e fechar mantém a pausa e reabre no mês selecionado", async () => {
  const f = fixture();
  await f.click("[data-calendar-toggle]");
  assert.equal(f.state.calendarOpen, true);
  assert.equal(f.state.scheduleAuto, false);
  await f.click("[data-calendar-month-step]", { calendarMonthStep: "1" });
  assert.equal(f.state.calendarMonth, "2026-10");
  assert.match(f.element.outerHTML, /outubro de 2026/);
  await f.click("[data-calendar-date]", { calendarDate: "2026-10-04" });
  assert.equal(f.state.booking.date, "2026-10-04");
  assert.equal(f.state.calendarOpen, false);
  assert.equal(f.state.scheduleAuto, false);
  await f.click("[data-calendar-toggle]");
  assert.equal(f.state.calendarMonth, "2026-10");
  await f.click("[data-calendar-close]");
  assert.equal(f.state.calendarOpen, false);
  assert.equal(f.state.scheduleAuto, false);
  f.context.resumeScheduleTurn();
  assert.equal(f.state.scheduleAuto, false);
  f.listeners.change({ target: { matches: selector => selector === "[data-schedule-turn-auto]", checked: true } });
  assert.equal(f.state.scheduleAuto, true);
  assert.equal(f.state.schedulePausedByCalendar, false);
});
