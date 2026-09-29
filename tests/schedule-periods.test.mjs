import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as schedule from "../frontend/schedule-model.mjs";
import * as queue from "../frontend/queue-model.mjs";
import * as calendar from "../frontend/calendar-model.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const establishment = { slug: "demo", professionals: [{ name: "Renam", ...schedule.scheduleFromPeriods([{ start: "08:00", end: "18:00" }]) }] };
const timeline = schedule.scheduleTimeline(establishment);

test("manhã e tarde dividem o expediente às treze horas em dois turnos de cinco horas", () => {
  const periods = schedule.scheduleDayPeriods(timeline);
  assert.deepEqual(periods.map(period => [period.id, period.startTime, period.endTime]), [["morning", "08:00", "13:00"], ["afternoon", "13:00", "18:00"]]);
  assert.ok(periods.every(period => (period.end - period.start) * timeline.step === 300));
  assert.deepEqual(periods.flatMap(period => period.times), timeline.times);
  assert.equal(periods[0].end, periods[1].start);
  assert.deepEqual(schedule.scheduleDayPeriods({ times: [] }), []);
  const afternoon = schedule.scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["14:00", "14:20"] }] });
  assert.equal(schedule.scheduleDayPeriods(afternoon).length, 1);
  assert.equal(schedule.scheduleDayPeriods(afternoon)[0].id, "afternoon");
});

function renderFixture(minutes = 8 * 60) {
  const state = { booking: { date: "2026-09-26", dateMode: "today", step: 1 }, scheduleAuto: true };
  const context = vm.createContext({ ...schedule, ...queue, ...calendar, state,
    getData: () => ({ slots: [] }), currentSaoPauloClock: () => ({ date: "2026-09-26", minutes }),
    professionalIsPaused: () => false, professionalIsClosed: () => false, professionalIsOnShift: () => true, currentProfessionalSlot: () => null, staffStatusFor: () => ({}),
    isoDate: () => "2026-09-26", prettyDate: () => "", ticketStatusLegend: () => "", escapeHTML: value => String(value),
  });
  vm.runInContext(source.slice(source.indexOf("function publicSchedule("), source.indexOf("function restoreScheduleScroll(")), context);
  return { context, state };
}

test("cada visualização mostra apenas seu turno e conserva a numeração do dia", () => {
  const { context, state } = renderFixture();
  let html = context.publicSchedule(establishment);
  assert.match(html, /Manhã, de 08:00 a 13:00/);
  assert.match(html, /RSI-01, Renam, 08:00/);
  assert.doesNotMatch(html, /RSI-16, Renam, 13:00/);
  state.scheduleTurn.id = "afternoon";
  html = context.publicSchedule(establishment);
  assert.match(html, /Tarde, de 13:00 a 18:00/);
  assert.match(html, /RSI-16, Renam, 13:00/);
  assert.doesNotMatch(html, /RSI-01, Renam, 08:00/);
  assert.match(html, /data-schedule-turn-auto checked/);
  state.scheduleAuto = false;
  assert.doesNotMatch(context.publicSchedule(establishment), /data-schedule-turn-auto checked/);
  assert.match(renderFixture(12 * 60 + 59).context.publicSchedule(establishment), /Manhã, de 08:00 a 13:00/);
  assert.match(renderFixture(13 * 60).context.publicSchedule(establishment), /Tarde, de 13:00 a 18:00/);
});

test("botão de próxima senha aparece junto ao avatar somente para equipe logada", () => {
  const { context, state } = renderFixture();
  assert.doesNotMatch(context.publicSchedule(establishment), /data-open-next-call/);
  context.session = () => ({ slug: "demo", name: "Outra pessoa" });
  const team = { ...establishment, professionals: [...establishment.professionals, { name: "Bia", ...schedule.scheduleFromPeriods([{ start: "08:00", end: "18:00" }]) }] };
  const teamMarkup = context.publicSchedule(team);
  assert.match(teamMarkup, /data-open-next-call="Renam"/);
  assert.match(teamMarkup, /data-open-next-call="Bia"/);
  state.booking.date = "2026-09-27";
  assert.match(context.publicSchedule(establishment), /data-open-next-call="Renam"[^>]*disabled/);
});

