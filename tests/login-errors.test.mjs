import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");

test("erro de login permanece dentro do formulário e é limpo ao tentar novamente", () => {
  let alert, insertions = 0;
  const form = { querySelector: selector => selector === "[data-login-error]" ? alert : {
    before: element => { alert = element; insertions++; },
  } };
  const context = vm.createContext({ document: { createElement: () => ({ dataset: {}, setAttribute(name, value) { this[name] = value; } }) } });
  vm.runInContext(source.slice(source.indexOf("function showLoginError("), source.indexOf("function footer(")), context);
  context.showLoginError(form, "Login ou senha inválidos.");
  assert.equal(alert.textContent, "Login ou senha inválidos.");
  assert.equal(alert.role, "alert");
  assert.equal(alert.hidden, false);
  context.showLoginError(form, "Muitas tentativas. Aguarde alguns minutos.");
  assert.equal(alert.textContent, "Muitas tentativas. Aguarde alguns minutos.");
  assert.equal(insertions, 1);
  context.showLoginError(form);
  assert.equal(alert.textContent, "");
  assert.equal(alert.hidden, true);
});
