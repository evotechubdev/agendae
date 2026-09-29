import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");

test("menu público mostra entrada e menu da equipe mostra apenas configurações e saída", () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf("function publicAccessMenu("), source.indexOf("function bookingContent(")), context);
  const publicMenu = context.publicAccessMenu({}, false);
  const staffMenu = context.publicAccessMenu({}, true);
  assert.match(publicMenu, /data-open-employee-access/);
  assert.doesNotMatch(publicMenu, /data-open-settings/);
  assert.match(staffMenu, /data-open-settings/);
  assert.match(staffMenu, /data-logout/);
  assert.doesNotMatch(staffMenu, /data-open-attendance/);
});

test("modal de horário mostra só a reserva selecionada", () => {
  const context = vm.createContext({
    state: { appointmentQuery: "" },
    activeEstablishment: () => ({}),
    isoDate: () => "2026-09-29",
    normalizedSearch: value => String(value).toLowerCase(),
    professionalIsPaused: () => false,
    scheduledTicket: () => "ABC-01",
    initials: value => value[0],
    escapeHTML: value => String(value),
    statusLabel: value => value,
  });
  vm.runInContext(source.slice(source.indexOf("function appointmentRows("), source.indexOf("function presenceWindowLabel(")), context);
  const appointments = [
    { id: "a", date: "2026-09-29", time: "09:00", client: "Ana", service: "Corte", professional: "João", status: "concluido" },
    { id: "b", date: "2026-09-29", time: "09:20", client: "Bia", service: "Corte", professional: "João", status: "concluido" },
  ];
  const markup = context.appointmentRows({ appointments }, "", { kind: "appointment", id: "b", time: "09:20", professional: "João" });
  assert.match(markup, /Bia/);
  assert.doesNotMatch(markup, /Ana/);
});
