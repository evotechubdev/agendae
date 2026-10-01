import { queueView, upcomingFreeSlots, scheduledTicket, professionalInitial, serviceInitials, ticketState, ticketSubstatus, TICKET_STATES, allProfessionalsClosed } from "./queue-model.mjs";
import { scheduleTimeline, scheduleMatrix, scheduleDayPeriods, lunchBreakFor, isLunchTime, serviceFitsSlot, serviceAvailableAt, workPeriodsFor, scheduleFromPeriods, businessHoursForDate, businessOpeningMinutes, businessDayIsClosed, appointmentPresenceWindow } from "./schedule-model.mjs";
import { renderBookingCalendar, shiftCalendarMonth, calendarMonthDays } from "./calendar-model.mjs";
import { loginCredentials } from "./login-model.mjs";
import { establishmentSlug, storeProfile } from "./establishment-model.mjs";
import { addressMapLabel, googleMapsPlaceQuery } from "./address-map.mjs";
import { formatPostalCode, lookupPostalCode, matchingPostalCode, postalDigits, searchPostalCodes } from "./postal-code.mjs";

const BASE = location.hostname.endsWith("github.io") ? "/agendae" : "";
const SYSTEM_MANAGE_ROUTE = "gerenciar-estabelecimentos";
const app = document.querySelector("#app");
const toastArea = document.querySelector("#toast-region");
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
let firebaseApi = null;
let firebaseSession = null;
let catalogLoaded = false;
let authFlowInProgress = false;
let queueSubscription = null;
let queueSubscriptionSlug = null;
let monitorClockTimer = null;
let serviceCarouselTimer = null;
let adminRefreshTimer = null;
let qrScanner = null;
let scheduleViewportWidth = window.innerWidth;
let scheduleTurnTimer = null;
const cloudCache = new Map();
const cloudLoading = new Set();
const professionalReconcileLoading = new Set();
const checkInConfigs = new Map();
const checkInConfigLoading = new Set();

let establishments = {};

const state = {
  booking: freshBooking(),
  mapAddressType: "address1",
  mapSlug: "",
  appointmentQuery: "",
  scheduleScrollLeft: 0,
  scheduleTurn: null,
  scheduleAuto: true,
  schedulePausedByCalendar: false,
  calendarOpen: false,
  calendarMonth: null,
  scheduleView: "day",
  publicLookup: freshPublicLookup(),
  employeeAccessOpen: false,
  systemAccessOpen: false,
  createdStoreSlug: "",
  createdStoreEmail: "",
  createdStorePassword: "",
  systemCreateName: "",
  systemEstablishments: [],
  systemListLoading: false,
  systemListLoaded: false,
  systemListError: "",
  settingsOpen: false,
  settingsTab: "professionals",
  apiKeyStatus: { slug: "", loading: false, loaded: false, active: false, lastFour: null, variable: "", automationReady: false, pending: "", deployRequested: false, error: "" },
  apiKeySecret: null,
  attendanceOpen: false,
  attendanceSelection: null,
  nextCallProfessional: null,
  mobileMenu: false,
};

function freshBooking() {
  return { step: 1, dateMode: "today", date: isoDate(0), serviceId: null, time: null, professional: "", confirmation: null };
}

function freshPublicLookup(method = "name") {
  return { method, query: "", loading: false, searched: false, results: [], selectedId: null, scanning: false, scanError: "", success: null, open: false };
}

function generateCheckInCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function statusLabel(status = "confirmado") {
  return ({ confirmado: "Confirmado", presente: "Presença confirmada", atendendo: "Em atendimento", concluido: "Concluído", aguardando: "Aguardando" })[status] || status;
}

function checkInQrUrl(establishment, token) {
  return new URL(href(`/${establishment.slug}?checkin=${encodeURIComponent(token)}#confirmar-presenca`), location.origin).toString();
}

function qrCodeMarkup(value, className = "") {
  if (!value || typeof window.qrcode !== "function") return '<div class="qr-placeholder">Preparando QR code…</div>';
  const code = window.qrcode(0, "M");
  code.addData(value);
  code.make();
  return `<div class="qr-code ${className}" aria-label="QR code para confirmação de presença">${code.createSvgTag({ cellSize: 6, margin: 0, scalable: true })}</div>`;
}

function isoDate(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function prettyDate(iso, long = false) {
  return new Intl.DateTimeFormat("pt-BR", long
    ? { weekday: "long", day: "2-digit", month: "long" }
    : { day: "2-digit", month: "short" }
  ).format(new Date(`${iso}T12:00:00`));
}

function slotHasPassed(date, time) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (date !== today) return date < today;
  const [hour, minute] = String(time).split(":").map(Number);
  return (hour * 60) + minute <= (Number(parts.hour) * 60) + Number(parts.minute);
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function initials(name) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function professionalDirectory(establishment, date = null) {
  return (establishment.professionals || []).map((item) => {
    const professional = typeof item === "string" ? { name: item, availableTimes: establishment.availableTimes || [] } : item;
    const lunchBreak = lunchBreakFor(establishment, professional.name, date);
    const daily = date && professional.slotDuration === 20 && professional.workPeriods?.length
      ? scheduleFromPeriods(professional.workPeriods, lunchBreak) : null;
    return { ...professional, ...(daily || {}), lunchBreak };
  });
}

function staffStatusFor(data, professionalName) {
  return (data.staffStatuses || []).find((item) => item.professional === professionalName) || {};
}

function professionalIsPaused(data, professionalName, date = isoDate()) {
  const status = staffStatusFor(data, professionalName);
  return Boolean(status.paused && (!status.pausedDate || status.pausedDate === date));
}

function professionalIsClosed(data, professionalName, date = isoDate()) {
  return staffStatusFor(data, professionalName).closedDate === date;
}

function currentSaoPauloClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) * 60) + Number(parts.minute) };
}

function professionalIsOnShift(professional, date = isoDate()) {
  const times = professional.availableTimes || [];
  if (!times.length) return false;
  const clock = currentSaoPauloClock();
  if (clock.date !== date) return false;
  if (isLunchTime(professional.lunchBreak, clock.minutes)) return false;
  if ((professional.pauseIntervals || []).some(interval => isLunchTime(interval, clock.minutes))) return false;
  const toMinutes = (time) => {
    const [hour, minute] = String(time).split(":").map(Number);
    return (hour * 60) + minute;
  };
  const minutes = times.map(toMinutes).sort((a, b) => a - b);
  return clock.minutes >= minutes[0] && (professional.scheduleEnd ? clock.minutes < toMinutes(professional.scheduleEnd) : clock.minutes <= minutes.at(-1));
}

function currentProfessionalSlot(professional, date = isoDate()) {
  if (!professionalIsOnShift(professional, date)) return null;
  const clock = currentSaoPauloClock();
  const times = [...(professional.availableTimes || [])].sort();
  return times.filter((time) => {
    const [hour, minute] = String(time).split(":").map(Number);
    return ((hour * 60) + minute) <= clock.minutes;
  }).at(-1) || times[0] || null;
}

function scheduleFor(establishment, professionalName) {
  const professional = professionalDirectory(establishment).find((item) => item.name === professionalName);
  return professional?.availableTimes || [];
}

function usesEmployeeSchedules(establishment) {
  return establishment.scheduleMode !== "establishment";
}

function normalizedSearch(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function requestedEstablishment() {
  const slug = new URLSearchParams(location.search).get("establishment");
  return slug && establishments[slug] ? establishments[slug] : null;
}

function href(path = "/") {
  if (path.startsWith("/public/")) return `${BASE}${path}`;
  const [pathAndQuery, hash = ""] = String(path).split("#", 2);
  const [pathname, queryString = ""] = pathAndQuery.split("?", 2);
  const routeName = pathname.replace(/^\/+|\/+$/g, "");
  const params = new URLSearchParams(queryString);
  if (routeName && routeName !== "home") params.set("route", routeName);
  const ordered = new URLSearchParams();
  if (params.has("route")) ordered.set("route", params.get("route"));
  for (const [key, value] of params) if (key !== "route") ordered.append(key, value);
  const query = ordered.toString();
  return `${BASE}/${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}

function navigate(path) {
  const previousRoute = route();
  void stopQrScanner();
  history.pushState(null, "", href(path));
  if (route() !== previousRoute) state.publicLookup = freshPublicLookup();
  state.calendarOpen = false;
  state.employeeAccessOpen = false;
  state.systemAccessOpen = false;
  state.createdStoreSlug = "";
  state.createdStoreEmail = "";
  state.createdStorePassword = "";
  state.systemCreateName = "";
  state.settingsOpen = false;
  state.apiKeySecret = null;
  state.attendanceOpen = false;
  state.attendanceSelection = null;
  state.nextCallProfessional = null;
  state.mobileMenu = false;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function route() {
  const queryRoute = new URLSearchParams(location.search).get("route");
  if (queryRoute) return queryRoute.replace(/^\/+|\/+$/g, "") || "home";
  let path = location.pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
  return path.replace(/^\/+|\/+$/g, "") || "home";
}

function session() {
  return firebaseSession;
}

function publicCacheKey(establishment, date = state.booking.date) {
  return `public:${establishment.slug}:${date}`;
}

function invalidatePublicCache(slug) {
  for (const key of cloudCache.keys()) {
    if (key.startsWith(`public:${slug}:`)) cloudCache.delete(key);
  }
}

function getData(establishment) {
  const cloud = cloudCache.get(publicCacheKey(establishment));
  return cloud || { appointments: [], queue: [], slots: [], staffStatuses: [], todayAppointments: 0 };
}

function getAdminData(establishment) {
  return cloudCache.get(`admin:${establishment.slug}`) || { appointments: [], queue: [], slots: [], staffStatuses: [] };
}

function settingsHasUnsavedInput() {
  return Boolean(document.querySelector('.settings-modal form[data-dirty="true"]'));
}

function settingsIsEditing() {
  return settingsHasUnsavedInput() || Boolean(document.activeElement?.closest(".settings-modal form"));
}

async function reconcileProfessionalCoverage(establishment, data) {
  if (!firebaseApi || !session() || !usesEmployeeSchedules(establishment)) return;
  const date = isoDate();
  const reconciliationKey = `${establishment.slug}:${date}`;
  if (professionalReconcileLoading.has(reconciliationKey)) return;
  professionalReconcileLoading.add(reconciliationKey);
  let changed = false;
  try {
    for (const professional of professionalDirectory(establishment, date)) {
      const appointments = data.appointments.filter((item) => item.professional === professional.name);
      const staffStatus = staffStatusFor(data, professional.name);
      const current = appointments.find((item) => item.status === "atendendo");
      const hasEligible = appointments.some((item) => ["presente", "confirmado"].includes(item.status));
      if (professionalIsClosed(data, professional.name, date) || professionalIsPaused(data, professional.name, date) || isLunchTime(professional.lunchBreak, currentSaoPauloClock().minutes)) continue;
      if (current) {
        if (staffStatus.currentAppointmentId !== current.id || staffStatus.currentDate !== date) {
          const synchronized = await firebaseApi.startNextProfessionalAppointment(establishment.slug, professional.name, date);
          changed ||= Boolean(synchronized);
        }
        continue;
      }
      if (!hasEligible || !professionalIsOnShift(professional, date)) continue;
      const started = await firebaseApi.startNextProfessionalAppointment(establishment.slug, professional.name, date);
      changed ||= Boolean(started);
    }
  } catch (error) {
    console.error("Agendae: não foi possível reconciliar os atendimentos em andamento.", error);
  } finally {
    professionalReconcileLoading.delete(reconciliationKey);
  }
  if (changed) {
    cloudCache.delete(`admin:${establishment.slug}`);
    invalidatePublicCache(establishment.slug);
    render();
  }
}

async function refreshCloudData(establishment, mode, date = isoDate()) {
  if (!firebaseApi) return;
  const key = mode === "admin" ? `admin:${establishment.slug}` : publicCacheKey(establishment, date);
  if (cloudLoading.has(key) || cloudCache.has(key)) return;
  cloudLoading.add(key);
  try {
    if (mode === "admin") {
      const remote = await firebaseApi.loadAdminData(establishment.slug, isoDate());
      cloudCache.set(key, { appointments: remote.appointments, queue: remote.queue, slots: remote.slots, staffStatuses: remote.staffStatuses || [] });
      void reconcileProfessionalCoverage(establishment, remote);
    } else {
      const remote = await firebaseApi.loadPublicData(establishment.slug, date);
      if (remote) cloudCache.set(key, { appointments: [], ...remote });
    }
    if (route() === establishment.slug && (typeof document === "undefined" || !settingsIsEditing())) render();
  } catch (error) {
    console.error("Agendae: não foi possível carregar os dados do Firebase.", error);
    toast("Não foi possível carregar os dados do estabelecimento.", "!");
  } finally {
    cloudLoading.delete(key);
  }
}

function logo() {
  return `<img class="brand" src="${href("/public/imagens/logo_agendae.png")}" alt="Agendae">`;
}

function toast(message, mark = "✓") {
  const item = document.createElement("div");
  item.className = "toast";
  item.innerHTML = `<strong style="color:var(--green);font-size:17px">${mark}</strong><span>${escapeHTML(message)}</span>`;
  toastArea.appendChild(item);
  setTimeout(() => item.remove(), 3200);
}

function showLoginError(form, message = "") {
  let alert = form.querySelector("[data-login-error]");
  if (!alert) {
    alert = document.createElement("p");
    alert.className = "login-error";
    alert.dataset.loginError = "";
    alert.setAttribute("role", "alert");
    form.querySelector("button[type=submit]").before(alert);
  }
  alert.textContent = message;
  alert.hidden = !message;
}

function footer() {
  return `<footer class="footer"><div class="footer-inner">${logo()}<span>Agendamentos e filas em um só lugar.</span><span>© ${new Date().getFullYear()} Agendae</span></div></footer>`;
}

function storeOpenNow(establishment) {
  const clock = currentSaoPauloClock();
  if (businessDayIsClosed(establishment, clock.date)) return false;
  const opening = businessOpeningMinutes(establishment, clock.date);
  const closingText = String(businessHoursForDate(establishment, clock.date)?.value || "");
  const times = [...closingText.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];
  if (opening === null || times.length < 2) return Boolean(establishment.openNow);
  const closing = Number(times.at(-1)[1]) * 60 + Number(times.at(-1)[2]);
  return clock.minutes >= opening && clock.minutes < closing;
}

function homeHeader(active = "home") {
  const admin = session()?.role === "system_admin";
  return `<header class="home-header"><div class="home-nav">
    <a href="${href("/")}" data-link>${logo()}</a>
    <nav class="home-nav-links" aria-label="Navegação principal">
      ${admin ? `<a class="home-nav-link ${active === "home" ? "active" : ""}" href="${href("/")}" data-link ${active === "home" ? 'aria-current="page"' : ""}>Home</a><a class="home-nav-link ${active === "manage" ? "active" : ""}" href="${href(`/${SYSTEM_MANAGE_ROUTE}`)}" data-link ${active === "manage" ? 'aria-current="page"' : ""}>Gerenciar Estabelecimentos</a><button class="btn btn-outline btn-sm" type="button" data-system-logout>Sair</button>` : '<button class="btn btn-primary" type="button" data-open-system-access>Entrar</button>'}
    </nav>
  </div></header>`;
}

function renderHome() {
  document.title = "Agendae — Encontre seu estabelecimento";
  const directory = Object.values(establishments).filter(item => item.setupComplete !== false);
  const sample = directory[0];
  const directoryHtml = !catalogLoaded
    ? '<div class="empty">Carregando estabelecimentos…</div>'
    : directory.length
      ? directory.map((item) => `<button class="directory-item" data-open-establishment="${item.slug}"><span class="est-avatar ${item.type === "clinic" ? "green" : ""}">${escapeHTML(item.initials)}</span><span class="directory-meta"><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.category)} · ${escapeHTML(item.neighborhood)}</small></span><span class="open-tag">${storeOpenNow(item) ? "ABERTO" : "FECHADO"}</span></button>`).join("")
      : '<div class="empty">Nenhum estabelecimento disponível.</div>';
  app.innerHTML = `
    ${homeHeader()}
    <main>
      <section class="home-hero" id="encontrar"><div class="home-hero-inner">
        <div class="home-copy">
          <div class="home-kicker">Agende sem ligar e sem esperar</div>
          <h1>Encontre seu estabelecimento e <span>agende agora.</span></h1>
          <p>Acesse a página do seu estabelecimento, confira os horários livres e acompanhe as senhas chamadas em tempo real.</p>
          <form class="finder" id="finder-form">
            <span class="finder-icon">⌕</span>
            <input id="finder-input" autocomplete="off" placeholder="Digite o nome do estabelecimento" aria-label="Nome do estabelecimento">
            <button class="btn btn-yellow" type="submit">Encontrar</button>
          </form>
          ${sample ? `<div class="finder-note"><span>Exemplo:</span><a href="${href(`/${sample.slug}`)}" data-link>${escapeHTML(sample.name)}</a></div>` : ""}
        </div>
        <aside class="directory-card">
          <div class="directory-label">Estabelecimentos disponíveis</div>
          ${directoryHtml}
        </aside>
      </div></section>
      <section class="trust-strip"><div class="trust-inner"><div class="trust-item"><span class="trust-icon">✓</span>Agendamento confirmado na hora</div><div class="trust-item"><span class="trust-icon">◷</span>Horários livres atualizados</div><div class="trust-item"><span class="trust-icon">#</span>Fila de senhas online</div></div></section>
       <section class="business-cta" id="para-negocios"><div><h2>Seu estabelecimento também pode ter uma agenda profissional.</h2><p>Controle horários, clientes e fila de atendimento em uma única interface.</p></div><button class="btn btn-yellow" type="button" data-open-system-access>${session()?.role === "system_admin" ? "Gerenciar estabelecimentos" : "Administração do sistema"}</button></section>
     </main>${footer()}${systemAccessModal()}`;
}

function systemAccessModal() {
  if (!state.systemAccessOpen || session()?.role === "system_admin") return "";
  return `<div class="booking-modal-backdrop" data-system-access-backdrop><section class="booking-modal system-access-modal" role="dialog" aria-modal="true" aria-labelledby="system-access-title"><div class="booking-modal-head"><div><small>ADMINISTRAÇÃO DO SISTEMA</small><h2 id="system-access-title">Entrar</h2></div><button class="booking-modal-close" type="button" data-close-system-access aria-label="Fechar">×</button></div><form id="system-login-form" class="system-access-body"><p class="booking-modal-lead">Acesso exclusivo para administradores do sistema.</p><div class="field"><label for="system-login">Login</label><input id="system-login" name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="admin" required></div><div class="field"><label for="system-password">Senha</label><input id="system-password" name="password" type="password" autocomplete="current-password" required></div><button class="btn btn-primary btn-block" type="submit">Entrar na administração</button></form></section></div>`;
}

async function refreshSystemEstablishments() {
  if (!firebaseApi || session()?.role !== "system_admin" || state.systemListLoading) return;
  state.systemListLoading = true;
  state.systemListError = "";
  if (route() === SYSTEM_MANAGE_ROUTE) render();
  try {
    const stores = await firebaseApi.loadSystemEstablishments();
    if (session()?.role !== "system_admin") return;
    state.systemEstablishments = stores;
    state.systemListLoaded = true;
  } catch (error) {
    state.systemListError = firebaseApi.firebaseErrorMessage(error);
  } finally {
    state.systemListLoading = false;
    if (route() === SYSTEM_MANAGE_ROUTE) render();
  }
}

function renderSystemManagement() {
  document.title = "Gerenciar Estabelecimentos — Agendae";
  const stores = [...state.systemEstablishments].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
  const draftSlug = establishmentSlug(state.systemCreateName).replace(/-/g, "");
  const list = state.systemListError
    ? `<div class="system-list-message" role="alert">${escapeHTML(state.systemListError)} <button class="btn btn-outline btn-sm" type="button" data-refresh-system-list>Tentar novamente</button></div>`
    : state.systemListLoading && !state.systemListLoaded
      ? '<div class="system-list-message">Carregando estabelecimentos…</div>'
      : stores.length
        ? stores.map(item => {
          const slug = item.slug || item.id;
          const status = item.active === false ? "Inativo" : item.setupComplete === false ? "Em configuração" : "Publicado";
          const published = item.active !== false && item.setupComplete !== false;
          return `<article class="system-store-row"><span class="est-avatar ${item.type === "clinic" ? "green" : ""}">${escapeHTML(item.initials || initials(item.name || "L"))}</span><div class="system-store-info"><strong>${escapeHTML(item.name || slug)}</strong><span>/${escapeHTML(slug)}</span></div><span class="system-store-status ${published ? "published" : "pending"}">${status}</span>${item.active !== false ? `<a class="btn btn-outline btn-sm" href="${href(`/${slug}`)}" data-link>Abrir página</a>` : ""}</article>`;
        }).join("")
        : '<div class="system-list-message">Nenhum estabelecimento cadastrado.</div>';
  app.innerHTML = `${homeHeader("manage")}<main class="system-page"><div class="system-page-inner">
    <div class="system-page-heading"><div><span class="system-eyebrow">ADMINISTRAÇÃO DO SISTEMA</span><h1>Gerenciar Estabelecimentos</h1><p>Consulte as lojas cadastradas e crie o acesso para um novo responsável.</p></div><button class="btn btn-primary" type="button" data-focus-system-create>+ Novo estabelecimento</button></div>
    <div class="system-page-grid"><section class="system-panel" aria-labelledby="system-list-title"><div class="system-panel-head"><div><h2 id="system-list-title">Estabelecimentos</h2><p>${state.systemListLoaded ? `${stores.length} cadastrado${stores.length === 1 ? "" : "s"}` : "Lista de lojas do sistema"}</p></div><button class="btn btn-outline btn-sm" type="button" data-refresh-system-list ${state.systemListLoading ? "disabled" : ""}>Atualizar</button></div><div class="system-store-list">${list}</div></section>
    <section class="system-panel system-create-panel" id="novo-estabelecimento" aria-labelledby="system-create-title"><div class="system-panel-head"><div><h2 id="system-create-title">Criar estabelecimento</h2><p>O responsável configurará a loja no primeiro acesso.</p></div></div>
      ${state.createdStoreSlug ? `<div class="system-created" role="status"><strong>Página de agendamento criada.</strong><p>A página já está disponível no endereço abaixo. Copie também os dados de acesso e entregue ao administrador da loja. A senha temporária aparece apenas agora.</p><code>Página: ${escapeHTML(new URL(href(`/${state.createdStoreSlug}`), location.origin).toString())}</code><code>Primeiro acesso: ${escapeHTML(new URL(href(`/login?establishment=${state.createdStoreSlug}`), location.origin).toString())}</code><code>Login: admin</code><code>E-mail: ${escapeHTML(state.createdStoreEmail)}</code><code>Senha temporária: ${escapeHTML(state.createdStorePassword)}</code><button class="btn btn-outline btn-sm" type="button" data-copy-store-access>Copiar dados de acesso</button></div>` : ""}
      <form id="system-create-form"><div class="field"><label for="store-name">Nome do estabelecimento</label><input id="store-name" name="name" required maxlength="100" placeholder="Ex.: Salão Bela" autocomplete="organization" value="${escapeHTML(state.systemCreateName)}"><small data-generated-store-login>${draftSlug ? `URL: ${draftSlug} · Login: admin · E-mail: ${draftSlug}-admin@agendae.com.br` : "O endereço e o e-mail serão gerados a partir do nome."}</small></div><button class="btn btn-primary btn-block" type="submit">Criar estabelecimento</button></form>
    </section></div>
  </div></main>${footer()}`;
  if (!state.systemListLoaded && !state.systemListLoading && !state.systemListError) void refreshSystemEstablishments();
}

function renderLogin() {
  document.title = "Entrar — Agendae";
  const requested = requestedEstablishment();
  const directory = Object.values(establishments);
  const establishmentOptions = directory.length
    ? directory.map((item) => `<option value="${escapeHTML(item.slug)}" ${requested?.slug === item.slug ? "selected" : ""}>${escapeHTML(item.name)}</option>`).join("")
    : '<option value="">Carregando estabelecimentos…</option>';
  app.innerHTML = `<main class="auth-page">
    <section class="auth-brand"><a href="${href("/")}" data-link>${logo()}</a><div class="auth-message"><h1>O controle do seu atendimento começa aqui.</h1><p>Acompanhe a agenda, veja os horários disponíveis e gerencie sua fila em tempo real.</p><div class="auth-points"><div class="auth-point"><span class="auth-check">✓</span>Dados exclusivos do seu estabelecimento</div><div class="auth-point"><span class="auth-check">✓</span>Agenda e senhas no mesmo painel</div><div class="auth-point"><span class="auth-check">✓</span>Acesso simples para toda a equipe</div></div></div></section>
    <section class="auth-panel"><div class="auth-form-wrap"><a class="back-home" href="${requested ? href(`/${requested.slug}`) : href("/")}" data-link>← ${requested ? `Voltar para ${escapeHTML(requested.name)}` : "Voltar para o início"}</a><h2>Acesso da equipe</h2><p>Entre com os dados fornecidos pelo seu estabelecimento.</p>
      <form id="login-form">
        <div class="field"><label for="establishment-login">Estabelecimento</label><select id="establishment-login" name="establishment" required ${requested || !directory.length ? "disabled" : ""}><option value="">Selecione o estabelecimento</option>${establishmentOptions}</select>${requested ? `<input type="hidden" name="establishment" value="${escapeHTML(requested.slug)}">` : ""}</div>
        <div class="field"><label for="employee-login">Login</label><input id="employee-login" name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="Digite seu login"></div>
        <div class="field"><div class="password-line"><label for="password">Senha</label><a href="#" data-forgot>Esqueci minha senha</a></div><div class="password-input"><input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Digite sua senha"><button type="button" class="password-toggle" data-toggle-password aria-label="Visualizar senha" title="Visualizar senha"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg></button></div></div>
        <label class="remember-option"><input type="checkbox" name="remember" checked><span>Lembrar senha</span></label>
        <button class="btn btn-primary btn-block" type="submit" ${directory.length ? "" : "disabled"}>Entrar no painel</button>
      </form>
      <div class="employee-access-note"><span>♙</span><p><strong>Acesso exclusivo para funcionários</strong><br>Clientes podem agendar normalmente sem criar uma conta.</p></div>
    </div></section>
  </main>`;
}

function employeeAccessModal(establishment) {
  if (!state.employeeAccessOpen) return "";
  return `<div class="booking-modal-backdrop" data-employee-access-backdrop><section class="booking-modal employee-access-modal" role="dialog" aria-modal="true" aria-labelledby="employee-access-title"><div class="booking-modal-head"><div><small>ACESSO DA EQUIPE</small><h2 id="employee-access-title">Área do estabelecimento</h2></div><button class="booking-modal-close" type="button" data-close-employee-access aria-label="Fechar acesso">×</button></div><form id="login-form" class="employee-access-form"><input type="hidden" name="establishment" value="${escapeHTML(establishment.slug)}"><div class="employee-modal-establishment"><span>${escapeHTML(establishment.initials)}</span><div><small>ESTABELECIMENTO</small><strong>${escapeHTML(establishment.name)}</strong></div></div><div class="field"><label for="employee-login">Login</label><input id="employee-login" name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="Digite seu login"></div><div class="field"><div class="password-line"><label for="password">Senha</label><a href="#" data-forgot>Esqueci minha senha</a></div><div class="password-input"><input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Digite sua senha"><button type="button" class="password-toggle" data-toggle-password aria-label="Visualizar senha" title="Visualizar senha"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg></button></div></div><label class="remember-option"><input type="checkbox" name="remember" checked><span>Lembrar senha</span></label><button class="btn btn-primary btn-block" type="submit">Entrar no painel</button></form></section></div>`;
}

