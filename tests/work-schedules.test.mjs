import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { scheduleFromPeriods, scheduleMatrix, workPeriodsFor, lunchBreakFor, serviceFitsSlot, serviceAvailableAt, isLunchTime, businessDayIsClosed, appointmentDurationMinutes } from "../frontend/schedule-model.mjs";

const source = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
function fixture(bookings = []) {
  const original = { professionals: [{ name: "A", ...scheduleFromPeriods([{ start: "08:00", end: "12:00" }]) }, { name: "B", availableTimes: ["09:00"] }], services: [{ name: "Combo", duration: 70 }] };
  const writes = [];
  const context = vm.createContext({
    db: {}, doc: (_db, ...parts) => parts.join("/"), collection: () => "slots", where: () => null, query: () => null,
    getDocs: async () => ({ docs: bookings.map(item => ({ data: () => item })) }),
    scheduleFromPeriods, scheduleMatrix, workPeriodsFor, lunchBreakFor, serviceFitsSlot, serverTimestamp: () => "now",
    runTransaction: async (_db, callback) => callback({ get: async () => ({ data: () => original }), update: (ref, value) => writes.push({ ref, value }) }),
  });
  const start = source.indexOf("export async function updateProfessionalWorkPeriods(");
  const end = source.indexOf("export async function saveProfessional(", start);
  const lunchStart = source.indexOf("export async function updateProfessionalLunchBreak(");
  vm.runInContext(source.slice(lunchStart, start).replace("export ", ""), context);
  vm.runInContext(source.slice(start, end).replace("export ", ""), context);
  return { context, writes, original };
}

test("salvar várias escalas preserva os demais profissionais e gera horários interligados", async () => {
  const { context, writes, original } = fixture();
  const saved = await context.updateProfessionalWorkPeriods("demo", "A", [{ start: "08:00", end: "10:00" }, { start: "11:00", end: "12:00" }]);
  assert.equal(writes.length, 1);
  assert.deepEqual(saved[1], original.professionals[1]);
  assert.deepEqual(saved[0].availableTimes, ["08:00", "08:20", "08:40", "09:00", "09:20", "09:40", "11:00", "11:20", "11:40"]);
});

test("reservas respeitam a duração inteira do serviço e não sobrepõem os horários seguintes", async () => {
  const { original } = fixture();
  const existing = { date: "2099-01-01", time: "09:00", professional: "A", service: "Combo" };
  const writes = [];
  const context = vm.createContext({
    db: {}, doc: (_db, ...parts) => parts.join("/"), collection: () => "appointments", documentKey: value => value.toLowerCase(),
    appointmentLookupKey: async () => "lookup", appointmentCodeLookupKey: async () => "code",
    scheduleMatrix, lunchBreakFor, isLunchTime, serviceFitsSlot, serviceAvailableAt, businessDayIsClosed, appointmentDurationMinutes, serverTimestamp: () => "now",
    slotRefsForAppointment: (_slug, item) => [`establishments/demo/slots/${item.date}_${item.time.replace(":", "")}_${item.professional.toLowerCase()}`, `establishments/demo/slots/${item.date}_${item.time.replace(":", "")}_establishment`],
    runTransaction: async (_db, callback) => callback({
      get: async ref => ref === "establishments/demo" ? { data: () => original } : { exists: () => ref === "establishments/demo/slots/2099-01-01_0900_a", data: () => existing, id: "2099-01-01_0900_a" },
      set: (ref, data) => writes.push({ ref, data }),
    }),
  });
  const start = source.indexOf("export async function createAppointment(");
  const end = source.indexOf("export async function getOrCreateCheckInConfig(", start);
  vm.runInContext(source.slice(start, end).replace("export ", ""), context);
  for (const time of ["08:40", "09:20", "10:00"]) {
    await assert.rejects(context.createAppointment("demo", { date: "2099-01-01", time, service: "Combo", professional: "A", client: "Cliente", checkInCode: "ABC123" }), /sobrepõe/);
  }
  assert.equal(writes.length, 0);
});

test("alterar a escala não pode remover uma reserva ou cortar sua duração", async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { context, writes } = fixture([{ date: tomorrow, time: "09:00", service: "Combo", professional: "A" }]);
  await assert.rejects(context.updateProfessionalWorkPeriods("demo", "A", [{ start: "08:00", end: "10:00" }]), /conflita com um agendamento/);
  await assert.rejects(context.updateProfessionalWorkPeriods("demo", "A", [{ start: "11:00", end: "12:00" }]), /conflita com um agendamento/);
  assert.equal(writes.length, 0);
});

test("dias de almoço não podem bloquear uma reserva futura", async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const weekday = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date(`${tomorrow}T12:00:00Z`).getUTCDay()];
  const { context, writes } = fixture([{ date: tomorrow, time: "09:00", service: "Combo", professional: "A" }]);
  await assert.rejects(context.updateProfessionalLunchBreak("demo", "A", { start: "09:00", end: "10:00", days: [weekday] }), /conflita com um agendamento/);
  assert.equal(writes.length, 0);
});
