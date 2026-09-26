import test from "node:test";
import assert from "node:assert/strict";
import { scheduleTimeline, scheduleBands } from "../frontend/schedule-model.mjs";

const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

test("linha do tempo possui marcas de vinte minutos sem criar horários para reserva", () => {
  const timeline = scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["08:00", "08:40", "09:20"] }, { name: "B", availableTimes: ["08:30", "09:00"] }] });
  assert.equal(timeline.step, 10);
  assert.equal(timeline.majorStep, 20);
  assert.deepEqual(timeline.times.filter((_, index) => index % (timeline.majorStep / timeline.step) === 0).slice(0, 4), ["08:00", "08:20", "08:40", "09:00"]);
  assert.ok(timeline.times.includes("08:10"));
  assert.ok(timeline.times.slice(1).every((time, index) => minutes(time) - minutes(timeline.times[index]) === 10));
  assert.deepEqual(timeline.professionals[0].segments.filter((segment) => segment.type === "slot").map((segment) => segment.time), ["08:00", "08:40", "09:20"]);
  assert.equal(timeline.professionals[0].segments[0].end, 4);
  assert.equal(timeline.professionals[1].segments[0].type, "unavailable");
});

test("horários entre marcas de vinte minutos conservam a posição e o horário exatos", () => {
  const timeline = scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["08:15", "08:45", "09:15"] }] });
  assert.equal(timeline.majorStep, 20);
  assert.equal(timeline.step, 5);
  const slots = timeline.professionals[0].segments.filter((segment) => segment.type === "slot");
  assert.deepEqual(slots.map((segment) => timeline.times[segment.start]), ["08:15", "08:45", "09:15"]);
  assert.deepEqual(slots.map((segment) => segment.time), ["08:15", "08:45", "09:15"]);
});

test("almoço ocupa seu intervalo inteiro e cada linha cobre todas as colunas sem sobreposição", () => {
  const timeline = scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["11:30", "12:00", "12:30", "13:00", "13:30"] }], professionalLunchBreaks: { A: { start: "12:00", end: "13:00" } } });
  const segments = timeline.professionals[0].segments;
  const lunch = segments.find((segment) => segment.type === "lunch");
  assert.equal(timeline.times[lunch.start], "12:00");
  assert.equal(timeline.times[lunch.end], "13:00");
  assert.equal((lunch.end - lunch.start) * timeline.step, 60);
  assert.ok(segments.slice(1).every((segment, index) => segment.start === segments[index].end));
  assert.equal(segments.at(-1).end, timeline.times.length);
  assert.deepEqual(scheduleBands(timeline.times, 12).flatMap((band) => band.times), timeline.times);
});

test("agenda vazia não inventa horários ou senhas", () => {
  assert.deepEqual(scheduleTimeline({ professionals: [] }).times, []);
});

test("horário que começou durante o almoço não vira reserva disponível ao retornar", () => {
  const timeline = scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["11:20", "13:00", "13:40", "14:20"] }], professionalLunchBreaks: { A: { start: "12:30", end: "13:30" } } });
  const index = timeline.times.indexOf("13:30");
  const segment = timeline.professionals[0].segments.find((item) => item.start <= index && item.end > index);
  assert.equal(segment.type, "unavailable");
  assert.ok(timeline.professionals[0].segments.every((item) => item.type !== "slot" || item.time !== "13:00"));
});