function timerFixture() {
  let now = 0;
  const timers = [], cleared = [];
  const state = { booking: { date: "2026-09-26" }, scheduleAuto: true, scheduleTurn: { key: "demo:2026-09-26", id: "morning", changedAt: 0 } };
  const body = { innerHTML: "" };
  const context = vm.createContext({ state, businessDayIsClosed: schedule.businessDayIsClosed, Date: { now: () => now },
    document: { querySelector: selector => selector === ".public-schedule-body" ? body : null, activeElement: null },
    getData: () => ({ slots: [] }), scheduleTimeline: () => timeline, scheduleDayPeriods: schedule.scheduleDayPeriods,
    publicSchedule: () => state.scheduleTurn.id, restoreScheduleScroll: () => {},
    clearTimeout: id => cleared.push(id), setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
  });
  vm.runInContext(`let scheduleTurnTimer = null;\n${source.slice(source.indexOf("function moveScheduleTurn("), source.indexOf("function restoreScheduleScroll("))}`, context);
  return { context, state, body, timers, cleared, advance: value => { now = value; } };
}

test("um atendimento que atravessa as treze horas mantém a mesma senha nos dois turnos", () => {
  const { context, state } = renderFixture();
  const booking = { date: "2026-09-26", time: "12:40", professional: "Renam", service: "Combo" };
  context.getData = () => ({ slots: [booking] });
  const configured = { ...establishment, services: [{ name: "Combo", duration: 70 }] };
  assert.match(context.publicSchedule(configured), /RCO-15, Renam, 12:40/);
  state.scheduleTurn.id = "afternoon";
  assert.match(context.publicSchedule(configured), /RCO-15, Renam, 12:40/);
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

test("selecionar um horário interrompe a alternância até a opção ser marcada novamente", async () => {
  for (const selector of ["[data-public-slot]", "[data-time]"]) {
    const fixture = timerFixture();
    const { context, state, timers, cleared } = fixture;
    const listeners = {};
    context.document.addEventListener = (type, handler) => { listeners[type] = handler; };
    context.activeEstablishment = () => establishment;
    context.render = () => context.startScheduleTurnTimer(establishment);
    vm.runInContext(source.slice(source.indexOf('document.addEventListener("click",'), source.indexOf('document.addEventListener("input",')), context);
    context.startScheduleTurnTimer(establishment);
    const originalTimer = timers[0];
    await listeners.click({ target: { matches: () => false, closest: value => value === selector ? { dataset: { professionalName: "Renam", slotTime: "08:20", time: "08:20" } } : null } });
    assert.equal(state.booking.time, "08:20");
    assert.equal(state.scheduleAuto, false);
    assert.ok(cleared.includes(1));
    assert.equal(timers.length, 1);
    fixture.advance(5000);
    originalTimer.callback();
    assert.equal(state.scheduleTurn.id, "morning");
    listeners.change({ target: { matches: value => value === "[data-schedule-turn-auto]", checked: true } });
    assert.equal(state.scheduleAuto, true);
    assert.equal(timers.at(-1).delay, 5000);
    fixture.advance(10000);
    timers.at(-1).callback();
    assert.equal(state.scheduleTurn.id, "afternoon");
  }
});

test("fechar o popup retoma a alternância com cinco segundos completos", () => {
  const fixture = timerFixture();
  fixture.context.pauseScheduleTurn();
  fixture.advance(17000);
  fixture.context.resumeScheduleTurn();
  fixture.context.startScheduleTurnTimer(establishment);
  assert.equal(fixture.state.scheduleAuto, true);
  assert.equal(fixture.timers.at(-1).delay, 5000);
  fixture.advance(22000);
  fixture.timers.at(-1).callback();
  assert.equal(fixture.state.scheduleTurn.id, "afternoon");
});

test("presença confirmada aparece apenas na reserva e mantém o código, a cor e o bloqueio", () => {
  const { context } = renderFixture();
  const booking = { date: "2026-09-26", time: "09:00", professional: "Renam", status: "confirmado" };
  context.getData = () => ({ slots: [booking] });
  assert.doesNotMatch(context.publicSchedule(establishment), /matrix-presence-confirmed/);
  booking.status = "presente";
  let html = context.publicSchedule(establishment);
  assert.match(html, /ticket-state-reserved[^>]*has-confirmed-presence[^>]*disabled[^>]*RSI-04, Renam, 09:00, Reservado, Presença Confirmada/);
  assert.match(html, /matrix-presence-confirmed">Presença Confirmada/);
  booking.status = "atendendo";
  html = context.publicSchedule(establishment);
  assert.doesNotMatch(html, /matrix-presence-confirmed/);
  assert.match(html, /RSI-04, Renam, 09:00, Em Atendimento/);
});
