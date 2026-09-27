import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as schedule from "../frontend/schedule-model.mjs";
import * as queue from "../frontend/queue-model.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const establishment = { slug: "demo", professionals: [{ name: "Renam", ...schedule.scheduleFromPeriods([{ start: "08:00", end: "18:00" }]) }] };
const timeline = schedule.scheduleTimeline(establishment);

test("manhã e tarde dividem o expediente ao meio-dia sem perder horários", () => {
  const periods = schedule.scheduleDayPeriods(timeline);
  assert.deepEqual(periods.map(period => [period.id, period.startTime, period.endTime]), [["morning", "08:00", "12:00"], ["afternoon", "12:00", "18:00"]]);
  assert.deepEqual(periods.flatMap(period => period.times), timeline.times);
  assert.equal(periods[0].end, periods[1].start);
  assert.deepEqual(schedule.scheduleDayPeriods({ times: [] }), []);
  const afternoon = schedule.scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["14:00", "14:20"] }] });
  assert.equal(schedule.scheduleDayPeriods(afternoon).length, 1);
  assert.equal(schedule.scheduleDayPeriods(afternoon)[0].id, "afternoon");
});

function renderFixture(minutes = 8 * 60) {
  const state = { booking: { date: "2026-09-26", dateMode: "today", step: 1 }, scheduleAuto: true };
  const context = vm.createContext({ ...schedule, ...queue, state,
    getData: () => ({ slots: [] }), currentSaoPauloClock: () => ({ date: "2026-09-26", minutes }),
    professionalIsPaused: () => false, professionalIsOnShift: () => true, currentProfessionalSlot: () => null, staffStatusFor: () => ({}),
    isoDate: () => "2026-09-26", prettyDate: () => "", ticketStatusLegend: () => "", escapeHTML: value => String(value),
  });
  vm.runInContext(source.slice(source.indexOf("function publicSchedule("), source.indexOf("function restoreScheduleScroll(")), context);
  return { context, state };
}

test("cada visualização mostra apenas seu turno e conserva a numeração do dia", () => {
  const { context, state } = renderFixture();
  let html = context.publicSchedule(establishment);
  assert.match(html, /Manhã, de 08:00 a 12:00/);
  assert.match(html, /RSI-01, Renam, 08:00/);
  assert.doesNotMatch(html, /RSI-13, Renam, 12:00/);
  state.scheduleTurn.id = "afternoon";
  html = context.publicSchedule(establishment);
  assert.match(html, /Tarde, de 12:00 a 18:00/);
  assert.match(html, /RSI-13, Renam, 12:00/);
  assert.doesNotMatch(html, /RSI-01, Renam, 08:00/);
  assert.match(html, /data-schedule-turn-auto checked/);
  state.scheduleAuto = false;
  assert.doesNotMatch(context.publicSchedule(establishment), /data-schedule-turn-auto checked/);
  assert.match(renderFixture(13 * 60).context.publicSchedule(establishment), /Tarde, de 12:00 a 18:00/);
});

function timerFixture() {
  let now = 0;
  const timers = [], cleared = [];
  const state = { booking: { date: "2026-09-26" }, scheduleAuto: true, scheduleTurn: { key: "demo:2026-09-26", id: "morning", changedAt: 0 } };
  const body = { innerHTML: "" };
  const context = vm.createContext({ state, Date: { now: () => now },
    document: { querySelector: () => body, activeElement: null },
    getData: () => ({ slots: [] }), scheduleTimeline: () => timeline, scheduleDayPeriods: schedule.scheduleDayPeriods,
    publicSchedule: () => state.scheduleTurn.id, restoreScheduleScroll: () => {},
    clearTimeout: id => cleared.push(id), setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
  });
  vm.runInContext(`let scheduleTurnTimer = null;\n${source.slice(source.indexOf("function moveScheduleTurn("), source.indexOf("function restoreScheduleScroll("))}`, context);
  return { context, state, body, timers, cleared, advance: value => { now = value; } };
}

test("um atendimento que atravessa o meio-dia mantém a mesma senha nos dois turnos", () => {
  const { context, state } = renderFixture();
  const booking = { date: "2026-09-26", time: "11:40", professional: "Renam", service: "Combo" };
  context.getData = () => ({ slots: [booking] });
  const configured = { ...establishment, services: [{ name: "Combo", duration: 70 }] };
  assert.match(context.publicSchedule(configured), /RCO-12, Renam, 11:40/);
  state.scheduleTurn.id = "afternoon";
  assert.match(context.publicSchedule(configured), /RCO-12, Renam, 11:40/);
});

test("alternância automática troca os turnos a cada cinco segundos e para ao desmarcar", () => {
  const fixture = timerFixture();
  const { context, state, timers } = fixture;
  context.startScheduleTurnTimer(establishment);
  assert.equal(timers[0].delay, 5000);
  fixture.advance(5000); timers[0].callback();
  assert.equal(state.scheduleTurn.id, "afternoon");
  assert.equal(timers[1].delay, 5000);
  fixture.advance(10000); timers[1].callback();
  assert.equal(state.scheduleTurn.id, "morning");
  state.scheduleAuto = false;
  context.startScheduleTurnTimer(establishment);
  const count = timers.length;
  timers.at(-1).callback();
  assert.equal(state.scheduleTurn.id, "morning");
  assert.equal(timers.length, count);
  context.moveScheduleTurn(establishment, -1);
  assert.equal(state.scheduleTurn.id, "afternoon");
  assert.equal(timers.length, count);
});

test("atualizações da agenda não reiniciam a contagem, mas as setas concedem cinco segundos", () => {
  const fixture = timerFixture();
  fixture.context.startScheduleTurnTimer(establishment);
  fixture.advance(2000);
  fixture.context.startScheduleTurnTimer(establishment);
  assert.equal(fixture.timers.at(-1).delay, 3000);
  fixture.context.moveScheduleTurn(establishment, 1);
  assert.equal(fixture.state.scheduleTurn.id, "afternoon");
  assert.equal(fixture.timers.at(-1).delay, 5000);
  assert.ok(fixture.cleared.includes(1));
});
