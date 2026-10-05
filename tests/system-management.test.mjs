import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const views = source.slice(source.indexOf("function homeHeader("), source.indexOf("function renderLogin("));

function fixture(profile = null, contactWhatsapp = "") {
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
    SYSTEM_MANAGE_ROUTE: "gerenciar-estabelecimentos", session: () => profile, firebaseApi: { contactWhatsapp },
    logo: () => "Agendae", footer: () => "", href: path => path,
    escapeHTML: value => String(value), initials: name => name.slice(0, 2).toUpperCase(), establishmentSlug: value => String(value || "").toLowerCase(),
    establishments: {}, catalogLoaded: true, storeOpenNow: () => false,
  });
  vm.runInContext(views, context);
  return { app, context };
}

test("página inicial apresenta o produto, o acesso interno e os parceiros em um seletor", () => {
  const { app, context } = fixture(null, "71999999999");
  context.establishments.salaobela = { slug: "salaobela", name: "Salão Bela", initials: "SB", category: "Salão", neighborhood: "Centro", setupComplete: true };
  context.renderHome();
  assert.match(app.innerHTML, /data-open-system-access>Acesso Interno<\/button>/);
  assert.match(app.innerHTML, /Interface completa/);
  assert.match(app.innerHTML, /API para seu site/);
  assert.match(app.innerHTML, /id="partner-select"/);
  assert.match(app.innerHTML, /<option value="salaobela">Salão Bela<\/option>/);
  assert.match(app.innerHTML, /https:\/\/wa\.me\/5571999999999\?text=/);
  assert.doesNotMatch(app.innerHTML, /Encontre seu estabelecimento|id="finder-form"|directory-item/);
  assert.doesNotMatch(app.innerHTML, /class="home-nav-link[^\"]*"[^>]*>Home<\/a>/);
  assert.doesNotMatch(app.innerHTML, /class="home-nav-link[^\"]*"[^>]*>Gerenciar Estabelecimentos/);
  assert.doesNotMatch(app.innerHTML, /class="home-nav-link[^\"]*"[^>]*>Para estabelecimentos/);
});

test("contato sem número válido não cria um link de WhatsApp", () => {
  const { app, context } = fixture(null, "71999999999<script>");
  context.renderHome();
  assert.match(app.innerHTML, /home-contact-disabled/);
  assert.doesNotMatch(app.innerHTML, /wa\.me/);
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
  assert.match(app.innerHTML, /data-system-toggle-store="barbearia"[^>]*>Inativar<\/button>/);
  assert.match(app.innerHTML, /data-system-delete-store="barbearia"[^>]*>Excluir<\/button>/);
  context.state.systemEstablishments[0].active = false;
  context.state.systemDeleteSlug = "barbearia";
  context.renderSystemManagement();
  assert.match(app.innerHTML, /data-system-toggle-store="barbearia"[^>]*>Reativar<\/button>/);
  assert.match(app.innerHTML, /todos os dados do estabelecimento.*perdidos/);
  assert.match(app.innerHTML, /id="system-delete-password"[^>]*type="password"/);
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
  assert.match(app.innerHTML, /class="workplace-hours-card"[^>]*data-map-address="address1"[^>]*><strong>Endere.o 1<\/strong><span class="compact-business-hours">Funcionamento<\/span><\/button>/);
  assert.equal((app.innerHTML.match(/class="workplace-hours-card"/g) || []).length, 1);
  pageContext.renderEstablishmentPublic({ ...store, address2: "Rua B" });
  assert.match(app.innerHTML, /class="workplace-hours-card"[^>]*data-map-address="address2"/);
  assert.equal((app.innerHTML.match(/class="workplace-hours-card"/g) || []).length, 2);
  pageContext.renderEstablishmentPublic({ ...store, reservedServices: [{ name: "Plantão", professional: "Ana", place: "Hospital Central", weekday: "qua", start: "09:00", end: "12:00" }] });
  assert.match(app.innerHTML, /Atendimentos em outros locais/);
  assert.match(app.innerHTML, /Hospital Central/);
  assert.match(app.innerHTML, /sem agendamento/);
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
