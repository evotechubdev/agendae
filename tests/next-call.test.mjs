import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { scheduleMatrix } from "../frontend/schedule-model.mjs";

const source = readFileSync(new URL("../frontend/firebase-service.js", import.meta.url), "utf8");
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

function fixture(withPending = true) {
  const current = { id: "a", date: today, time: "09:00", professional: "Ana", client: "Cliente A", service: "Corte", status: "atendendo" };
  const pending = { id: "b", date: today, time: "09:20", professional: "Ana", client: "Cliente B", service: "Corte", status: "confirmado" };
  const appointments = withPending ? [current, pending] : [current];
  const updates = [], sets = [];
  const context = vm.createContext({
    db: {},
    doc: (_db, ...parts) => parts.join("/"),
    documentKey: value => value.toLowerCase(),
    serverTimestamp: () => "now",
    professionalAppointments: async () => appointments,
    nextEligibleAppointment: (items, excluded) => items.find(item => item.id !== excluded && ["confirmado", "presente"].includes(item.status)) || null,
    slotRefsForAppointment: (_slug, item) => [`slot:${item.time}`],
    existingAppointmentSlot: async (_transaction, _slug, item) => `slot:${item.time}`,
    isLunchTime: () => false,
    lunchBreakFor: () => null,
    scheduleMatrix,
    runTransaction: async (_db, callback) => callback({
      get: async ref => {
        if (ref === "establishments/demo") return { exists: () => true, data: () => ({ professionals: [{ name: "Ana", availableTimes: ["09:00", "09:20"], scheduleStart: "00:00", scheduleEnd: "24:00" }] }) };
        if (ref.includes("/staffStatus/")) return { exists: () => false };
        if (ref.startsWith("slot:")) {
          const slot = ref === "slot:09:00" ? { professional: "Ana", time: "09:00", status: "atendendo" } : withPending ? { professional: "Ana", time: "09:20", status: "confirmado" } : null;
          return { exists: () => Boolean(slot), data: () => slot };
        }
        const item = appointments.find(value => ref.endsWith(`/appointments/${value.id}`));
        return { id: item?.id, exists: () => Boolean(item), data: () => item };
      },
      update: (ref, value) => updates.push({ ref, value }),
      set: (ref, value) => sets.push({ ref, value }),
    }),
  });
  const start = source.indexOf("export async function finishProfessionalTurn(");
  const end = source.indexOf("export async function addQueueTicket(", start);
  vm.runInContext(source.slice(start, end).replace("export ", ""), context);
  return { context, updates, sets };
}

test("chamar a próxima conclui a atual e inicia a seguinte na mesma transação", async () => {
  const { context, updates, sets } = fixture();
  const result = await context.finishProfessionalTurn("demo", "Ana", today, "next");
  assert.equal(result.next.id, "b");
  assert.equal(updates.find(item => item.ref.endsWith("/appointments/a")).value.status, "concluido");
  assert.equal(updates.find(item => item.ref.endsWith("/appointments/b")).value.status, "atendendo");
  assert.equal(sets.find(item => item.ref.includes("/staffStatus/")).value.currentAppointmentId, "b");
});

test("pausa conclui a atual sem chamar outra senha", async () => {
  const { context, updates, sets } = fixture();
  await context.finishProfessionalTurn("demo", "Ana", today, "pause");
  assert.equal(updates.find(item => item.ref.endsWith("/appointments/a")).value.status, "concluido");
  assert.equal(updates.some(item => item.ref.endsWith("/appointments/b")), false);
  assert.equal(sets.find(item => item.ref.includes("/staffStatus/")).value.paused, true);
});

test("encerrar expediente exige que não haja reservas pendentes", async () => {
  const pending = fixture();
  await assert.rejects(pending.context.finishProfessionalTurn("demo", "Ana", today, "close"), /reservas pendentes/);
  assert.equal(pending.updates.length, 0);
  const clear = fixture(false);
  await clear.context.finishProfessionalTurn("demo", "Ana", today, "close");
  assert.equal(clear.sets.find(item => item.ref.includes("/staffStatus/")).value.closedDate, today);
  assert.equal(clear.updates.find(item => item.ref === "establishments/demo").value.staffClosedDates.Ana, today);
});

test("popup oferece próxima senha, pausa e encerramento com confirmação do atendimento atual", () => {
  const page = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
  const state = { nextCallProfessional: "Ana" };
  const appointments = [
    { date: today, professional: "Ana", client: "Cliente A", time: "09:00", status: "atendendo" },
    { date: today, professional: "Ana", client: "Cliente B", time: "09:20", status: "confirmado" },
  ];
  const context = vm.createContext({
    state, session: () => ({ slug: "demo" }),
    getAdminData: () => ({ appointments }),
    cloudCache: new Map([["admin:demo", {}]]),
    isoDate: () => today,
    professionalIsPaused: () => false,
    professionalDirectory: () => [{ name: "Ana" }],
    professionalIsOnShift: () => true,
    escapeHTML: value => String(value),
  });
  const start = page.indexOf("function nextCallModal(");
  const end = page.indexOf("function renderEstablishmentPublic(", start);
  vm.runInContext(page.slice(start, end), context);
  const markup = context.nextCallModal({ slug: "demo" });
  assert.match(markup, /Cliente A/);
  assert.match(markup, /data-next-call-action="next"/);
  assert.match(markup, /data-next-call-action="pause"/);
  assert.match(markup, /data-next-call-action="close"[^>]*disabled/);
  appointments.pop();
  assert.doesNotMatch(context.nextCallModal({ slug: "demo" }), /data-next-call-action="close"[^>]*disabled/);
});

test("reserva pública não grava horário de funcionário com expediente encerrado", async () => {
  const context = vm.createContext({
    db: {},
    doc: (...parts) => parts.join("/"),
    collection: (...parts) => parts.join("/"),
    documentKey: value => value.toLowerCase(),
    appointmentLookupKey: async () => "name",
    appointmentCodeLookupKey: async () => "code",
    isLunchTime: () => false,
    lunchBreakFor: () => null,
    runTransaction: async (_db, callback) => callback({
      get: async ref => ref.includes("/staffStatus/")
        ? { exists: () => true, data: () => ({ closedDate: today }) }
        : { exists: () => false, data: () => ({}) },
    }),
  });
  const start = source.indexOf("export async function createAppointment(");
  const end = source.indexOf("export async function getOrCreateCheckInConfig(", start);
  vm.runInContext(source.slice(start, end).replace("export ", ""), context);
  await assert.rejects(context.createAppointment("demo", {
    date: today, time: "09:00", professional: "Ana", service: "Corte", client: "Cliente", checkInCode: "ABC123",
  }), /expediente deste profissional foi encerrado/);
});
