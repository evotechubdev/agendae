import assert from "node:assert/strict";
import test from "node:test";
import { formatPostalCode, lookupPostalCode, matchingPostalCode, searchPostalCodes } from "../frontend/postal-code.mjs";

test("CEP consulta rua, bairro, cidade e UF e a busca inversa evita CEP ambíguo", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const result = calls.length === 1
      ? { cep: "01001-000", logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" }
      : [
          { cep: "40000-001", logradouro: "Avenida Central", bairro: "Centro", localidade: "Salvador", uf: "BA" },
          { cep: "40000-002", logradouro: "Avenida Central", bairro: "Brotas", localidade: "Salvador", uf: "BA" },
        ];
    return { ok: true, json: async () => result };
  };
  try {
    const direct = await lookupPostalCode("01001-000");
    assert.equal(direct.localidade, "São Paulo");
    assert.equal(formatPostalCode("01001000"), "01001-000");
    const matches = await searchPostalCodes({ state: "BA", city: "Salvador", street: "Avenida Central" });
    assert.equal(matchingPostalCode(matches, { street: "Avenida Central", neighborhood: "" }), null);
    assert.equal(matchingPostalCode(matches, { street: "Avenida Central", neighborhood: "Brotas" }).cep, "40000-002");
    assert.match(calls[1], /BA\/Salvador\/Avenida%20Central\/json/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
