import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const start = source.indexOf("function integrationApiVariable(");
const end = source.indexOf("async function loadApiKeyStatus(", start);

function markup(role, secret = null) {
  const context = vm.createContext({
    state: { apiKeyStatus: { slug: "demo", loaded: true, active: true, lastFour: "ABCD", variable: "API_AGENDAE_DEMO", externalVariable: "API_AGENDAE_DEMO", automationReady: true, deployRequested: true }, apiKeySecret: secret },
    firebaseApi: { integrationApiBaseUrl: "https://agendae-backend-t5ax.onrender.com" },
    session: () => ({ role }),
    escapeHTML: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  });
  vm.runInContext(source.slice(start, end), context);
  return context.apiSettingsMarkup({ slug: "demo", name: "Loja Demo" });
}

test("aba API reserva geração e detalhes da integração ao administrador", () => {
  assert.doesNotMatch(markup("staff"), /data-generate-api-key|\/v1\/establishments/);
  const gerente = markup("gerente");
  assert.match(gerente, /data-generate-api-key/);
  assert.match(gerente, /data-refresh-api-key/);
  assert.match(gerente, />API_AGENDAE_DEMO</);
  assert.match(gerente, /Variável interna no Render do Agendae/);
  assert.match(gerente, /Variável no backend do sistema externo/);
  assert.match(gerente, /data-revoke-api-key/);
  assert.match(gerente, /\/v1\/establishments\/demo/);
  assert.doesNotMatch(gerente, /ag_live_[A-Za-z0-9_-]{10,}/);
});

test("chave recém-gerada aparece apenas no estado temporário da aba", () => {
  const generated = markup("gerente", "ag_live_exemplo");
  assert.match(generated, /ag_live_exemplo/);
  assert.match(generated, /data-copy-external-api-variable="API_AGENDAE_DEMO"/);
  assert.match(generated, /Cadastre esta chave API no backend do seu sistema externo/);
  assert.doesNotMatch(markup("gerente"), /ag_live_exemplo/);
});
