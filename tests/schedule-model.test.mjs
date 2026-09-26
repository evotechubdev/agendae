import test from "node:test";
import assert from "node:assert/strict";
import { scheduleMatrix } from "../frontend/schedule-model.mjs";

test("colunas incluem os horários distintos de todos os profissionais sem criar disponibilidade", () => {
  const matrix = scheduleMatrix({ professionals: [
    { name: "Renam", availableTimes: ["08:40", "08:00", "08:00", "09:20"] },
    { name: "Carlos", availableTimes: ["10:15", "12:45"] },
    { name: "Marcos", availableTimes: ["09:30", "18:00"] },
  ] });
  assert.deepEqual(matrix.times, ["08:00", "08:40", "09:20", "09:30", "10:15", "12:45", "18:00"]);
  assert.deepEqual(matrix.professionals.map((item) => item.name), ["Renam", "Carlos", "Marcos"]);
  assert.deepEqual(matrix.professionals[0].periods, ["08:00", "08:40", "09:20", null, null, null, null]);
  assert.deepEqual(matrix.professionals[1].periods, [null, null, null, null, "10:15", "12:45", null]);
  assert.deepEqual(matrix.professionals[2].periods, [null, null, null, "09:30", null, null, "18:00"]);
});

test("agenda compartilhada usa a grade do estabelecimento para todas as linhas", () => {
  const matrix = scheduleMatrix({ scheduleMode: "establishment", availableTimes: ["10:00", "09:00"], professionals: ["Renam", { name: "Carlos", availableTimes: ["12:00"] }] });
  assert.deepEqual(matrix.times, ["09:00", "10:00"]);
  assert.deepEqual(matrix.professionals.map((item) => item.periods), [["09:00", "10:00"], ["09:00", "10:00"]]);
});

test("profissional sem horários continua na grade e horários inválidos não viram colunas", () => {
  const matrix = scheduleMatrix({ professionals: [{ name: "Renam", availableTimes: ["24:00", "12:99", "texto", "10:00"] }, { name: "Carlos", availableTimes: [] }] });
  assert.deepEqual(matrix.times, ["10:00"]);
  assert.deepEqual(matrix.professionals[1].periods, [null]);
});

test("horários de meia hora e intervalos diferentes compartilham uma coluna por horário real", () => {
  const matrix = scheduleMatrix({ professionals: [
    { name: "Renam", availableTimes: ["08:00", "08:30", "09:00"] },
    { name: "Carlos", availableTimes: ["08:15", "08:45", "09:15"] },
    { name: "Marcos", availableTimes: ["8:30", "08:30", "09:00"] },
  ] });
  assert.deepEqual(matrix.times, ["08:00", "08:15", "08:30", "08:45", "09:00", "09:15"]);
  assert.deepEqual(matrix.professionals[0].periods, ["08:00", null, "08:30", null, "09:00", null]);
  assert.deepEqual(matrix.professionals[1].periods, [null, "08:15", null, "08:45", null, "09:15"]);
  assert.deepEqual(matrix.professionals[2].periods, [null, null, "08:30", null, "09:00", null]);
});

test("profissionais com intervalos de 20 e 30 minutos mantêm suas próprias disponibilidades", () => {
  const matrix = scheduleMatrix({ professionals: [
    { name: "A", availableTimes: ["08:00", "08:20", "08:40", "09:00"] },
    { name: "B", availableTimes: ["08:00", "08:30", "09:00"] },
    { name: "C", availableTimes: ["09:00", "09:30"] },
  ] });
  assert.deepEqual(matrix.times, ["08:00", "08:20", "08:30", "08:40", "09:00", "09:30"]);
  assert.deepEqual(matrix.professionals[0].periods, ["08:00", "08:20", null, "08:40", "09:00", null]);
  assert.deepEqual(matrix.professionals[1].periods, ["08:00", null, "08:30", null, "09:00", null]);
  assert.deepEqual(matrix.professionals[2].periods, [null, null, null, null, "09:00", "09:30"]);
});