function selectedBookingPopup(establishment) {
  const booking = state.booking;
  if (businessDayIsClosed(establishment, booking.date)) return "";
  if (booking.step !== 1 || !booking.time || !booking.professional) return "";
  const professional = (establishment.professionals || []).find(item => (typeof item === "string" ? item : item.name) === booking.professional);
  return `<div class="booking-modal-backdrop" data-selected-booking-backdrop><section class="booking-modal selected-booking-popup" data-selected-booking-popup role="dialog" aria-modal="true" aria-labelledby="selected-booking-title"><div class="booking-modal-head"><div><small>AGENDAMENTO</small><h2 id="selected-booking-title">Horário selecionado</h2></div><button class="booking-modal-close" type="button" data-close-selected-booking aria-label="Fechar horário selecionado">×</button></div><div class="selected-booking-content"><div class="selected-booking-professional"><span class="selected-booking-avatar" aria-hidden="true">${escapeHTML(professionalInitial(booking.professional))}</span><div><strong>${escapeHTML(booking.professional)}</strong><small>${escapeHTML(professional?.role || "Profissional")}</small></div></div><div class="selected-booking-date"><strong>${escapeHTML(booking.time)}</strong><span>${prettyDate(booking.date, true)}</span></div><button class="btn btn-primary" type="button" data-booking-next>Agendar este horário</button><button class="selected-booking-cancel" type="button" data-close-selected-booking>Escolher outro horário</button></div></section></div>`;
}

function renderPasswordChange() {
  document.title = "Definir senha definitiva — Agendae";
  app.innerHTML = `<main class="password-change-page"><section class="booking-modal password-change-modal" aria-labelledby="password-change-title"><div class="booking-modal-head"><div><small>PRIMEIRO ACESSO</small><h2 id="password-change-title">Defina sua senha definitiva</h2></div></div><form id="first-password-form" class="booking-modal-form"><p class="booking-modal-lead">Antes de configurar o estabelecimento, escolha uma senha exclusiva para sua conta.</p><div class="field"><label for="new-password">Nova senha</label><input id="new-password" name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="field"><label for="confirm-new-password">Confirme a nova senha</label><input id="confirm-new-password" name="confirmation" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn btn-primary btn-block" type="submit">Salvar senha e continuar</button><button class="system-signout" type="button" data-first-access-logout>Sair</button></form></section></main>`;
}

function closeSelectedBooking() {
  const selectedTime = state.booking.time;
  const selectedProfessional = state.booking.professional;
  state.booking.step = 1;
  state.booking.time = null;
  resumeScheduleTurn();
  render();
  const slot = [...document.querySelectorAll("[data-public-slot]")].find(item => item.dataset.slotTime === selectedTime && item.dataset.professionalName === selectedProfessional);
  slot?.focus();
}

function publicAccessMenu(establishment, authenticated = false) {
  const options = authenticated
    ? '<button type="button" data-open-settings><strong>Configurações da loja</strong><small>Funcionários, horários e serviços</small></button><button type="button" data-logout><strong>Sair</strong><small>Encerrar sessão</small></button>'
    : '<button type="button" data-open-employee-access><strong>Entrar</strong><small>Acesso da equipe</small></button>';
  return `<details class="public-internal-menu" data-internal-menu><summary aria-label="Menu do estabelecimento" title="Menu do estabelecimento"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"></path></svg></summary><div class="public-internal-dropdown">${options}</div></details>`;
}

function bookingContent(establishment) {
  const booking = state.booking;
  if (booking.step < 3 && businessDayIsClosed(establishment, booking.date)) return "";
  const availableServices = (establishment.services || []).filter(item => serviceAvailableAt(establishment, item, booking.date, booking.time) && serviceFitsSlot(establishment, booking.professional, booking.time, item.name, getData(establishment).slots || [], booking.date));

  if (booking.step === 2) return `<div class="booking-modal-backdrop" data-booking-modal-backdrop>
    <section class="booking-modal booking-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title">
      <div class="booking-modal-head"><div><small>FINALIZAR AGENDAMENTO</small><h2 id="booking-modal-title">Escolha o serviço e confirme</h2></div><button class="booking-modal-close" type="button" data-close-selected-booking aria-label="Fechar janela">×</button></div>
      <form id="booking-form" class="booking-modal-form">
        <p class="booking-modal-lead">Selecione o serviço desejado. A duração e o valor variam conforme a opção escolhida.</p>
        <fieldset class="booking-service-picker"><legend>Serviço <span>Obrigatório</span></legend><div class="booking-service-options">${availableServices.map((item) => `<label class="booking-service-option"><input type="radio" name="service" value="${escapeHTML(item.id)}" data-booking-service required ${booking.serviceId === item.id ? "checked" : ""}><span class="service-icon">${escapeHTML(item.icon || "✦")}</span><span class="booking-service-info"><strong>${escapeHTML(item.name)}</strong><small>${item.duration} minutos · ${escapeHTML(serviceLocationLabel(establishment, item))}</small></span><span class="service-price">${item.price ? currency.format(item.price) : "Incluso"}</span><i aria-hidden="true">✓</i></label>`).join("") || '<p class="empty">Nenhum serviço disponível neste horário. Escolha outro.</p>'}</div></fieldset>
        <div class="mini-field-grid"><div class="field full"><label for="customer-name">Nome completo</label><input id="customer-name" name="name" type="text" autocomplete="name" required placeholder="Digite seu nome"></div><div class="field full"><label for="customer-phone">Telefone <span class="optional-label">(opcional)</span></label><input id="customer-phone" name="phone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000"></div></div>
        <div class="confirmation-data booking-review"><div class="confirmation-row"><span>Data</span><strong>${prettyDate(booking.date, true)}</strong></div><div class="confirmation-row"><span>Horário</span><strong>${escapeHTML(booking.time)}</strong></div><div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(booking.professional)}</strong></div></div>
        <div class="booking-actions"><button class="btn btn-outline" type="button" data-booking-back>Voltar</button><button class="btn btn-yellow" type="submit">Confirmar agendamento</button></div>
      </form>
    </section>
  </div>`;

  const item = booking.confirmation;
  return `<div class="booking-modal-backdrop"><section class="booking-modal booking-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="booking-confirmation-title"><div class="booking-modal-head"><div><small>AGENDAMENTO CONCLUÍDO</small><h2 id="booking-confirmation-title">Agendamento confirmado</h2></div><button class="booking-modal-close" type="button" data-new-booking aria-label="Fechar confirmação">×</button></div><div class="booking-modal-form"><div class="confirmation"><div class="confirmation-icon">✓</div><p class="booking-lead">Seu horário na ${escapeHTML(establishment.name)} está reservado.</p><div class="confirmation-data"><div class="confirmation-row"><span>Serviço</span><strong>${escapeHTML(item.service)}</strong></div><div class="confirmation-row"><span>Data</span><strong>${prettyDate(item.date, true)}</strong></div><div class="confirmation-row"><span>Horário</span><strong>${escapeHTML(item.time)}</strong></div><div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(item.professional)}</strong></div><div class="confirmation-row"><span>Local</span><strong>${escapeHTML(item.locationType === "online" ? "Atendimento On line" : item.serviceAddress || establishment.address)}</strong></div></div>${item.locationType === "online" && item.meetingUrl ? `<p><a href="${escapeHTML(item.meetingUrl)}" target="_blank" rel="noopener noreferrer">Abrir link da reunião</a></p>` : ""}<div class="call-ticket"><span>Senha no painel</span><strong>${escapeHTML(scheduledTicket(establishment, item.time, item.professional, item.service, item.date))}</strong><p>Esta senha identifica seu horário quando ele for chamado.</p></div><div class="checkin-password"><span>Sua senha de presença</span><strong>${escapeHTML(item.checkInCode)}</strong><p>Guarde esta senha para confirmar sua chegada. Ela não aparece no painel público.</p></div><div class="booking-actions"><span></span><button class="btn btn-primary" type="button" data-new-booking>Fazer outro agendamento</button></div></div></div></section></div>`;
}

function monthlyScheduleMarkup(establishment) {
  const month = state.calendarMonth || state.booking.date.slice(0, 7);
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T12:00:00Z`));
  const today = isoDate();
  const clock = currentSaoPauloClock();
  const days = calendarMonthDays(month).map(date => {
    if (!date) return '<span class="monthly-schedule-empty" aria-hidden="true"></span>';
    const past = date < today;
    const closed = businessDayIsClosed(establishment, date);
    const hasSchedule = !closed && scheduleMatrix(establishment, date).professionals.some(professional => professional.availableTimes.some(time =>
      (date !== today || Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) > clock.minutes)
      && (establishment.services || []).some(service => serviceAvailableAt(establishment, service, date, time)
        && serviceFitsSlot(establishment, professional.name, time, service.name, [], date))));
    const status = past ? "Passou" : closed ? "Fechado" : hasSchedule ? "Expediente" : "Sem horários";
    return `<button type="button" class="monthly-schedule-day ${closed ? "is-closed" : ""} ${date === today ? "is-today" : ""}" data-monthly-date="${date}" aria-label="${prettyDate(date, true)}: ${status}" ${past ? "disabled" : ""}><strong>${Number(date.slice(-2))}</strong><small>${status}</small></button>`;
  }).join("");
  return `<section class="monthly-schedule" aria-label="Grade mensal de agendamento"><div class="monthly-schedule-heading"><button type="button" data-monthly-step="-1" aria-label="Mês anterior">‹</button><h3>${escapeHTML(label)}</h3><button type="button" data-monthly-step="1" aria-label="Próximo mês">›</button></div><p>Selecione um dia para ver os horários livres e fazer o agendamento.</p><div class="monthly-schedule-grid">${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(day => `<span class="monthly-schedule-weekday">${day}</span>`).join("")}${days}</div></section>`;
}

function publicSchedule(establishment) {
  if (establishment.setupComplete === false) return `<div class="schedule-empty" role="status">A agenda de ${escapeHTML(establishment.name)} está em configuração. Os horários para agendamento aparecerão aqui após a publicação pelo responsável.</div>`;
  const data = getData(establishment);
  const canManage = typeof session === "function" && session()?.slug === establishment.slug;
  const timeline = scheduleTimeline(establishment, data.slots || [], state.booking.date);
  const { times, professionals, step, majorStep } = timeline;
  const clock = currentSaoPauloClock();
  const isToday = state.booking.date === clock.date;
  const renderRows = (start, end) => professionals.map((professional) => {
    const staffStatus = staffStatusFor(data, professional.name);
    const paused = isToday && professionalIsPaused(data, professional.name, state.booking.date);
    const closed = isToday && professionalIsClosed(data, professional.name, state.booking.date);
    const onShift = isToday && professionalIsOnShift(professional, state.booking.date);
    const savedCurrentTime = onShift && staffStatus.currentDate === state.booking.date ? staffStatus.currentTime : null;
    const currentTime = savedCurrentTime || (isToday ? currentProfessionalSlot(professional, state.booking.date) : null);
    const selected = state.booking.step < 3 && state.booking.professional === professional.name && state.booking.time;
    const cells = professional.segments.filter((segment) => segment.start < end && segment.end > start).map((segment) => {
      const span = Math.min(segment.end, end) - Math.max(segment.start, start);
      const time = segment.time;
      if (segment.type === "unavailable") return `<td colspan="${span}" class="matrix-unavailable"><span aria-label="Sem horário cadastrado">—</span></td>`;
      if (segment.type === "pause") {
        const label = `Pausado, ${segment.reason}, ${professional.name}`;
        const compact = span * step < 20;
        return `<td colspan="${span}"><button class="matrix-slot ticket-state-paused ${compact ? "matrix-pause-buffer" : ""}" type="button" disabled aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}"><strong class="matrix-ticket-code">${compact ? "Ⅱ" : "Pausado"}</strong><small class="matrix-pause-reason" ${compact ? "hidden" : ""}>${escapeHTML(segment.reason)}</small><i class="matrix-status-dot" aria-hidden="true"></i></button></td>`;
      }
      if (segment.type === "lunch") {
        const label = `Pausado, almoço de ${professional.name}, ${professional.lunchBreak.start} às ${professional.lunchBreak.end}`;
        return `<td colspan="${span}"><button class="matrix-slot ticket-state-paused" type="button" disabled aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}"><strong class="matrix-ticket-code">Pausado</strong><small class="matrix-pause-reason">Almoço</small><i class="matrix-status-dot" aria-hidden="true"></i></button></td>`;
      }
      const appointment = (data.slots || []).find((slot) => slot.date === state.booking.date && slot.time === time && (slot.id?.endsWith("_establishment") || slot.professional === professional.name));
      const status = closed ? "closed" : ticketState({ date: state.booking.date, time, booked: Boolean(appointment), currentTime, paused, status: appointment?.status }, clock);
      const serviceReady = !(establishment.services || []).length || establishment.services.some(service => serviceAvailableAt(establishment, service, state.booking.date, time) && serviceFitsSlot(establishment, professional.name, time, service.name, data.slots || [], state.booking.date));
      const substatus = ticketSubstatus(appointment, status);
      const ticket = scheduledTicket(establishment, time, professional.name, appointment?.service, state.booking.date);
      const chosen = selected === time;
      const label = `${ticket}, ${professional.name}, ${time}, ${status === "free" && !serviceReady ? "nenhum serviço disponível" : TICKET_STATES[status]}${substatus ? `, ${substatus}` : ""}${chosen ? ", selecionado" : ""}${canManage && isToday && appointment ? ", abrir atendimento" : ""}`;
      const action = status === "free" && serviceReady ? `data-public-slot data-professional-name="${escapeHTML(professional.name)}" data-slot-time="${escapeHTML(time)}" aria-pressed="${chosen}"`
        : canManage && isToday && appointment ? `data-open-attendance-slot data-appointment-id="${escapeHTML(appointment.appointmentId || "")}" data-professional-name="${escapeHTML(appointment.professional || professional.name)}" data-slot-time="${escapeHTML(time)}"` : 'disabled';
      return `<td colspan="${span}"><button class="matrix-slot ${span * step <= 20 ? "matrix-slot-tight" : ""} ${span * step < 20 ? "matrix-slot-short" : ""} ticket-state-${status} ${status === "free" && !serviceReady ? "service-unavailable" : ""} ${chosen ? "selected" : ""} ${substatus ? "has-confirmed-presence" : ""}" type="button" ${action} aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}"><strong class="matrix-ticket-code"><span>${escapeHTML(ticket.slice(0, 3))}</span><span>${escapeHTML(ticket.slice(3))}</span></strong><small class="matrix-start-time">${escapeHTML(time)}</small><i class="matrix-status-dot" aria-hidden="true">${chosen || substatus ? "✓" : ""}</i>${substatus ? `<small class="matrix-presence-confirmed">${substatus}</small>` : ""}</button></td>`;
    }).join("");
    const avatar = `<span class="matrix-avatar" aria-hidden="true">${escapeHTML(Array.from(professional.name.trim())[0]?.toLocaleUpperCase("pt-BR") || "?")}</span>`;
    const name = `<span><strong>${escapeHTML(professional.name)}</strong><small>${escapeHTML(professional.role || "Profissional")}</small></span>`;
    const nextButton = canManage ? `<button class="matrix-next-call" type="button" data-open-next-call="${escapeHTML(professional.name)}" aria-label="${closed ? "Expediente encerrado de" : !isToday ? "Próxima senha disponível apenas hoje para" : "Chamar próxima senha de"} ${escapeHTML(professional.name)}" title="${closed ? "Expediente encerrado" : !isToday ? "Disponível somente na agenda de hoje" : "Chamar próxima senha"}" ${closed || !isToday ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14l10-7L4 5Zm13 0v14"/></svg></button>` : "";
    const person = canManage
      ? `<div class="matrix-person"><span class="matrix-person-avatar-actions">${avatar}${nextButton}</span>${isToday ? `<button class="matrix-person-info" type="button" data-open-professional-attendance="${escapeHTML(professional.name)}" aria-label="Abrir atendimentos de ${escapeHTML(professional.name)}">${name}</button>` : name}</div>`
      : `<div class="matrix-person">${avatar}${name}</div>`;
    return `<tr class="${selected ? "matrix-row-selected" : ""}"><th scope="row">${person}</th>${cells}</tr>`;
  }).join("");
  const toolbar = (turnControls = "") => `<div class="schedule-command-bar"><div class="schedule-date-toolbar"><div class="quick-dates"><button type="button" class="${state.booking.dateMode === "today" ? "active" : ""}" data-date-mode="today"><strong>Hoje</strong><small>${prettyDate(isoDate())}</small></button></div>${renderBookingCalendar({ selectedDate: state.booking.date, dateMode: state.booking.dateMode, today: isoDate(), month: state.calendarMonth, open: state.calendarOpen })}${turnControls}</div><div class="schedule-view-toggle" role="group" aria-label="Visualização da agenda"><button type="button" data-schedule-view="day" aria-pressed="${state.scheduleView !== "month"}">Dia</button><button type="button" data-schedule-view="month" aria-pressed="${state.scheduleView === "month"}">Mês</button></div>${ticketStatusLegend()}</div>`;
  if (state.scheduleView === "month") return `${toolbar()}${monthlyScheduleMarkup(establishment)}`;
  if (businessDayIsClosed(establishment, state.booking.date)) return `${toolbar()}<div class="schedule-empty" role="status">Sem expediente neste dia. Escolha outra data para agendar.</div>`;
  if (!professionals.length || !times.length) return `${toolbar()}<div class="schedule-empty">Nenhum horário cadastrado.</div>`;
  const periods = scheduleDayPeriods(timeline);
  const key = `${establishment.slug || establishment.id || establishment.name}:${state.booking.date}`;
  if (state.scheduleTurn?.key !== key || !periods.some(period => period.id === state.scheduleTurn.id)) {
    const preferred = isToday && clock.minutes >= 13 * 60 ? "afternoon" : "morning";
    state.scheduleTurn = { key, id: periods.find(period => period.id === preferred)?.id || periods[0].id, changedAt: Date.now() };
    state.scheduleScrollLeft = 0;
  }
  const period = periods.find(item => item.id === state.scheduleTurn.id);
  const controls = `<div class="schedule-turn-controls"><div class="schedule-turn-navigation" role="group" aria-label="Turnos da agenda"><button type="button" data-schedule-turn-step="-1" aria-label="Turno anterior" ${periods.length < 2 ? "disabled" : ""}>‹</button><div class="schedule-turn-title" aria-live="polite"><strong>${period.label}</strong><small>${period.startTime}–${period.endTime}</small></div><button type="button" data-schedule-turn-step="1" aria-label="Próximo turno" ${periods.length < 2 ? "disabled" : ""}>›</button></div><label class="schedule-turn-auto"><input type="checkbox" data-schedule-turn-auto ${state.scheduleAuto !== false ? "checked" : ""} ${periods.length < 2 ? "disabled" : ""}><span>Alternar automaticamente<small>A cada 5 segundos</small></span></label></div>`;
  const unitsPerHeading = majorStep / step;
  const bands = [period];
  const columns = Math.max(...bands.map((band) => band.times.length));
  return `${toolbar(controls)}<div class="schedule-matrix-bands schedule-timeline schedule-period-view" style="--matrix-bands:${bands.length};--timeline-track-width:${108 / unitsPerHeading}px">${bands.map((band) => {
    const headers = band.times.flatMap((time, index) => index % unitsPerHeading ? [] : [`<th scope="col" colspan="${Math.min(unitsPerHeading, band.times.length - index)}" class="timeline-hour"><time datetime="${time}" title="${time}">${time}</time>${index + unitsPerHeading >= band.times.length ? `<span class="timeline-end-label">${band.endTime}</span>` : ""}</th>`]).join("");
    const padding = columns - band.times.length;
    const rows = renderRows(band.start, band.end).replaceAll("</tr>", `${padding ? `<td colspan="${padding}" class="matrix-timeline-padding"></td>` : ""}</tr>`);
    return `<div class="schedule-matrix-wrap" data-schedule-matrix aria-label="${band.label}, de ${band.startTime} a ${band.endTime}"><table class="schedule-matrix" style="--matrix-columns:${columns}"><caption>${band.label}, de ${band.startTime} a ${band.endTime}, em intervalos de uma hora</caption><colgroup><col class="matrix-person-column">${Array.from({ length: columns }, () => "<col>").join("")}</colgroup><thead><tr><th scope="col">Equipe<small class="timeline-range">${band.startTime}–${band.endTime}</small></th>${headers}${padding ? `<th colspan="${padding}" class="matrix-timeline-padding"></th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("")}</div>`;
}

