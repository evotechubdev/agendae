import test from "node:test";
import assert from "node:assert/strict";
import { loginCredentials } from "../frontend/login-model.mjs";

test("admin do estabelecimento usa exatamente o e-mail informado", () => {
  assert.deepEqual(loginCredentials(" ADMIN ", "salaobela"), {
    email: "salaobela-admin@agendae.com.br",
    legacyEmail: "admin@agendae.com.br",
  });
});

test("login simples mantém os identificadores atual e antigo", () => {
  assert.deepEqual(loginCredentials(" Ána ", "salaobela"), {
    email: "salaobela-ana@agendae.com.br",
    legacyEmail: "ana@agendae.com.br",
  });
});

test("e-mail completo é enviado sem transformar seu identificador", () => {
  for (const email of ["ana@agendae.com.br", "salaobela-ana@agendae.com.br", "ana+equipe@example.com"]) {
    assert.deepEqual(loginCredentials(` ${email.toUpperCase()} `, "salaobela"), { email, legacyEmail: "" });
  }
});

test("entrada vazia ou e-mail malformado não gera credenciais", () => {
  for (const value of ["", "   ", "@@", "ana@", "ana @example.com", "ana@example", "ana@@example.com"]) {
    assert.equal(loginCredentials(value, "salaobela"), null);
  }
});
