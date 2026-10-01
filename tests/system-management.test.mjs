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
  assert.match(app.innerHTML, /href="\/novaloja" data-link>Abrir página<\/a>/);
  assert.match(app.innerHTML, /id="system-create-form"/);
  assert.match(app.innerHTML, /data-system-logout/);
  context.state.createdStoreSlug = "novaloja";
  context.state.createdStoreEmail = "novaloja-admin@agendae.com.br";
  context.state.createdStorePassword = "senha-temporaria";
  context.renderSystemManagement();
  assert.match(app.innerHTML, /Página de agendamento criada/);
  assert.match(app.innerHTML, /Página: https:\/\/example\.test\/novaloja/);
});

test("loja recém-criada abre a página padrão de agendamento", () => {
  const store = { slug: "graziellematos", name: "Grazielle Matos", initials: "GM", address: "", services: [], setupComplete: false };
  const rendered = [];
  const routeContext = vm.createContext({
    state: {}, location: { search: "" }, URLSearchParams,
    SYSTEM_MANAGE_ROUTE: "gerenciar-estabelecimentos", catalogLoaded: true,
    establishments: { graziellematos: store },
    scheduleTurnTimer: null, adminRefreshTimer: null, monitorClockTimer: null, serviceCarouselTimer: null,
    clearTimeout() {}, clearInterval() {}, session: () => null, route: () => "graziellematos",
    renderEstablishmentPublic: value => rendered.push(value),
    renderNotFound: () => assert.fail("A loja cadastrada não deve aparecer como inexistente"),
  });
  vm.runInContext(source.slice(source.indexOf("function render() {"), source.indexOf("function activeEstablishment()")), routeContext);
  routeContext.render();
  assert.deepEqual(rendered, [store]);

  const app = { innerHTML: "" };
  const pageContext = vm.createContext({
    app, document: { title: "" }, location: { search: "" }, URLSearchParams,
    state: { booking: { step: 1, date: "2026-09-30" }, publicLookup: { scanning: false }, attendanceOpen: false },
    session: () => null, getData: () => ({}), href: path => path, logo: () => "Agendae", escapeHTML: value => String(value),
    publicCurrentAttendance: () => "Atendendo agora", publicAccessMenu: () => "Entrar", publicSchedule: () => "Agenda",
    publicMapMarkup: () => '<section class="panel public-location-panel">Mapa</section>',
    compactBusinessHours: () => "Funcionamento", publicServiceCards: () => "Serviços",
    employeeAccessModal: () => "", requestAnimationFrame() {},
  });
  vm.runInContext(source.slice(source.indexOf("function renderEstablishmentPublic("), source.indexOf("function appointmentRows(")), pageContext);
  pageContext.renderEstablishmentPublic(store);
  assert.match(app.innerHTML, /class="est-page"/);
  assert.match(app.innerHTML, /Grazielle Matos/);
  assert.match(app.innerHTML, /public-schedule-panel/);
  assert.match(app.innerHTML, /public-services-panel/);
  assert.match(app.innerHTML, /public-details-layout/);
  assert.match(app.innerHTML, /<div class="est-header-business"><strong>Grazielle Matos<\/strong><\/div>/);
  assert.ok(app.innerHTML.indexOf("public-schedule-panel") < app.innerHTML.indexOf("public-services-panel"));
  assert.ok(app.innerHTML.indexOf("public-services-panel") < app.innerHTML.indexOf("public-location-panel"));
  assert.match(app.innerHTML, /Agenda em configuração/);
  assert.match(app.innerHTML, /data-open-checkin disabled/);
  assert.doesNotMatch(app.innerHTML, /Estabelecimento não encontrado/);
});

test("agenda recém-criada não libera horários antes da publicação", () => {
  const context = vm.createContext({ escapeHTML: value => String(value) });
  vm.runInContext(source.slice(source.indexOf("function publicSchedule("), source.indexOf("function moveScheduleTurn(")), context);
  const markup = context.publicSchedule({ name: "Grazielle Matos", setupComplete: false });
  assert.match(markup, /agenda de Grazielle Matos está em configuração/);
  assert.doesNotMatch(markup, /data-public-slot/);
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