function moveScheduleTurn(establishment, direction = 1) {
  const body = document.querySelector(".public-schedule-body");
  if (!body) return;
  const periods = scheduleDayPeriods(scheduleTimeline(establishment, getData(establishment).slots || [], state.booking.date));
  if (periods.length < 2) return;
  const index = Math.max(0, periods.findIndex(period => period.id === state.scheduleTurn?.id));
  const next = periods[(index + direction + periods.length) % periods.length];
  const focused = document.activeElement;
  const focusSelector = focused?.matches("[data-schedule-turn-auto]") ? "[data-schedule-turn-auto]" : focused?.matches("[data-schedule-turn-step]") ? `[data-schedule-turn-step="${focused.dataset.scheduleTurnStep}"]` : null;
  state.scheduleTurn = { key: `${establishment.slug || establishment.id || establishment.name}:${state.booking.date}`, id: next.id, changedAt: Date.now() };
  state.scheduleScrollLeft = 0;
  body.innerHTML = publicSchedule(establishment);
  restoreScheduleScroll();
  if (focusSelector) body.querySelector(focusSelector)?.focus();
  startScheduleTurnTimer(establishment);
}

function startScheduleTurnTimer(establishment) {
  clearTimeout(scheduleTurnTimer);
  scheduleTurnTimer = null;
  if (state.scheduleView === "month") return;
  if (businessDayIsClosed(establishment, state.booking.date)) return;
  if (state.scheduleAuto === false || !document.querySelector(".public-schedule-body")) return;
  const periods = scheduleDayPeriods(scheduleTimeline(establishment, getData(establishment).slots || [], state.booking.date));
  if (periods.length < 2) return;
  const elapsed = Date.now() - (state.scheduleTurn?.changedAt ?? Date.now());
  scheduleTurnTimer = setTimeout(() => {
    scheduleTurnTimer = null;
    if (state.scheduleAuto !== false) moveScheduleTurn(establishment, 1);
  }, Math.max(0, 5000 - elapsed));
}

function pauseScheduleTurn() {
  state.scheduleAuto = false;
  clearTimeout(scheduleTurnTimer);
  scheduleTurnTimer = null;
  const checkbox = document.querySelector("[data-schedule-turn-auto]");
  if (checkbox) checkbox.checked = false;
}

function resumeScheduleTurn() {
  if (state.schedulePausedByCalendar) return;
  state.scheduleAuto = true;
  if (state.scheduleTurn) state.scheduleTurn.changedAt = Date.now();
}

function restoreScheduleScroll() {
  const matrix = document.querySelector("[data-schedule-matrix]");
  if (!matrix) return;
  matrix.scrollLeft = state.scheduleScrollLeft;
  matrix.addEventListener("scroll", () => { state.scheduleScrollLeft = matrix.scrollLeft; }, { passive: true });
}

function serviceLocationLabel(establishment, service) {
  if (service.locationType === "online") return "Atendimento On line";
  if (service.locationType === "address2") return `Endereço 2: ${establishment.address2 || "a definir"}`;
  return `Endereço 1: ${establishment.address || "a definir"}`;
}

function publicMapMarkup(establishment) {
  const addresses = { address1: String(establishment.address || "").trim(), address2: String(establishment.address2 || "").trim() };
  const selected = addresses[state.mapAddressType] ? state.mapAddressType : addresses.address1 ? "address1" : "address2";
  const address = addresses[selected];
  if (!address) return "";
  const suffix = selected === "address2" ? "2" : "";
  const mapLabel = addressMapLabel(establishment, suffix);
  const query = googleMapsPlaceQuery(establishment, suffix);
  const choices = addresses.address2 ? `<div class="public-location-choices" role="group" aria-label="Selecionar endereço no mapa"><button type="button" data-map-address="address1" aria-pressed="${selected === "address1"}" ${addresses.address1 ? "" : "disabled"}>Endereço 1</button><button type="button" data-map-address="address2" aria-pressed="${selected === "address2"}">Endereço 2</button></div>` : "";
  const key = firebaseApi?.googleMapsEmbedKey;
  const mapUrl = key ? new URL("https://www.google.com/maps/embed/v1/place") : null;
  if (mapUrl) mapUrl.search = new URLSearchParams({ key, q: query, language: "pt-BR", region: "BR" }).toString();
  const map = mapUrl ? `<div class="public-map-view"><iframe title="Localização de ${escapeHTML(mapLabel)} no ${selected === "address2" ? "Endereço 2" : "Endereço 1"}" src="${mapUrl.href.replaceAll("&", "&amp;")}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>` : `<div class="public-map-empty"><p>Mapa indisponível no momento.</p></div>`;
  return `<section class="panel public-location-panel" aria-labelledby="public-location-title"><div><h2 id="public-location-title">Onde estamos</h2>${choices}<p>${escapeHTML(address)}</p></div>${map}</section>`;
}

function selectPublicMapAddress(establishment, type) {
  const address = String(type === "address2" ? establishment.address2 || "" : establishment.address || "").trim();
  if (!address || !["address1", "address2"].includes(type)) return;
  state.mapAddressType = type;
  const panel = document.querySelector(".public-location-panel");
  if (panel) panel.outerHTML = publicMapMarkup(establishment);
}

function serviceWeeklyLabel(service) {
  if (service.weeklyAvailability == null) return "Todo o expediente";
  return [["seg", "Seg"], ["ter", "Ter"], ["qua", "Qua"], ["qui", "Qui"], ["sex", "Sex"], ["sab", "Sáb"], ["dom", "Dom"]]
    .filter(([day]) => service.weeklyAvailability[day]?.length)
    .map(([day, label]) => `${label} ${service.weeklyAvailability[day].map(interval => `${interval.start}–${interval.end}`).join(", ")}`).join(" · ");
}

function publicServiceCards(establishment) {
  return `<section class="public-services" id="servicos-agendamento"><div class="service-list">${establishment.services.map((item) => `<article class="service-card-display" title="${escapeHTML(`${serviceLocationLabel(establishment, item)} · ${serviceWeeklyLabel(item)}`)}"><span class="service-icon">${escapeHTML(item.icon || "✦")}</span><span><strong>${escapeHTML(item.name)}</strong><small>${item.duration} minutos · ${escapeHTML(serviceLocationLabel(establishment, item))}</small><small>${escapeHTML(serviceWeeklyLabel(item))}</small></span><span class="service-price">${item.price ? currency.format(item.price) : "Incluso"}</span></article>`).join("") || (establishment.setupComplete === false ? '<p class="empty">Os serviços aparecerão após o cadastro.</p>' : "")}</div></section>`;
}

function moveServiceCarousel(direction = 1) {
  const carousel = document.querySelector("[data-service-carousel]");
  const card = carousel?.querySelector(".service-card-display");
  if (!carousel || !card) return;
  const step = card.getBoundingClientRect().width + 10;
  const atEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 4;
  const atStart = carousel.scrollLeft <= 4;
  const left = direction > 0 && atEnd ? 0 : direction < 0 && atStart ? carousel.scrollWidth : carousel.scrollLeft + (step * direction);
  carousel.scrollTo({ left, behavior: "smooth" });
}

