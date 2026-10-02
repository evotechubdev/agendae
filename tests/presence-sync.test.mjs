import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { appointmentPresenceWindow as realPresenceWindow } from "../frontend/schedule-model.mjs";

const source = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
const appointment = { date: "2026-09-26", time: "09:00", professional: "Rafael", service: "Corte", status: "confirmado", durationMinutes: 20 };
function fixture(shared = false, now = "2026-09-26T09:00:00-03:00") {
  const writes = [];
  let committed = false;
  const slotId = `establishments/demo/slots/2026-09-26_0900_${shared ? "establishment" : "rafael"}`;
  const context = vm.createContext({ db: {},
    appointmentPresenceWindow: (establishment, item) => realPresenceWindow(establishment, item, new Date(now)),
    doc: (_db, ...parts) => parts.join("/"), documentKey: value => value.toLowerCase(), serverTimestamp: () => "now",
    getDoc: async ref => ({ ref, exists: () => ref === slotId || ref.endsWith("/appointments/id"), data: () => appointment }),
    writeBatch: () => ({ update: (ref, data) => writes.push({ ref, data }), set: (ref, data) => writes.push({ ref, data }), commit: async () => { committed = true; } }),
  });
  vm.runInContext(source.slice(source.indexOf("function slotRefsForAppointment("), source.indexOf("function nextEligibleAppointment(")), context);
  vm.runInContext(source.slice(source.indexOf("export async function confirmPresenceWithQr("), source.indexOf("async function professionalAppointments(")).replaceAll("export ", ""), context);
  return { context, writes, slotId, get committed() { return committed; } };
}

test("confirmar por QR ou pela equipe atualiza agendamento, presença e senha juntos nas duas modalidades de agenda", async () => {
  for (const shared of [false, true]) for (const method of ["qr", "employee"]) {
    const f = fixture(shared);
    if (method === "qr") await f.context.confirmPresenceWithQr("demo", "id", "token", appointment.date, true, appointment);
    else await f.context.confirmPresenceManually("demo", "id");
    assert.equal(f.committed, true);
    assert.equal(f.writes.length, 3);
    for (const write of f.writes) {
      assert.equal(write.data.status, "presente");
      assert.equal(write.data.checkedInAt, "now");
      assert.equal(write.data.checkInMethod, method);
    }
    const slotWrite = f.writes.find(write => write.ref === f.slotId);
    assert.equal(slotWrite.data.appointmentId, "id");
    assert.equal(slotWrite.data.client, undefined);
    assert.equal(slotWrite.data.phone, undefined);
  }
});

test("dados de horário ausentes ou divergentes não confirmam presença parcialmente", async () => {
  for (const selected of [undefined, { ...appointment, time: null }, { ...appointment, date: "2026-09-27" }]) {
    const f = fixture();
    await assert.rejects(f.context.confirmPresenceWithQr("demo", "id", "token", appointment.date, true, selected));
    assert.equal(f.writes.length, 0);
    assert.equal(f.committed, false);
  }
});

test("QR e confirmação manual rejeitam véspera, atraso e antecipação sem gravação parcial", async () => {
  for (const now of ["2026-09-25T09:00:00-03:00", "2026-09-26T07:59:59-03:00", "2026-09-26T09:20:01-03:00", "2026-09-27T09:00:00-03:00"]) {
    for (const method of ["qr", "employee"]) {
      const f = fixture(false, now);
      const request = method === "qr" ? f.context.confirmPresenceWithQr("demo", "id", "token", appointment.date, true, appointment) : f.context.confirmPresenceManually("demo", "id");
      await assert.rejects(request, /presença só pode ser confirmada/);
      assert.equal(f.writes.length, 0);
      assert.equal(f.committed, false);
    }
  }
});

test("a atualização ao vivo muda as senhas de hoje e preserva a agenda de outra data", () => {
  const page = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
  const todayKey = "public:demo:2026-09-26", futureKey = "public:demo:2026-09-27";
  const futureSlots = [{ date: "2026-09-27", time: "09:00", status: "confirmado" }];
  const cloudCache = new Map([[todayKey, { slots: [{ ...appointment, status: "confirmado" }] }], [futureKey, { slots: futureSlots }]]);
  let callback;
  const context = vm.createContext({ cloudCache, queueSubscriptionSlug: null, queueSubscription: null,
    firebaseApi: { observePublicState: (_slug, handler) => { callback = handler; } },
    publicCacheKey: (_est, date) => `public:demo:${date}`, isoDate: () => "2026-09-26",
    URLSearchParams, location: { search: "" }, route: () => "demo", session: () => null, render() {},
  });
  vm.runInContext(page.slice(page.indexOf("function ensureQueueSubscription("), page.indexOf("function professionalAvailability(")), context);
  context.ensureQueueSubscription({ slug: "demo" });
  const updated = [{ ...appointment, status: "presente" }];
  callback({ todaySlots: updated });
  assert.equal(cloudCache.get(todayKey).slots, updated);
  assert.equal(cloudCache.get(futureKey).slots, futureSlots);
  assert.equal(cloudCache.get(futureKey).todaySlots, updated);
});
