import assert from "node:assert/strict";
import test from "node:test";
import { establishmentSlug, newEstablishment, storeProfile, normalizeWeeklyAvailability } from "../frontend/establishment-model.mjs";

test("o nome gera o endereço e o login exclusivos da loja", () => {
  const result = newEstablishment({ name: "Salão Bela", ownerPassword: "senha123" });
  assert.equal(result.slug, "salaobela");
  assert.equal(result.establishment.name, "Salão Bela");
  assert.equal(result.establishment.setupComplete, false);
  assert.deepEqual(result.establishment.professionals, []);
  assert.deepEqual(result.establishment.services, []);
  assert.equal(result.owner.email, "salaobela-admin@agendae.com.br");
  assert.equal(result.owner.name, "Administrador");
  assert.equal(establishmentSlug("Clínica & Cia"), "clinica-cia");
});

test("os dados públicos são configurados pelo administrador da loja", () => {
  const profile = storeProfile({ name: "Salão Bela", category: "Salão", neighborhood: "Centro", address: "Rua A, 10", opening: "08:00", closing: "18:00", saturdayOpen: "on" });
  assert.equal(profile.initials, "SB");
  assert.deepEqual(profile.hours, [
    { label: "Seg a sex", value: "08:00 - 18:00" },
    { label: "Sábado", value: "08:00 - 18:00" },
    { label: "Domingo", value: "Fechado" },
  ]);
  assert.throws(() => storeProfile({ ...profile, opening: "18:00", closing: "08:00" }), /horário/);
});

test("expediente varia por dia e inclui segundo endereço opcional", () => {
  const profile = storeProfile({
    name: "Clínica Viva", category: "Clínica", neighborhood: "Centro", address: "Rua A, 10", address2: "Rua B, 20",
    day_seg_open: "on", day_seg_start: "08:00", day_seg_end: "12:00",
    day_ter_start: "08:00", day_ter_end: "18:00",
    day_qua_open: "on", day_qua_start: "13:00", day_qua_end: "19:00",
    day_qui_start: "08:00", day_qui_end: "18:00",
    day_sex_start: "08:00", day_sex_end: "18:00",
    day_sab_start: "08:00", day_sab_end: "18:00",
    day_dom_start: "08:00", day_dom_end: "18:00",
  });
  assert.equal(profile.address2, "Rua B, 20");
  assert.deepEqual(profile.hours.map(item => item.value), ["08:00 - 12:00", "Fechado", "13:00 - 19:00", "Fechado", "Fechado", "Fechado", "Fechado"]);
  assert.throws(() => storeProfile({ ...Object.fromEntries(profile.hours.map((_, index) => [`day_${["seg", "ter", "qua", "qui", "sex", "sab", "dom"][index]}_start`, "08:00"])), name: "Loja", category: "Loja", neighborhood: "Centro", address: "Rua A" }), /pelo menos um dia/);
});

test("serviço aceita intervalos por dia e rejeita sobreposição", () => {
  const weekly = normalizeWeeklyAvailability({ seg: [{ start: "14:00", end: "16:00" }, { start: "08:00", end: "10:00" }], sab: [{ start: "09:00", end: "12:00" }] });
  assert.deepEqual(weekly.seg, [{ start: "08:00", end: "10:00" }, { start: "14:00", end: "16:00" }]);
  assert.throws(() => normalizeWeeklyAvailability({ seg: [{ start: "08:00", end: "11:00" }, { start: "10:00", end: "12:00" }] }), /sobrepor/);
  assert.throws(() => normalizeWeeklyAvailability({}), /Selecione pelo menos um dia/);
});
