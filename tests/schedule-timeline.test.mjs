import test from "node:test";
import assert from "node:assert/strict";
import { scheduleTimeline, scheduleBands, serviceDurationFor, serviceFitsSlot } from "../frontend/schedule-model.mjs";

const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

test("linha do tempo possui marcas de uma hora sem criar horários para reserva", () => {
  const timeline = scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["08:00", "08:40", "09:20"] }, { name: "B", availableTimes: ["08:30", "09:00"] }] });
  assert.equal(timeline.step, 10);
  assert.equal(timeline.majorStep, 60);
  assert.deepEqual(timeline.times.filter((_, index) => index % (timeline.majorStep / timeline.step) === 0), ["08:00", "09:00"]);
  assert.equal(timeline.endTime, "10:00");
  assert.ok(timeline.times.includes("08:10"));
  assert.ok(timeline.times.slice(1).every((time, index) => minutes(time) - minutes(timeline.times[index]) === 10));
  assert.deepEqual(timeline.professionals[0].segments.filter((segment) => segment.type === "slot").map((segment) => segment.time), ["08:00", "08:40", "09:20"]);
  assert.equal(timeline.professionals[0].segments[0].end, 2);
  assert.equal(timeline.professionals[1].segments[0].type, "unavailable");
});

test("horários entre marcas de uma hora conservam a posição e o horário exatos", () => {
  const timeline = scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["08:15", "08:45", "09:15"] }] });
  assert.equal(timeline.majorStep, 60);
  assert.equal(timeline.step, 5);
  const slots = timeline.professionals[0].segments.filter((segment) => segment.type === "slot");
  assert.deepEqual(slots.map((segment) => timeline.times[segment.start]), ["08:15", "08:45", "09:15"]);
  assert.deepEqual(slots.map((segment) => segment.time), ["08:15", "08:45", "09:15"]);
});

test("todas as senhas SI duram vinte minutos, inclusive BSI-03 e BSI-04 separadas por lacunas", () => {
  const establishment = { professionals: [{ name: "Bruno Alves", availableTimes: ["09:20", "10:00", "10:40", "11:20", "13:00", "13:40"] }, { name: "Outro", availableTimes: ["08:00", "09:30"] }] };
  const timeline = scheduleTimeline(establishment);
  const slots = timeline.professionals.flatMap((professional) => professional.segments.filter((segment) => segment.type === "slot"));
  assert.ok(slots.every((segment) => (segment.end - segment.start) * timeline.step === 20));
  assert.equal(serviceDurationFor(establishment, "Bruno Alves"), 20);
  assert.equal(serviceDurationFor(establishment, "Outro", "Serviço indefinido"), 20);
  const interval = timeline.professionals[0].segments.find((segment) => segment.time === "11:20");
  assert.equal(timeline.times[interval.end], "11:40");
});

test("serviço reservado usa a duração do cadastro sem se estender até a próxima senha", () => {
  const establishment = { services: [{ name: "Corte", duration: 40 }, { name: "Barba", duration: 30 }], professionals: [{ name: "A", availableTimes: ["08:00", "08:40", "10:00", "11:20"] }] };
  const timeline = scheduleTimeline(establishment, [{ time: "08:00", professional: "A", service: "Corte" }, { time: "10:00", professional: "A", service: "Corte" }, { time: "11:20", professional: "A", service: "Barba" }]);
  const duration = (time) => { const segment = timeline.professionals[0].segments.find((item) => item.time === time); return (segment.end - segment.start) * timeline.step; };
  assert.equal(duration("08:00"), 40);
  assert.equal(duration("10:00"), 40);
  assert.equal(duration("11:20"), 30);
});

test("serviço longo ocupa sua duração inteira e bloqueia os inícios que sobrepõem a reserva", () => {
  const establishment = { services: [{ name: "Combo", duration: 70 }], professionals: [{ name: "A", availableTimes: ["08:00", "08:40", "09:20"] }, { name: "B", availableTimes: ["08:40"] }] };
  const bookings = [{ time: "08:00", professional: "A", service: "Combo" }];
  const timeline = scheduleTimeline(establishment, bookings);
  const segment = timeline.professionals[0].segments.find((item) => item.time === "08:00");
  assert.equal((segment.end - segment.start) * timeline.step, 70);
  assert.equal(timeline.professionals[0].segments.some((item) => item.time === "08:40"), false);
  assert.equal(serviceFitsSlot(establishment, "A", "08:40", undefined, bookings), false);
  assert.equal(serviceFitsSlot(establishment, "B", "08:40", undefined, bookings), true);
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

test("expediente completo aparece mesmo quando a agenda individual cobre apenas parte do dia", () => {
  const timeline = scheduleTimeline({ hours: [{ label: "Segunda a sexta", value: "08:00 — 19:00" }, { label: "Sábado", value: "08:00 — 17:00" }], professionals: [{ name: "A", availableTimes: ["10:00", "10:40", "11:20"] }] });
  assert.equal(timeline.startTime, "08:00");
  assert.equal(timeline.endTime, "19:00");
  assert.equal(timeline.professionals[0].segments[0].type, "unavailable");
  assert.deepEqual(timeline.professionals[0].segments.filter((segment) => segment.type === "slot").map((segment) => segment.time), ["10:00", "10:40", "11:20"]);
});

test("horário que começou durante o almoço não vira reserva disponível ao retornar", () => {
  const timeline = scheduleTimeline({ professionals: [{ name: "A", availableTimes: ["11:20", "13:00", "13:40", "14:20"] }], professionalLunchBreaks: { A: { start: "12:30", end: "13:30" } } });
  const index = timeline.times.indexOf("13:30");
  const segment = timeline.professionals[0].segments.find((item) => item.start <= index && item.end > index);
  assert.equal(segment.type, "unavailable");
  assert.ok(timeline.professionals[0].segments.every((item) => item.type !== "slot" || item.time !== "13:00"));
});
