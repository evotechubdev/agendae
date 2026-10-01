import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { formatPostalCode, matchingPostalCode, postalDigits } from "../frontend/postal-code.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const record = { cep: "01001-000", logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP" };
const context = vm.createContext({
  formatPostalCode, matchingPostalCode, postalDigits,
  lookupPostalCode: async value => String(value) === "40280900" ? { cep: "40280-900", logradouro: "Avenida Antônio Carlos Magalhães", complemento: "2671", unidade: "Edifício Bahia Center", bairro: "Brotas", localidade: "Salvador", uf: "BA" } : record,
  searchPostalCodes: async () => [record],
  Option: class { constructor(text, value) { this.text = text; this.value = value; } },
});
vm.runInContext(source.slice(source.indexOf("function postalField("), source.indexOf("function storeSettingsMarkup(")), context);

function formWith(values) {
  const fields = Object.fromEntries(["street", "number", "neighborhood", "zipCode", "city", "state", "complement"].map(name => [name, { value: values[name] || "", dataset: {} }]));
  const status = { textContent: "" };
  const select = { hidden: true, replaceChildren(...options) { this.options = options; } };
  const form = {
    elements: { namedItem: name => fields[name] },
    querySelector: selector => selector.startsWith("[data-postal-status") ? status : select,
    isConnected: true, dataset: {},
  };
  return { form, fields, status, select };
}

test("CEP preenche cidade e estado sem apagar complemento nem número SN", async () => {
  const { form, fields } = formWith({ zipCode: "01001000", number: "SN", complement: "Edifício Exemplo" });
  await context.fillAddressFromPostalCode(form, "");
  assert.equal(fields.street.value, "Praça da Sé");
  assert.equal(fields.neighborhood.value, "Sé");
  assert.equal(fields.city.value, "São Paulo");
  assert.equal(fields.state.value, "SP");
  assert.equal(fields.zipCode.value, "01001-000");
  assert.equal(fields.number.value, "SN");
  assert.equal(fields.complement.value, "Edifício Exemplo");
});

test("rua, cidade e UF preenchem o CEP quando há correspondência única", async () => {
  const { form, fields } = formWith({ street: "Praça da Sé", city: "São Paulo", state: "SP" });
  await context.fillPostalCodeFromAddress(form, "");
  assert.equal(fields.zipCode.value, "01001-000");
});

test("CEP de edifício preenche número e complemento quando vazios", async () => {
  const { form, fields } = formWith({ zipCode: "40280900" });
  await context.fillAddressFromPostalCode(form, "");
  assert.equal(fields.number.value, "2671");
  assert.equal(fields.complement.value, "Edifício Bahia Center");
  assert.equal(fields.city.value, "Salvador");
  assert.equal(fields.state.value, "BA");
});
