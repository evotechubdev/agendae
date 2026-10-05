import test from "node:test";
import assert from "node:assert/strict";
import { loginCredentials, loginIdentity } from "../frontend/login-model.mjs";

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

test("e-mail autenticado localiza seu mapa de login", () => {
  assert.deepEqual(loginIdentity("barbeariadorenam-admin@agendae.com.br"), {
    slug: "barbeariadorenam", login: "admin",
  });
  assert.deepEqual(loginIdentity("admin@agendae.com.br", "barbeariadorenam"), {
    slug: "barbeariadorenam", login: "admin",
  });
  assert.equal(loginIdentity("admin@example.com"), null);
});
