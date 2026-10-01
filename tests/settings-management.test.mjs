import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { normalizeWeeklyAvailability, normalizeReservedService } from "../frontend/establishment-model.mjs";
import { serviceAvailableAt, appointmentDurationMinutes } from "../frontend/schedule-model.mjs";

const source = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
const start = source.indexOf("export async function saveProfessional(");
const end = source.indexOf("export async function loadPublicData(", start);

function fixture(bookings = []) {
  const establishment = {
    professionals: [{ name: "Ana", role: "Cabeleireira", availableTimes: ["09:00"] }],
    services: [{ id: "corte", name: "Corte", duration: 20, price: 30, icon: "✦" }],
    address2: "Rua B, 20",
    availableTimes: ["09:00"],
  };
  const writes = [];
  const context = vm.createContext({
    db: {},
    doc: (_db, ...parts) => parts.join("/"),
    collection: () => "slots", where: () => null, query: () => null,
    getDocs: async () => ({ docs: bookings.map(booking => ({ data: () => booking })) }),
    getDoc: async () => ({ exists: () => true, data: () => establishment }),
    updateDoc: async (_reference, value) => writes.push(value),
    crypto: { randomUUID: () => "reserved-1" },
    documentKey: value => value.toLowerCase(),
    normalizeWeeklyAvailability, normalizeReservedService, serviceAvailableAt, appointmentDurationMinutes, URL,
    serverTimestamp: () => "now",
    runTransaction: async (_db, callback) => callback({
      get: async () => ({ exists: () => true, data: () => establishment }),
      update: (_reference, value) => writes.push(value),
    }),
  });
  vm.runInContext(source.slice(start, end).replaceAll("export ", ""), context);
  return { context, establishment, writes };
}

test("cadastrar funcionário preserva a escala dos demais", async () => {
  const { context, writes } = fixture();
  const result = await context.saveProfessional("demo", "", { name: "Bruno", role: "Barbeiro" });
  assert.equal(result.professionals.length, 2);
  assert.deepEqual(result.professionals[0].availableTimes, ["09:00"]);
  assert.equal(result.professionals[1].availableTimes.length, 0);
  assert.equal(writes[0].professionals[1].name, "Bruno");
});

test("reserva futura impede renomear funcionário", async () => {
  const { context, writes } = fixture([{ date: "2099-01-01", professional: "Ana", time: "09:00" }]);
  await assert.rejects(context.saveProfessional("demo", "Ana", { name: "Ana Maria", role: "Cabeleireira" }), /reservas futuras/);
  assert.equal(writes.length, 0);
});

test("renomear profissional atualiza seu serviço reservado e impede exclusão acidental", async () => {
  const { context, establishment } = fixture();
  establishment.reservedServices = [{ id: "hospital", professional: "Ana", name: "Plantão", place: "Hospital Central", weekday: "qua", start: "09:00", end: "12:00" }];
  const changed = await context.saveProfessional("demo", "Ana", { name: "Ana Maria", role: "Nutricionista" });
  assert.equal(changed.reservedServices[0].professional, "Ana Maria");
  establishment.professionals = changed.professionals;
  establishment.reservedServices = changed.reservedServices;
  await assert.rejects(context.removeProfessional("demo", "Ana Maria"), /serviços reservados/);
});

test("preço pode mudar, mas duração de serviço reservado não", async () => {
  const { context, writes } = fixture([{ date: "2099-01-01", service: "Corte", time: "09:00" }]);
  const details = { name: "Corte", duration: 20, price: 35, icon: "✦" };
  const services = await context.saveService("demo", "corte", details);
  assert.equal(services[0].price, 35);
  assert.equal(writes.length, 1);
  await assert.rejects(context.saveService("demo", "corte", { ...details, duration: 40 }), /reservas futuras/);
  assert.equal(writes.length, 1);
});

test("serviço salva local e múltiplos intervalos semanais", async () => {
  const { context, writes } = fixture();
  const weeklyAvailability = { seg: [{ start: "08:00", end: "10:00" }, { start: "14:00", end: "16:00" }] };
  const services = await context.saveService("demo", "corte", { name: "Corte", duration: 20, price: 30, icon: "✦", locationType: "address2", weeklyAvailability });
  assert.equal(services[0].locationType, "address2");
  assert.deepEqual(services[0].weeklyAvailability.seg, weeklyAvailability.seg);
  assert.equal(writes.length, 1);
});

test("mudança de horário do serviço preserva reservas futuras", async () => {
  const date = "2099-01-01";
  const weekday = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date(`${date}T12:00:00Z`).getUTCDay()];
  const { context, writes } = fixture([{ date, time: "09:00", service: "Corte" }]);
  await assert.rejects(context.saveService("demo", "corte", { name: "Corte", duration: 20, price: 30, icon: "✦", weeklyAvailability: { [weekday]: [{ start: "10:00", end: "11:00" }] } }), /reservas futuras/);
  assert.equal(writes.length, 0);
});

test("serviço reservado salva o hospital e recusa conflito com reserva futura", async () => {
  const details = { name: "Atendimento hospitalar", professional: "Ana", place: "Hospital Central", weekday: "qua", start: "09:00", end: "12:00" };
  const { context, establishment, writes } = fixture();
  const saved = await context.saveReservedService("demo", "", details);
  assert.equal(saved[0].place, "Hospital Central");
  assert.equal(saved[0].id, "reserved-1");
  assert.equal(writes[0].reservedServices[0].weekday, "qua");
  establishment.reservedServices = saved;
  const removed = await context.removeReservedService("demo", "reserved-1");
  assert.equal(removed.length, 0);
  const conflict = fixture([{ date: "2099-01-07", time: "09:00", professional: "Ana", service: "Corte" }]);
  const weekday = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date("2099-01-07T12:00:00Z").getUTCDay()];
  await assert.rejects(conflict.context.saveReservedService("demo", "", { ...details, weekday }), /agendamentos futuros/);
  assert.equal(conflict.writes.length, 0);
});