function startServiceCarousel() {
  clearInterval(serviceCarouselTimer);
  const carousel = document.querySelector("[data-service-carousel]");
  if (!carousel || carousel.scrollWidth <= carousel.clientWidth || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  serviceCarouselTimer = setInterval(() => {
    if (!carousel.matches(":hover") && !carousel.contains(document.activeElement)) moveServiceCarousel(1);
  }, 4000);
}

function publicAppointmentLookup() {
  const lookup = state.publicLookup;
  const credentialLabel = lookup.method === "code" ? "Senha do agendamento" : "Nome completo";
  const credentialPlaceholder = lookup.method === "code" ? "Ex.: 7K9M2P" : "Digite seu nome completo";
  const results = lookup.loading
    ? '<div class="lookup-message">Buscando seu agendamento…</div>'
    : lookup.searched && !lookup.results.length
      ? `<div class="lookup-message">Nenhum agendamento foi encontrado com ${lookup.method === "code" ? "essa senha" : "esse nome completo"}.</div>`
      : lookup.results.map((item) => {
        const online = item.locationType === "online";
        const canCheckIn = !online && item.status === "confirmado" && appointmentPresenceWindow(activeEstablishment(), item).allowed;
        const isPresent = item.status === "presente";
        const place = online ? "Atendimento On line" : item.serviceAddress || activeEstablishment()?.address || "Endereço a confirmar";
        const meetingLink = online && lookup.method === "code" && /^https?:\/\//i.test(item.meetingUrl || "") ? `<a href="${escapeHTML(item.meetingUrl)}" target="_blank" rel="noopener noreferrer">Abrir reunião</a>` : "";
        return `<article class="lookup-result checkin-result"><div><small>${prettyDate(item.date, true)}</small><strong>${escapeHTML(item.time)} · ${escapeHTML(item.service)}</strong><span>${escapeHTML(item.professional)}</span><span>${escapeHTML(place)}</span>${meetingLink}</div><div><em class="status ${escapeHTML(item.status || "confirmado")}">${escapeHTML(statusLabel(item.status))}</em>${online ? `<span class="presence-unavailable">${meetingLink ? "Entre pelo link no horário reservado." : lookup.method === "name" ? "Use sua senha para consultar os detalhes online." : "O estabelecimento informará o acesso online."}</span>` : canCheckIn ? `<button class="btn btn-primary btn-sm" type="button" data-start-checkin="${escapeHTML(item.appointmentId)}">Ler QR e confirmar</button>` : isPresent ? '<span class="presence-done">✓ Presença registrada</span>' : `<span class="presence-unavailable">${presenceWindowLabel(activeEstablishment(), item)}</span>`}</div></article>`;
      }).join("");
  const success = lookup.success ? `<div class="checkin-success" role="status"><span>✓</span><div><strong>Presença confirmada!</strong><p>${escapeHTML(lookup.success.time)} · ${escapeHTML(lookup.success.service)}. A equipe já pode ver que você chegou.</p></div></div>` : "";
  const scanner = lookup.scanning ? `<div class="booking-modal-backdrop" data-checkin-backdrop>
    <section class="booking-modal checkin-scanner-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-scanner-title">
      <div class="booking-modal-head"><div><small>CONFIRMAÇÃO DE PRESENÇA</small><h2 id="checkin-scanner-title">Aponte para o QR code</h2></div><button class="booking-modal-close" type="button" data-cancel-checkin aria-label="Fechar leitor">×</button></div>
      <div class="checkin-scanner-body"><div class="scanner-frame"><video data-qr-video playsinline muted></video><span class="scanner-corner corner-one"></span><span class="scanner-corner corner-two"></span><span class="scanner-corner corner-three"></span><span class="scanner-corner corner-four"></span><div class="scanner-loading" data-scanner-loading><span class="loading-spinner"></span>Ativando câmera…</div></div>
      <p>Mantenha o QR code do balcão dentro do quadrado. A confirmação será automática.</p>
      ${lookup.scanError ? `<div class="scanner-error">${escapeHTML(lookup.scanError)}</div>` : ""}
      <label class="btn btn-soft scanner-upload">Usar foto do QR<input type="file" accept="image/*" data-qr-image hidden></label>
      <button class="btn btn-outline" type="button" data-cancel-checkin>Cancelar</button></div>
    </section></div>` : "";
  return `<div class="public-lookup-panel" id="confirmar-presenca"><div class="checkin-heading"><span class="checkin-heading-icon">✓</span><div><small>CHEGUEI AO LOCAL</small><h2 class="booking-title">Confirmar minha presença</h2></div></div><p class="booking-lead">Primeiro encontre seu horário. Depois, leia o QR code disponível no balcão.</p>
    <div class="checkin-methods" role="tablist" aria-label="Forma de identificação"><button type="button" class="${lookup.method === "name" ? "active" : ""}" data-checkin-method="name">Usar meu nome</button><button type="button" class="${lookup.method === "code" ? "active" : ""}" data-checkin-method="code">Usar minha senha</button></div>
    <form id="public-appointment-search-form"><label for="public-appointment-credential">${credentialLabel}</label><div class="public-lookup-field"><input id="public-appointment-credential" name="credential" type="text" value="${escapeHTML(lookup.query)}" ${lookup.method === "code" ? 'inputmode="text" autocapitalize="characters" maxlength="12"' : 'autocomplete="name"'} required placeholder="${credentialPlaceholder}"><button class="btn btn-primary" type="submit" ${lookup.loading ? "disabled" : ""}>${lookup.loading ? "Pesquisando…" : "Encontrar horário"}</button></div></form>
    ${success}<div class="public-lookup-results" aria-live="polite">${results}</div>${scanner}</div>`;
}

function publicCheckInModal() {
  if (!state.publicLookup.open) return "";
  return `<div class="booking-modal-backdrop" data-checkin-modal-backdrop>
    <section class="booking-modal checkin-flow-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-modal-title">
      <div class="booking-modal-head"><div><small>CHEGUEI AO LOCAL</small><h2 id="checkin-modal-title">Confirmar minha presença</h2></div><button class="booking-modal-close" type="button" data-close-checkin-modal aria-label="Fechar confirmação de presença">×</button></div>
      <div class="checkin-flow-body">${publicAppointmentLookup()}</div>
    </section>
  </div>`;
}

async function stopQrScanner() {
  if (!qrScanner) return;
  try { await qrScanner.stop(); qrScanner.destroy(); } catch { /* câmera já encerrada */ }
  qrScanner = null;
}

function parseCheckInQr(rawValue, expectedSlug) {
  try {
    const url = new URL(String(rawValue));
    const queryRoute = url.searchParams.get("route");
    if (queryRoute) {
      const token = url.searchParams.get("checkin");
      if (queryRoute === expectedSlug && token) return token;
      throw new Error("wrong-establishment");
    }
    const staticRoute = url.search.match(/^\?\/([^&]+)&checkin=([^&]+)/);
    if (staticRoute) {
      const scannedSlug = decodeURIComponent(staticRoute[1]);
      const token = decodeURIComponent(staticRoute[2]);
      if (scannedSlug === expectedSlug && token) return token;
      throw new Error("wrong-establishment");
    }
    let path = url.pathname;
    if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
    const scannedSlug = path.replace(/^\/+|\/+$/g, "");
    const token = url.searchParams.get("checkin");
    if (scannedSlug !== expectedSlug || !token) throw new Error("wrong-establishment");
    return token;
  } catch {
    const match = String(rawValue || "").match(/^agendae:checkin:([^:]+):(.+)$/);
    if (match?.[1] === expectedSlug) return match[2];
    return null;
  }
}

async function finishPublicCheckIn(rawValue) {
  const establishment = activeEstablishment();
  const lookup = state.publicLookup;
  const selected = lookup.results.find((item) => item.appointmentId === lookup.selectedId);
  const token = establishment ? parseCheckInQr(rawValue, establishment.slug) : null;
  if (!establishment || !selected || !token) {
    lookup.scanError = "Este QR code não pertence a este estabelecimento. Aponte para o código disponível no balcão.";
    render();
    requestAnimationFrame(startQrScanner);
    return;
  }
  await stopQrScanner();
  lookup.scanError = "";
  try {
    await firebaseApi.confirmPresenceWithQr(establishment.slug, selected.appointmentId, token, selected.date, selected.presenceExists !== false, selected);
    selected.status = "presente";
    selected.presenceExists = true;
    lookup.scanning = false;
    lookup.success = selected;
    const url = new URL(location.href);
    url.searchParams.delete("checkin");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    render();
  } catch (error) {
    lookup.scanError = firebaseApi ? firebaseApi.firebaseErrorMessage(error) : "Não foi possível confirmar a presença.";
    lookup.scanning = true;
    render();
  }
}

async function startQrScanner() {
  const video = document.querySelector("[data-qr-video]");
  if (!video || !state.publicLookup.scanning) return;
  await stopQrScanner();
  try {
    const { default: QrScanner } = await import("./vendor/qr-scanner.min.js");
    qrScanner = new QrScanner(video, (result) => void finishPublicCheckIn(result?.data || result), {
      preferredCamera: "environment",
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
    });
    await qrScanner.start();
    document.querySelector("[data-scanner-loading]")?.remove();
  } catch (error) {
    console.error("Agendae: não foi possível abrir a câmera.", error);
    state.publicLookup.scanError = "Não foi possível abrir a câmera. Autorize o acesso ou use uma foto do QR code.";
    render();
  }
}

function queueDetail(item) {
  if (["paused", "closed"].includes(item?.ticketState)) return item.professional;
  return item?.kind === "scheduled" ? `${item.time} · ${item.professional}` : (item?.servicePoint || "Fila avulsa");
}

function queueBadge(item, monitor = false) {
  if (item?.ticketState) return `<span class="ticket-status-label ticket-state-${item.ticketState}">${TICKET_STATES[item.ticketState]}${ticketSubstatus(item, item.ticketState) ? '<small class="ticket-presence-substatus">✓ Presença Confirmada</small>' : ""}</span>`;
  if (item?.kind === "scheduled" && !item.service) return `<span class="${monitor ? "monitor-normal" : "normal-badge"}">Serviço indefinido</span>`;
  if (item?.kind === "scheduled") return `<span class="${monitor ? "monitor-scheduled" : "scheduled-badge"}">Agendado</span>`;
  if (item?.priority === "preferencial") return `<span class="${monitor ? "monitor-priority" : "priority-badge"}">Preferencial</span>`;
  return `<span class="${monitor ? "monitor-normal" : "normal-badge"}">Avulso</span>`;
}

function currentTicketCards(current, showNames = false, monitor = false) {
  return `<div class="current-ticket-list">${current.map((item) => `<article class="current-ticket-card ticket-state-${item.ticketState}"><strong>${escapeHTML(["paused", "closed"].includes(item.ticketState) ? TICKET_STATES[item.ticketState] : item.ticket)}</strong>${item.pauseReason ? `<small class="current-ticket-reason">${escapeHTML(item.pauseReason)}</small>` : ""}<span class="current-ticket-detail">${escapeHTML(queueDetail(item))}</span>${showNames && item.ticketState === "in-service" && item.client ? `<span class="queue-customer">${escapeHTML(item.client)}</span>` : ""}</article>`).join("") || '<p class="current-ticket-empty">Nenhum profissional cadastrado</p>'}</div>`;
}

function liveStatusDot(current, notStarted = false, closedDay = false) {
  const inactive = notStarted || allProfessionalsClosed(current);
  return `<span class="live-dot${inactive ? " closed" : ""}" aria-label="${closedDay ? "Sem expediente neste dia" : notStarted ? "Expediente não Iniciado" : inactive ? "Todos os profissionais encerrados" : "Atendimento disponível"}"></span>`;
}

function attendanceView(establishment, data, date, clock = currentSaoPauloClock()) {
  const opening = businessOpeningMinutes(establishment, clock.date);
  const beforeOpening = opening !== null && clock.minutes < opening;
  const closedDay = businessDayIsClosed(establishment, date && date >= clock.date ? date : clock.date);
  const notStarted = closedDay || date > clock.date || beforeOpening || businessDayIsClosed(establishment, clock.date);
  return { notStarted, closedDay, current: notStarted ? [] : queueView(establishment, data, clock).current };
}

function attendanceCards(view, showNames = false, monitor = false) {
  if (view.closedDay) return '<div class="public-live-not-started" role="status">Sem expediente neste dia</div>';
  return view.notStarted ? '<div class="public-live-not-started" role="status">Expediente não Iniciado</div>' : currentTicketCards(view.current, showNames, monitor);
}

function publicCurrentAttendance(establishment, data, clock = currentSaoPauloClock()) {
  if (establishment.setupComplete === false) return '<div class="public-live-control"><span class="live-dot closed" aria-label="Agenda em configuração"></span></div><div><small>Atendendo agora</small><div class="public-live-not-started" role="status">Em configuração</div></div>';
  const view = attendanceView(establishment, data, state.booking.date, clock);
  return `<div class="public-live-control">${liveStatusDot(view.current, view.notStarted, view.closedDay)}<button class="public-queue-expand" type="button" data-open-queue-display aria-label="Expandir painel de senhas no monitor" title="Expandir painel de senhas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5m13-5v5h-5"/></svg></button></div><div><small>Atendendo agora</small>${attendanceCards(view)}</div>`;
}

function ticketStatusLegend() {
  return `<div class="ticket-status-legend" aria-label="Legenda dos status das senhas">${Object.entries(TICKET_STATES).map(([state, label]) => `<span class="ticket-state-${state}"><i aria-hidden="true"></i>${label}</span>`).join("")}</div>`;
}

function queuePanel(establishment, data, showNames = true, showHeader = true, date) {
  const clock = currentSaoPauloClock();
  const view = attendanceView(establishment, data, date || clock.date, clock);
  return `<section class="panel queue-panel">${showHeader ? '<div class="panel-head queue-panel-head"><div><h2>Painel de senhas</h2><p>Uma senha por profissional, no horário atual</p></div><div class="queue-head-actions"><span class="open-tag">AO VIVO</span><button class="btn btn-soft btn-sm" data-open-queue-display>⛶ Exibir no monitor</button></div></div>' : ""}
    <div class="queue-board"><div class="queue-current"><small>Atendendo agora</small>${view.notStarted ? liveStatusDot([], true, view.closedDay) : ""}${attendanceCards(view, showNames)}</div>
    </div></section>`;
}

function ticketLegend(establishment) {
  const professionals = professionalDirectory(establishment).map((item) => `<span><b>${escapeHTML(professionalInitial(item.name))}</b> ${escapeHTML(item.name)}</span>`).join("");
  const services = (establishment.services || []).map((item) => `<span><b>${escapeHTML(serviceInitials(item.name))}</b> ${escapeHTML(item.name)}</span>`).join("");
  return `<section class="ticket-legend" aria-label="Legenda das senhas"><h3>Como ler as senhas</h3>${ticketStatusLegend()}<p class="ticket-legend-example"><strong>RCT-08</strong><span><b>R</b>: inicial do profissional · <b>CT</b>: iniciais do serviço · <b>08</b>: 8º horário na agenda do profissional naquele dia.</span></p><p>Exemplos de serviço: <b>CT</b> = Cabelo Tesoura, <b>CM</b> = Cabelo Máquina, <b>CC</b> = Cabelo Completo, <b>SI</b> = Serviço indefinido (sem serviço registrado para o horário).</p><div class="ticket-legend-group"><h4>Profissionais</h4><div>${professionals}</div></div><div class="ticket-legend-group"><h4>Serviços</h4><div>${services}</div></div><p>A contagem começa em 01 e inclui os horários ocupados e os que já passaram. Na agenda compartilhada, usa a grade do estabelecimento. Somente horários da grade cadastrada geram senhas no painel.</p></section>`;
}

function ensureQueueSubscription(establishment) {
  if (!firebaseApi || queueSubscriptionSlug === establishment.slug) return;
  if (queueSubscription) queueSubscription();
  queueSubscriptionSlug = establishment.slug;
  queueSubscription = firebaseApi.observePublicState(establishment.slug, (live) => {
    if (live.establishmentSchedule) Object.assign(establishment, live.establishmentSchedule);
    if (live.professionalLunchBreaks) establishment.professionalLunchBreaks = live.professionalLunchBreaks;
    if (live.establishmentHours) establishment.hours = live.establishmentHours;
    const prefix = `public:${establishment.slug}:`;
    const keys = [...cloudCache.keys()].filter((key) => key.startsWith(prefix));
    if (!keys.length) keys.push(publicCacheKey(establishment, isoDate()));
    for (const key of keys) {
      const cached = cloudCache.get(key) || { appointments: [], slots: [], todayAppointments: 0 };
      cloudCache.set(key, { ...cached, ...live, ...(live.todaySlots && key === publicCacheKey(establishment, isoDate()) ? { slots: live.todaySlots } : {}) });
    }
    const params = new URLSearchParams(location.search);
    if (route() === establishment.slug && (typeof document === "undefined" || !settingsIsEditing())) render();
  });
}

function professionalAvailability(establishment, data, date = isoDate()) {
  const slots = data.slots || [];
  return professionalDirectory(establishment, date).map((professional) => ({
    ...professional,
    freeTimes: (professional.availableTimes || []).filter((time) =>
      !businessDayIsClosed(establishment, date) && !professionalIsClosed(data, professional.name, date) && !slotHasPassed(date, time) && serviceFitsSlot(establishment, professional.name, time, undefined, slots, date)
    ),
  }));
}

function availableTimesFor(establishment, data, date = isoDate()) {
  if (businessDayIsClosed(establishment, date)) return [];
  if (!usesEmployeeSchedules(establishment)) {
    const busy = new Set((data.slots || []).map((slot) => slot.time));
    const professionals = professionalDirectory(establishment, date);
    return (establishment.availableTimes || []).filter((time) => !slotHasPassed(date, time) && !busy.has(time) && professionals.some((professional) => !professionalIsClosed(data, professional.name, date) && serviceFitsSlot(establishment, professional.name, time, undefined, data.slots || [], date)));
  }
  return [...new Set(professionalAvailability(establishment, data, date).flatMap((professional) => professional.freeTimes))].sort();
}

function staffSchedulesMarkup(establishment, data, selectedProfessional = "") {
  if (!usesEmployeeSchedules(establishment)) {
    const freeTimes = availableTimesFor(establishment, data);
    return `<section class="staff-schedule"><div class="staff-schedule-head"><span class="client-avatar">EST</span><span><strong>Agenda do estabelecimento</strong><small>Grade compartilhada · ${freeTimes.length} livres</small></span></div><div class="staff-time-list">${freeTimes.length ? freeTimes.map((time) => `<span class="free-slot">${time}</span>`).join("") : '<span class="staff-full">Agenda preenchida</span>'}</div></section>`;
  }
  return professionalAvailability(establishment, data).filter((professional) => !selectedProfessional || professional.name === selectedProfessional).map((professional) => {
    const staffStatus = staffStatusFor(data, professional.name);
    const current = data.appointments.find((item) => item.professional === professional.name && item.status === "atendendo");
    const paused = professionalIsPaused(data, professional.name);
    const closed = professionalIsClosed(data, professional.name);
    const onShift = professionalIsOnShift(professional);
    const onLunch = isLunchTime(professional.lunchBreak, currentSaoPauloClock().minutes);
    const label = closed ? "Expediente encerrado" : paused || onLunch ? "Pausado" : onShift ? `Em Atendimento${current ? ` · ${current.time}` : ""}` : "Fora do expediente";
    const statusClass = closed ? "off-shift" : paused || onLunch ? "paused" : onShift ? "in-service" : "off-shift";
    return `<section class="staff-schedule"><div class="staff-schedule-head"><span class="client-avatar">${initials(professional.name)}</span><span class="staff-schedule-person"><strong>${escapeHTML(professional.name)}</strong><small>${escapeHTML(professional.role || "Profissional")} · ${professional.freeTimes.length} livres</small></span><span class="staff-operational-status ${statusClass}">${escapeHTML(label)}</span></div>${closed ? "" : `<button class="staff-pause-button ${paused ? "resume" : ""}" type="button" data-toggle-professional-pause data-professional-name="${escapeHTML(professional.name)}" data-paused="${paused}">${paused ? "Retomar atendimento" : "Pausar atendimento"}</button>`}<div class="staff-time-list">${professional.freeTimes.length ? professional.freeTimes.map((time) => `<span class="free-slot">${time}</span>`).join("") : '<span class="staff-full">Sem horários livres</span>'}</div></section>`;
  }).join("");
}

function compactBusinessHours(establishment) {
  const hours = establishment.hours || [];
  const labelKey = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  const range = (value) => {
    const clean = String(value || "").trim();
    if (!clean) return "";
    if (/fechado/i.test(clean)) return "Fechado";
    const normalized = clean.replace(/^das\s+/i, "").replace(/\s*(?:-|\u2013|\u2014|\u00e0s|as)\s*/i, " às ");
    return `das ${normalized}`;
  };
  const weekdayGroup = hours.find((item) => {
    const key = labelKey(item.label);
    return key.includes("diasuteis") || key === "uteis" || (key.includes("seg") && key.includes("sex"));
  });
  const weekdays = [["seg", "Seg"], ["ter", "Ter"], ["qua", "Qua"], ["qui", "Qui"], ["sex", "Sex"]]
    .map(([day, label]) => ({ label, value: hours.find((item) => labelKey(item.label).startsWith(day))?.value }))
    .filter((item) => item.value);
  const weekdayParts = weekdayGroup?.value
    ? [{ label: "Seg a sex", value: weekdayGroup.value }]
    : weekdays.length === 5 && weekdays.every((item) => range(item.value) === range(weekdays[0].value))
      ? [{ label: "Seg a sex", value: weekdays[0].value }]
      : weekdays;
  const saturday = hours.find((item) => labelKey(item.label).startsWith("sab"));
  const sunday = hours.find((item) => labelKey(item.label).startsWith("dom"));
  const parts = [
    ...weekdayParts.map((item) => `<span><strong>${item.label}</strong> ${escapeHTML(range(item.value))}</span>`),
    saturday?.value ? `<span><strong>Sáb</strong> ${escapeHTML(range(saturday.value))}</span>` : "",
    sunday?.value ? `<span><strong>Dom</strong> ${escapeHTML(range(sunday.value))}</span>` : "",
  ].filter(Boolean);
  return parts.join('<i aria-hidden="true">•</i>') || `<span>${escapeHTML(establishment.todayHours || "Consulte o funcionamento")}</span>`;
}

function lunchSchedulesMarkup(establishment) {
  const days = [["seg", "Seg"], ["ter", "Ter"], ["qua", "Qua"], ["qui", "Qui"], ["sex", "Sex"], ["sab", "Sáb"], ["dom", "Dom"]];
  return `<section class="panel lunch-config-panel"><div class="panel-head"><div><h2>Horários de almoço</h2><p>Defina o intervalo e escolha os dias de almoço de cada profissional.</p></div></div><div class="lunch-config-list">${professionalDirectory(establishment).map((professional) => {
    const interval = professional.lunchBreak;
    const custom = Boolean(interval?.days);
    return `<form class="lunch-config-form" data-lunch-form data-professional-name="${escapeHTML(professional.name)}"><strong>${escapeHTML(professional.name)}</strong><label>Início<input type="time" name="start" value="${interval?.start || ""}" aria-label="Início do almoço de ${escapeHTML(professional.name)}"></label><label>Fim<input type="time" name="end" value="${interval?.end || ""}" aria-label="Fim do almoço de ${escapeHTML(professional.name)}"></label><label class="lunch-day-mode">Dias do almoço<select name="dayMode" data-lunch-day-mode><option value="all" ${custom ? "" : "selected"}>Todos os dias</option><option value="custom" ${custom ? "selected" : ""}>Selecionar dias</option></select></label><div class="lunch-day-options" data-lunch-days ${custom ? "" : "hidden"}>${days.map(([day, label]) => `<label><input type="checkbox" name="lunchDay" value="${day}" ${interval?.days?.includes(day) ? "checked" : ""}>${label}</label>`).join("")}</div><button type="submit" class="btn btn-primary btn-sm">Salvar</button><small>Deixe início e fim vazios para remover o intervalo.</small></form>`;
  }).join("")}</div></section>`;
}

function workPeriodRow(professionalName, period = {}) {
  return `<div class="work-period-row"><label>Início<input type="time" name="start" value="${escapeHTML(period.start || "")}" required aria-label="Início do período de ${escapeHTML(professionalName)}"></label><label>Fim<input type="time" name="end" value="${escapeHTML(period.end || "")}" required aria-label="Fim do período de ${escapeHTML(professionalName)}"></label><button type="button" class="work-period-remove" data-remove-work-period aria-label="Remover período">×</button></div>`;
}

function workSchedulesMarkup(establishment) {
  return `<section class="panel work-config-panel"><div class="panel-head"><div><h2>Escalas de trabalho</h2><p>Adicione os períodos de cada profissional. As senhas SI seguem uma sequência de 20 minutos; intervalos ficam pausados.</p></div></div><div class="work-config-list">${professionalDirectory(establishment).map(professional => `<form class="work-config-form" data-work-form data-professional-name="${escapeHTML(professional.name)}"><div class="work-config-heading"><span class="matrix-avatar">${escapeHTML(professionalInitial(professional.name))}</span><div><strong>${escapeHTML(professional.name)}</strong><small>${escapeHTML(professional.role || "Profissional")}</small></div><span class="work-config-duration">SI · 20 min</span></div><div class="work-period-list">${workPeriodsFor(professional).map(period => workPeriodRow(professional.name, period)).join("") || workPeriodRow(professional.name)}</div><div class="work-config-actions"><button type="button" class="btn btn-soft btn-sm" data-add-work-period>+ Adicionar período</button><button type="submit" class="btn btn-primary btn-sm">Salvar escala</button></div><small class="work-config-note">O almoço é definido abaixo e interrompe automaticamente a sequência.</small></form>`).join("")}</div></section>`;
}

function professionalSettingsMarkup(establishment) {
  const items = professionalDirectory(establishment).map((item) => `<form class="settings-item-form" data-professional-form data-original-name="${escapeHTML(item.name)}"><div class="settings-fields"><label>Nome<input name="name" value="${escapeHTML(item.name)}" maxlength="80" required></label><label>Função<input name="role" value="${escapeHTML(item.role || "")}" maxlength="80" placeholder="Profissional"></label></div><div class="settings-item-actions"><button class="btn btn-primary btn-sm" type="submit">Salvar</button><button class="btn btn-outline btn-sm" type="button" data-remove-professional="${escapeHTML(item.name)}">Remover</button></div></form>`).join("");
  return `<div class="settings-section"><p class="settings-hint">Cadastre quem atende na agenda. O acesso por login continua vinculado à conta da equipe.</p>${items || '<p class="empty">Nenhum funcionário cadastrado.</p>'}<form class="settings-item-form" data-professional-form><h3>Adicionar funcionário</h3><div class="settings-fields"><label>Nome<input name="name" maxlength="80" required></label><label>Função<input name="role" maxlength="80" placeholder="Profissional"></label></div><button class="btn btn-primary btn-sm" type="submit">Adicionar funcionário</button></form></div>`;
}

function serviceIntervalMarkup(interval = {}) {
  return `<div class="service-interval-row" data-service-interval><input type="time" data-interval-start value="${escapeHTML(interval.start || "08:00")}" aria-label="Início do intervalo"><span>até</span><input type="time" data-interval-end value="${escapeHTML(interval.end || "18:00")}" aria-label="Fim do intervalo"><button type="button" data-remove-service-interval aria-label="Remover intervalo">×</button></div>`;
}

function serviceSettingsForm(item = {}) {
  const days = [["seg", "Segunda"], ["ter", "Terça"], ["qua", "Quarta"], ["qui", "Quinta"], ["sex", "Sexta"], ["sab", "Sábado"], ["dom", "Domingo"]];
  const custom = item.weeklyAvailability != null;
  const online = item.locationType === "online";
  const weeklyRows = days.map(([day, label]) => {
    const intervals = item.weeklyAvailability?.[day] || [];
    return `<div class="service-day-row" data-service-day="${day}"><label><input type="checkbox" data-service-day-enabled ${intervals.length ? "checked" : ""}>${label}</label><div class="service-intervals" data-service-intervals>${(intervals.length ? intervals : [{}]).map(serviceIntervalMarkup).join("")}</div><button class="btn btn-outline btn-sm" type="button" data-add-service-interval>+ Intervalo</button></div>`;
  }).join("");
  return `<form class="settings-item-form" data-service-form ${item.id ? `data-service-id="${escapeHTML(item.id)}"` : ""}>${item.id ? "" : "<h3>Adicionar serviço</h3>"}<div class="settings-fields settings-service-fields"><label>Serviço<input name="name" value="${escapeHTML(item.name || "")}" maxlength="80" required></label><label>Duração (min)<input name="duration" type="number" min="1" max="1440" step="1" value="${Number(item.duration) || 20}" required></label><label>Preço (R$)<input name="price" type="number" min="0" step="0.01" value="${Number(item.price) || 0}" required></label><label>Ícone<input name="icon" value="${escapeHTML(item.icon || "✦")}" maxlength="8" aria-label="Ícone do serviço"></label><label>Local do atendimento<select name="locationType" data-service-location><option value="address1" ${!item.locationType || item.locationType === "address1" ? "selected" : ""}>Endereço 1</option><option value="address2" ${item.locationType === "address2" ? "selected" : ""}>Endereço 2</option><option value="online" ${online ? "selected" : ""}>Atendimento On line</option></select></label><label data-service-meeting-url ${online ? "" : "hidden"}>Link da reunião <small>(opcional)</small><input name="meetingUrl" type="url" value="${escapeHTML(item.meetingUrl || "")}" placeholder="https://..."></label></div><label class="service-availability-mode">Disponibilidade do serviço<select name="availabilityMode" data-service-availability-mode><option value="all" ${custom ? "" : "selected"}>Todo o expediente da loja</option><option value="custom" ${custom ? "selected" : ""}>Dias e horários específicos</option></select></label><div class="service-weekly-grid" data-service-weekly ${custom ? "" : "hidden"}>${weeklyRows}</div><div class="settings-item-actions"><button class="btn btn-primary btn-sm" type="submit">${item.id ? "Salvar" : "Adicionar serviço"}</button>${item.id ? `<button class="btn btn-outline btn-sm" type="button" data-remove-service="${escapeHTML(item.id)}">Remover</button>` : ""}</div></form>`;
}

function serviceSettingsMarkup(establishment) {
  const items = (establishment.services || []).map(serviceSettingsForm).join("");
  return `<div class="settings-section"><p class="settings-hint">Defina o local e, se desejar, os dias e horários próprios de cada serviço. O horário também precisa caber no expediente da loja e na escala do profissional.</p>${items || '<p class="empty">Nenhum serviço cadastrado.</p>'}${serviceSettingsForm()}</div>`;
}

function hoursSettingsMarkup(establishment) {
  return `<div class="settings-section">${workSchedulesMarkup(establishment)}${lunchSchedulesMarkup(establishment)}${extraWorkingDatesMarkup(establishment)}<section class="schedule-config"><div><small>MODELO DA AGENDA</small><h2>Como os horários são organizados?</h2><p>Esta configuração vale para novos agendamentos.</p></div><div class="schedule-mode-options"><button class="schedule-mode ${usesEmployeeSchedules(establishment) ? "active" : ""}" type="button" data-schedule-mode="employee"><span>♙</span><strong>Por funcionário</strong><small>Cada profissional tem seus horários.</small></button><button class="schedule-mode ${!usesEmployeeSchedules(establishment) ? "active" : ""}" type="button" data-schedule-mode="establishment"><span>▣</span><strong>Grade compartilhada</strong><small>Uma agenda para a equipe.</small></button></div></section></div>`;
}

function storeAddressFields(establishment, suffix = "") {
  const value = key => escapeHTML(establishment[`${key}${suffix}`] || (key === "street" && !establishment[`city${suffix}`] ? establishment[suffix ? "address2" : "address"] : "") || "");
  const required = suffix ? "" : "required";
  const section = suffix ? "section-address2" : "section-address1";
  return `<div class="settings-fields"><label>Rua<input name="street${suffix}" ${required} value="${value("street")}" autocomplete="${section} address-line1"></label><label>Número<input name="number${suffix}" ${required} value="${value("number")}" placeholder="Ex.: 123 ou SN"></label><label>Bairro<input name="neighborhood${suffix}" ${required} value="${value("neighborhood")}"></label><label>CEP<input name="zipCode${suffix}" ${required} inputmode="numeric" pattern="[0-9]{5}-?[0-9]{3}" maxlength="9" placeholder="00000-000" value="${value("zipCode")}" autocomplete="${section} postal-code"></label><label>Cidade<input name="city${suffix}" ${required} value="${value("city")}" autocomplete="${section} address-level2"></label><label>Estado (UF)<input name="state${suffix}" ${required} minlength="2" maxlength="2" pattern="[A-Za-z]{2}" value="${value("state")}" autocomplete="${section} address-level1" placeholder="BA"></label><label>Complemento <small>(nome do edifício, se houver)</small><input name="complement${suffix}" value="${value("complement")}" placeholder="Ex.: Edifício Bahia Center, sala 1306"></label></div><small class="address-lookup-status" data-postal-status="${suffix || "1"}" role="status">CEP completo preenche rua, bairro, cidade e UF; número e edifício entram quando disponíveis. Com rua, cidade e UF, buscamos o CEP.</small><select class="address-postal-options" data-postal-options="${suffix || "1"}" aria-label="Escolha o CEP do Endereço ${suffix || "1"}" hidden></select>`;
}

function postalField(form, name, suffix) {
  return form.elements.namedItem(`${name}${suffix}`);
}

function postalStatus(form, suffix, message) {
  const status = form.querySelector(`[data-postal-status="${suffix || "1"}"]`);
  if (status) status.textContent = message;
}

function applyPostalResult(form, suffix, result, overwrite = false) {
  const values = { street: result.logradouro, neighborhood: result.bairro, city: result.localidade, state: result.uf, zipCode: formatPostalCode(result.cep) };
  for (const [name, value] of Object.entries(values)) {
    const input = postalField(form, name, suffix);
    if (input && value && (overwrite || !input.value.trim() || name === "zipCode" && postalDigits(input.value).length !== 8)) input.value = value;
  }
  const number = postalField(form, "number", suffix);
  const numberHint = String(result.complemento || "").trim();
  if (number && !number.value.trim() && /^\d+[A-Za-z]?$/.test(numberHint)) number.value = numberHint;
  const complement = postalField(form, "complement", suffix);
  const building = String(result.unidade || "").trim();
  if (complement && !complement.value.trim() && building) complement.value = building;
  form.dataset.dirty = "true";
}

async function fillAddressFromPostalCode(form, suffix) {
  const input = postalField(form, "zipCode", suffix);
  const digits = postalDigits(input?.value);
  if (digits.length !== 8 || input.dataset.lastPostalLookup === digits) return;
  input.dataset.lastPostalLookup = digits;
  postalStatus(form, suffix, "Consultando CEP…");
  try {
    const result = await lookupPostalCode(digits);
    if (!form.isConnected || postalDigits(input.value) !== digits) return;
    applyPostalResult(form, suffix, result, true);
    form.querySelector(`[data-postal-options="${suffix || "1"}"]`).hidden = true;
    postalStatus(form, suffix, "Rua, bairro, cidade e estado preenchidos pelo CEP.");
  } catch (error) {
    if (form.isConnected && postalDigits(input.value) === digits) {
      delete input.dataset.lastPostalLookup;
      postalStatus(form, suffix, error.message);
    }
  }
}

async function fillPostalCodeFromAddress(form, suffix) {
  const zip = postalField(form, "zipCode", suffix);
  if (postalDigits(zip.value).length === 8) return;
  const details = Object.fromEntries(["street", "neighborhood", "city", "state"].map(name => [name, postalField(form, name, suffix)?.value.trim() || ""]));
  if (details.street.length < 3 || details.city.length < 3 || details.state.length !== 2) return;
  const signature = `${details.street}|${details.neighborhood}|${details.city}|${details.state}`;
  postalStatus(form, suffix, "Buscando CEP pela rua…");
  try {
    const matches = await searchPostalCodes(details);
    if (!form.isConnected || signature !== `${postalField(form, "street", suffix).value.trim()}|${postalField(form, "neighborhood", suffix).value.trim()}|${postalField(form, "city", suffix).value.trim()}|${postalField(form, "state", suffix).value.trim()}` || postalDigits(zip.value).length === 8) return;
    const chosen = matchingPostalCode(matches, details);
    const select = form.querySelector(`[data-postal-options="${suffix || "1"}"]`);
    select.hidden = true;
    if (chosen) {
      applyPostalResult(form, suffix, chosen);
      postalStatus(form, suffix, "CEP encontrado e preenchido automaticamente.");
    } else if (matches.length) {
      select.replaceChildren(new Option("Escolha o CEP desta rua", ""), ...matches.map(item => new Option(`${item.cep} · ${item.logradouro} · ${item.bairro}`, item.cep)));
      select.hidden = false;
      postalStatus(form, suffix, "Encontramos mais de um CEP. Escolha o correto.");
    } else {
      postalStatus(form, suffix, "CEP não encontrado para esta rua. Informe o CEP manualmente.");
    }
  } catch (error) {
    if (form.isConnected) postalStatus(form, suffix, error.message);
  }
}

function storeSettingsMarkup(establishment) {
  if (session()?.role !== "admin") return '<div class="settings-section"><p class="settings-hint">Somente o administrador da loja pode alterar os dados do estabelecimento.</p></div>';
  const days = [["seg", "Segunda", "2026-09-28"], ["ter", "Terça", "2026-09-29"], ["qua", "Quarta", "2026-09-30"], ["qui", "Quinta", "2026-10-01"], ["sex", "Sexta", "2026-10-02"], ["sab", "Sábado", "2026-10-03"], ["dom", "Domingo", "2026-10-04"]];
  const weeklyRows = days.map(([day, label, date]) => {
    const entry = businessHoursForDate(establishment, date);
    const open = entry ? !/fechado/i.test(entry.value || "") : (establishment.hours || []).length ? false : !["sab", "dom"].includes(day);
    const times = String(entry?.value || "").match(/(\d{2}:\d{2}).*?(\d{2}:\d{2})/);
    return `<div class="store-day-row"><label><input type="checkbox" name="day_${day}_open" ${open ? "checked" : ""}>${label}</label><input type="time" name="day_${day}_start" value="${times?.[1] || "08:00"}" aria-label="Abertura na ${label}"><span>até</span><input type="time" name="day_${day}_end" value="${times?.[2] || "18:00"}" aria-label="Fechamento na ${label}"></div>`;
  }).join("");
  const ready = establishment.name !== "Estabelecimento em configuração" && establishment.category && establishment.neighborhood && establishment.address && establishment.hours?.length && establishment.professionals?.length && establishment.services?.length && establishment.availableTimes?.length && (!(establishment.services || []).some(item => item.locationType === "address2") || establishment.address2);
  return `<div class="settings-section store-profile-settings"><p class="settings-hint">O endereço da página é <strong>${escapeHTML(establishment.slug)}</strong>. Preencha os dados da loja aqui; depois cadastre funcionários, escalas e serviços nas outras abas.</p>
    <form class="settings-item-form" data-store-profile-form><h3>Dados do estabelecimento</h3><div class="settings-fields"><label>Nome da loja<input name="name" maxlength="100" required value="${escapeHTML(establishment.name === "Estabelecimento em configuração" ? "" : establishment.name)}"></label><label>Categoria<input name="category" required value="${escapeHTML(establishment.category || "")}" placeholder="Ex.: Barbearia"></label></div><h3>Endereços</h3><h4>Endereço 1</h4>${storeAddressFields(establishment)}<h4>Endereço 2 <small>(opcional)</small></h4>${storeAddressFields(establishment, "2")}
      <h3>Expediente por dia da semana</h3><p class="settings-hint">Marque os dias de atendimento e informe a abertura e o fechamento de cada um. A escala dos profissionais também precisa caber nesses horários.</p><div class="store-weekly-grid">${weeklyRows}</div><p class="store-save-status" data-store-save-status role="alert" hidden></p><button class="btn btn-primary btn-sm" type="submit">Salvar dados da loja</button></form>
    ${establishment.setupComplete === false ? `<div class="store-publish"><strong>Publicação</strong><p>Para aparecer na busca e aceitar agendamentos, salve os dados da loja, adicione pelo menos um funcionário, uma escala e um serviço.</p><button class="btn btn-primary btn-sm" type="button" data-publish-store ${ready ? "" : "disabled"}>Publicar estabelecimento</button></div>` : '<p class="settings-hint">Estabelecimento publicado. Você pode editar os dados acima e salvá-los a qualquer momento.</p>'}</div>`;
}

function apiSettingsMarkup(establishment) {
  const base = firebaseApi?.integrationApiBaseUrl || "https://agendae-backend-t5ax.onrender.com";
  if (session()?.role !== "admin") return '<div class="settings-section"><p class="settings-hint">A chave de API pode criar agendamentos. Peça a um administrador da loja para configurar a integração.</p></div>';
  const status = state.apiKeyStatus.slug === establishment.slug ? state.apiKeyStatus : { loading: true };
  const variable = status.variable || `api-${establishment.slug}`;
  const statusText = status.loading || !status.loaded ? "Consultando a chave no servidor…"
    : status.error ? escapeHTML(status.error)
      : status.pending ? `${status.pending === "revoke" ? "Revogação" : "Ativação"} aguardando deploy${status.active ? ` · chave atual final ${escapeHTML(status.lastFour || "")}` : ""}`
        : status.active ? `Chave ativa · final ${escapeHTML(status.lastFour || "")}` : "Nenhuma chave ativa";
  const secret = state.apiKeySecret
    ? `<div class="api-key-created" role="status"><strong>Copie a chave agora</strong><p>Ela será mostrada uma única vez. O backend já salvou a variável <code>${escapeHTML(variable)}</code> no Render. ${status.active && status.lastFour === state.apiKeySecret.slice(-4) ? "A nova chave já está ativa." : status.deployRequested ? "O deploy foi solicitado; aguarde a ativação antes de usar a chave." : "O deploy não pôde ser iniciado. Inicie um deploy manual no Render para ativá-la."} Guarde a chave no servidor do site cliente.</p><div class="api-key-value"><code>${escapeHTML(state.apiKeySecret)}</code><button class="btn btn-outline btn-sm" type="button" data-copy-api-key>Copiar</button></div></div>` : "";
  const automationHint = status.loaded && !status.automationReady ? '<p class="settings-hint">O proprietário precisa configurar <code>RENDER_API_KEY</code> no serviço agendae-backend para habilitar a atualização automática.</p>' : "";
  const deployHint = status.pending === "revoke" && !status.deployRequested ? '<p class="settings-hint">A variável foi removida, mas o deploy não iniciou. Inicie um deploy manual no Render para concluir a revogação.</p>' : "";
  return `<div class="settings-section api-settings"><div><h3>API de agendamentos</h3><p class="settings-hint">Um serviço no Render atende todas as lojas. Cada loja usa sua própria variável e sua própria rota.</p></div><div class="api-key-panel"><div><strong>Chave de ${escapeHTML(establishment.name)}</strong><small>${statusText}</small></div><div class="api-key-actions"><button class="btn btn-primary btn-sm" type="button" data-generate-api-key ${status.loading || !status.automationReady || status.pending ? "disabled" : ""}>${status.active ? "Gerar e salvar nova chave" : "Gerar e salvar chave"}</button>${status.active ? `<button class="btn btn-outline btn-sm" type="button" data-revoke-api-key ${status.loading || !status.automationReady || status.pending ? "disabled" : ""}>Revogar chave</button>` : ""}<button class="btn btn-outline btn-sm" type="button" data-refresh-api-key ${status.loading ? "disabled" : ""}>Atualizar status</button></div></div>${automationHint}${deployHint}<div class="api-endpoints"><strong>Variável no Render</strong><code>${escapeHTML(variable)}</code><p class="settings-hint">Ao gerar, trocar ou revogar, o backend altera esta variável e solicita um deploy ao Render. A mudança entra em vigor quando o deploy terminar. Guarde a chave apenas no servidor do site cliente.</p></div>${secret}<div class="api-endpoints"><strong>URL da loja</strong><code>${escapeHTML(base)}/v1/establishments/${escapeHTML(establishment.slug)}</code><strong>Rotas disponíveis</strong><code>GET /catalog</code><code>GET /availability?date=AAAA-MM-DD&amp;service=SERVIÇO</code><code>POST /appointments</code><p class="settings-hint">Envie a chave no cabeçalho <code>Authorization: Bearer SUA_CHAVE</code>. A reserva recebe <code>date</code>, <code>time</code>, <code>professional</code>, <code>service</code>, <code>client</code> e <code>phone</code>.</p></div></div>`;
}

async function loadApiKeyStatus(establishment) {
  if (!firebaseApi || session()?.role !== "admin" || state.apiKeyStatus.loading && state.apiKeyStatus.slug === establishment.slug) return;
  const previous = state.apiKeyStatus.slug === establishment.slug ? state.apiKeyStatus : {};
  state.apiKeyStatus = { slug: establishment.slug, loading: true, loaded: false, active: false, lastFour: null, variable: `api-${establishment.slug}`, automationReady: false, pending: previous.pending || "", deployRequested: previous.deployRequested || false, error: "" };
  render();
  try {
    const result = await firebaseApi.getIntegrationApiKeyStatus(establishment.slug);
    if (state.apiKeyStatus.slug !== establishment.slug) return;
    const pending = previous.pending === "revoke" && result.active || previous.pending === "update" && state.apiKeySecret && result.lastFour !== state.apiKeySecret.slice(-4) ? previous.pending : "";
    state.apiKeyStatus = { slug: establishment.slug, loading: false, loaded: true, active: Boolean(result.active), lastFour: result.lastFour, variable: result.variable || `api-${establishment.slug}`, automationReady: Boolean(result.automationReady), pending, deployRequested: previous.deployRequested || false, error: "" };
  } catch (error) {
    if (state.apiKeyStatus.slug !== establishment.slug) return;
    state.apiKeyStatus = { slug: establishment.slug, loading: false, loaded: true, active: false, lastFour: null, variable: `api-${establishment.slug}`, automationReady: false, pending: previous.pending || "", deployRequested: previous.deployRequested || false, error: error.message || "Não foi possível consultar a API." };
  }
  if (state.settingsOpen && state.settingsTab === "api" && activeEstablishment()?.slug === establishment.slug) {
    const tabFocused = document.activeElement?.matches('[data-settings-tab="api"]');
    render();
    if (tabFocused) document.querySelector('[data-settings-tab="api"]')?.focus();
  }
}

function settingsModal(establishment) {
  if (!state.settingsOpen) return "";
  const tabs = [["store", "Loja"], ["professionals", "Funcionários"], ["hours", "Horários"], ["services", "Serviços"], ["api", "API"]];
  const content = state.settingsTab === "store" ? storeSettingsMarkup(establishment) : state.settingsTab === "hours" ? hoursSettingsMarkup(establishment) : state.settingsTab === "services" ? serviceSettingsMarkup(establishment) : state.settingsTab === "api" ? apiSettingsMarkup(establishment) : professionalSettingsMarkup(establishment);
  return `<div class="booking-modal-backdrop" data-settings-backdrop><section class="booking-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="booking-modal-head"><div><small>ÁREA DA EQUIPE</small><h2 id="settings-title">Configurações da loja</h2></div><button class="booking-modal-close" type="button" data-close-settings aria-label="Fechar configurações">×</button></div><nav class="settings-tabs" aria-label="Configurações">${tabs.map(([key, label]) => `<button type="button" data-settings-tab="${key}" class="${state.settingsTab === key ? "active" : ""}" ${state.settingsTab === key ? 'aria-current="page"' : ""}>${label}</button>`).join("")}</nav><div class="settings-body">${content}</div></section></div>`;
}

function attendanceModal(establishment) {
  if (!state.attendanceOpen || !state.attendanceSelection) return "";
  const selection = state.attendanceSelection;
  const data = getAdminData(establishment);
  const title = selection.kind === "appointment" ? `Atendimento das ${selection.time}` : selection.professional;
  const appointments = cloudCache.has(`admin:${establishment.slug}`) ? appointmentRows(data, "", selection) : '<div class="empty">Carregando atendimento…</div>';
  const staffPanel = selection.kind === "professional" ? `<section class="panel staff-availability-panel"><div class="panel-head"><div><h2>${escapeHTML(selection.professional)}</h2><p>Disponibilidade e pausa de hoje</p></div></div><div class="staff-schedules">${staffSchedulesMarkup(establishment, data, selection.professional)}</div></section>` : "";
  return `<div class="booking-modal-backdrop" data-attendance-backdrop><section class="booking-modal attendance-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-title"><div class="booking-modal-head"><div><small>ÁREA DA EQUIPE</small><h2 id="attendance-title">${escapeHTML(title)}</h2></div><button class="booking-modal-close" type="button" data-close-attendance aria-label="Fechar atendimento">×</button></div><div class="attendance-modal-body"><div class="appointment-list">${appointments}</div>${staffPanel}</div></section></div>`;
}

function nextCallModal(establishment) {
  const name = state.nextCallProfessional;
  if (!name || session()?.slug !== establishment.slug) return "";
  const data = getAdminData(establishment);
  const ready = cloudCache.has(`admin:${establishment.slug}`);
  const appointments = data.appointments.filter(item => item.date === isoDate() && item.professional === name);
  const current = appointments.find(item => item.status === "atendendo");
  const pending = appointments.filter(item => ["confirmado", "presente"].includes(item.status))
    .sort((a, b) => Number(b.status === "presente") - Number(a.status === "presente") || a.time.localeCompare(b.time));
  const paused = professionalIsPaused(data, name);
  const professional = professionalDirectory(establishment, isoDate()).find(item => item.name === name);
  const canCall = ready && professional && professionalIsOnShift(professional) && (current || pending.length || paused);
  const choice = (action, title, detail, disabled = false) => `<button class="next-call-choice next-call-${action}" type="button" data-next-call-action="${action}" ${disabled ? "disabled" : ""}><strong>${title}</strong><small>${detail}</small></button>`;
  const currentMessage = !ready ? '<p class="next-call-loading">Carregando a agenda do funcionário…</p>'
    : current ? `<p>O atendimento de <strong>${escapeHTML(current.client)}</strong>, das ${escapeHTML(current.time)}, será finalizado quando você confirmar uma opção.</p>`
      : `<p>${paused ? "O atendimento está em pausa." : "Não há atendimento em andamento."} Escolha o próximo passo para ${escapeHTML(name)}.</p>`;
  return `<div class="booking-modal-backdrop" data-next-call-backdrop><section class="booking-modal next-call-modal" role="dialog" aria-modal="true" aria-labelledby="next-call-title"><div class="booking-modal-head"><div><small>CONTROLE DA FILA</small><h2 id="next-call-title">Próxima senha · ${escapeHTML(name)}</h2></div><button class="booking-modal-close" type="button" data-close-next-call aria-label="Fechar próxima senha">×</button></div><div class="next-call-body">${currentMessage}<div class="next-call-choices">${choice("next", current ? "⏭ Finalizar e chamar a próxima" : paused ? "⏭ Retomar e chamar a próxima" : "⏭ Chamar a próxima senha", pending[0] ? `Próxima reserva: ${escapeHTML(pending[0].time)} · ${escapeHTML(pending[0].client)}` : "Sem reserva seguinte; o horário livre volta ao painel.", !canCall)}${choice("pause", current ? "Ⅱ Finalizar e iniciar pausa" : "Ⅱ Iniciar pausa", "As próximas senhas aguardam até a retomada.", !ready || paused && !current)}${choice("close", current ? "■ Finalizar e encerrar expediente" : "■ Encerrar expediente de hoje", pending.length ? `${pending.length} reserva${pending.length === 1 ? "" : "s"} pendente${pending.length === 1 ? "" : "s"}; reagende antes de encerrar.` : "Bloqueia novas reservas para este funcionário hoje.", !ready || pending.length > 0)}</div><button class="btn btn-outline btn-sm" type="button" data-close-next-call>Cancelar</button></div></section></div>`;
}

function renderEstablishmentPublic(establishment) {
  document.title = `${establishment.name} — Agendae`;
  if (state.mapSlug !== establishment.slug) {
    state.mapSlug = establishment.slug;
    state.mapAddressType = "address1";
  }
  if (establishment.setupComplete !== false && new URLSearchParams(location.search).has("checkin")) state.publicLookup.open = true;
  const data = getData(establishment);
  const authenticated = session()?.slug === establishment.slug;
  const pending = establishment.setupComplete === false;
  const mapMarkup = publicMapMarkup(establishment);
  app.innerHTML = `<div class="est-page">
    <header class="est-topbar"><div class="est-topbar-inner"><div class="est-topbar-identity"><a href="${href(`/${establishment.slug}`)}" data-agenda-logo aria-label="Voltar à agenda de ${escapeHTML(establishment.name)}">${logo()}</a><span class="est-header-divider"></span><div class="est-header-business"><strong>${escapeHTML(establishment.name)}</strong><small>${escapeHTML(establishment.address)}</small></div></div></div></header>
    <section class="public-live-strip"><div class="public-live-inner"><article class="public-live-card public-live-current">${publicCurrentAttendance(establishment, data)}</article><div class="public-live-actions"><button class="btn btn-yellow btn-sm" type="button" data-open-checkin ${pending ? 'disabled title="Disponível após a publicação"' : ""}>✓ Confirmar presença</button>${publicAccessMenu(establishment, authenticated)}</div></div></section>
    <main class="est-content public-direct-content">${pending ? '<div class="public-setup-notice" role="status"><strong>Agenda em configuração</strong><span>O responsável está cadastrando os dados deste estabelecimento. Os agendamentos serão liberados após a publicação.</span></div>' : ""}<section class="booking-zone" id="agendar"><div class="public-agenda-layout"><section class="panel public-schedule-panel"><div class="public-schedule-body">${publicSchedule(establishment)}</div></section><aside class="public-agenda-side"><section class="panel public-services-panel"><div class="panel-head compact-panel-head"><div><h2>Serviços</h2><div class="compact-business-hours">${compactBusinessHours(establishment)}</div></div></div>${publicServiceCards(establishment)}</section></aside></div></section>${mapMarkup}</main>
    ${pending ? "" : state.booking.step > 1 ? bookingContent(establishment) : selectedBookingPopup(establishment)}
    ${pending ? "" : publicCheckInModal()}${employeeAccessModal(establishment)}${authenticated ? `${settingsModal(establishment)}${attendanceModal(establishment)}${nextCallModal(establishment)}` : ""}</div>`;
  requestAnimationFrame(() => {
    startServiceCarousel();
    restoreScheduleScroll();
    if (state.publicLookup.scanning) void startQrScanner();
  });
  if (!pending) void refreshCloudData(establishment, "public", state.booking.date);
  if (authenticated) void refreshCloudData(establishment, "admin");
  if (authenticated && state.attendanceOpen) {
    adminRefreshTimer = setInterval(() => {
      if (!state.attendanceOpen || document.activeElement?.closest(".attendance-modal form, .attendance-modal input")) return;
      cloudCache.delete(`admin:${establishment.slug}`);
      void refreshCloudData(establishment, "admin");
    }, 10000);
  }
  if (!pending) {
    ensureQueueSubscription(establishment);
    startQueueClock(establishment);
    startScheduleTurnTimer(establishment);
  }
}

function appointmentRows(data, query = state.appointmentQuery, selection = null) {
  const establishment = activeEstablishment();
  const todayAppointments = data.appointments.filter((item) => item.date === isoDate()
    && (!selection || (selection.kind === "professional" ? item.professional === selection.professional
      : selection.id ? item.id === selection.id : item.time === selection.time && item.professional === selection.professional)))
    .sort((a,b) => a.time.localeCompare(b.time));
  const normalizedQuery = normalizedSearch(query);
  const appointments = normalizedQuery
    ? todayAppointments.filter((item) => normalizedSearch(item.client).includes(normalizedQuery) || String(item.checkInCode || "").toLowerCase() === normalizedQuery.replace(/\s/g, "") || scheduledTicket(establishment, item.time, item.professional, item.service, item.date).toLowerCase() === normalizedQuery)
    : todayAppointments;
  if (!todayAppointments.length) return '<div class="empty">Nenhum atendimento marcado para hoje.</div>';
  if (!appointments.length) return `<div class="empty">Nenhum agendamento encontrado para <strong>${escapeHTML(query.trim())}</strong>.</div>`;
  return appointments.map((item) => {
    const paused = professionalIsPaused(data, item.professional);
    const action = item.status === "confirmado"
      ? `<button class="btn btn-soft btn-sm" type="button" data-confirm-presence="${escapeHTML(item.id)}" ${appointmentPresenceWindow(establishment, item).allowed ? "" : "disabled"} title="${escapeHTML(presenceWindowLabel(establishment, item))}">Confirmar chegada</button>`
      : item.status === "presente" && paused
        ? '<span class="appointment-paused">Em pausa</span>'
        : item.status === "presente"
          ? `<button class="btn btn-soft btn-sm" type="button" data-start-appointment="${escapeHTML(item.id)}" data-professional-name="${escapeHTML(item.professional)}">Iniciar</button>`
          : item.status === "atendendo"
            ? `<button class="btn btn-primary btn-sm" type="button" data-complete-appointment="${escapeHTML(item.id)}" data-professional-name="${escapeHTML(item.professional)}">Encerrar</button>`
            : item.status === "concluido" ? '<span>✓ Finalizado</span>' : "";
    return `<div class="appointment-row"><span class="appt-time">${item.time}</span><span class="client"><span class="client-avatar">${initials(item.client)}</span><span><strong>${escapeHTML(item.client)}</strong><small>${escapeHTML(item.service)} · Painel ${escapeHTML(scheduledTicket(establishment, item.time, item.professional, item.service, item.date))}${item.checkInCode ? ` · Presença ${escapeHTML(item.checkInCode)}` : ""}</small></span></span><span class="professional">${escapeHTML(item.professional)}</span><span class="status ${escapeHTML(item.status)}">${escapeHTML(statusLabel(item.status))}</span><span class="appointment-presence-action">${action}</span></div>`;
  }).join("");
}

function presenceWindowLabel(establishment, appointment) {
  const window = appointmentPresenceWindow(establishment, appointment);
  if (!Number.isFinite(window.opens) || !Number.isFinite(window.end)) return "Horário do atendimento indisponível";
  const format = value => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  return `Presença em ${prettyDate(appointment.date)}, das ${format(window.opens)} às ${format(window.end)}`;
}

function extraWorkingDatesMarkup(establishment) {
  const today = currentSaoPauloClock().date;
  const dates = Object.keys(establishment.extraWorkingDates || {}).filter(date => date >= today && establishment.extraWorkingDates[date] === true).sort();
  return `<section class="panel extra-working-panel"><div class="panel-head"><div><h2>Expediente extra</h2><p>Libere o atendimento apenas na data escolhida, usando as escalas dos profissionais. Outros dias continuam com o expediente normal.</p></div></div><form class="extra-working-form" data-extra-working-form><label class="field"><span>Data do expediente extra</span><input type="date" name="date" min="${today}" value="${today}" required></label><input type="hidden" name="enabled" value="true"><button class="btn btn-primary btn-sm" type="submit">Liberar esta data</button></form><div class="extra-working-dates">${dates.map(date => `<form class="extra-working-date" data-extra-working-form><strong>${prettyDate(date, true)}</strong><input type="hidden" name="date" value="${date}"><input type="hidden" name="enabled" value="false"><button class="btn btn-outline btn-sm" type="submit">Remover expediente extra</button></form>`).join("") || '<p class="empty">Nenhum expediente extra programado.</p>'}</div></section>`;
}

async function loadCheckInConfig(establishment) {
  if (!firebaseApi || !session() || checkInConfigs.has(establishment.slug) || checkInConfigLoading.has(establishment.slug)) return;
  checkInConfigLoading.add(establishment.slug);
  try {
    const config = await firebaseApi.getOrCreateCheckInConfig(establishment.slug);
    checkInConfigs.set(establishment.slug, config);
    if (route() === establishment.slug) render();
  } catch (error) {
    console.error("Agendae: não foi possível preparar o QR de presença.", error);
    toast(firebaseApi.firebaseErrorMessage(error), "!");
  } finally {
    checkInConfigLoading.delete(establishment.slug);
  }
}

function adminCheckInPanel(establishment, today) {
  const token = checkInConfigs.get(establishment.slug)?.token;
  const present = today.filter((item) => item.status === "presente").length;
  const qr = token ? qrCodeMarkup(checkInQrUrl(establishment, token), "admin-checkin-qr") : '<div class="qr-placeholder"><span class="loading-spinner"></span>Preparando QR code…</div>';
  return `<section class="admin-checkin panel"><div class="admin-checkin-copy"><small>CHECK-IN PRESENCIAL</small><h2>Confirmação de presença</h2><p>Deixe este QR visível no balcão. O cliente informa o nome ou a senha do agendamento e aponta a câmera para o código.</p><div class="admin-checkin-stats"><strong>${String(present).padStart(2, "0")}</strong><span>presenças confirmadas hoje</span></div><div class="admin-checkin-actions"><a class="btn btn-primary btn-sm ${token ? "" : "disabled"}" href="${href(`/${establishment.slug}?display=checkin`)}" data-link>Exibir QR no estabelecimento</a><span>Sem celular ou internet? Pesquise o cliente abaixo e use <b>Confirmar chegada</b>.</span></div></div><div class="admin-checkin-visual">${qr}<small>QR exclusivo de ${escapeHTML(establishment.name)}</small></div></section>`;
}

function renderAdmin(establishment) {
  document.title = `Painel · ${establishment.name} — Agendae`;
  const data = getData(establishment);
  const today = data.appointments.filter((item) => item.date === isoDate());
  const waiting = queueView(establishment, data, currentSaoPauloClock()).waiting.length;
  const completed = today.filter((item) => item.status === "concluido").length;
  const freeSlots = usesEmployeeSchedules(establishment)
    ? professionalAvailability(establishment, data).flatMap((professional) => professional.freeTimes).sort()
    : availableTimesFor(establishment, data);
  const currentUser = session();
  const firstName = currentUser?.name?.split(" ")[0] || "gestor";
  app.innerHTML = `<div class="admin-shell">
    <aside class="sidebar ${state.mobileMenu ? "mobile-open" : ""}"><a href="${href("/")}" data-link>${logo()}</a><div class="workspace"><span class="est-avatar">${escapeHTML(establishment.initials)}</span><span><strong>${escapeHTML(establishment.name)}</strong><small>${escapeHTML(establishment.category)}</small></span></div><div class="side-label">Gestão</div><nav class="side-nav"><button class="side-link active"><span class="side-icon">⌂</span>Visão geral</button><button class="side-link" data-coming><span class="side-icon">▣</span>Agenda</button><button class="side-link" data-coming><span class="side-icon">☷</span>Fila de senhas</button><button class="side-link" data-coming><span class="side-icon">♙</span>Clientes</button><button class="side-link" data-coming><span class="side-icon">⌁</span>Relatórios</button></nav><div class="side-spacer"></div><a class="side-link" href="${href(`/${establishment.slug}?public=1`)}" data-link><span class="side-icon">↗</span>Ver página pública</a><button class="side-link" data-logout><span class="side-icon">←</span>Sair</button><div class="sidebar-user"><span class="user-avatar">${initials(currentUser?.name || "Usuário")}</span><span><strong>${escapeHTML(currentUser?.name || "Usuário")}</strong><small>${currentUser?.role === "admin" ? "Administrador" : "Equipe"}</small></span></div></aside>
    <main class="admin-main"><header class="admin-topbar"><button class="icon-btn mobile-admin-menu" data-mobile-admin>☰</button><div class="admin-title"><h1>Bom dia, ${escapeHTML(firstName)}</h1><p>${prettyDate(isoDate(),true)} · acompanhe o movimento de hoje.</p></div><div class="admin-actions"><button class="icon-btn" data-notification>♢</button><a class="btn btn-primary btn-sm" href="${href(`/${establishment.slug}?public=1#agendar`)}" data-link>+ Novo agendamento</a></div></header>
      <section class="admin-stats"><article class="admin-stat"><div class="admin-stat-head"><span>Atendimentos hoje</span><span class="stat-icon">▣</span></div><strong>${String(today.length).padStart(2,"0")}</strong><em>Agenda atualizada agora</em></article><article class="admin-stat"><div class="admin-stat-head"><span>Horários livres</span><span class="stat-icon">◷</span></div><strong>${String(freeSlots.length).padStart(2,"0")}</strong><em>Próximo às ${freeSlots[0] || "—"}</em></article><article class="admin-stat"><div class="admin-stat-head"><span>Clientes na fila</span><span class="stat-icon">☷</span></div><strong>${String(waiting).padStart(2,"0")}</strong><em>Espera média de ${establishment.averageWaitMinutes} min</em></article><article class="admin-stat"><div class="admin-stat-head"><span>Atendidos</span><span class="stat-icon">✓</span></div><strong>${String(completed).padStart(2,"0")}</strong><em>Hoje até agora</em></article></section>
      ${adminCheckInPanel(establishment, today)}
      ${extraWorkingDatesMarkup(establishment)}
      ${workSchedulesMarkup(establishment)}
      ${lunchSchedulesMarkup(establishment)}
      <section class="schedule-config"><div><small>MODELO DA AGENDA</small><h2>Como os horários são organizados?</h2><p>Essa configuração vale para todos os novos agendamentos.</p></div><div class="schedule-mode-options"><button class="schedule-mode ${usesEmployeeSchedules(establishment) ? "active" : ""}" data-schedule-mode="employee"><span>♙</span><strong>Agenda por funcionário</strong><small>Cada profissional tem seus próprios horários.</small></button><button class="schedule-mode ${!usesEmployeeSchedules(establishment) ? "active" : ""}" data-schedule-mode="establishment"><span>▣</span><strong>Agenda do estabelecimento</strong><small>Uma única grade compartilhada pela equipe.</small></button></div></section>
      <div class="admin-grid"><section class="panel"><div class="panel-head"><div><h2>Atendimentos de hoje</h2><p><span data-appointment-count>${today.length}</span> horários agendados</p></div><button class="btn btn-soft btn-sm" data-coming>Ver agenda completa</button></div><div class="appointment-search"><span class="appointment-search-icon" aria-hidden="true">⌕</span><input type="search" value="${escapeHTML(state.appointmentQuery)}" data-appointment-search aria-label="Pesquisar agendamento pelo nome ou senha" placeholder="Pesquisar por nome completo ou senha"><button type="button" data-clear-appointment-search aria-label="Limpar pesquisa" ${state.appointmentQuery ? "" : "hidden"}>×</button></div><div class="appointment-list">${appointmentRows(data)}</div></section><div class="side-stack">${queuePanel(establishment, data)}<section class="panel staff-availability-panel"><div class="panel-head"><div><h2>${usesEmployeeSchedules(establishment) ? "Agenda por profissional" : "Agenda do estabelecimento"}</h2><p>${usesEmployeeSchedules(establishment) ? "Disponibilidade individual de hoje" : "Disponibilidade compartilhada de hoje"}</p></div></div><div class="staff-schedules">${staffSchedulesMarkup(establishment, data)}</div></section></div></div>
    </main></div>`;
  const queueSection = app.querySelector(".admin-grid .queue-panel");
  if (queueSection) {
    queueSection.insertAdjacentHTML("beforeend", ticketLegend(establishment));
  }
  void refreshCloudData(establishment, "admin");
  void loadCheckInConfig(establishment);
  adminRefreshTimer = setInterval(() => {
    if (route() !== establishment.slug || session()?.slug !== establishment.slug || new URLSearchParams(location.search).get("public") === "1") return;
    if (document.activeElement?.closest("[data-lunch-form], [data-work-form], [data-extra-working-form]")) return;
    if (document.querySelector('[data-work-form][data-dirty="true"], [data-lunch-form][data-dirty="true"], [data-extra-working-form][data-dirty="true"]')) return;
    cloudCache.delete(`admin:${establishment.slug}`);
    void refreshCloudData(establishment, "admin");
  }, 10000);
}

function updateMonitorClock() {
  const target = document.querySelector("[data-monitor-clock]");
  if (target) target.textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}

function startQueueClock(establishment, monitor = false) {
  clearInterval(monitorClockTimer);
  const clockKey = () => { const clock = currentSaoPauloClock(); return `${clock.date}|${clock.minutes}`; };
  let previousMinute = clockKey();
  monitorClockTimer = setInterval(() => {
    if (monitor) updateMonitorClock();
    const minute = clockKey();
    if (minute === previousMinute) return;
    previousMinute = minute;
    if (monitor) { renderQueueDisplay(establishment); return; }
    const data = getData(establishment);
    const currentPanel = document.querySelector(".public-live-current");
    if (currentPanel) currentPanel.innerHTML = publicCurrentAttendance(establishment, data);
    const schedule = document.querySelector(".public-schedule-body");
    if (schedule && !state.calendarOpen && !document.activeElement?.closest("[data-booking-calendar]")) { schedule.innerHTML = publicSchedule(establishment); restoreScheduleScroll(); }
    const lookup = document.querySelector(".public-lookup-panel");
    if (lookup && !state.publicLookup.scanning && !lookup.contains(document.activeElement)) lookup.outerHTML = publicAppointmentLookup();
  }, 1000);
}

function renderQueueDisplay(establishment) {
  document.title = `Painel de senhas · ${establishment.name}`;
  const clock = currentSaoPauloClock();
  const data = cloudCache.get(publicCacheKey(establishment, clock.date)) || { queue: [], slots: [], todayAppointments: 0 };
  const view = attendanceView(establishment, data, clock.date, clock);
  const slotsReady = Array.isArray(data.todaySlots);
  const waiting = view.closedDay ? [] : queueView(establishment, data, clock).waiting;
  const upcoming = [...waiting, ...(slotsReady ? upcomingFreeSlots(establishment, data, clock) : [])]
    .sort((a, b) => a.time.localeCompare(b.time) || (a.kind === "free") - (b.kind === "free") || a.professional.localeCompare(b.professional, "pt-BR"));
  const visibleUpcoming = upcoming.slice(0, 4);
  const currentCount = view.current.length;
  const monitorColumns = currentCount <= 3 ? Math.max(1, currentCount) : currentCount === 4 ? 2 : Math.ceil(Math.sqrt(currentCount * 1.5));
  const monitorRows = Math.ceil(currentCount / monitorColumns);
  const displayDate = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" }).format(new Date());
  const currentCards = view.notStarted
    ? `<div class="monitor-state-message">${view.closedDay ? "Sem expediente neste dia" : "Expediente não iniciado"}</div>`
    : view.current.map((item) => `<article class="monitor-ticket-card monitor-ticket-${item.ticketState}"><div class="monitor-ticket-top"><span class="monitor-ticket-professional">${escapeHTML(item.professional)}</span><span class="monitor-ticket-status">${escapeHTML(TICKET_STATES[item.ticketState])}</span></div><strong class="monitor-ticket-code">${escapeHTML(["paused", "closed"].includes(item.ticketState) ? TICKET_STATES[item.ticketState] : item.ticket)}</strong><div class="monitor-ticket-meta">${item.pauseReason ? `<span>${escapeHTML(item.pauseReason)}</span>` : item.time ? `<span>Horário ${escapeHTML(item.time)}</span>` : ""}${item.ticketState === "in-service" ? `<span>${escapeHTML(item.service || "Serviço não informado")}</span>` : ""}</div></article>`).join("") || '<div class="monitor-state-message">Nenhum profissional cadastrado</div>';
  const waitingRows = visibleUpcoming.map((item, index) => `<li class="monitor-upcoming-row ${item.kind === "free" ? "monitor-upcoming-free" : ""}"><span class="monitor-upcoming-position">${String(index + 1).padStart(2, "0")}</span><div><strong>${item.kind === "free" ? "Horário livre" : escapeHTML(item.ticket)}</strong><small>${escapeHTML(item.professional)}${item.kind === "free" ? " · Disponível para agendamento" : ` · ${escapeHTML(item.service || "Serviço não informado")}`}</small></div><time>${escapeHTML(item.time)}</time></li>`).join("");
  app.innerHTML = `<main class="queue-display"><header class="queue-display-header"><div class="queue-display-brand">${logo()}<div><span>${escapeHTML(establishment.name)}</span><small>PAINEL DE SENHAS</small></div></div><div class="queue-display-status"><span class="monitor-live-label">${liveStatusDot(view.current, view.notStarted, view.closedDay)} AO VIVO</span><div class="monitor-datetime"><small>${escapeHTML(displayDate)}</small><strong data-monitor-clock></strong></div></div></header>
    <section class="queue-display-content"><div class="queue-display-current"><div class="monitor-section-heading"><span>01 / ATENDIMENTO</span><h1>Atendendo agora</h1><p>Confira sua senha e dirija-se ao profissional indicado.</p></div><div class="monitor-current-grid ${currentCount <= 2 ? "monitor-current-spacious" : ""} ${monitorRows > 2 ? "monitor-current-dense" : ""}" style="--monitor-columns:${monitorColumns};--monitor-rows:${Math.max(1, monitorRows)}">${currentCards}</div></div><aside class="queue-display-next"><div class="monitor-section-heading"><span>02 / PRÓXIMOS HORÁRIOS</span><h2>A seguir</h2><p>Senhas reservadas e horários livres.</p></div>${waitingRows ? `<ol class="monitor-upcoming-list">${waitingRows}</ol>${upcoming.length > visibleUpcoming.length ? `<p class="monitor-upcoming-more">+ ${upcoming.length - visibleUpcoming.length} horários seguintes</p>` : ""}` : `<div class="monitor-upcoming-empty">${slotsReady ? "Nenhum horário restante hoje." : "Carregando horários..."}</div>`}</aside></section>
    <footer class="queue-display-footer"><span>As senhas são atualizadas automaticamente. Aguarde sua chamada.</span><div><button class="monitor-action" type="button" data-request-fullscreen>⛶ Tela cheia</button><button class="monitor-action" type="button" data-close-queue-display>Fechar painel</button></div></footer></main>`;
  updateMonitorClock();
  startQueueClock(establishment, true);
  void refreshCloudData(establishment, "public", clock.date);
  ensureQueueSubscription(establishment);
}

function renderCheckInDisplay(establishment) {
  document.title = `QR de presença · ${establishment.name}`;
  const token = checkInConfigs.get(establishment.slug)?.token;
  const qr = token ? qrCodeMarkup(checkInQrUrl(establishment, token), "display-checkin-qr") : '<div class="qr-placeholder"><span class="loading-spinner"></span>Preparando QR code…</div>';
  app.innerHTML = `<main class="checkin-display"><header class="checkin-display-header">${logo()}<span>${escapeHTML(establishment.name)}</span></header><section class="checkin-display-content"><div class="checkin-display-copy"><small>CONFIRMAÇÃO DE PRESENÇA</small><h1>Chegou? Confirme aqui.</h1><p>Abra a página da ${escapeHTML(establishment.name)}, informe seu nome ou a senha do agendamento e aponte a câmera para este QR code.</p><div class="checkin-display-steps"><span><b>1</b> Identifique seu horário</span><span><b>2</b> Leia o QR code</span><span><b>3</b> Presença confirmada</span></div></div><div class="checkin-display-code">${qr}<strong>Aponte a câmera para o código</strong><small>QR exclusivo deste estabelecimento</small></div></section><footer class="checkin-display-footer"><span>Se precisar de ajuda, procure nossa equipe.</span><div><button class="monitor-action" data-request-fullscreen>⛶ Tela cheia</button><button class="monitor-action" data-print-checkin ${token ? "" : "disabled"}>Imprimir</button><a class="monitor-action" href="${href(`/${establishment.slug}`)}" data-link>Fechar</a></div></footer></main>`;
  if (!token) void loadCheckInConfig(establishment);
}

function renderLoading() {
  document.title = "Carregando — Agendae";
  app.innerHTML = `<main class="loading-page">${logo()}<span class="loading-spinner"></span><p>Carregando estabelecimento…</p></main>`;
}

function renderNotFound() {
  document.title = "Estabelecimento não encontrado — Agendae";
  app.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:30px;background:var(--canvas)"><div style="max-width:520px;text-align:center">${logo()}<h1 style="margin:35px 0 10px;color:var(--navy);font:800 34px Manrope">Estabelecimento não encontrado</h1><p style="color:var(--muted);line-height:1.6">Confira o endereço ou volte para pesquisar na Agendae.</p><a class="btn btn-primary" style="margin-top:18px" href="${href("/")}" data-link>Encontrar estabelecimento</a></div></main>`;
}

function render() {
  clearTimeout(scheduleTurnTimer);
  scheduleTurnTimer = null;
  clearInterval(adminRefreshTimer);
  adminRefreshTimer = null;
  clearInterval(monitorClockTimer);
  monitorClockTimer = null;
  clearInterval(serviceCarouselTimer);
  serviceCarouselTimer = null;
  if (session()?.mustChangePassword) return renderPasswordChange();
  const current = route();
  if (current === "home") return renderHome();
  if (current === SYSTEM_MANAGE_ROUTE) return session()?.role === "system_admin" ? renderSystemManagement() : renderHome();
  if (current === "login") return renderLogin();
  if (!catalogLoaded) return renderLoading();
  const establishment = establishments[current];
  if (!establishment) return renderNotFound();
  const routeParams = new URLSearchParams(location.search);
  if (routeParams.get("display") === "queue") return renderQueueDisplay(establishment);
  const authenticated = session()?.slug === establishment.slug;
  if (routeParams.get("display") === "checkin" && authenticated) return renderCheckInDisplay(establishment);
  renderEstablishmentPublic(establishment);
}

function activeEstablishment() {
  return establishments[route()];
}

function refreshBookingCalendar(focusSelector) {
  const calendar = document.querySelector("[data-booking-calendar]");
  if (calendar) calendar.outerHTML = renderBookingCalendar({ selectedDate: state.booking.date, dateMode: state.booking.dateMode, today: isoDate(), month: state.calendarMonth, open: state.calendarOpen });
  if (focusSelector) requestAnimationFrame(() => document.querySelector(focusSelector)?.focus());
}

function selectBookingDate(selectedDate) {
  pauseCalendarSchedule();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? new Date(`${selectedDate}T12:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== selectedDate || selectedDate < isoDate()) {
    toast("Escolha uma data válida a partir de hoje.", "!");
    return false;
  }
  state.booking.date = selectedDate;
  state.booking.dateMode = selectedDate === isoDate() ? "today" : "other";
  state.booking.time = null;
  state.booking.step = 1;
  state.booking.confirmation = null;
  state.calendarMonth = selectedDate.slice(0, 7);
  state.calendarOpen = false;
  const establishment = activeEstablishment();
  if (establishment) cloudCache.delete(publicCacheKey(establishment));
  render();
  requestAnimationFrame(() => document.querySelector("[data-calendar-toggle]")?.focus());
  return true;
}

function pauseCalendarSchedule() {
  state.schedulePausedByCalendar = true;
  pauseScheduleTurn();
}

function pauseCalendarInteraction(event) {
  if (event.target.closest("[data-booking-calendar], [data-date-mode]")) pauseCalendarSchedule();
}

document.addEventListener("pointerdown", pauseCalendarInteraction);
document.addEventListener("focusin", pauseCalendarInteraction);

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-first-access-logout]")) {
    await firebaseApi?.logout();
    firebaseSession = null;
    navigate("/");
    return;
  }
  if (event.target.closest("[data-open-system-access]")) {
    if (session()?.role === "system_admin") return navigate(`/${SYSTEM_MANAGE_ROUTE}`);
    state.systemAccessOpen = true;
    render();
    requestAnimationFrame(() => document.querySelector("#system-login")?.focus());
    return;
  }
  if (event.target.closest("[data-focus-system-create]")) {
    document.querySelector("#novo-estabelecimento")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#store-name")?.focus();
    return;
  }
  if (event.target.closest("[data-refresh-system-list]")) {
    void refreshSystemEstablishments();
    return;
  }
  if (event.target.closest("[data-close-system-access]") || event.target.matches("[data-system-access-backdrop]")) {
    state.systemAccessOpen = false;
    state.createdStoreSlug = "";
    state.createdStoreEmail = "";
    state.createdStorePassword = "";
    render();
    document.querySelector("[data-open-system-access]")?.focus();
    return;
  }
  if (event.target.closest("[data-system-logout]")) {
    await firebaseApi?.logout();
    firebaseSession = null;
    state.systemEstablishments = [];
    state.systemListLoaded = false;
    state.systemListError = "";
    state.createdStoreSlug = "";
    state.createdStoreEmail = "";
    state.createdStorePassword = "";
    state.systemAccessOpen = false;
    navigate("/");
    return;
  }
  if (event.target.closest("[data-copy-store-access]")) {
    const url = new URL(href(`/login?establishment=${state.createdStoreSlug}`), location.origin).toString();
    try {
      await navigator.clipboard.writeText(`Página: ${new URL(href(`/${state.createdStoreSlug}`), location.origin)}\nPrimeiro acesso: ${url}\nLogin: admin\nE-mail: ${state.createdStoreEmail}\nSenha temporária: ${state.createdStorePassword}`);
      toast("Dados de acesso copiados.");
    } catch { toast("Não foi possível copiar. Selecione os dados acima manualmente.", "!"); }
    return;
  }
  if (state.calendarOpen && !event.target.closest("[data-booking-calendar]")) {
    state.calendarOpen = false;
    refreshBookingCalendar();
  }
  const scheduleView = event.target.closest("[data-schedule-view]");
  if (scheduleView) {
    state.scheduleView = scheduleView.dataset.scheduleView === "month" ? "month" : "day";
    state.calendarMonth = state.calendarMonth || state.booking.date.slice(0, 7);
    state.calendarOpen = false;
    clearTimeout(scheduleTurnTimer);
    scheduleTurnTimer = null;
    if (state.scheduleTurn) state.scheduleTurn.changedAt = Date.now();
    render();
    requestAnimationFrame(() => document.querySelector(`[data-schedule-view="${state.scheduleView}"]`)?.focus());
    return;
  }
  const monthlyStep = event.target.closest("[data-monthly-step]");
  if (monthlyStep) {
    state.calendarMonth = shiftCalendarMonth(state.calendarMonth || state.booking.date.slice(0, 7), Number(monthlyStep.dataset.monthlyStep));
    render();
    requestAnimationFrame(() => document.querySelector(`[data-monthly-step="${monthlyStep.dataset.monthlyStep}"]`)?.focus());
    return;
  }
  const monthlyDate = event.target.closest("[data-monthly-date]");
  if (monthlyDate) {
    state.scheduleView = "day";
    selectBookingDate(monthlyDate.dataset.monthlyDate);
    return;
  }
  if (event.target.closest("[data-calendar-toggle]")) {
    pauseCalendarSchedule();
    state.calendarOpen = !state.calendarOpen;
    if (state.calendarOpen) state.calendarMonth = state.booking.date.slice(0, 7);
    refreshBookingCalendar(state.calendarOpen ? '[data-calendar-date][aria-pressed="true"]:not([disabled])' : "[data-calendar-toggle]");
    return;
  }
  const calendarStep = event.target.closest("[data-calendar-month-step]");
  if (calendarStep) {
    pauseCalendarSchedule();
    state.calendarMonth = shiftCalendarMonth(state.calendarMonth || state.booking.date.slice(0, 7), Number(calendarStep.dataset.calendarMonthStep));
    refreshBookingCalendar(`[data-calendar-month-step="${calendarStep.dataset.calendarMonthStep}"]`);
    return;
  }
  if (event.target.closest("[data-calendar-close]")) {
    pauseCalendarSchedule();
    state.calendarOpen = false;
    refreshBookingCalendar("[data-calendar-toggle]");
    return;
  }
  const calendarDate = event.target.closest("[data-calendar-date]");
  if (calendarDate) {
    selectBookingDate(calendarDate.dataset.calendarDate);
    return;
  }
  const openMenu = document.querySelector("[data-internal-menu][open]");
  if (openMenu && !openMenu.contains(event.target)) openMenu.open = false;
  let establishmentForModal;
  const canManage = () => { establishmentForModal = activeEstablishment(); return establishmentForModal && session()?.slug === establishmentForModal.slug; };
  if (event.target.closest("[data-publish-store]") && canManage() && session()?.role === "admin" && firebaseApi) {
    try {
      await firebaseApi.publishStore(establishmentForModal.slug);
      establishmentForModal.setupComplete = true;
      render();
      toast("Estabelecimento publicado e disponível na busca.");
    } catch (error) { toast(firebaseApi.firebaseErrorMessage(error), "!"); }
    return;
  }
  if (event.target.closest("[data-open-settings]") && canManage()) {
    state.attendanceOpen = false;
    state.nextCallProfessional = null;
    state.settingsOpen = true;
    state.publicLookup.open = false;
    state.booking = freshBooking();
    render();
    if (state.settingsTab === "api") void loadApiKeyStatus(establishmentForModal);
    requestAnimationFrame(() => document.querySelector("[data-close-settings]")?.focus());
    return;
  }
  if (event.target.closest("[data-close-settings]") || event.target.matches("[data-settings-backdrop]")) {
    if (settingsHasUnsavedInput() && !window.confirm("Descartar alterações não salvas?")) return;
    state.settingsOpen = false;
    state.apiKeySecret = null;
    render();
    document.querySelector("[data-internal-menu] summary")?.focus();
    return;
  }
  const settingsTab = event.target.closest("[data-settings-tab]");
  if (settingsTab && canManage()) {
    if (settingsHasUnsavedInput() && !window.confirm("Descartar alterações não salvas?")) return;
    state.settingsTab = settingsTab.dataset.settingsTab;
    if (state.settingsTab !== "api") state.apiKeySecret = null;
    render();
    if (state.settingsTab === "api") void loadApiKeyStatus(establishmentForModal);
    document.querySelector(`[data-settings-tab="${state.settingsTab}"]`)?.focus();
    return;
  }
  if (event.target.closest("[data-generate-api-key]") && canManage() && session()?.role === "admin" && firebaseApi) {
    if (state.apiKeyStatus.active && !window.confirm("Gerar e salvar uma nova chave no Render? A chave atual continuará ativa até o novo deploy terminar.")) return;
    state.apiKeyStatus.loading = true;
    render();
    try {
      const result = await firebaseApi.generateIntegrationApiKey(establishmentForModal.slug);
      state.apiKeySecret = result.key;
      state.apiKeyStatus = { ...state.apiKeyStatus, slug: establishmentForModal.slug, loading: false, loaded: true, variable: result.variable || `api-${establishmentForModal.slug}`, pending: "update", deployRequested: Boolean(result.deployRequested), error: "" };
      render();
      document.querySelector("[data-copy-api-key]")?.focus();
    } catch (error) {
      state.apiKeyStatus.loading = false;
      render();
      toast(error.message || "Não foi possível gerar a chave.", "!");
    }
    return;
  }
  if (event.target.closest("[data-refresh-api-key]") && canManage() && session()?.role === "admin") {
    void loadApiKeyStatus(establishmentForModal);
    return;
  }
  if (event.target.closest("[data-revoke-api-key]") && canManage() && session()?.role === "admin" && firebaseApi) {
    if (!window.confirm("Revogar esta chave? O site integrado perderá o acesso quando o novo deploy terminar.")) return;
    state.apiKeyStatus.loading = true;
    render();
    try {
      const result = await firebaseApi.revokeIntegrationApiKey(establishmentForModal.slug);
      state.apiKeySecret = null;
      state.apiKeyStatus = { ...state.apiKeyStatus, loading: false, pending: "revoke", deployRequested: Boolean(result.deployRequested), error: "" };
      render();
      toast(result.deployRequested ? "Revogação salva. Aguarde o deploy." : "Variável removida. Inicie um deploy manual no Render para concluir a revogação.");
    } catch (error) {
      state.apiKeyStatus.loading = false;
      render();
      toast(error.message || "Não foi possível revogar a chave.", "!");
    }
    return;
  }
  if (event.target.closest("[data-copy-api-key]") && state.apiKeySecret) {
    try { await navigator.clipboard.writeText(state.apiKeySecret); toast("Chave copiada."); }
    catch { toast("Não foi possível copiar. Selecione a chave e copie manualmente.", "!"); }
    return;
  }
  const selectedAppointmentSlot = event.target.closest("[data-open-attendance-slot]");
  const selectedProfessional = event.target.closest("[data-open-professional-attendance]");
  if ((selectedAppointmentSlot || selectedProfessional) && canManage()) {
    state.settingsOpen = false;
    state.apiKeySecret = null;
    state.nextCallProfessional = null;
    state.attendanceOpen = true;
    state.attendanceSelection = selectedAppointmentSlot
      ? { kind: "appointment", id: selectedAppointmentSlot.dataset.appointmentId, professional: selectedAppointmentSlot.dataset.professionalName, time: selectedAppointmentSlot.dataset.slotTime }
      : { kind: "professional", professional: selectedProfessional.dataset.openProfessionalAttendance };
    state.publicLookup.open = false;
    state.booking = freshBooking();
    cloudCache.delete(`admin:${establishmentForModal.slug}`);
    render();
    requestAnimationFrame(() => document.querySelector("[data-close-attendance]")?.focus());
    return;
  }
  if (event.target.closest("[data-close-attendance]") || event.target.matches("[data-attendance-backdrop]")) {
    state.attendanceOpen = false;
    state.attendanceSelection = null;
    render();
    document.querySelector("[data-open-attendance-slot], [data-open-professional-attendance]")?.focus();
    return;
  }
  const nextCallButton = event.target.closest("[data-open-next-call]");
  if (nextCallButton && canManage()) {
    state.attendanceOpen = false;
    state.attendanceSelection = null;
    state.settingsOpen = false;
    state.apiKeySecret = null;
    state.nextCallProfessional = nextCallButton.dataset.openNextCall;
    state.publicLookup.open = false;
    state.booking = freshBooking();
    cloudCache.delete(`admin:${establishmentForModal.slug}`);
    render();
    requestAnimationFrame(() => document.querySelector("[data-close-next-call]")?.focus());
    return;
  }
  if (event.target.closest("[data-close-next-call]") || event.target.matches("[data-next-call-backdrop]")) {
    const name = state.nextCallProfessional;
    state.nextCallProfessional = null;
    render();
    [...document.querySelectorAll("[data-open-next-call]")].find(item => item.dataset.openNextCall === name)?.focus();
    return;
  }
  const nextCallAction = event.target.closest("[data-next-call-action]");
  if (nextCallAction && canManage() && state.nextCallProfessional && firebaseApi) {
    const name = state.nextCallProfessional;
    const action = nextCallAction.dataset.nextCallAction;
    nextCallAction.disabled = true;
    try {
      const result = await firebaseApi.finishProfessionalTurn(establishmentForModal.slug, name, isoDate(), action);
      state.nextCallProfessional = null;
      cloudCache.delete(`admin:${establishmentForModal.slug}`);
      invalidatePublicCache(establishmentForModal.slug);
      render();
      toast(action === "close" ? `Expediente de ${name} encerrado hoje.`
        : action === "pause" ? `Atendimento de ${name} em pausa.`
          : result.next ? `Próxima senha de ${name}: ${result.next.time}.` : `Atendimento de ${name} finalizado. Não há próxima reserva.`);
    } catch (error) {
      nextCallAction.disabled = false;
      toast(error.message || firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
  const removeProfessionalButton = event.target.closest("[data-remove-professional]");
  if (removeProfessionalButton && canManage()) {
    const name = removeProfessionalButton.dataset.removeProfessional;
    if (!window.confirm(`Remover ${name} da agenda?`)) return;
    removeProfessionalButton.disabled = true;
    try {
      const result = await firebaseApi.removeProfessional(establishmentForModal.slug, name);
      Object.assign(establishmentForModal, result);
      invalidatePublicCache(establishmentForModal.slug);
      render();
      toast(`${name} removido da agenda.`);
    } catch (error) {
      removeProfessionalButton.disabled = false;
      toast(error.message || firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
  const removeServiceButton = event.target.closest("[data-remove-service]");
  if (removeServiceButton && canManage()) {
    const serviceId = removeServiceButton.dataset.removeService;
    const service = establishmentForModal.services.find(item => item.id === serviceId);
    if (!window.confirm(`Remover o serviço ${service?.name || serviceId}?`)) return;
    removeServiceButton.disabled = true;
    try {
      establishmentForModal.services = await firebaseApi.removeService(establishmentForModal.slug, serviceId);
      invalidatePublicCache(establishmentForModal.slug);
      render();
      toast("Serviço removido.");
    } catch (error) {
      removeServiceButton.disabled = false;
      toast(error.message || firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
  if (event.target.closest("[data-close-selected-booking]") || event.target.matches("[data-selected-booking-backdrop]")) {
    closeSelectedBooking();
    return;
  }
  const turnArrow = event.target.closest("[data-schedule-turn-step]");
  if (turnArrow) {
    const establishment = activeEstablishment();
    if (establishment) moveScheduleTurn(establishment, Number(turnArrow.dataset.scheduleTurnStep));
    return;
  }
  const addPeriod = event.target.closest("[data-add-work-period]");
  if (addPeriod) {
    const form = addPeriod.closest("[data-work-form]");
    form.dataset.dirty = "true";
    form.querySelector(".work-period-list").insertAdjacentHTML("beforeend", workPeriodRow(form.dataset.professionalName));
    form.querySelector(".work-period-row:last-child input")?.focus();
    return;
  }
  const removePeriod = event.target.closest("[data-remove-work-period]");
  if (removePeriod) {
    const form = removePeriod.closest("[data-work-form]");
    if (form.querySelectorAll(".work-period-row").length > 1) {
      form.dataset.dirty = "true";
      removePeriod.closest(".work-period-row").remove();
    }
    else toast("Mantenha pelo menos um período de trabalho.", "!");
    return;
  }
  const addServiceInterval = event.target.closest("[data-add-service-interval]");
  if (addServiceInterval) {
    const day = addServiceInterval.closest("[data-service-day]");
    day.closest("[data-service-form]").dataset.dirty = "true";
    day.querySelector("[data-service-day-enabled]").checked = true;
    day.querySelector("[data-service-intervals]").insertAdjacentHTML("beforeend", serviceIntervalMarkup());
    day.querySelector("[data-service-interval]:last-child [data-interval-start]")?.focus();
    return;
  }
  const removeServiceInterval = event.target.closest("[data-remove-service-interval]");
  if (removeServiceInterval) {
    const day = removeServiceInterval.closest("[data-service-day]");
    const rows = day.querySelectorAll("[data-service-interval]");
    if (rows.length > 1) removeServiceInterval.closest("[data-service-interval]").remove();
    else day.querySelector("[data-service-day-enabled]").checked = false;
    day.closest("[data-service-form]").dataset.dirty = "true";
    return;
  }
  if (event.target.closest("[data-agenda-logo]")) {
    event.preventDefault();
    const establishment = activeEstablishment();
    if (establishment) {
      state.booking = freshBooking();
      navigate(`/${establishment.slug}`);
    }
    return;
  }
  const internal = event.target.closest("[data-link]");
  if (internal) {
    event.preventDefault();
    const url = new URL(internal.href);
    const params = new URLSearchParams(url.search);
    const routeName = params.get("route");
    params.delete("route");
    const remainingQuery = params.toString();
    const path = routeName
      ? `/${routeName}${remainingQuery ? `?${remainingQuery}` : ""}${url.hash}`
      : `${url.pathname.replace(BASE, "")}${url.search}${url.hash}` || "/";
    navigate(path);
    return;
  }
  const open = event.target.closest("[data-open-establishment]");
  if (open) return navigate(`/${open.dataset.openEstablishment}`);
  const mapChoice = event.target.closest("[data-map-address]");
  if (mapChoice) {
    const establishment = activeEstablishment();
    if (establishment) selectPublicMapAddress(establishment, mapChoice.dataset.mapAddress);
    return;
  }
  if (event.target.closest("[data-service-carousel-prev]")) { moveServiceCarousel(-1); return; }
  if (event.target.closest("[data-service-carousel-next]")) { moveServiceCarousel(1); return; }
  const publicSlot = event.target.closest("[data-public-slot]");
  if (publicSlot) {
    pauseScheduleTurn();
    state.booking.professional = publicSlot.dataset.professionalName;
    state.booking.time = publicSlot.dataset.slotTime;
    state.booking.step = 1;
    state.booking.confirmation = null;
    render();
    document.querySelector("[data-selected-booking-popup] [data-booking-next]")?.focus?.();
    return;
  }
  if (event.target.closest("[data-open-employee-access]")) {
    state.employeeAccessOpen = true;
    render();
    requestAnimationFrame(() => document.querySelector("#employee-login")?.focus());
    return;
  }
  if (event.target.closest("[data-close-employee-access]") || event.target.matches("[data-employee-access-backdrop]")) {
    state.employeeAccessOpen = false;
    render();
    return;
  }
  if (event.target.closest("[data-forgot]")) { event.preventDefault(); toast("Solicite uma nova senha ao administrador do estabelecimento.", "ⓘ"); return; }
  const passwordToggle = event.target.closest("[data-toggle-password]");
  if (passwordToggle) {
    const passwordInput = document.querySelector("#password");
    const visible = passwordInput?.type === "text";
    if (passwordInput) passwordInput.type = visible ? "password" : "text";
    passwordToggle.classList.toggle("visible", !visible);
    passwordToggle.setAttribute("aria-label", visible ? "Visualizar senha" : "Ocultar senha");
    passwordToggle.title = visible ? "Visualizar senha" : "Ocultar senha";
    return;
  }
  const mode = event.target.closest("[data-date-mode]");
  if (mode) {
    selectBookingDate(isoDate());
    return;
  }
  const time = event.target.closest("[data-time]");
  if (time) { pauseScheduleTurn(); state.booking.time = time.dataset.time; render(); document.querySelector("[data-selected-booking-popup] [data-booking-next]")?.focus?.(); return; }
  if (event.target.closest("[data-booking-next]")) {
    event.preventDefault();
    state.booking.step = 2;
    render();
    requestAnimationFrame(() => document.querySelector("[data-booking-service]")?.focus());
    return;
  }
  if (event.target.matches("[data-booking-modal-backdrop]")) { closeSelectedBooking(); return; }
  if (event.target.closest("[data-booking-back]")) { event.preventDefault(); state.booking.step = 1; render(); document.querySelector("[data-selected-booking-popup] [data-booking-next]")?.focus?.(); return; }
  if (event.target.closest("[data-new-booking]")) { state.booking = freshBooking(); resumeScheduleTurn(); render(); return; }
  if (event.target.closest("[data-open-checkin]")) {
    state.publicLookup.open = true;
    render();
    requestAnimationFrame(() => document.querySelector("#public-appointment-credential")?.focus());
    return;
  }
  if (event.target.closest("[data-close-checkin-modal]") || event.target.matches("[data-checkin-modal-backdrop]")) {
    await stopQrScanner();
    const url = new URL(location.href);
    url.searchParams.delete("checkin");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    state.publicLookup = freshPublicLookup(state.publicLookup.method);
    render();
    return;
  }
  const checkInMethod = event.target.closest("[data-checkin-method]");
  if (checkInMethod) {
    state.publicLookup = freshPublicLookup(checkInMethod.dataset.checkinMethod);
    state.publicLookup.open = true;
    render();
    requestAnimationFrame(() => document.querySelector("#public-appointment-credential")?.focus());
    return;
  }
  const startCheckInButton = event.target.closest("[data-start-checkin]");
  if (startCheckInButton) {
    const selectedId = startCheckInButton.dataset.startCheckin;
    const selected = state.publicLookup.results.find(item => item.appointmentId === selectedId);
    if (!selected || selected.status !== "confirmado" || !appointmentPresenceWindow(activeEstablishment(), selected).allowed) {
      toast("A presença só pode ser confirmada na data do atendimento, de uma hora antes do início até o término previsto.", "!");
      return;
    }
    state.publicLookup.selectedId = selectedId;
    state.publicLookup.scanError = "";
    const scannedToken = new URLSearchParams(location.search).get("checkin");
    if (scannedToken) {
      await finishPublicCheckIn(checkInQrUrl(activeEstablishment(), scannedToken));
    } else {
      state.publicLookup.scanning = true;
      render();
      requestAnimationFrame(startQrScanner);
    }
    return;
  }
  if (event.target.closest("[data-cancel-checkin]") || event.target.matches("[data-checkin-backdrop]")) {
    await stopQrScanner();
    state.publicLookup.scanning = false;
    state.publicLookup.scanError = "";
    render();
    return;
  }
  if (event.target.closest("[data-mobile-admin]")) { state.mobileMenu = !state.mobileMenu; render(); return; }
  if (event.target.closest("[data-coming]")) { toast("Módulo preparado para a próxima etapa do sistema.", "ⓘ"); return; }
  if (event.target.closest("[data-notification]")) { toast("Nenhuma nova notificação.", "○"); return; }
  const scheduleModeButton = event.target.closest("[data-schedule-mode]");
  if (scheduleModeButton) {
    const establishment = activeEstablishment();
    const scheduleMode = scheduleModeButton.dataset.scheduleMode;
    if (!establishment || establishment.scheduleMode === scheduleMode) return;
    scheduleModeButton.disabled = true;
    try {
      await firebaseApi.updateScheduleMode(establishment.slug, scheduleMode);
      establishment.scheduleMode = scheduleMode;
      state.booking.time = null;
      invalidatePublicCache(establishment.slug);
      render();
      toast(scheduleMode === "employee" ? "Agenda por funcionário ativada." : "Agenda do estabelecimento ativada.");
    } catch (error) {
      scheduleModeButton.disabled = false;
      toast(firebaseApi ? firebaseApi.firebaseErrorMessage(error) : "Não foi possível salvar a configuração.", "!");
    }
    return;
  }
  if (event.target.closest("[data-open-queue-display]")) {
    const establishment = activeEstablishment();
    if (establishment) {
      const fromPublicStrip = Boolean(event.target.closest(".public-queue-expand"));
      navigate(`/${establishment.slug}?display=queue`);
      if (fromPublicStrip && document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => {});
    }
    return;
  }
  if (event.target.closest("[data-close-queue-display]")) {
    const establishment = activeEstablishment();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (establishment) navigate(`/${establishment.slug}?public=1`);
    return;
  }
  if (event.target.closest("[data-request-fullscreen]")) {
    try { await document.documentElement.requestFullscreen(); } catch { toast("O navegador não permitiu abrir a tela cheia.", "!"); }
    return;
  }
  if (event.target.closest("[data-print-checkin]")) { window.print(); return; }
  if (event.target.closest("[data-logout]")) {
    const establishmentSlug = activeEstablishment()?.slug;
    try { if (firebaseApi) await firebaseApi.logout(); } catch { /* a interface encerra mesmo sem rede */ }
    firebaseSession = null;
    cloudCache.clear();
    state.booking = freshBooking();
    state.settingsOpen = false;
    state.apiKeySecret = null;
    state.attendanceOpen = false;
    state.attendanceSelection = null;
    state.nextCallProfessional = null;
    navigate(establishmentSlug ? `/${establishmentSlug}` : "/");
    toast("Sessão encerrada.");
    return;
  }
  if (event.target.closest("[data-clear-appointment-search]")) {
    state.appointmentQuery = "";
    render();
    requestAnimationFrame(() => document.querySelector("[data-appointment-search]")?.focus());
    return;
  }
  const pauseButton = event.target.closest("[data-toggle-professional-pause]");
  if (pauseButton) {
    const establishment = activeEstablishment();
    const professionalName = pauseButton.dataset.professionalName;
    const professional = professionalDirectory(establishment, isoDate()).find((item) => item.name === professionalName);
    const pause = pauseButton.dataset.paused !== "true";
    pauseButton.disabled = true;
    pauseButton.textContent = pause ? "Pausando…" : "Retomando…";
    try {
      const next = await firebaseApi.setProfessionalPause(establishment.slug, professionalName, pause, isoDate(), Boolean(professional && professionalIsOnShift(professional)));
      cloudCache.delete(`admin:${establishment.slug}`);
      invalidatePublicCache(establishment.slug);
      toast(pause ? `${professionalName} está com o atendimento em pausa.` : next ? `${professionalName} retomou e o próximo atendimento foi iniciado.` : `${professionalName} retomou o atendimento.`);
      render();
    } catch (error) {
      pauseButton.disabled = false;
      toast(firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
  const startAppointmentButton = event.target.closest("[data-start-appointment]");
  if (startAppointmentButton) {
    const establishment = activeEstablishment();
    startAppointmentButton.disabled = true;
    startAppointmentButton.textContent = "Iniciando…";
    try {
      await firebaseApi.startProfessionalAppointment(establishment.slug, startAppointmentButton.dataset.startAppointment, startAppointmentButton.dataset.professionalName, isoDate());
      cloudCache.delete(`admin:${establishment.slug}`);
      invalidatePublicCache(establishment.slug);
      toast("Atendimento iniciado.");
      render();
    } catch (error) {
      startAppointmentButton.disabled = false;
      startAppointmentButton.textContent = "Iniciar";
      toast(firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
  const completeAppointmentButton = event.target.closest("[data-complete-appointment]");
  if (completeAppointmentButton) {
    const establishment = activeEstablishment();
    const professionalName = completeAppointmentButton.dataset.professionalName;
    const professional = professionalDirectory(establishment, isoDate()).find((item) => item.name === professionalName);
    completeAppointmentButton.disabled = true;
    completeAppointmentButton.textContent = "Encerrando…";
    try {
      const result = await firebaseApi.completeAppointmentAndAdvance(establishment.slug, completeAppointmentButton.dataset.completeAppointment, professionalName, isoDate(), Boolean(professional && professionalIsOnShift(professional)));
      cloudCache.delete(`admin:${establishment.slug}`);
      invalidatePublicCache(establishment.slug);
      toast(result.next ? `Atendimento encerrado. ${result.next.time} entrou automaticamente em atendimento.` : result.paused ? "Atendimento encerrado. O próximo aguardará até a retomada." : "Atendimento encerrado.");
      render();
    } catch (error) {
      completeAppointmentButton.disabled = false;
      completeAppointmentButton.textContent = "Encerrar";
      toast(firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
  const confirmPresenceButton = event.target.closest("[data-confirm-presence]");
  if (confirmPresenceButton) {
    const establishment = activeEstablishment();
    const data = getData(establishment);
    const appointment = data.appointments.find((item) => item.id === confirmPresenceButton.dataset.confirmPresence);
    confirmPresenceButton.disabled = true;
    confirmPresenceButton.textContent = "Confirmando…";
    try {
      await firebaseApi.confirmPresenceManually(establishment.slug, confirmPresenceButton.dataset.confirmPresence);
      const professional = professionalDirectory(establishment, isoDate()).find((item) => item.name === appointment?.professional);
      const hasCurrent = data.appointments.some((item) => item.professional === appointment?.professional && item.status === "atendendo");
      if (professional && !professionalIsPaused(data, appointment?.professional) && !hasCurrent && professionalIsOnShift(professional)) {
        await firebaseApi.startNextProfessionalAppointment(establishment.slug, professional.name, isoDate());
      }
      cloudCache.delete(`admin:${establishment.slug}`);
      invalidatePublicCache(establishment.slug);
      toast("Presença confirmada pela equipe.");
      render();
    } catch (error) {
      confirmPresenceButton.disabled = false;
      confirmPresenceButton.textContent = "Confirmar chegada";
      toast(firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
});

document.addEventListener("change", (event) => {
  const addressForm = event.target.closest("[data-store-profile-form]");
  if (addressForm) {
    const suffix = event.target.name?.endsWith("2") || event.target.dataset.postalOptions === "2" ? "2" : "";
    if (event.target.matches("[data-postal-options]")) {
      if (event.target.value) {
        postalField(addressForm, "zipCode", suffix).value = event.target.value;
        event.target.hidden = true;
        void fillAddressFromPostalCode(addressForm, suffix);
      }
      return;
    }
    if (["zipCode", "zipCode2"].includes(event.target.name)) { void fillAddressFromPostalCode(addressForm, suffix); return; }
    if (/^(street|neighborhood|city|state)(2)?$/.test(event.target.name || "")) { void fillPostalCodeFromAddress(addressForm, suffix); return; }
  }
  if (event.target.matches("[data-lunch-day-mode]")) {
    event.target.closest("[data-lunch-form]").querySelector("[data-lunch-days]").hidden = event.target.value !== "custom";
    return;
  }
  if (event.target.matches("[data-service-availability-mode]")) {
    event.target.closest("[data-service-form]").querySelector("[data-service-weekly]").hidden = event.target.value !== "custom";
    return;
  }
  if (event.target.matches("[data-service-location]")) {
    event.target.closest("[data-service-form]").querySelector("[data-service-meeting-url]").hidden = event.target.value !== "online";
    return;
  }
  if (event.target.matches("[data-schedule-turn-auto]")) {
    state.scheduleAuto = event.target.checked;
    if (event.target.checked) state.schedulePausedByCalendar = false;
    if (state.scheduleTurn) state.scheduleTurn.changedAt = Date.now();
    const establishment = activeEstablishment();
    if (establishment) startScheduleTurnTimer(establishment);
    return;
  }
  if (event.target.matches("[data-booking-date]")) {
    selectBookingDate(event.target.value);
  }
  if (event.target.matches("[data-professional]")) { state.booking.professional = event.target.value; state.booking.time = null; render(); }
  if (event.target.matches("[data-booking-service]")) {
    state.booking.serviceId = event.target.value;
    const establishment = activeEstablishment();
    const service = establishment?.services?.find(item => item.id === event.target.value);
    if (service && service.locationType !== "online") selectPublicMapAddress(establishment, service.locationType === "address2" ? "address2" : "address1");
  }
  if (event.target.matches("[data-qr-image]")) {
    const file = event.target.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const { default: QrScanner } = await import("./vendor/qr-scanner.min.js");
        const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
        await finishPublicCheckIn(result?.data || result);
      } catch {
        await stopQrScanner();
        state.publicLookup.scanError = "Não encontramos um QR code válido nessa imagem. Tente novamente.";
        render();
      }
    })();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#store-name")) {
    state.systemCreateName = event.target.value;
    const slug = establishmentSlug(event.target.value).replace(/-/g, "");
    const preview = document.querySelector("[data-generated-store-login]");
    if (preview) preview.textContent = slug ? `URL: ${slug} · Login: admin · E-mail: ${slug}-admin@agendae.com.br` : "O endereço e o e-mail serão gerados a partir do nome.";
    return;
  }
  const scheduleForm = event.target.closest("[data-work-form], [data-lunch-form], [data-extra-working-form], [data-professional-form], [data-service-form], [data-store-profile-form]");
  if (scheduleForm) {
    scheduleForm.dataset.dirty = "true";
    if (event.target.matches('input[name="zipCode"], input[name="zipCode2"]') && postalDigits(event.target.value).length === 8) void fillAddressFromPostalCode(scheduleForm, event.target.name.endsWith("2") ? "2" : "");
    return;
  }
  if (!event.target.matches("[data-appointment-search]")) return;
  state.appointmentQuery = event.target.value;
  const establishment = activeEstablishment();
  if (!establishment) return;
  const data = getData(establishment);
  const list = document.querySelector(".appointment-list");
  if (list) list.innerHTML = appointmentRows(data);
  const clearButton = document.querySelector("[data-clear-appointment-search]");
  if (clearButton) clearButton.hidden = !state.appointmentQuery;
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "first-password-form") {
    if (!firebaseApi || !session()?.mustChangePassword) return;
    const form = new FormData(event.target);
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("confirmation") || "");
    if (password.length < 8 || password === "123456" || password !== confirmation) return showLoginError(event.target, "Informe duas senhas iguais com pelo menos 8 caracteres.");
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await firebaseApi.changeOwnPassword(password);
      firebaseSession.mustChangePassword = false;
      if (route() !== firebaseSession.slug) navigate(`/${firebaseSession.slug}`);
      if (establishments[firebaseSession.slug]?.setupComplete === false) {
        state.settingsTab = "store";
        state.settingsOpen = true;
      }
      render();
      toast("Senha definitiva salva.");
    } catch (error) {
      button.disabled = false;
      showLoginError(event.target, firebaseApi.firebaseErrorMessage(error));
    }
    return;
  }
  if (event.target.id === "system-login-form") {
    if (!firebaseApi || authFlowInProgress) return;
    const button = event.target.querySelector('button[type="submit"]');
    const form = new FormData(event.target);
    button.disabled = true;
    authFlowInProgress = true;
    try {
      firebaseSession = await firebaseApi.loginSystemAdmin(String(form.get("login")), String(form.get("password")));
      state.createdStoreSlug = "";
      state.createdStoreEmail = "";
      state.createdStorePassword = "";
      state.systemListLoaded = false;
      state.systemListError = "";
      navigate(`/${SYSTEM_MANAGE_ROUTE}`);
    } catch (error) {
      button.disabled = false;
      showLoginError(event.target, firebaseApi.firebaseErrorMessage(error));
    } finally { authFlowInProgress = false; }
    return;
  }
  if (event.target.id === "system-create-form") {
    if (!firebaseApi || session()?.role !== "system_admin") return;
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const details = await firebaseApi.createEstablishmentWithOwner({ name: new FormData(event.target).get("name") });
      establishments[details.slug] = details.establishment;
      state.systemEstablishments = [...state.systemEstablishments.filter(item => (item.slug || item.id) !== details.slug), details.establishment];
      state.createdStoreSlug = details.slug;
      state.createdStoreEmail = details.email;
      state.createdStorePassword = details.password;
      state.systemCreateName = "";
      render();
      toast("Estabelecimento e administrador da loja criados.");
    } catch (error) {
      button.disabled = false;
      showLoginError(event.target, firebaseApi.firebaseErrorMessage(error));
    }
    return;
  }
  if (event.target.matches("[data-store-profile-form]")) {
    const establishment = activeEstablishment();
    if (!establishment || session()?.slug !== establishment.slug || session()?.role !== "admin" || !firebaseApi) return;
    const button = event.target.querySelector('button[type="submit"]');
    const status = event.target.querySelector("[data-store-save-status]");
    button.disabled = true;
    status.hidden = false;
    status.textContent = "Salvando dados da loja…";
    status.dataset.state = "saving";
    try {
      const profile = storeProfile(Object.fromEntries(new FormData(event.target)));
      await firebaseApi.saveStoreProfile(establishment.slug, profile);
      Object.assign(establishment, profile);
      event.target.dataset.dirty = "false";
      state.settingsOpen = false;
      render();
      document.querySelector("[data-internal-menu] summary")?.focus();
      toast("Dados da loja salvos.");
    } catch (error) {
      button.disabled = false;
      const message = firebaseApi.firebaseErrorMessage(error);
      status.textContent = `Não foi possível salvar os dados da loja: ${message}`;
      status.dataset.state = "error";
      status.scrollIntoView({ block: "nearest" });
      toast(status.textContent, "!");
    }
    return;
  }
  if (event.target.matches("[data-professional-form], [data-service-form]")) {
    const establishment = activeEstablishment();
    if (!establishment || session()?.slug !== establishment.slug || !firebaseApi) return;
    const form = new FormData(event.target);
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (event.target.matches("[data-professional-form]")) {
        const result = await firebaseApi.saveProfessional(establishment.slug, event.target.dataset.originalName || "", {
          name: form.get("name"), role: form.get("role"),
        });
        Object.assign(establishment, result);
        toast("Funcionário salvo.");
      } else {
        const weeklyAvailability = form.get("availabilityMode") === "custom"
          ? Object.fromEntries([...event.target.querySelectorAll("[data-service-day]")].filter(day => day.querySelector("[data-service-day-enabled]").checked).map(day => [day.dataset.serviceDay, [...day.querySelectorAll("[data-service-interval]")].map(row => ({ start: row.querySelector("[data-interval-start]").value, end: row.querySelector("[data-interval-end]").value }))]))
          : null;
        establishment.services = await firebaseApi.saveService(establishment.slug, event.target.dataset.serviceId || "", {
          name: form.get("name"), duration: form.get("duration"), price: form.get("price"), icon: form.get("icon"),
          locationType: form.get("locationType"), meetingUrl: form.get("meetingUrl"), weeklyAvailability,
        });
        toast("Serviço salvo.");
      }
      invalidatePublicCache(establishment.slug);
      render();
    } catch (error) {
      button.disabled = false;
      toast(error.message || firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
  if (event.target.matches("[data-extra-working-form]")) {
    const establishment = activeEstablishment();
    if (!establishment || session()?.slug !== establishment.slug || !firebaseApi) return;
    const form = new FormData(event.target);
    const enabled = form.get("enabled") === "true";
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      establishment.extraWorkingDates = await firebaseApi.updateExtraWorkingDate(establishment.slug, String(form.get("date")), enabled);
      cloudCache.delete(`admin:${establishment.slug}`);
      invalidatePublicCache(establishment.slug);
      state.booking.time = null;
      render();
      toast(enabled ? "Expediente extra liberado somente para esta data." : "Expediente extra removido. O expediente normal foi mantido.");
    } catch (error) {
      button.disabled = false;
      toast(error.message || "Não foi possível salvar o expediente extra.", "!");
    }
    return;
  }
  if (event.target.matches("[data-work-form]")) {
    const establishment = activeEstablishment();
    if (!establishment || session()?.slug !== establishment.slug || !firebaseApi) return;
    const professionalName = event.target.dataset.professionalName;
    const periods = [...event.target.querySelectorAll(".work-period-row")].map(row => ({ start: row.querySelector('[name="start"]').value, end: row.querySelector('[name="end"]').value }));
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      establishment.professionals = await firebaseApi.updateProfessionalWorkPeriods(establishment.slug, professionalName, periods);
      establishment.availableTimes = [...new Set(establishment.professionals.flatMap(professional => professional.availableTimes || []))].sort();
      state.booking.time = null;
      cloudCache.delete(`admin:${establishment.slug}`);
      invalidatePublicCache(establishment.slug);
      render();
      toast(`Escala de ${professionalName} atualizada.`);
    } catch (error) {
      button.disabled = false;
      toast(error.message || "Não foi possível salvar a escala.", "!");
    }
    return;
  }
  if (event.target.matches("[data-lunch-form]")) {
    const establishment = activeEstablishment();
    if (!establishment || session()?.slug !== establishment.slug || !firebaseApi) return;
    const form = new FormData(event.target);
    const professionalName = event.target.dataset.professionalName;
    const start = String(form.get("start") || "");
    const end = String(form.get("end") || "");
    const days = form.get("dayMode") === "custom" ? form.getAll("lunchDay") : null;
    const interval = start || end ? { start, end, ...(days ? { days } : {}) } : null;
    if (interval && days && !days.length) {
      toast("Selecione pelo menos um dia de almoço.", "!");
      return;
    }
    if (interval && !lunchBreakFor({ ...establishment, professionalLunchBreaks: { [professionalName]: interval } }, professionalName)) {
      toast("Informe início e fim do almoço, com o fim após o início.", "!");
      return;
    }
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      establishment.professionalLunchBreaks = await firebaseApi.updateProfessionalLunchBreak(establishment.slug, professionalName, interval);
      establishment.professionals = establishment.professionals.map(professional => professional.name === professionalName && professional.slotDuration === 20
        ? { ...professional, ...scheduleFromPeriods(workPeriodsFor(professional)) }
        : professional);
      establishment.availableTimes = [...new Set(establishment.professionals.flatMap(professional => professional.availableTimes || establishment.availableTimes || []))].sort();
      state.booking.time = null;
      invalidatePublicCache(establishment.slug);
      render();
      toast(`Almoço de ${professionalName} atualizado.`);
    } catch (error) {
      button.disabled = false;
      toast(firebaseApi.firebaseErrorMessage(error), "!");
    }
    return;
  }
  if (event.target.id === "public-appointment-search-form") {
    const establishment = activeEstablishment();
    const lookupMethod = state.publicLookup.method;
    const credential = String(new FormData(event.target).get("credential") || "").trim();
    if (!establishment) return;
    if (lookupMethod === "name" && normalizedSearch(credential).split(" ").length < 2) return toast("Digite seu nome completo para consultar.", "!");
    if (lookupMethod === "code" && credential.replace(/\s/g, "").length < 6) return toast("Digite a senha de 6 caracteres do agendamento.", "!");
    state.publicLookup = { ...freshPublicLookup(lookupMethod), query: credential, loading: true, open: true };
    render();
    try {
      const results = await firebaseApi.findPublicAppointments(establishment.slug, credential, lookupMethod);
      state.publicLookup = { ...freshPublicLookup(lookupMethod), query: credential, loading: false, searched: true, results, open: true };
    } catch (error) {
      console.error("Agendae: falha ao consultar agendamento.", error);
      state.publicLookup = { ...freshPublicLookup(lookupMethod), query: credential, loading: false, searched: false, results: [], open: true };
      toast("Não foi possível consultar agora. Tente novamente.", "!");
    }
    render();
    return;
  }
  if (event.target.id === "finder-form") {
    const query = new FormData(event.target).get("query") || document.querySelector("#finder-input")?.value || "";
    const normalized = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    if (!normalized) return toast("Digite o nome do estabelecimento.", "!");
    const match = Object.values(establishments).find((item) => {
      const searchable = `${item.name} ${item.category} ${item.slug}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      return searchable.includes(normalized);
    });
    if (match) navigate(`/${match.slug}`);
    else toast("Não encontramos esse estabelecimento.", "!");
    return;
  }
  if (event.target.id === "login-form") {
    if (authFlowInProgress) return;
    showLoginError(event.target);
    if (!firebaseApi) return showLoginError(event.target, "O serviço de acesso ainda não respondeu. Tente novamente em instantes.");
    const form = new FormData(event.target);
    const establishmentSlug = String(form.get("establishment") || "");
    const credentials = loginCredentials(form.get("login"), establishmentSlug);
    if (!establishments[establishmentSlug]) return showLoginError(event.target, "Selecione um estabelecimento válido.");
    if (!credentials) return showLoginError(event.target, "Digite um login ou e-mail válido.");
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Entrando…";
    authFlowInProgress = true;
    try {
      firebaseSession = await firebaseApi.login(
        credentials.email,
        form.get("password"),
        form.get("remember") === "on",
        credentials.legacyEmail,
        establishmentSlug,
      );
      if (firebaseSession.slug !== establishmentSlug) {
        await firebaseApi.logout();
        firebaseSession = null;
        const mismatch = new Error("Funcionário vinculado a outro estabelecimento.");
        mismatch.code = "agendae/establishment-mismatch";
        throw mismatch;
      }
      state.booking = freshBooking();
      navigate(`/${establishmentSlug}`);
      if (establishments[establishmentSlug]?.setupComplete === false && firebaseSession.role === "admin" && !firebaseSession.mustChangePassword) {
        state.settingsTab = "store";
        state.settingsOpen = true;
        render();
      }
      toast(`Login realizado. Bem-vindo, ${firebaseSession.name.split(" ")[0]}!`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Entrar no painel";
      showLoginError(event.target, firebaseApi.firebaseErrorMessage(error));
      console.error("Agendae: falha no login", { code: error?.code || "unknown" });
    } finally {
      authFlowInProgress = false;
    }
    return;
  }
  if (event.target.id === "booking-form") {
    const establishment = activeEstablishment();
    if (!establishment) return;
    if (establishment.setupComplete === false) { toast("A agenda ainda está em configuração.", "!"); return; }
    if (businessDayIsClosed(establishment, state.booking.date)) {
      state.booking.step = 1;
      state.booking.time = null;
      render();
      toast("Sem expediente neste dia. Escolha outra data para agendar.", "!");
      return;
    }
    if (slotHasPassed(state.booking.date, state.booking.time)) {
      state.booking.step = 1;
      state.booking.time = null;
      render();
      toast("Este horário já passou. Escolha outro horário disponível.", "!");
      return;
    }
    const form = new FormData(event.target);
    const selectedServiceId = String(form.get("service") || "");
    const service = establishment.services.find((item) => item.id === selectedServiceId);
    if (!service) {
      toast("Selecione o serviço desejado para continuar.", "!");
      event.target.querySelector("[data-booking-service]")?.focus();
      return;
    }
    if (!serviceAvailableAt(establishment, service, state.booking.date, state.booking.time) || !serviceFitsSlot(establishment, state.booking.professional, state.booking.time, service.name, getData(establishment).slots || [], state.booking.date)) {
      state.booking.step = 1;
      state.booking.time = null;
      render();
      toast("Este serviço não está disponível no dia e horário escolhido.", "!");
      return;
    }
    state.booking.serviceId = selectedServiceId;
    const locationType = service.locationType || "address1";
    const appointment = { id: crypto.randomUUID(), date: state.booking.date, time: state.booking.time, client: form.get("name").trim(), phone: form.get("phone").trim(), service: service.name, professional: state.booking.professional, locationType, serviceAddress: locationType === "online" ? "" : locationType === "address2" ? establishment.address2 || "" : establishment.address || "", meetingUrl: locationType === "online" ? service.meetingUrl || "" : "", status: "confirmado", checkInCode: generateCheckInCode() };
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Confirmando…";
    try {
      if (firebaseApi) await firebaseApi.createAppointment(
        establishment.slug,
        appointment,
        establishment.scheduleMode || "employee",
        professionalDirectory(establishment).map((professional) => professional.name),
      );
      else throw new Error("Serviço de agendamento indisponível.");
      cloudCache.delete(publicCacheKey(establishment));
      state.booking.confirmation = appointment;
      state.booking.step = 3;
      render();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Confirmar agendamento";
      toast(firebaseApi ? firebaseApi.firebaseErrorMessage(error) : "Não foi possível conectar ao serviço de agendamento.", "!");
      if (error?.code === "agendae/slot-unavailable") {
        state.booking.step = 1;
        state.booking.time = null;
        cloudCache.delete(publicCacheKey(establishment));
        render();
      }
    }
  }
});

