import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
const start = source.indexOf("export async function saveProfessional(");
const end = source.indexOf("export async function loadPublicData(", start);

function fixture(bookings = []) {
  const establishment = {
    professionals: [{ name: "Ana", role: "Cabeleireira", availableTimes: ["09:00"] }],
    services: [{ id: "corte", name: "Corte", duration: 20, price: 30, icon: "✦" }],
    availableTimes: ["09:00"],
  };
  const writes = [];
  const context = vm.createContext({
    db: {},
    doc: (_db, ...parts) => parts.join("/"),
    collection: () => "slots", where: () => null, query: () => null,
    getDocs: async () => ({ docs: bookings.map(booking => ({ data: () => booking })) }),
    documentKey: value => value.toLowerCase(),
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

test("preço pode mudar, mas duração de serviço reservado não", async () => {
  const { context, writes } = fixture([{ date: "2099-01-01", service: "Corte", time: "09:00" }]);
  const details = { name: "Corte", duration: 20, price: 35, icon: "✦" };
  const services = await context.saveService("demo", "corte", details);
  assert.equal(services[0].price, 35);
  assert.equal(writes.length, 1);
  await assert.rejects(context.saveService("demo", "corte", { ...details, duration: 40 }), /reservas futuras/);
  assert.equal(writes.length, 1);
});
