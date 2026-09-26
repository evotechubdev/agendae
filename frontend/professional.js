import { queueView, scheduledTicket, professionalInitial, serviceInitials, ticketState, TICKET_STATES } from "./queue-model.mjs";

const BASE = location.hostname.endsWith("github.io") ? "/agendae" : "";
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
let professionalScheduleTimer = null;
let adminRefreshTimer = null;
let qrScanner = null;
const cloudCache = new Map();
const cloudLoading = new Set();
const professionalReconcileLoading = new Set();
const checkInConfigs = new Map();
const checkInConfigLoading = new Set();

let establishments = {};

const state = {
  booking: freshBooking(),
  appointmentQuery: "",
  publicLookup: freshPublicLookup(),
  queueModalOpen: false,
  employeeAccessOpen: false,
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

function professionalDirectory(establishment) {
  return (establishment.professionals || []).map((professional) => typeof professional === "string"
    ? { name: professional, availableTimes: establishment.availableTimes || [] }
    : professional
  );
}

function staffStatusFor(data, professionalName) {
  return (data.staffStatuses || []).find((item) => item.professional === professionalName) || {};
}

function professionalIsPaused(data, professionalName, date = isoDate()) {
  const status = staffStatusFor(data, professionalName);
  return Boolean(status.paused && (!status.pausedDate || status.pausedDate === date));
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
  const toMinutes = (time) => {
    const [hour, minute] = String(time).split(":").map(Number);
    return (hour * 60) + minute;
  };
  const minutes = times.map(toMinutes).sort((a, b) => a - b);
  return clock.minutes >= minutes[0] && clock.minutes <= minutes.at(-1);
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

function normalizedLogin(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._-]/g, "");
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
  state.queueModalOpen = false;
  state.employeeAccessOpen = false;
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
  const adminMode = session()?.slug === establishment.slug && new URLSearchParams(location.search).get("public") !== "1";
  const cloud = cloudCache.get(adminMode ? `admin:${establishment.slug}` : publicCacheKey(establishment));
  return cloud || { appointments: [], queue: [], slots: [], staffStatuses: [], todayAppointments: 0 };
}

