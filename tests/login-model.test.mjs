import test from "node:test";
import assert from "node:assert/strict";
import { loginCredentials } from "../frontend/login-model.mjs";

test("login simples mantém os identificadores atual e antigo", () => {
  assert.deepEqual(loginCredentials(" Rénam ", "barbeariadorenam"), {
    email: "barbeariadorenam-renam@agendae.com.br",
    legacyEmail: "renam@agendae.com.br",
  });
});

test("e-mail completo é enviado sem transformar seu identificador", () => {
  for (const email of ["renam@agendae.com.br", "barbeariadorenam-renam@agendae.com.br", "renam+equipe@example.com"]) {
    assert.deepEqual(loginCredentials(` ${email.toUpperCase()} `, "barbeariadorenam"), { email, legacyEmail: "" });
  }
});

test("entrada vazia ou e-mail malformado não gera credenciais", () => {
  for (const value of ["", "   ", "@@", "renam@", "renam @example.com", "renam@example", "renam@@example.com"]) {
    assert.equal(loginCredentials(value, "barbeariadorenam"), null);
  }
});
