import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const views = source.slice(source.indexOf("function homeHeader("), source.indexOf("function renderLogin("));

function fixture(profile = null) {
  const app = { innerHTML: "" };
  const state = {
    systemAccessOpen: false, systemListLoaded: true, systemListLoading: false, systemListError: "",
    systemEstablishments: [
      { slug: "barbearia", name: "Barbearia", initials: "BA", active: true, setupComplete: true },
      { slug: "novaloja", name: "Nova Loja", initials: "NL", active: true, setupComplete: false },
    ],
    createdStoreSlug: "", createdStoreEmail: "", createdStorePassword: "",
    systemCreateName: "",
  };
  const context = vm.createContext({
    app, state, document: { title: "" }, location: { origin: "https://example.test" }, URL,
    SYSTEM_MANAGE_ROUTE: "gerenciar-estabelecimentos", session: () => profile,
    logo: () => "Agendae", footer: () => "", href: path => path,
    escapeHTML: value => String(value), initials: name => name.slice(0, 2).toUpperCase(), establishmentSlug: value => String(value || "").toLowerCase(),
    establishments: {}, catalogLoaded: true, storeOpenNow: () => false,
  });
  vm.runInContext(views, context);
  return { app, context };
}

test("página pública mostra apenas Entrar, sem abas de administração", () => {
  const { app, context } = fixture();
  context.renderHome();
  assert.match(app.innerHTML, />Entrar<\/button>/);
  assert.doesNotMatch(app.innerHTML, /class="home-nav-link[^\"]*"[^>]*>Home<\/a>/);
  assert.doesNotMatch(app.innerHTML, /class="home-nav-link[^\"]*"[^>]*>Gerenciar Estabelecimentos/);
  assert.doesNotMatch(app.innerHTML, /class="home-nav-link[^\"]*"[^>]*>Para estabelecimentos/);
});

test("administrador vê as abas e uma tela com lista e cadastro", () => {
  const { app, context } = fixture({ role: "system_admin", name: "Sistema" });
  context.renderSystemManagement();
  assert.match(app.innerHTML, />Home<\/a>/);
  assert.match(app.innerHTML, /aria-current="page">Gerenciar Estabelecimentos<\/a>/);
  assert.match(app.innerHTML, /Barbearia/);
  assert.match(app.innerHTML, /Nova Loja/);
  assert.match(app.innerHTML, /Em configuração/);
  assert.match(app.innerHTML, /id="system-create-form"/);
  assert.match(app.innerHTML, /data-system-logout/);
});

test("rota de gestão abre a Home sem sessão administrativa", () => {
  const rendered = [];
  let profile = null;
  const context = vm.createContext({
    SYSTEM_MANAGE_ROUTE: "gerenciar-estabelecimentos", state: {},
    scheduleTurnTimer: null, adminRefreshTimer: null, monitorClockTimer: null, serviceCarouselTimer: null,
    clearTimeout() {}, clearInterval() {}, session: () => profile, route: () => "gerenciar-estabelecimentos",
    renderHome: () => rendered.push("home"), renderSystemManagement: () => rendered.push("manage"),
  });
  vm.runInContext(source.slice(source.indexOf("function render() {"), source.indexOf("function activeEstablishment()")), context);
  context.render();
  profile = { role: "system_admin" };
  context.render();
  assert.deepEqual(rendered, ["home", "manage"]);
});