async function reconcileProfessionalCoverage(establishment, data) {
  if (!firebaseApi || !session() || !usesEmployeeSchedules(establishment)) return;
  const date = isoDate();
  const reconciliationKey = `${establishment.slug}:${date}`;
  if (professionalReconcileLoading.has(reconciliationKey)) return;
  professionalReconcileLoading.add(reconciliationKey);
  let changed = false;
  try {
    for (const professional of professionalDirectory(establishment)) {
      const appointments = data.appointments.filter((item) => item.professional === professional.name);
      const staffStatus = staffStatusFor(data, professional.name);
      const current = appointments.find((item) => item.status === "atendendo");
      const hasEligible = appointments.some((item) => ["presente", "confirmado"].includes(item.status));
      if (professionalIsPaused(data, professional.name, date)) continue;
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
    if (route() === establishment.slug) render();
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

function footer() {
  return `<footer class="footer"><div class="footer-inner">${logo()}<span>Agendamentos e filas em um só lugar.</span><span>© ${new Date().getFullYear()} Agendae</span></div></footer>`;
}

function renderHome() {
  document.title = "Agendae — Encontre seu estabelecimento";
  const directory = Object.values(establishments);
  const sample = directory[0];
  const directoryHtml = !catalogLoaded
    ? '<div class="empty">Carregando estabelecimentos…</div>'
    : directory.length
      ? directory.map((item) => `<button class="directory-item" data-open-establishment="${item.slug}"><span class="est-avatar ${item.type === "clinic" ? "green" : ""}">${escapeHTML(item.initials)}</span><span class="directory-meta"><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.category)} · ${escapeHTML(item.neighborhood)}</small></span><span class="open-tag">${item.openNow ? "ABERTO" : "FECHADO"}</span></button>`).join("")
      : '<div class="empty">Nenhum estabelecimento disponível.</div>';
  app.innerHTML = `
    <header class="home-header"><div class="home-nav">
      <a href="${href("/")}" data-link>${logo()}</a>
      <nav class="home-nav-links"><a class="home-nav-link" href="#encontrar">Encontrar estabelecimento</a><a class="home-nav-link" href="#para-negocios">Para estabelecimentos</a><a class="btn btn-primary" href="${href("/login")}" data-link>Entrar</a></nav>
    </div></header>
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
      <section class="business-cta" id="para-negocios"><div><h2>Seu estabelecimento também pode ter uma agenda profissional.</h2><p>Controle horários, clientes e fila de atendimento em uma única interface.</p></div><a class="btn btn-yellow" href="${href("/login")}" data-link>Acessar área do estabelecimento</a></section>
    </main>${footer()}`;
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

function bookingContent(establishment) {
  const booking = state.booking;

  if (booking.step === 2) return `<div class="booking-modal-backdrop" data-booking-modal-backdrop>
    <section class="booking-modal booking-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title">
      <div class="booking-modal-head"><div><small>FINALIZAR AGENDAMENTO</small><h2 id="booking-modal-title">Escolha o serviço e confirme</h2></div><button class="booking-modal-close" type="button" data-booking-back aria-label="Fechar janela">×</button></div>
      <form id="booking-form" class="booking-modal-form">
        <p class="booking-modal-lead">Selecione o serviço desejado. A duração e o valor variam conforme a opção escolhida.</p>
        <fieldset class="booking-service-picker"><legend>Serviço <span>Obrigatório</span></legend><div class="booking-service-options">${establishment.services.map((item) => `<label class="booking-service-option"><input type="radio" name="service" value="${escapeHTML(item.id)}" data-booking-service required ${booking.serviceId === item.id ? "checked" : ""}><span class="service-icon">${item.icon}</span><span class="booking-service-info"><strong>${escapeHTML(item.name)}</strong><small>${item.duration} minutos</small></span><span class="service-price">${item.price ? currency.format(item.price) : "Incluso"}</span><i aria-hidden="true">✓</i></label>`).join("")}</div></fieldset>
        <div class="mini-field-grid"><div class="field full"><label for="customer-name">Nome completo</label><input id="customer-name" name="name" type="text" autocomplete="name" required placeholder="Digite seu nome"></div><div class="field full"><label for="customer-phone">Telefone <span class="optional-label">(opcional)</span></label><input id="customer-phone" name="phone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000"></div></div>
        <div class="confirmation-data booking-review"><div class="confirmation-row"><span>Data</span><strong>${prettyDate(booking.date, true)}</strong></div><div class="confirmation-row"><span>Horário</span><strong>${escapeHTML(booking.time)}</strong></div><div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(booking.professional)}</strong></div></div>
        <div class="booking-actions"><button class="btn btn-outline" type="button" data-booking-back>Voltar</button><button class="btn btn-yellow" type="submit">Confirmar agendamento</button></div>
      </form>
    </section>
  </div>`;

  const item = booking.confirmation;
  return `<div class="booking-modal-backdrop"><section class="booking-modal booking-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="booking-confirmation-title"><div class="booking-modal-head"><div><small>AGENDAMENTO CONCLUÍDO</small><h2 id="booking-confirmation-title">Agendamento confirmado</h2></div><button class="booking-modal-close" type="button" data-new-booking aria-label="Fechar confirmação">×</button></div><div class="booking-modal-form"><div class="confirmation"><div class="confirmation-icon">✓</div><p class="booking-lead">Seu horário na ${escapeHTML(establishment.name)} está reservado.</p><div class="confirmation-data"><div class="confirmation-row"><span>Serviço</span><strong>${escapeHTML(item.service)}</strong></div><div class="confirmation-row"><span>Data</span><strong>${prettyDate(item.date, true)}</strong></div><div class="confirmation-row"><span>Horário</span><strong>${escapeHTML(item.time)}</strong></div><div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(item.professional)}</strong></div></div><div class="call-ticket"><span>Senha no painel</span><strong>${escapeHTML(scheduledTicket(establishment, item.time, item.professional, item.service))}</strong><p>Esta senha identifica seu horário quando ele for chamado.</p></div><div class="checkin-password"><span>Sua senha de presença</span><strong>${escapeHTML(item.checkInCode)}</strong><p>Guarde esta senha para confirmar sua chegada. Ela não aparece no painel público.</p></div><div class="booking-actions"><span></span><button class="btn btn-primary" type="button" data-new-booking>Fazer outro agendamento</button></div></div></div></section></div>`;
}

function publicSchedule(establishment) {
  const data = getData(establishment);
  const employeeMode = usesEmployeeSchedules(establishment);
  const professionals = professionalDirectory(establishment);
  const schedules = professionals.map((professional) => {
    const times = employeeMode ? (professional.availableTimes || []) : (establishment.availableTimes || []);
    const busy = new Set((data.slots || []).filter((slot) => slot.id?.endsWith("_establishment") || slot.professional === professional.name).map((slot) => slot.time));
    const freeCount = times.filter((time) => !busy.has(time) && !slotHasPassed(state.booking.date, time)).length;
    const staffStatus = staffStatusFor(data, professional.name);
    const isToday = state.booking.date === isoDate();
    const paused = isToday && professionalIsPaused(data, professional.name, state.booking.date);
    const scheduleProfessional = { ...professional, availableTimes: times };
    const onShift = isToday && professionalIsOnShift(scheduleProfessional, state.booking.date);
    const savedCurrentTime = isToday && staffStatus.currentDate === state.booking.date ? staffStatus.currentTime : null;
    const currentTime = savedCurrentTime || (onShift ? currentProfessionalSlot(scheduleProfessional, state.booking.date) : null);
    const operationalLabel = !isToday
      ? `${freeCount} ${freeCount === 1 ? "livre" : "livres"}`
      : paused
        ? "Pausado"
        : onShift
          ? "Em Atendimento"
          : "Fora do expediente";
    const operationalClass = paused ? "paused" : onShift ? "in-service" : "off-shift";
    const buttons = times.map((time) => {
      const appointment = (data.slots || []).find((slot) => slot.date === state.booking.date && slot.time === time && (slot.id?.endsWith("_establishment") || slot.professional === professional.name));
      const status = ticketState({ date: state.booking.date, time, booked: busy.has(time), currentTime, paused, status: appointment?.status }, currentSaoPauloClock());
      if (status !== "free") return `<button class="schedule-slot ticket-state-${status}" type="button" disabled aria-label="${escapeHTML(time)} ${TICKET_STATES[status]}"><strong>${escapeHTML(time)}</strong><small>${TICKET_STATES[status]}</small></button>`;
      const selected = state.booking.step < 3 && state.booking.professional === professional.name && state.booking.time === time;
      return `<button class="schedule-slot available ticket-state-free ${selected ? "selected" : ""}" type="button" data-public-slot data-professional-name="${escapeHTML(professional.name)}" data-slot-time="${escapeHTML(time)}" aria-pressed="${selected}"><strong>${escapeHTML(time)}</strong><small>Livre${selected ? " · Selecionado" : ""}</small></button>`;
    }).join("");
    const headerAction = state.booking.time && state.booking.professional === professional.name && state.booking.step < 3
      ? `<button class="btn btn-primary btn-sm schedule-booking-button" type="button" data-booking-next aria-label="Agendar este horário: ${escapeHTML(state.booking.time)}">Agendar Este Horário</button>`
      : `<em class="professional-status ${operationalClass}">${operationalLabel}</em>`;
    return `<article class="public-professional-schedule"><header><span class="client-avatar">${initials(professional.name)}</span><div><strong>${escapeHTML(professional.name)}</strong><small>${escapeHTML(professional.role || "Profissional")}</small></div>${headerAction}</header><div class="public-slot-grid">${buttons || '<div class="schedule-empty">Nenhum horário configurado para esta data.</div>'}</div></article>`;
  }).join("");
  const controls = professionals.length > 1 ? `<div class="professional-carousel-controls"><span data-professional-carousel-position>1 de ${professionals.length}</span><button type="button" data-professional-carousel-prev aria-label="Profissional anterior">←</button><button type="button" data-professional-carousel-next aria-label="Próximo profissional">→</button></div>` : "";
  const otherDateValue = state.booking.dateMode === "other" ? state.booking.date : "";
  return `<div class="schedule-command-bar"><div class="schedule-date-toolbar"><div class="quick-dates"><button type="button" class="${state.booking.dateMode === "today" ? "active" : ""}" data-date-mode="today"><strong>Hoje</strong><small>${prettyDate(isoDate())}</small></button></div><label class="schedule-date-field"><span>Outra data</span><input type="date" min="${isoDate(1)}" value="${otherDateValue}" data-booking-date aria-label="Escolha outra data"></label></div>${ticketStatusLegend()}${controls}</div><div class="professional-carousel"><div class="public-schedules" data-professional-carousel>${schedules || '<div class="schedule-empty">Nenhum profissional disponível.</div>'}</div></div>`;
}

function navigateProfessionalCarousel(direction) {
  const carousel = document.querySelector("[data-professional-carousel]");
  const cards = [...(carousel?.querySelectorAll(".public-professional-schedule") || [])];
  if (!carousel || cards.length < 2) return;

  if (professionalScheduleTimer) {
    clearInterval(professionalScheduleTimer);
    professionalScheduleTimer = null;
  }

  const savedIndex = Number(carousel.dataset.carouselIndex);
  const visibleIndex = cards.reduce((best, card, index) =>
    Math.abs(card.getBoundingClientRect().left - carousel.getBoundingClientRect().left)
      < Math.abs(cards[best].getBoundingClientRect().left - carousel.getBoundingClientRect().left) ? index : best, 0);
  const currentIndex = carousel.dataset.carouselIndex === undefined ? visibleIndex : savedIndex;
  const nextIndex = (currentIndex + direction + cards.length) % cards.length;
  carousel.dataset.carouselIndex = String(nextIndex);
  carousel.scrollTo({ left: cards[nextIndex].offsetLeft - cards[0].offsetLeft, behavior: "smooth" });
  const position = document.querySelector("[data-professional-carousel-position]");
  if (position) position.textContent = `${nextIndex + 1} de ${cards.length}`;
}

function publicServiceCards(establishment) {
  return `<section class="public-services" id="servicos-agendamento"><div class="service-list">${establishment.services.map((item) => `<article class="service-card-display"><span class="service-icon">${item.icon}</span><span><strong>${escapeHTML(item.name)}</strong><small>${item.duration} minutos</small></span><span class="service-price">${item.price ? currency.format(item.price) : "Incluso"}</span></article>`).join("")}</div></section>`;
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

function updateProfessionalCarouselPosition() {
  const carousel = document.querySelector("[data-professional-carousel]");
  const label = document.querySelector("[data-professional-carousel-position]");
  if (!carousel || !label) return;
  const count = carousel.querySelectorAll(".public-professional-schedule").length;
  const index = Math.min(count - 1, Math.max(0, Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth))));
  label.textContent = `${index + 1} de ${count}`;
}

function moveProfessionalCarousel(direction = 1) {
  const carousel = document.querySelector("[data-professional-carousel]");
  if (!carousel) return;
  const cards = carousel.querySelectorAll(".public-professional-schedule");
  if (cards.length < 2) return;
  const current = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
  const next = (current + direction + cards.length) % cards.length;
  carousel.scrollTo({ left: next * carousel.clientWidth, behavior: "smooth" });
  setTimeout(updateProfessionalCarouselPosition, 350);
}

function startProfessionalCarousel() {
  clearInterval(professionalScheduleTimer);
  const carousel = document.querySelector("[data-professional-carousel]");
  if (!carousel || carousel.querySelectorAll(".public-professional-schedule").length < 2) return;
  const selectedCard = carousel.querySelector(".schedule-slot.selected")?.closest(".public-professional-schedule");
  if (selectedCard) {
    const cards = [...carousel.querySelectorAll(".public-professional-schedule")];
    carousel.scrollLeft = cards.indexOf(selectedCard) * carousel.clientWidth;
    updateProfessionalCarouselPosition();
  }
  carousel.addEventListener("scroll", updateProfessionalCarouselPosition, { passive: true });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  professionalScheduleTimer = setInterval(() => {
    if (!carousel.matches(":hover") && !carousel.contains(document.activeElement)) moveProfessionalCarousel(1);
  }, 5000);
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
        const canCheckIn = item.date === isoDate() && item.status === "confirmado";
        const isPresent = item.status === "presente";
        return `<article class="lookup-result checkin-result"><div><small>${prettyDate(item.date, true)}</small><strong>${escapeHTML(item.time)} · ${escapeHTML(item.service)}</strong><span>${escapeHTML(item.professional)}</span></div><div><em class="status ${escapeHTML(item.status || "confirmado")}">${escapeHTML(statusLabel(item.status))}</em>${canCheckIn ? `<button class="btn btn-primary btn-sm" type="button" data-start-checkin="${escapeHTML(item.appointmentId)}">Ler QR e confirmar</button>` : isPresent ? '<span class="presence-done">✓ Presença registrada</span>' : '<span class="presence-unavailable">Disponível no dia agendado</span>'}</div></article>`;
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
    await firebaseApi.confirmPresenceWithQr(establishment.slug, selected.appointmentId, token, selected.date, selected.presenceExists !== false);
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
  if (item?.ticketState === "paused") return item.professional;
  return item?.kind === "scheduled" ? `${item.time} · ${item.professional}` : (item?.servicePoint || "Fila avulsa");
}

function queueBadge(item, monitor = false) {
  if (item?.ticketState) return `<span class="ticket-status-label ticket-state-${item.ticketState}">${TICKET_STATES[item.ticketState]}</span>`;
  if (item?.kind === "scheduled" && !item.service) return `<span class="${monitor ? "monitor-normal" : "normal-badge"}">Serviço indefinido</span>`;
  if (item?.kind === "scheduled") return `<span class="${monitor ? "monitor-scheduled" : "scheduled-badge"}">Agendado</span>`;
  if (item?.priority === "preferencial") return `<span class="${monitor ? "monitor-priority" : "priority-badge"}">Preferencial</span>`;
  return `<span class="${monitor ? "monitor-normal" : "normal-badge"}">Avulso</span>`;
}

function currentTicketCards(current, showNames = false, monitor = false) {
  return `<div class="current-ticket-list">${current.map((item) => `<article class="current-ticket-card ticket-state-${item.ticketState}"><strong>${escapeHTML(item.ticketState === "paused" ? TICKET_STATES.paused : item.ticket)}</strong><span class="current-ticket-detail">${escapeHTML(queueDetail(item))}</span>${showNames && item.ticketState === "in-service" && item.client ? `<span class="queue-customer">${escapeHTML(item.client)}</span>` : ""}</article>`).join("") || '<p class="current-ticket-empty">Nenhum profissional cadastrado</p>'}</div>`;
}

function ticketStatusLegend() {
  return `<div class="ticket-status-legend" aria-label="Legenda dos status das senhas">${Object.entries(TICKET_STATES).map(([state, label]) => `<span class="ticket-state-${state}"><i aria-hidden="true"></i>${label}</span>`).join("")}</div>`;
}

function queuePanel(establishment, data, showNames = true, showHeader = true) {
  const { current } = queueView(establishment, data, currentSaoPauloClock());
  return `<section class="panel queue-panel">${showHeader ? '<div class="panel-head queue-panel-head"><div><h2>Painel de senhas</h2><p>Uma senha por profissional, no horário atual</p></div><div class="queue-head-actions"><span class="open-tag">AO VIVO</span><button class="btn btn-soft btn-sm" data-open-queue-display>⛶ Exibir no monitor</button></div></div>' : ""}
    <div class="queue-board"><div class="queue-current"><small>Atendendo agora</small>${currentTicketCards(current, showNames)}</div>
    </div></section>`;
}

function ticketLegend(establishment) {
  const professionals = professionalDirectory(establishment).map((item) => `<span><b>${escapeHTML(professionalInitial(item.name))}</b> ${escapeHTML(item.name)}</span>`).join("");
  const services = (establishment.services || []).map((item) => `<span><b>${escapeHTML(serviceInitials(item.name))}</b> ${escapeHTML(item.name)}</span>`).join("");
  return `<section class="ticket-legend" aria-label="Legenda das senhas"><h3>Como ler as senhas</h3>${ticketStatusLegend()}<p class="ticket-legend-example"><strong>RCT-08</strong><span><b>R</b>: inicial do profissional · <b>CT</b>: iniciais do serviço · <b>08</b>: 8º horário na agenda do profissional naquele dia.</span></p><p>Exemplos de serviço: <b>CT</b> = Cabelo Tesoura, <b>CM</b> = Cabelo Máquina, <b>CC</b> = Cabelo Completo, <b>SI</b> = Serviço indefinido (sem serviço registrado para o horário).</p><div class="ticket-legend-group"><h4>Profissionais</h4><div>${professionals}</div></div><div class="ticket-legend-group"><h4>Serviços</h4><div>${services}</div></div><p>A contagem começa em 01 e inclui os horários ocupados e os que já passaram. Na agenda compartilhada, usa a grade do estabelecimento. Somente horários da grade cadastrada geram senhas no painel.</p></section>`;
}

function publicQueueModal(establishment, data) {
  if (!state.queueModalOpen) return "";
  return `<div class="booking-modal-backdrop" data-public-queue-backdrop><section class="booking-modal public-queue-modal" role="dialog" aria-modal="true" aria-labelledby="public-queue-modal-title"><div class="booking-modal-head"><div><small>ATUALIZAÇÃO EM TEMPO REAL</small><h2 id="public-queue-modal-title">Painel de Senhas</h2></div><button class="booking-modal-close" type="button" data-close-public-queue aria-label="Fechar painel de senhas">×</button></div><div class="public-queue-modal-body">${queuePanel(establishment, data, false, false)}</div></section></div>`;
}

function ensureQueueSubscription(establishment) {
  if (!firebaseApi || queueSubscriptionSlug === establishment.slug) return;
  if (queueSubscription) queueSubscription();
  queueSubscriptionSlug = establishment.slug;
  queueSubscription = firebaseApi.observePublicState(establishment.slug, (live) => {
    const prefix = `public:${establishment.slug}:`;
    const keys = [...cloudCache.keys()].filter((key) => key.startsWith(prefix));
    if (!keys.length) keys.push(publicCacheKey(establishment, isoDate()));
    for (const key of keys) {
      const cached = cloudCache.get(key) || { appointments: [], slots: [], todayAppointments: 0 };
      cloudCache.set(key, { ...cached, ...live });
    }
    const params = new URLSearchParams(location.search);
    if (route() === establishment.slug && (params.get("display") === "queue" || params.get("public") === "1" || session()?.slug !== establishment.slug)) render();
  });
}

function professionalAvailability(establishment, data, date = isoDate()) {
  const slots = data.slots || [];
  return professionalDirectory(establishment).map((professional) => ({
    ...professional,
    freeTimes: (professional.availableTimes || []).filter((time) =>
      !slotHasPassed(date, time) && !slots.some((slot) => slot.time === time && (slot.id?.endsWith("_establishment") || slot.professional === professional.name))
    ),
  }));
}

function availableTimesFor(establishment, data, date = isoDate()) {
  if (!usesEmployeeSchedules(establishment)) {
    const busy = new Set((data.slots || []).map((slot) => slot.time));
    return (establishment.availableTimes || []).filter((time) => !slotHasPassed(date, time) && !busy.has(time));
  }
  return [...new Set(professionalAvailability(establishment, data, date).flatMap((professional) => professional.freeTimes))].sort();
}

function staffSchedulesMarkup(establishment, data) {
  if (!usesEmployeeSchedules(establishment)) {
    const freeTimes = availableTimesFor(establishment, data);
    return `<section class="staff-schedule"><div class="staff-schedule-head"><span class="client-avatar">EST</span><span><strong>Agenda do estabelecimento</strong><small>Grade compartilhada · ${freeTimes.length} livres</small></span></div><div class="staff-time-list">${freeTimes.length ? freeTimes.map((time) => `<span class="free-slot">${time}</span>`).join("") : '<span class="staff-full">Agenda preenchida</span>'}</div></section>`;
  }
  return professionalAvailability(establishment, data).map((professional) => {
    const staffStatus = staffStatusFor(data, professional.name);
    const current = data.appointments.find((item) => item.professional === professional.name && item.status === "atendendo");
    const paused = professionalIsPaused(data, professional.name);
    const onShift = professionalIsOnShift(professional);
    const label = paused ? "Pausado" : onShift ? `Em Atendimento${current ? ` · ${current.time}` : ""}` : "Fora do expediente";
    const statusClass = paused ? "paused" : onShift ? "in-service" : "off-shift";
    return `<section class="staff-schedule"><div class="staff-schedule-head"><span class="client-avatar">${initials(professional.name)}</span><span class="staff-schedule-person"><strong>${escapeHTML(professional.name)}</strong><small>${escapeHTML(professional.role || "Profissional")} · ${professional.freeTimes.length} livres</small></span><span class="staff-operational-status ${statusClass}">${escapeHTML(label)}</span></div><button class="staff-pause-button ${paused ? "resume" : ""}" type="button" data-toggle-professional-pause data-professional-name="${escapeHTML(professional.name)}" data-paused="${paused}">${paused ? "Retomar atendimento" : "Pausar atendimento"}</button><div class="staff-time-list">${professional.freeTimes.length ? professional.freeTimes.map((time) => `<span class="free-slot">${time}</span>`).join("") : '<span class="staff-full">Agenda preenchida</span>'}</div></section>`;
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
    return (key.includes("seg") || key.includes("segunda")) && (key.includes("sex") || key.includes("sexta"));
  });
  const weekdays = ["segunda", "terca", "quarta", "quinta", "sexta"]
    .map((day) => hours.find((item) => labelKey(item.label).startsWith(day)))
    .filter(Boolean);
  const weekdayValue = weekdayGroup?.value || weekdays[0]?.value || "";
  const saturday = hours.find((item) => labelKey(item.label).startsWith("sab"));
  const parts = [
    weekdayValue ? `<span><strong>Seg a sex</strong> ${escapeHTML(range(weekdayValue))}</span>` : "",
    saturday?.value ? `<span><strong>Sáb</strong> ${escapeHTML(range(saturday.value))}</span>` : "",
  ].filter(Boolean);
  return parts.join('<i aria-hidden="true">•</i>') || `<span>${escapeHTML(establishment.todayHours || "Consulte o funcionamento")}</span>`;
}

function renderEstablishmentPublic(establishment) {
  document.title = `${establishment.name} — Agendae`;
  if (new URLSearchParams(location.search).has("checkin")) state.publicLookup.open = true;
  const data = getData(establishment);
  const scheduleQueue = queueView(establishment, data, currentSaoPauloClock());
  const authenticated = session()?.slug === establishment.slug;
  app.innerHTML = `<div class="est-page">
    <header class="est-topbar"><div class="est-topbar-inner"><div class="est-topbar-identity"><a href="${href("/")}" data-link>${logo()}</a><span class="est-header-divider"></span><div class="est-header-business"><strong>${escapeHTML(establishment.name)}</strong><small>${escapeHTML(establishment.address)}</small></div></div><div class="est-header-actions"><button class="btn btn-yellow btn-sm" type="button" data-open-checkin>✓ Confirmar presença</button>${authenticated ? `<a class="btn btn-primary btn-sm" href="${href(`/${establishment.slug}`)}" data-link>Voltar ao painel</a>` : '<button class="btn btn-primary btn-sm" type="button" data-open-employee-access>Área do estabelecimento</button>'}</div></div></header>
    <section class="public-live-strip"><div class="public-live-inner"><article class="public-live-card public-live-current"><span class="live-dot"></span><div><small>Atendendo agora</small>${currentTicketCards(scheduleQueue.current)}</div></article><button class="btn btn-yellow btn-sm public-queue-button" type="button" data-open-public-queue>Painel de Senhas</button></div></section>
    <main class="est-content public-direct-content"><section class="booking-zone" id="agendar"><div class="public-agenda-layout"><section class="panel public-schedule-panel"><div class="public-schedule-body">${publicSchedule(establishment)}</div></section><aside class="public-agenda-side"><section class="panel public-services-panel"><div class="panel-head compact-panel-head"><div><h2>Serviços</h2><div class="compact-business-hours">${compactBusinessHours(establishment)}</div></div></div>${publicServiceCards(establishment)}</section></aside></div></section></main>
    ${state.booking.step > 1 ? bookingContent(establishment) : ""}
    ${publicCheckInModal()}${publicQueueModal(establishment, data)}${employeeAccessModal(establishment)}</div>`;
  requestAnimationFrame(() => {
    startServiceCarousel();
    startProfessionalCarousel();
    if (state.publicLookup.scanning) void startQrScanner();
  });
  void refreshCloudData(establishment, "public", state.booking.date);
  ensureQueueSubscription(establishment);
  startQueueClock(establishment);
}

function appointmentRows(data, query = state.appointmentQuery) {
  const establishment = activeEstablishment();
  const todayAppointments = data.appointments.filter((item) => item.date === isoDate()).sort((a,b) => a.time.localeCompare(b.time));
  const normalizedQuery = normalizedSearch(query);
  const appointments = normalizedQuery
    ? todayAppointments.filter((item) => normalizedSearch(item.client).includes(normalizedQuery) || String(item.checkInCode || "").toLowerCase() === normalizedQuery.replace(/\s/g, "") || scheduledTicket(establishment, item.time, item.professional, item.service).toLowerCase() === normalizedQuery)
    : todayAppointments;
  if (!todayAppointments.length) return '<div class="empty">Nenhum atendimento marcado para hoje.</div>';
  if (!appointments.length) return `<div class="empty">Nenhum agendamento encontrado para <strong>${escapeHTML(query.trim())}</strong>.</div>`;
  return appointments.map((item) => {
    const paused = professionalIsPaused(data, item.professional);
    const action = item.status === "confirmado"
      ? `<button class="btn btn-soft btn-sm" type="button" data-confirm-presence="${escapeHTML(item.id)}">Confirmar chegada</button>`
      : item.status === "presente" && paused
        ? '<span class="appointment-paused">Em pausa</span>'
        : item.status === "presente"
          ? `<button class="btn btn-soft btn-sm" type="button" data-start-appointment="${escapeHTML(item.id)}" data-professional-name="${escapeHTML(item.professional)}">Iniciar</button>`
          : item.status === "atendendo"
            ? `<button class="btn btn-primary btn-sm" type="button" data-complete-appointment="${escapeHTML(item.id)}" data-professional-name="${escapeHTML(item.professional)}">Encerrar</button>`
            : item.status === "concluido" ? '<span>✓ Finalizado</span>' : "";
    return `<div class="appointment-row"><span class="appt-time">${item.time}</span><span class="client"><span class="client-avatar">${initials(item.client)}</span><span><strong>${escapeHTML(item.client)}</strong><small>${escapeHTML(item.service)} · Painel ${escapeHTML(scheduledTicket(establishment, item.time, item.professional, item.service))}${item.checkInCode ? ` · Presença ${escapeHTML(item.checkInCode)}` : ""}</small></span></span><span class="professional">${escapeHTML(item.professional)}</span><span class="status ${escapeHTML(item.status)}">${escapeHTML(statusLabel(item.status))}</span><span class="appointment-presence-action">${action}</span></div>`;
  }).join("");
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
    cloudCache.delete(`admin:${establishment.slug}`);
    void refreshCloudData(establishment, "admin");
  }, 10000);
}

function updateMonitorClock() {
  const target = document.querySelector("[data-monitor-clock]");
  if (target) target.textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
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
    const { current } = queueView(establishment, data, currentSaoPauloClock());
    const currentList = document.querySelector(".public-live-current .current-ticket-list");
    if (currentList) currentList.outerHTML = currentTicketCards(current);
    const modalPanel = document.querySelector(".public-queue-modal .queue-panel");
    if (modalPanel) modalPanel.outerHTML = queuePanel(establishment, data, false, false);
    const schedule = document.querySelector(".public-schedule-body");
    if (schedule) { schedule.innerHTML = publicSchedule(establishment); startProfessionalCarousel(); }
  }, 1000);
}

