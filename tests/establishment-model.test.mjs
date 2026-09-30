import assert from "node:assert/strict";
import test from "node:test";
import { establishmentSlug, newEstablishment, storeProfile } from "../frontend/establishment-model.mjs";

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
