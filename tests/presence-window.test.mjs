import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { appointmentPresenceWindow, appointmentDurationMinutes } from "../frontend/schedule-model.mjs";

const establishment = { services: [{ name: "Corte", duration: 20 }, { name: "Combo", duration: 70 }] };
const appointment = { date: "2026-09-27", time: "09:20", professional: "Rafael", service: "Corte" };

test("presença das 09:20 abre exatamente às 08:20 e encerra às 09:40 na data real", () => {
  for (const [time, expected] of [["08:19:59.999", false], ["08:20:00", true], ["09:20:00", true], ["09:40:00", true], ["09:40:00.001", false]]) {
    assert.equal(appointmentPresenceWindow(establishment, appointment, new Date(`2026-09-27T${time}-03:00`)).allowed, expected, time);
  }
  for (const date of ["2026-09-26", "2026-09-28"]) {
    assert.equal(appointmentPresenceWindow(establishment, appointment, new Date(`${date}T09:20:00-03:00`)).allowed, false);
  }
});

test("duração salva preserva o término da reserva após alterações no catálogo", () => {
  const saved = { ...appointment, durationMinutes: 20 };
  assert.equal(appointmentDurationMinutes({ services: [{ name: "Corte", duration: 70 }] }, saved), 20);
  const combo = { ...appointment, service: "Combo" };
  assert.equal(appointmentPresenceWindow(establishment, combo, new Date("2026-09-27T10:30:00-03:00")).allowed, true);
  assert.equal(appointmentPresenceWindow(establishment, combo, new Date("2026-09-27T10:30:00.001-03:00")).allowed, false);
});

test("uma hora antes nunca libera presença na véspera e o fuso é São Paulo", () => {
  const early = { ...appointment, time: "00:20" };
  assert.equal(appointmentPresenceWindow(establishment, early, new Date("2026-09-26T23:30:00-03:00")).allowed, false);
  assert.equal(appointmentPresenceWindow(establishment, early, new Date("2026-09-27T00:00:00-03:00")).allowed, true);
  assert.equal(appointmentPresenceWindow(establishment, appointment, new Date("2026-09-27T11:20:00Z")).allowed, true);
});

test("consulta pública e botão da equipe acompanham a janela e mostram seus horários", () => {
  const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
  const item = { ...appointment, id: "id", appointmentId: "id", client: "Cliente", status: "confirmado" };
  let now = new Date("2026-09-27T08:19:59-03:00");
  const context = vm.createContext({
    state: { publicLookup: { method: "name", searched: true, query: "", results: [item] }, appointmentQuery: "" },
    activeEstablishment: () => establishment, appointmentPresenceWindow: (est, appt) => appointmentPresenceWindow(est, appt, now),
    isoDate: () => appointment.date, prettyDate: value => value, escapeHTML: value => String(value), statusLabel: value => value,
    normalizedSearch: value => value, professionalIsPaused: () => false, initials: () => "C", scheduledTicket: () => "RSI-01",
  });
  for (const name of ["publicAppointmentLookup", "appointmentRows", "presenceWindowLabel"]) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf("\nfunction ", start + 10);
    vm.runInContext(source.slice(start, end), context);
  }
  assert.doesNotMatch(context.publicAppointmentLookup(), /data-start-checkin=/);
  assert.match(context.publicAppointmentLookup(), /08:20.*09:40/);
  assert.match(context.appointmentRows({ appointments: [item] }), /data-confirm-presence="id" disabled/);
  now = new Date("2026-09-27T08:20:00-03:00");
  assert.match(context.publicAppointmentLookup(), /data-start-checkin="id"/);
  assert.doesNotMatch(context.appointmentRows({ appointments: [item] }), /data-confirm-presence="id" disabled/);
  now = new Date("2026-09-27T09:40:01-03:00");
  assert.doesNotMatch(context.publicAppointmentLookup(), /data-start-checkin=/);
});
