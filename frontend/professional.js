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
const cloudCache = new Map();
const cloudLoading = new Set();

let establishments = {};

const state = {
  booking: freshBooking(),
  appointmentQuery: "",
  publicLookup: { query: "", loading: false, searched: false, results: [] },
  mobileMenu: false,
};

function freshBooking() {
  return { step: 1, dateMode: "today", date: isoDate(0), serviceId: null, time: null, professional: "", confirmation: null };
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
  return `${BASE}${path === "/" ? "/" : path}`;
}

function navigate(path) {
  history.pushState(null, "", href(path));
  state.mobileMenu = false;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function route() {
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
  return cloud || { appointments: [], queue: [], slots: [], todayAppointments: 0 };
}

async function refreshCloudData(establishment, mode, date = isoDate()) {
  if (!firebaseApi) return;
  const key = mode === "admin" ? `admin:${establishment.slug}` : publicCacheKey(establishment, date);
  if (cloudLoading.has(key) || cloudCache.has(key)) return;
  cloudLoading.add(key);
  try {
    if (mode === "admin") {
      const remote = await firebaseApi.loadAdminData(establishment.slug, isoDate());
      cloudCache.set(key, { appointments: remote.appointments, queue: remote.queue, slots: remote.slots });
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

function progress(step) {
  return `<div class="booking-progress">${["Escolha", "Seus dados", "Confirmação"].map((label, index) => {
    const number = index + 1;
    const className = number < step ? "done" : number === step ? "active" : "";
    return `<div class="progress-step ${className}"><span class="progress-number">${number < step ? "✓" : number}</span><span>${label}</span></div>`;
  }).join("")}</div>`;
}

function bookingContent(establishment) {
  const booking = state.booking;
  const service = establishment.services.find((item) => item.id === booking.serviceId);

  if (booking.step === 1) return `${progress(1)}<div class="selected-slot-card"><span class="selected-slot-icon">✓</span><div><small>HORÁRIO SELECIONADO</small><strong>${prettyDate(booking.date, true)} · ${escapeHTML(booking.time)}</strong><span>${escapeHTML(booking.professional)}</span></div><button type="button" data-change-slot>Alterar</button></div><h2 class="booking-title">Escolha o serviço</h2><p class="booking-lead">Selecione o atendimento desejado para continuar.</p>
    <div class="service-grid">${establishment.services.map((item) => `<button type="button" class="service-btn ${booking.serviceId === item.id ? "selected" : ""}" data-service="${item.id}"><span class="service-icon">${item.icon}</span><span><strong>${item.name}</strong><small>${item.duration} minutos</small></span><span class="service-price">${item.price ? currency.format(item.price) : "Incluso"}</span></button>`).join("")}</div>
    <div class="booking-actions"><button class="btn btn-outline" type="button" data-change-slot>Escolher outro horário</button><button class="btn btn-primary" type="button" data-booking-next ${service ? "" : "disabled"}>Continuar →</button></div>`;

  if (booking.step === 2) return `<div class="booking-modal-backdrop" data-booking-modal-backdrop>
    <section class="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-modal-title">
      <div class="booking-modal-head"><div><small>FINALIZAR AGENDAMENTO</small><h2 id="booking-modal-title">Seus dados e confirmação</h2></div><button class="booking-modal-close" type="button" data-booking-back aria-label="Fechar janela">×</button></div>
      <form id="booking-form" class="booking-modal-form">
        <p class="booking-modal-lead">Confira os dados escolhidos abaixo e informe seu nome para confirmar.</p>
        <div class="mini-field-grid"><div class="field full"><label for="customer-name">Nome completo</label><input id="customer-name" name="name" type="text" autocomplete="name" required placeholder="Digite seu nome"></div><div class="field full"><label for="customer-phone">Telefone <span class="optional-label">(opcional)</span></label><input id="customer-phone" name="phone" type="tel" autocomplete="tel" placeholder="(00) 00000-0000"></div></div>
        <div class="confirmation-data booking-review"><div class="confirmation-row"><span>Serviço</span><strong>${escapeHTML(service.name)}</strong></div><div class="confirmation-row"><span>Data</span><strong>${prettyDate(booking.date, true)}</strong></div><div class="confirmation-row"><span>Horário</span><strong>${escapeHTML(booking.time)}</strong></div><div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(booking.professional)}</strong></div></div>
        <div class="booking-actions"><button class="btn btn-outline" type="button" data-booking-back>Voltar</button><button class="btn btn-yellow" type="submit">Confirmar agendamento</button></div>
      </form>
    </section>
  </div>`;

  const item = booking.confirmation;
  return `${progress(3)}<div class="confirmation"><div class="confirmation-icon">✓</div><h2 class="booking-title">Agendamento confirmado</h2><p class="booking-lead">Seu horário na ${establishment.name} está reservado.</p><div class="confirmation-data"><div class="confirmation-row"><span>Serviço</span><strong>${escapeHTML(item.service)}</strong></div><div class="confirmation-row"><span>Data</span><strong>${prettyDate(item.date, true)}</strong></div><div class="confirmation-row"><span>Horário</span><strong>${item.time}</strong></div><div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(item.professional)}</strong></div></div><div class="booking-actions"><span></span><button class="btn btn-primary" data-new-booking>Fazer outro agendamento</button></div></div>`;
}

function publicSchedule(establishment) {
  const data = getData(establishment);
  const employeeMode = usesEmployeeSchedules(establishment);
  const professionals = professionalDirectory(establishment);
  const schedules = professionals.map((professional) => {
    const times = employeeMode ? (professional.availableTimes || []) : (establishment.availableTimes || []);
    const busy = new Set((data.slots || []).filter((slot) => slot.id?.endsWith("_establishment") || slot.professional === professional.name).map((slot) => slot.time));
    const freeCount = times.filter((time) => !busy.has(time)).length;
    const buttons = times.map((time) => busy.has(time)
      ? `<button class="schedule-slot occupied" type="button" disabled aria-label="${escapeHTML(time)} ocupado"><strong>${escapeHTML(time)}</strong><small>Ocupado</small></button>`
      : `<button class="schedule-slot available ${state.booking.professional === professional.name && state.booking.time === time ? "selected" : ""}" type="button" data-public-slot data-professional-name="${escapeHTML(professional.name)}" data-slot-time="${escapeHTML(time)}"><strong>${escapeHTML(time)}</strong><small>Disponível</small></button>`
    ).join("");
    return `<article class="public-professional-schedule"><header><span class="client-avatar">${initials(professional.name)}</span><div><strong>${escapeHTML(professional.name)}</strong><small>${escapeHTML(professional.role || "Profissional")}</small></div><em>${freeCount} ${freeCount === 1 ? "livre" : "livres"}</em></header><div class="public-slot-grid">${buttons || '<div class="schedule-empty">Nenhum horário configurado para esta data.</div>'}</div></article>`;
  }).join("");
  return `<div class="schedule-date-toolbar"><div class="quick-dates"><button type="button" class="${state.booking.dateMode === "today" ? "active" : ""}" data-date-mode="today"><strong>Hoje</strong><small>${prettyDate(isoDate())}</small></button><button type="button" class="${state.booking.dateMode === "tomorrow" ? "active" : ""}" data-date-mode="tomorrow"><strong>Amanhã</strong><small>${prettyDate(isoDate(1))}</small></button></div><label class="schedule-date-field"><span>Outra data</span><input type="date" min="${isoDate()}" value="${state.booking.date}" data-booking-date></label></div><div class="schedule-legend"><span><i class="available"></i>Disponível para agendar</span><span><i class="occupied"></i>Horário ocupado</span></div><div class="public-schedules">${schedules || '<div class="schedule-empty">Nenhum profissional disponível.</div>'}</div>`;
}

function publicAppointmentLookup() {
  const lookup = state.publicLookup;
  const results = lookup.loading
    ? '<div class="lookup-message">Buscando seu agendamento…</div>'
    : lookup.searched && !lookup.results.length
      ? '<div class="lookup-message">Nenhum agendamento foi encontrado com esse nome completo.</div>'
      : lookup.results.map((item) => `<article class="lookup-result"><div><small>${prettyDate(item.date, true)}</small><strong>${escapeHTML(item.time)} · ${escapeHTML(item.service)}</strong></div><div><span>${escapeHTML(item.professional)}</span><em>${escapeHTML(item.status || "confirmado")}</em></div></article>`).join("");
  return `<div class="public-lookup-panel" id="consultar-agendamento"><h2 class="booking-title">Consultar meu agendamento</h2><p class="booking-lead">Digite exatamente o nome completo informado na reserva. Você não precisa iniciar um novo agendamento.</p><form id="public-appointment-search-form"><label for="public-appointment-name">Nome completo</label><div class="public-lookup-field"><input id="public-appointment-name" name="client" type="text" value="${escapeHTML(lookup.query)}" autocomplete="name" required placeholder="Digite seu nome completo"><button class="btn btn-primary" type="submit" ${lookup.loading ? "disabled" : ""}>${lookup.loading ? "Pesquisando…" : "Pesquisar agendamento"}</button></div></form><div class="public-lookup-results" aria-live="polite">${results}</div></div>`;
}

function queuePanel(data, showNames = true) {
  const current = data.queue.find((item) => item.status === "atendendo");
  const waiting = data.queue.filter((item) => item.status === "aguardando");
  const priorityBadge = (item) => item?.priority === "preferencial" ? '<span class="priority-badge">Preferencial</span>' : '<span class="normal-badge">Normal</span>';
  return `<section class="panel queue-panel"><div class="panel-head queue-panel-head"><div><h2>Painel de senhas</h2><p>Ordem de atendimento atualizada em tempo real</p></div><div class="queue-head-actions"><span class="open-tag">AO VIVO</span><button class="btn btn-soft btn-sm" data-open-queue-display>⛶ Exibir no monitor</button></div></div>
    <div class="queue-board"><div class="queue-current"><small>Atendendo agora</small><strong>${escapeHTML(current?.ticket || "—")}</strong><div class="service-point">${current ? escapeHTML(current.servicePoint || "Atendimento") : "Fila livre"}</div>${current ? priorityBadge(current) : ""}${showNames && current?.name ? `<span class="queue-customer">${escapeHTML(current.name)}</span>` : ""}</div>
    <div class="queue-next"><div class="queue-list-title"><strong>Próximas senhas</strong><span>${waiting.length} aguardando</span></div><div class="queue-list">${waiting.slice(0,6).map((item,index) => `<div class="queue-row"><span class="queue-position">${index + 1}º</span><span class="ticket">${escapeHTML(item.ticket)}</span><span class="queue-row-info"><strong>${showNames ? escapeHTML(item.name || "Cliente") : "Aguardando"}</strong>${priorityBadge(item)}</span><small>${index === 0 ? "Próxima" : "Na fila"}</small></div>`).join("") || '<div class="empty">Ninguém aguardando.</div>'}</div></div></div></section>`;
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

function professionalAvailability(establishment, data) {
  const slots = data.slots || [];
  return professionalDirectory(establishment).map((professional) => ({
    ...professional,
    freeTimes: (professional.availableTimes || []).filter((time) =>
      !slots.some((slot) => slot.time === time && (slot.id?.endsWith("_establishment") || slot.professional === professional.name))
    ),
  }));
}

function availableTimesFor(establishment, data) {
  if (!usesEmployeeSchedules(establishment)) {
    const busy = new Set((data.slots || []).map((slot) => slot.time));
    return (establishment.availableTimes || []).filter((time) => !busy.has(time));
  }
  return [...new Set(professionalAvailability(establishment, data).flatMap((professional) => professional.freeTimes))].sort();
}

function staffSchedulesMarkup(establishment, data) {
  if (!usesEmployeeSchedules(establishment)) {
    const freeTimes = availableTimesFor(establishment, data);
    return `<section class="staff-schedule"><div class="staff-schedule-head"><span class="client-avatar">EST</span><span><strong>Agenda do estabelecimento</strong><small>Grade compartilhada · ${freeTimes.length} livres</small></span></div><div class="staff-time-list">${freeTimes.length ? freeTimes.map((time) => `<span class="free-slot">${time}</span>`).join("") : '<span class="staff-full">Agenda preenchida</span>'}</div></section>`;
  }
  return professionalAvailability(establishment, data).map((professional) => `<section class="staff-schedule"><div class="staff-schedule-head"><span class="client-avatar">${initials(professional.name)}</span><span><strong>${escapeHTML(professional.name)}</strong><small>${escapeHTML(professional.role || "Profissional")} · ${professional.freeTimes.length} livres</small></span></div><div class="staff-time-list">${professional.freeTimes.length ? professional.freeTimes.map((time) => `<span class="free-slot">${time}</span>`).join("") : '<span class="staff-full">Agenda preenchida</span>'}</div></section>`).join("");
}

function hoursMarkup(establishment) {
  return (establishment.hours || []).map((item, index) =>
    `<div class="hours-row ${index === 0 ? "today" : ""}"><span>${escapeHTML(item.label)}</span><${index === 0 ? "strong" : "span"}>${escapeHTML(item.value)}</${index === 0 ? "strong" : "span"}></div>`
  ).join("");
}

function renderEstablishmentPublic(establishment) {
  document.title = `${establishment.name} — Agendae`;
  const data = getData(establishment);
  const todayAppointments = data.appointments.filter((item) => item.date === isoDate());
  const todayCount = Number.isFinite(data.todayAppointments) ? data.todayAppointments : todayAppointments.length;
  const freeTimes = availableTimesFor(establishment, data);
  const nextFree = freeTimes[0] || "—";
  const authenticated = session()?.slug === establishment.slug;
  app.innerHTML = `<div class="est-page">
    <header class="est-topbar"><div class="est-topbar-inner"><a href="${href("/")}" data-link>${logo()}</a><div class="est-header-actions">${authenticated ? `<a class="btn btn-primary btn-sm" href="${href(`/${establishment.slug}`)}" data-link>Voltar ao painel</a>` : `<a class="btn btn-primary btn-sm" href="${href(`/login?establishment=${establishment.slug}`)}" data-link>Área do estabelecimento</a>`}</div></div></header>
    <section class="est-cover"><div class="est-cover-inner"><div class="est-identity"><div class="est-logo">${escapeHTML(establishment.initials)}</div><div><h1>${escapeHTML(establishment.name)}</h1><p>${escapeHTML(establishment.description)}</p><div class="est-facts"><span>⌖ ${escapeHTML(establishment.address)}</span><span>◷ ${escapeHTML(establishment.todayHours)}</span><span>● ${establishment.openNow ? "Aberto agora" : "Fechado"}</span></div></div></div><div class="live-ticket"><span class="live-dot"></span><span><small>Senha chamada agora</small><strong>${data.queue.find((item) => item.status === "atendendo")?.ticket || "—"}</strong></span></div></div></section>
    <main class="est-content"><div class="public-summary"><article class="summary-card"><small>Atendimentos hoje</small><strong>${String(todayCount).padStart(2,"0")}</strong><em>Agenda atualizada</em></article><article class="summary-card"><small>Próximo horário livre</small><strong>${nextFree}</strong><em>Disponível hoje</em></article><article class="summary-card"><small>Tempo médio de espera</small><strong>${establishment.averageWaitMinutes} min</strong><em>Fila em tempo real</em></article></div>
      <section class="booking-zone" id="agendar"><div class="zone-title"><span class="zone-number">01</span><div><small>AGENDAMENTOS</small><h2>Horários de atendimento</h2><p>Veja a agenda por profissional, escolha outra data ou consulte uma reserva.</p></div></div><div class="public-agenda-layout"><section class="panel public-schedule-panel"><div class="panel-head"><div><h2>Agenda de ${prettyDate(state.booking.date, true)}</h2><p>Selecione um horário livre para agendar</p></div></div><div class="public-schedule-body">${publicSchedule(establishment)}</div></section><aside class="public-agenda-side"><section class="panel public-lookup-card">${publicAppointmentLookup()}</section><section class="panel hours-panel"><div class="panel-head"><div><h2>Horário de funcionamento</h2><p>Atendimento presencial</p></div></div><div class="hours-body">${hoursMarkup(establishment)}</div></section></aside></div>${state.booking.time ? `<section class="panel booking-panel selected-booking-panel" id="novo-agendamento"><div class="panel-head"><div><h2>Agendar atendimento</h2><p>Complete os dados do horário selecionado</p></div></div><div class="booking-body">${bookingContent(establishment)}</div></section>` : ""}</section>
      <section class="queue-zone" id="painel-senhas"><div class="zone-title queue-zone-title"><span class="zone-number">02</span><div><small>FILA DE ATENDIMENTO</small><h2>Acompanhe sua senha</h2><p>Veja quem está sendo atendido e sua posição na fila.</p></div></div>${queuePanel(data, false)}</section></main>
  </div>`;
  void refreshCloudData(establishment, "public", state.booking.date);
  ensureQueueSubscription(establishment);
}

function appointmentRows(data, query = state.appointmentQuery) {
  const todayAppointments = data.appointments.filter((item) => item.date === isoDate()).sort((a,b) => a.time.localeCompare(b.time));
  const normalizedQuery = normalizedSearch(query);
  const appointments = normalizedQuery
    ? todayAppointments.filter((item) => normalizedSearch(item.client).includes(normalizedQuery))
    : todayAppointments;
  if (!todayAppointments.length) return '<div class="empty">Nenhum atendimento marcado para hoje.</div>';
  if (!appointments.length) return `<div class="empty">Nenhum agendamento encontrado para <strong>${escapeHTML(query.trim())}</strong>.</div>`;
  return appointments.map((item) => `<div class="appointment-row"><span class="appt-time">${item.time}</span><span class="client"><span class="client-avatar">${initials(item.client)}</span><span><strong>${escapeHTML(item.client)}</strong><small>${escapeHTML(item.service)}</small></span></span><span class="professional">${escapeHTML(item.professional)}</span><span class="status ${item.status}">${item.status[0].toUpperCase()+item.status.slice(1)}</span></div>`).join("");
}

function renderAdmin(establishment) {
  document.title = `Painel · ${establishment.name} — Agendae`;
  const data = getData(establishment);
  const today = data.appointments.filter((item) => item.date === isoDate());
  const waiting = data.queue.filter((item) => item.status === "aguardando").length;
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
      <section class="schedule-config"><div><small>MODELO DA AGENDA</small><h2>Como os horários são organizados?</h2><p>Essa configuração vale para todos os novos agendamentos.</p></div><div class="schedule-mode-options"><button class="schedule-mode ${usesEmployeeSchedules(establishment) ? "active" : ""}" data-schedule-mode="employee"><span>♙</span><strong>Agenda por funcionário</strong><small>Cada profissional tem seus próprios horários.</small></button><button class="schedule-mode ${!usesEmployeeSchedules(establishment) ? "active" : ""}" data-schedule-mode="establishment"><span>▣</span><strong>Agenda do estabelecimento</strong><small>Uma única grade compartilhada pela equipe.</small></button></div></section>
      <div class="admin-grid"><section class="panel"><div class="panel-head"><div><h2>Atendimentos de hoje</h2><p><span data-appointment-count>${today.length}</span> horários confirmados</p></div><button class="btn btn-soft btn-sm" data-coming>Ver agenda completa</button></div><div class="appointment-search"><span class="appointment-search-icon" aria-hidden="true">⌕</span><input type="search" value="${escapeHTML(state.appointmentQuery)}" data-appointment-search aria-label="Pesquisar agendamento pelo nome completo" placeholder="Pesquisar por nome completo"><button type="button" data-clear-appointment-search aria-label="Limpar pesquisa" ${state.appointmentQuery ? "" : "hidden"}>×</button></div><div class="appointment-list">${appointmentRows(data)}</div></section><div class="side-stack">${queuePanel(data)}<section class="panel staff-availability-panel"><div class="panel-head"><div><h2>${usesEmployeeSchedules(establishment) ? "Agenda por profissional" : "Agenda do estabelecimento"}</h2><p>${usesEmployeeSchedules(establishment) ? "Disponibilidade individual de hoje" : "Disponibilidade compartilhada de hoje"}</p></div></div><div class="staff-schedules">${staffSchedulesMarkup(establishment, data)}</div></section></div></div>
    </main></div>`;
  const queueSection = app.querySelector(".admin-grid .queue-panel");
  if (queueSection) queueSection.insertAdjacentHTML("beforeend", `<div class="queue-admin-actions"><button class="btn btn-soft btn-sm" data-add-ticket data-priority="normal">+ Senha normal</button><button class="btn btn-priority btn-sm" data-add-ticket data-priority="preferencial">+ Preferencial</button><button class="btn btn-primary btn-sm" data-next-ticket>Chamar próxima</button></div>`);
  void refreshCloudData(establishment, "admin");
}

function updateMonitorClock() {
  const target = document.querySelector("[data-monitor-clock]");
  if (target) target.textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}

function renderQueueDisplay(establishment) {
  document.title = `Painel de senhas · ${establishment.name}`;
  const data = cloudCache.get(publicCacheKey(establishment, isoDate())) || { queue: [], slots: [], todayAppointments: 0 };
  const current = data.queue.find((item) => item.status === "atendendo");
  const waiting = data.queue.filter((item) => item.status === "aguardando");
  const badge = (item) => item?.priority === "preferencial" ? '<span class="monitor-priority">Preferencial</span>' : '<span class="monitor-normal">Normal</span>';
  app.innerHTML = `<main class="queue-display"><header class="queue-display-header"><div class="queue-display-brand">${logo()}<span>${escapeHTML(establishment.name)}</span></div><div class="queue-display-status"><span class="live-dot"></span> AO VIVO <strong data-monitor-clock></strong></div></header>
    <section class="queue-display-content"><div class="queue-display-current"><small>SENHA EM ATENDIMENTO</small><strong>${escapeHTML(current?.ticket || "—")}</strong><div class="monitor-service-point"><span>Dirija-se para</span><b>${escapeHTML(current?.servicePoint || "Aguardando chamada")}</b></div>${current ? badge(current) : ""}</div>
    <aside class="queue-display-next"><div class="monitor-next-title"><span>Próximas senhas</span><b>${waiting.length} aguardando</b></div><div class="monitor-waiting-list">${waiting.slice(0,8).map((item, index) => `<div class="monitor-waiting-row"><span class="monitor-position">${index + 1}</span><strong>${escapeHTML(item.ticket)}</strong>${badge(item)}</div>`).join("") || '<div class="monitor-empty">Fila sem espera</div>'}</div></aside></section>
    <footer class="queue-display-footer"><span>Acompanhe a ordem e aguarde sua senha ser chamada.</span><div><button class="monitor-action" data-request-fullscreen>⛶ Tela cheia</button><a class="monitor-action" href="${href(`/${establishment.slug}?public=1#painel-senhas`)}" data-link>Fechar painel</a></div></footer></main>`;
  updateMonitorClock();
  clearInterval(monitorClockTimer);
  monitorClockTimer = setInterval(updateMonitorClock, 1000);
  void refreshCloudData(establishment, "public", isoDate());
  ensureQueueSubscription(establishment);
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
  clearInterval(monitorClockTimer);
  monitorClockTimer = null;
  const current = route();
  if (current === "home") return renderHome();
  if (current === "login") return renderLogin();
  if (!catalogLoaded) return renderLoading();
  const establishment = establishments[current];
  if (!establishment) return renderNotFound();
  if (new URLSearchParams(location.search).get("display") === "queue") return renderQueueDisplay(establishment);
  const authenticated = session()?.slug === establishment.slug;
  const publicPreview = new URLSearchParams(location.search).get("public") === "1";
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
    const path = `${url.pathname.replace(BASE, "")}${url.search}${url.hash}` || "/";
    navigate(path);
    return;
  }
  const open = event.target.closest("[data-open-establishment]");
  if (open) return navigate(`/${open.dataset.openEstablishment}`);
  const publicSlot = event.target.closest("[data-public-slot]");
  if (publicSlot) {
    state.booking.professional = publicSlot.dataset.professionalName;
    state.booking.time = publicSlot.dataset.slotTime;
    state.booking.step = 1;
    state.booking.confirmation = null;
    render();
    requestAnimationFrame(() => document.querySelector("#novo-agendamento")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (event.target.closest("[data-change-slot]")) { state.booking.time = null; state.booking.step = 1; render(); return; }
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
    state.booking.dateMode = mode.dataset.dateMode;
    state.booking.date = mode.dataset.dateMode === "today" ? isoDate() : isoDate(1);
    state.booking.time = null;
    const establishment = activeEstablishment();
    if (establishment) cloudCache.delete(publicCacheKey(establishment));
    render();
    return;
  }
  const service = event.target.closest("[data-service]");
  if (service) { state.booking.serviceId = service.dataset.service; render(); return; }
  const time = event.target.closest("[data-time]");
  if (time) { state.booking.time = time.dataset.time; render(); return; }
  if (event.target.closest("[data-booking-next]")) {
    event.preventDefault();
    state.booking.step = 2;
    render();
    requestAnimationFrame(() => document.querySelector("#customer-name")?.focus());
    return;
  }
  if (event.target.closest("[data-booking-back]") || event.target.matches("[data-booking-modal-backdrop]")) { event.preventDefault(); state.booking.step = 1; render(); return; }
  if (event.target.closest("[data-new-booking]")) { state.booking = freshBooking(); render(); return; }
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
  const addTicketButton = event.target.closest("[data-add-ticket]");
  if (addTicketButton) await addTicket(addTicketButton.dataset.priority || "normal");
  if (event.target.closest("[data-next-ticket]")) await callNext();
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-booking-date]")) {
    state.booking.date = event.target.value || isoDate(1);
    state.booking.dateMode = state.booking.date === isoDate() ? "today" : state.booking.date === isoDate(1) ? "tomorrow" : "other";
    state.booking.time = null;
    const establishment = activeEstablishment();
    if (establishment) cloudCache.delete(publicCacheKey(establishment));
    render();
  }
  if (event.target.matches("[data-professional]")) { state.booking.professional = event.target.value; state.booking.time = null; render(); }
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
    const fullName = String(new FormData(event.target).get("client") || "").trim();
    if (!establishment || normalizedSearch(fullName).split(" ").length < 2) return toast("Digite seu nome completo para consultar.", "!");
    state.publicLookup = { query: fullName, loading: true, searched: false, results: [] };
    render();
    try {
      const results = await firebaseApi.findPublicAppointments(establishment.slug, fullName);
      state.publicLookup = { query: fullName, loading: false, searched: true, results };
    } catch (error) {
      console.error("Agendae: falha ao consultar agendamento.", error);
      state.publicLookup = { query: fullName, loading: false, searched: false, results: [] };
      toast("Não foi possível consultar agora. Tente novamente.", "!");
    }
    render();
    requestAnimationFrame(() => document.querySelector("#consultar-agendamento")?.scrollIntoView({ behavior: "smooth", block: "center" }));
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
    const form = new FormData(event.target);
    const service = establishment.services.find((item) => item.id === state.booking.serviceId);
    const appointment = { id: crypto.randomUUID(), date: state.booking.date, time: state.booking.time, client: form.get("name").trim(), phone: form.get("phone").trim(), service: service.name, professional: state.booking.professional, status: "confirmado" };
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

async function addTicket(priority = "normal") {
  const establishment = activeEstablishment();
  const data = getData(establishment);
  const prefix = establishment.queuePrefix;
  const nextNumber = data.queue.reduce((max, item) => Math.max(max, Number(item.ticket.split("-")[1]) || 0), 0) + 1;
  const ticket = `${prefix}-${String(nextNumber).padStart(3,"0")}`;
  try {
    if (!firebaseApi || !session()) throw new Error("Sessão indisponível.");
    await firebaseApi.addQueueTicket(establishment.slug, ticket, "Cliente sem agendamento", priority, establishment.defaultServicePoint || "Atendimento");
  } catch (error) {
    toast(firebaseApi ? firebaseApi.firebaseErrorMessage(error) : "Entre novamente para alterar a fila.", "!");
    return;
  }
  cloudCache.delete(`admin:${establishment.slug}`);
  invalidatePublicCache(establishment.slug);
  toast(`Senha ${ticket}${priority === "preferencial" ? " preferencial" : ""} adicionada.`);
  render();
}

async function callNext() {
  const establishment = activeEstablishment();
  let remoteTicket;
  try {
    if (!firebaseApi || !session()) throw new Error("Sessão indisponível.");
    remoteTicket = await firebaseApi.callNextTicket(establishment.slug, establishment.defaultServicePoint || "Atendimento");
  } catch (error) {
    toast(firebaseApi ? firebaseApi.firebaseErrorMessage(error) : "Entre novamente para alterar a fila.", "!");
    return;
  }
  cloudCache.delete(`admin:${establishment.slug}`);
  invalidatePublicCache(establishment.slug);
  toast(remoteTicket ? `Senha ${remoteTicket} chamada.` : "Fila concluída.", remoteTicket ? "✓" : "○");
  render();
}

window.addEventListener("popstate", render);
document.addEventListener("keydown", (event) => {
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
