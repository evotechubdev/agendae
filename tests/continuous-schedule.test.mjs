import test from "node:test";
import assert from "node:assert/strict";
import { continuousSchedule, scheduleTimeline, scheduleFromPeriods, serviceFitsSlot } from "../frontend/schedule-model.mjs";
import { queueView } from "../frontend/queue-model.mjs";

test("cada senha SI termina exatamente no início da próxima", () => {
  const schedule = continuousSchedule("08:00", "10:00");
  assert.deepEqual(schedule.availableTimes, ["08:00", "08:20", "08:40", "09:00", "09:20", "09:40"]);
  const timeline = scheduleTimeline({ professionals: [{ name: "A", ...schedule }] });
  const slots = timeline.professionals[0].segments.filter(item => item.type === "slot");
  assert.ok(slots.every(item => (item.end - item.start) * timeline.step === 20));
  assert.ok(slots.slice(1).every((item, index) => item.start === slots[index].end));
});

test("múltiplas escalas usam a mesma linha do tempo e encadeiam cada período", () => {
  const first = scheduleFromPeriods([{ start: "08:00", end: "10:00" }, { start: "11:00", end: "13:00" }]);
  const second = scheduleFromPeriods([{ start: "09:15", end: "11:15" }]);
  assert.deepEqual(first.pauseIntervals, [{ start: "10:00", end: "11:00", reason: "Intervalo" }]);
  const establishment = { professionals: [{ name: "A", ...first }, { name: "B", ...second }] };
  const timeline = scheduleTimeline(establishment);
  assert.equal(timeline.majorStep, 60);
  for (const professional of timeline.professionals) {
    const slots = professional.segments.filter(item => item.type === "slot");
    assert.ok(slots.every(item => (item.end - item.start) * timeline.step === 20));
    for (let i = 1; i < slots.length; i++) {
      const previous = slots[i - 1];
      assert.ok(previous.end === slots[i].start || professional.segments.some(item => item.type === "pause" && item.start === previous.end && item.end === slots[i].start));
    }
  }
  assert.equal(serviceFitsSlot(establishment, "A", "09:50"), false);
  assert.equal(serviceFitsSlot(establishment, "A", "10:00"), false);
  assert.equal(serviceFitsSlot(establishment, "A", "11:00"), true);
});

test("escalas inválidas, sobrepostas ou sem atendimento completo são rejeitadas", () => {
  for (const periods of [[], [{ start: "08:00", end: "08:10" }], [{ start: "08:60", end: "10:00" }], [{ start: "11:00", end: "10:00" }], [{ start: "08:00", end: "10:00" }, { start: "09:00", end: "11:00" }]]) {
    assert.throws(() => scheduleFromPeriods(periods));
  }
});

test("almoço deslocado conserva senhas inteiras e retoma a sequência ao terminar", () => {
  const lunchBreak = { start: "12:30", end: "13:30" };
  const schedule = continuousSchedule("08:00", "18:20", lunchBreak);
  assert.ok(schedule.availableTimes.includes("12:00"));
  assert.equal(schedule.availableTimes.includes("12:20"), false);
  assert.ok(schedule.availableTimes.includes("13:30"));
  assert.ok(schedule.availableTimes.includes("13:50"));
  assert.deepEqual(schedule.pauseIntervals, [{ start: "12:20", end: "12:30", reason: "Intervalo" }, { start: "18:10", end: "18:20", reason: "Intervalo" }]);
  const establishment = { professionals: [{ name: "A", ...schedule, scheduleEnd: "18:20" }], professionalLunchBreaks: { A: lunchBreak } };
  const timeline = scheduleTimeline(establishment);
  const segments = timeline.professionals[0].segments;
  assert.equal(segments.find(item => timeline.times[item.start] === "12:20").type, "pause");
  assert.equal(segments.find(item => timeline.times[item.start] === "12:30").type, "lunch");
  for (const [time, state, reason] of [[12 * 60 + 20, "paused", "Intervalo"], [12 * 60 + 30, "paused", "Almoço"], [13 * 60 + 30, "in-service", undefined], [18 * 60 + 20, "closed", undefined]]) {
    const current = queueView(establishment, { todaySlots: [] }, { date: "2026-09-26", minutes: time }).current[0];
    assert.equal(current.ticketState, state);
    assert.equal(current.pauseReason, reason);
  }
});