window.addEventListener("popstate", render);
window.addEventListener("resize", () => {
  if (scheduleViewportWidth === window.innerWidth) return;
  scheduleViewportWidth = window.innerWidth;
  const schedule = document.querySelector(".public-schedule-body");
  const establishment = activeEstablishment();
  if (schedule && establishment) {
    schedule.innerHTML = publicSchedule(establishment);
    restoreScheduleScroll();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.systemAccessOpen) {
    state.systemAccessOpen = false;
    state.createdStoreSlug = "";
    state.createdStoreEmail = "";
    state.createdStorePassword = "";
    render();
    document.querySelector("[data-open-system-access]")?.focus();
    return;
  }
  if (event.key === "Escape" && state.nextCallProfessional) {
    event.preventDefault();
    const name = state.nextCallProfessional;
    state.nextCallProfessional = null;
    render();
    [...document.querySelectorAll("[data-open-next-call]")].find(item => item.dataset.openNextCall === name)?.focus();
    return;
  }
  if (event.key === "Escape" && (state.settingsOpen || state.attendanceOpen)) {
    event.preventDefault();
    if (state.settingsOpen && settingsHasUnsavedInput() && !window.confirm("Descartar alterações não salvas?")) return;
    state.settingsOpen = false;
    state.apiKeySecret = null;
    state.attendanceOpen = false;
    state.attendanceSelection = null;
    render();
    document.querySelector("[data-open-attendance-slot], [data-open-professional-attendance]")?.focus();
    return;
  }
  if (event.key === "Tab" && (state.settingsOpen || state.attendanceOpen || state.nextCallProfessional)) {
    const modal = document.querySelector(".settings-modal, .attendance-modal, .next-call-modal");
    const focusable = [...(modal?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])') || [])];
    const first = focusable[0], last = focusable.at(-1);
    if (first && (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
    return;
  }
  if (event.key === "Escape" && state.calendarOpen) {
    event.preventDefault();
    state.calendarOpen = false;
    refreshBookingCalendar("[data-calendar-toggle]");
    return;
  }
  const openMenu = document.querySelector("[data-internal-menu][open]");
  if (event.key === "Escape" && openMenu) {
    openMenu.open = false;
    openMenu.querySelector("summary")?.focus();
    return;
  }
  if (event.key === "Escape" && state.employeeAccessOpen) {
    state.employeeAccessOpen = false;
    render();
    return;
  }
  if (event.key === "Escape" && state.publicLookup.scanning) {
    void stopQrScanner();
    state.publicLookup.scanning = false;
    state.publicLookup.scanError = "";
    render();
    return;
  }
  if (event.key === "Escape" && state.publicLookup.open) {
    void stopQrScanner();
    const url = new URL(location.href);
    url.searchParams.delete("checkin");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    state.publicLookup = freshPublicLookup(state.publicLookup.method);
    render();
    return;
  }
  if (event.key === "Escape" && (state.booking.step === 2 || state.booking.step === 1 && state.booking.time)) {
    closeSelectedBooking();
    return;
  }
  const selectionPopup = document.querySelector("[data-selected-booking-popup]");
  if (event.key === "Tab" && selectionPopup && !state.employeeAccessOpen && !state.publicLookup.open) {
    const buttons = [...selectionPopup.querySelectorAll("button:not([disabled])")];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
render();

async function initializeFirebase() {
  try {
    firebaseApi = await import("./firebase-service.js");
    const directory = await firebaseApi.loadEstablishments();
    establishments = Object.fromEntries(directory.map((item) => [item.slug || item.id, { ...item, slug: item.slug || item.id }]));
    catalogLoaded = true;
    firebaseApi.observeSession((profile, error) => {
      firebaseSession = profile;
      if (!profile) { state.settingsOpen = false; state.apiKeySecret = null; state.attendanceOpen = false; state.attendanceSelection = null; state.nextCallProfessional = null; state.systemEstablishments = []; state.systemListLoaded = false; }
      if (error) toast(firebaseApi.firebaseErrorMessage(error), "!");
      if (!profile && route() === SYSTEM_MANAGE_ROUTE) { navigate("/"); return; }
      if (profile?.role === "admin" && !profile.mustChangePassword && establishments[route()]?.setupComplete === false && !state.settingsOpen) {
        state.settingsTab = "store";
        state.settingsOpen = true;
      }
      if (profile && route() === "login" && !authFlowInProgress) {
        if (profile.role === "system_admin") { navigate(`/${SYSTEM_MANAGE_ROUTE}`); return; }
        const requestedSlug = new URLSearchParams(location.search).get("establishment");
        if (requestedSlug && requestedSlug !== profile.slug) {
          void firebaseApi.logout();
          return;
        }
        navigate(`/${profile.slug}`);
        if (profile.role === "admin" && !profile.mustChangePassword && establishments[profile.slug]?.setupComplete === false) {
          state.settingsTab = "store";
          state.settingsOpen = true;
          render();
        }
      } else if (!settingsIsEditing()) render();
    });
    render();
  } catch (error) {
    console.error("Agendae: falha ao carregar o Firebase.", error);
    catalogLoaded = true;
    render();
      toast(error?.message || "Não foi possível carregar o sistema. Verifique sua conexão.", "!");
  }
}

await initializeFirebase();
