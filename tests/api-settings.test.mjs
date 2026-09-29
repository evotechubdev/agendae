import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const start = source.indexOf("function apiSettingsMarkup(");
const end = source.indexOf("async function loadApiKeyStatus(", start);

function markup(role, secret = null) {
  const context = vm.createContext({
    state: { apiKeyStatus: { slug: "demo", loaded: true, active: true, lastFour: "ABCD" }, apiKeySecret: secret },
    firebaseApi: { integrationApiBaseUrl: "https://agendae-backend-t5ax.onrender.com" },
    session: () => ({ role }),
    escapeHTML: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  });
  vm.runInContext(source.slice(start, end), context);
  return context.apiSettingsMarkup({ slug: "demo" });
}

test("aba API reserva geração e detalhes da integração ao administrador", () => {
  assert.doesNotMatch(markup("staff"), /data-generate-api-key|\/v1\/establishments/);
  const admin = markup("admin");
  assert.match(admin, /data-generate-api-key/);
  assert.match(admin, /data-revoke-api-key/);
  assert.match(admin, /\/v1\/establishments\/demo/);
  assert.doesNotMatch(admin, /ag_live_/);
});

test("chave recém-gerada aparece apenas no estado temporário da aba", () => {
  assert.match(markup("admin", "ag_live_exemplo"), /ag_live_exemplo/);
  assert.doesNotMatch(markup("admin"), /ag_live_exemplo/);
});
