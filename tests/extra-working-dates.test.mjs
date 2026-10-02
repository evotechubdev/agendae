import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { businessDayIsClosed, businessOpeningMinutes, appointmentDurationMinutes } from "../frontend/schedule-model.mjs";

const establishment = { hours: [{ label: "Domingo", value: "Fechado" }], professionals: [{ name: "Rafael", availableTimes: ["08:00", "08:20"] }] };
test("expediente extra só libera a data específica e remover recupera o fechamento normal", () => {
  const extra = { ...establishment, extraWorkingDates: { "2026-09-27": true } };
  assert.equal(businessDayIsClosed(extra, "2026-09-27"), false);
  assert.equal(businessOpeningMinutes(extra, "2026-09-27"), 480);
  assert.equal(businessDayIsClosed(extra, "2026-10-04"), true);
  assert.equal(businessDayIsClosed({ ...extra, extraWorkingDates: {} }, "2026-09-27"), true);
});

test("salvar e remover exceções preserva o expediente semanal e outras datas", async () => {
  const source = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
  const writes = [];
  let saved = { ...establishment };
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const future = "2099-10-04";
  const context = vm.createContext({ db: {}, doc: () => "establishment", Date, appointmentDurationMinutes,
    runTransaction: async (_db, callback) => callback({ get: async () => ({ data: () => saved }), update: (_ref, data) => { writes.push(data); saved = { ...saved, ...data }; } }),
  });
  vm.runInContext(source.slice(source.indexOf("export async function updateExtraWorkingDate("), source.indexOf("async function professionalAppointments(")).replace("export ", ""), context);
  await context.updateExtraWorkingDate("demo", date, true);
  await context.updateExtraWorkingDate("demo", future, true);
  await context.updateExtraWorkingDate("demo", date, false);
  assert.equal(saved.extraWorkingDates[future], true);
  assert.equal(saved.extraWorkingDates[date], undefined);
  assert.equal(saved.hours, establishment.hours);
  assert.ok(writes.every(write => !Object.hasOwn(write, "hours")));
  await assert.rejects(context.updateExtraWorkingDate("demo", "2020-01-01", true), /hoje ou uma data futura/);
  await assert.rejects(context.updateExtraWorkingDate("demo", "2099-02-31", true), /hoje ou uma data futura/);
});

test("preparar QR preserva o token existente e sincroniza durações para reservas antigas", async () => {
  const source = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
  const writes = [];
  const context = vm.createContext({ db: {}, appointmentDurationMinutes,
    doc: (_db, ...parts) => parts.join("/"),
    runTransaction: async (_db, callback) => callback({
      get: async ref => ref.endsWith("/config") ? { exists: () => true, data: () => ({ token: "existing" }) } : { data: () => ({ services: [{ name: "Combo", duration: 70 }] }) },
      update: (ref, data) => writes.push({ ref, data }),
    }),
  });
  vm.runInContext(source.slice(source.indexOf("export async function getOrCreateCheckInConfig("), source.indexOf("export async function confirmPresenceWithQr(")).replace("export ", ""), context);
  const config = await context.getOrCreateCheckInConfig("demo");
  assert.equal(config.token, "existing");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.serviceDurations.Combo, 70);
});
