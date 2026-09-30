import assert from "node:assert/strict";
import test from "node:test";
import { establishmentSlug, newEstablishment, storeProfile } from "../frontend/establishment-model.mjs";

test("o cadastro inicial cria apenas a loja provisória e o vínculo do administrador", () => {
  const result = newEstablishment({ slug: "Salão Bela", ownerName: "Ana", ownerEmail: "ANA@EXAMPLE.COM", ownerPassword: "senha123" });
  assert.equal(result.slug, "salao-bela");
  assert.equal(result.establishment.setupComplete, false);
  assert.deepEqual(result.establishment.professionals, []);
  assert.deepEqual(result.establishment.services, []);
  assert.equal(result.owner.email, "ana@example.com");
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