function renderQueueDisplay(establishment) {
  document.title = `Painel de senhas · ${establishment.name}`;
  const data = cloudCache.get(publicCacheKey(establishment, isoDate())) || { queue: [], slots: [], todayAppointments: 0 };
  const { current } = queueView(establishment, data, currentSaoPauloClock());
  app.innerHTML = `<main class="queue-display"><header class="queue-display-header"><div class="queue-display-brand">${logo()}<span>${escapeHTML(establishment.name)}</span></div><div class="queue-display-status"><span class="live-dot"></span> AO VIVO <strong data-monitor-clock></strong></div></header>
    <section class="queue-display-content"><div class="queue-display-current"><small>ATENDENDO AGORA</small>${currentTicketCards(current, false, true)}</div>
    <footer class="queue-display-footer"><span>Acompanhe a ordem e aguarde sua senha ser chamada.</span><div><button class="monitor-action" data-request-fullscreen>⛶ Tela cheia</button><a class="monitor-action" href="${href(`/${establishment.slug}?public=1#painel-senhas`)}" data-link>Fechar painel</a></div></footer></main>`;
  updateMonitorClock();
  startQueueClock(establishment, true);
  void refreshCloudData(establishment, "public", isoDate());
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
  clearInterval(adminRefreshTimer);
  adminRefreshTimer = null;
  clearInterval(monitorClockTimer);
  monitorClockTimer = null;
  clearInterval(serviceCarouselTimer);
  serviceCarouselTimer = null;
  clearInterval(professionalScheduleTimer);
  professionalScheduleTimer = null;
  const current = route();
  if (current === "home") return renderHome();
  if (current === "login") return renderLogin();
  if (!catalogLoaded) return renderLoading();
  const establishment = establishments[current];
  if (!establishment) return renderNotFound();
  const routeParams = new URLSearchParams(location.search);
  if (routeParams.get("display") === "queue") return renderQueueDisplay(establishment);
  const authenticated = session()?.slug === establishment.slug;
  if (routeParams.get("display") === "checkin" && authenticated) return renderCheckInDisplay(establishment);
  const publicPreview = routeParams.get("public") === "1" || routeParams.has("checkin");
  if (authenticated && !publicPreview) renderAdmin(establishment);
  else renderEstablishmentPublic(establishment);
}

function activeEstablishment() {
  return establishments[route()];
}

document.addEventListener("click", async (event) => {
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
  if (event.target.closest("[data-service-carousel-prev]")) { moveServiceCarousel(-1); return; }
  if (event.target.closest("[data-service-carousel-next]")) { moveServiceCarousel(1); return; }
  if (event.target.closest("[data-professional-carousel-prev]")) { navigateProfessionalCarousel(-1); return; }
  if (event.target.closest("[data-professional-carousel-next]")) { navigateProfessionalCarousel(1); return; }
  const publicSlot = event.target.closest("[data-public-slot]");
  if (publicSlot) {
    state.booking.professional = publicSlot.dataset.professionalName;
    state.booking.time = publicSlot.dataset.slotTime;
    state.booking.step = 1;
    state.booking.confirmation = null;
    render();
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
    state.booking.dateMode = "today";
    state.booking.date = isoDate();
    state.booking.time = null;
    const establishment = activeEstablishment();
    if (establishment) cloudCache.delete(publicCacheKey(establishment));
    render();
    return;
  }
  const time = event.target.closest("[data-time]");
  if (time) { state.booking.time = time.dataset.time; render(); return; }
  if (event.target.closest("[data-booking-next]")) {
    event.preventDefault();
    state.booking.step = 2;
    render();
    requestAnimationFrame(() => document.querySelector("[data-booking-service]")?.focus());
    return;
  }
  if (event.target.closest("[data-booking-back]") || event.target.matches("[data-booking-modal-backdrop]")) { event.preventDefault(); state.booking.step = 1; render(); return; }
  if (event.target.closest("[data-new-booking]")) { state.booking = freshBooking(); render(); return; }
  if (event.target.closest("[data-open-public-queue]")) {
    state.queueModalOpen = true;
    render();
    return;
  }
  if (event.target.closest("[data-close-public-queue]") || event.target.matches("[data-public-queue-backdrop]")) {
    state.queueModalOpen = false;
    render();
    return;
  }
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
    if (establishment) navigate(`/${establishment.slug}?display=queue`);
    return;
  }
  if (event.target.closest("[data-request-fullscreen]")) {
    try { await document.documentElement.requestFullscreen(); } catch { toast("O navegador não permitiu abrir a tela cheia.", "!"); }
    return;
  }
  if (event.target.closest("[data-print-checkin]")) { window.print(); return; }
  if (event.target.closest("[data-logout]")) {
    try { if (firebaseApi) await firebaseApi.logout(); } catch { /* a interface encerra mesmo sem rede */ }
    firebaseSession = null;
    cloudCache.clear();
    state.booking = freshBooking();
    navigate("/login");
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
    const professional = professionalDirectory(establishment).find((item) => item.name === professionalName);
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
    const professional = professionalDirectory(establishment).find((item) => item.name === professionalName);
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
      const professional = professionalDirectory(establishment).find((item) => item.name === appointment?.professional);
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
  if (event.target.matches("[data-booking-date]")) {
    const selectedDate = event.target.value;
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? new Date(`${selectedDate}T12:00:00`) : null;
    const validDate = parsedDate && !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === selectedDate && selectedDate > isoDate();
    if (!validDate) {
      event.target.value = "";
      toast("Escolha uma data válida a partir de amanhã.", "!");
      return;
    }
    state.booking.date = selectedDate;
    state.booking.dateMode = "other";
    state.booking.time = null;
    const establishment = activeEstablishment();
    if (establishment) cloudCache.delete(publicCacheKey(establishment));
    render();
  }
  if (event.target.matches("[data-professional]")) { state.booking.professional = event.target.value; state.booking.time = null; render(); }
  if (event.target.matches("[data-booking-service]")) state.booking.serviceId = event.target.value;
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
    if (!firebaseApi) return toast("O serviço de acesso ainda não respondeu. Tente novamente em instantes.", "!");
    const form = new FormData(event.target);
    const establishmentSlug = String(form.get("establishment") || "");
    const employeeLogin = normalizedLogin(form.get("login"));
    if (!establishments[establishmentSlug]) return toast("Selecione um estabelecimento válido.", "!");
    if (!employeeLogin) return toast("Digite um login válido.", "!");
    const internalEmail = `${establishmentSlug}-${employeeLogin}@agendae.com.br`;
    const legacyEmail = `${employeeLogin}@agendae.com.br`;
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Entrando…";
    authFlowInProgress = true;
    try {
      firebaseSession = await firebaseApi.login(
        internalEmail,
        form.get("password"),
        form.get("remember") === "on",
        legacyEmail,
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
      toast(`Login realizado. Bem-vindo, ${firebaseSession.name.split(" ")[0]}!`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Entrar no painel";
      toast(firebaseApi.firebaseErrorMessage(error), "!");
    } finally {
      authFlowInProgress = false;
    }
    return;
  }
  if (event.target.id === "booking-form") {
    const establishment = activeEstablishment();
    if (!establishment) return;
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
    state.booking.serviceId = selectedServiceId;
    const appointment = { id: crypto.randomUUID(), date: state.booking.date, time: state.booking.time, client: form.get("name").trim(), phone: form.get("phone").trim(), service: service.name, professional: state.booking.professional, status: "confirmado", checkInCode: generateCheckInCode() };
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
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.employeeAccessOpen) {
    state.employeeAccessOpen = false;
    render();
    return;
  }
  if (event.key === "Escape" && state.queueModalOpen) {
    state.queueModalOpen = false;
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
  if (event.key === "Escape" && state.booking.step === 2) {
    state.booking.step = 1;
    render();
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
      if (error) toast(firebaseApi.firebaseErrorMessage(error), "!");
      if (profile && route() === "login" && !authFlowInProgress) {
        const requestedSlug = new URLSearchParams(location.search).get("establishment");
        if (requestedSlug && requestedSlug !== profile.slug) {
          void firebaseApi.logout();
          return;
        }
        navigate(`/${profile.slug}`);
      } else render();
    });
    render();
  } catch (error) {
    console.error("Agendae: falha ao carregar o Firebase.", error);
    catalogLoaded = true;
    render();
      toast("Não foi possível carregar o sistema. Verifique sua conexão.", "!");
  }
}

await initializeFirebase();
