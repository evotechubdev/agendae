const BASE = location.hostname.endsWith("github.io") ? "/agendae" : "";
const app = document.querySelector("#app");
const toastArea = document.querySelector("#toast-region");
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
let firebaseApi = null;
let firebaseSession = null;
let firebaseConnected = false;
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
  app.innerHTML = `<main class="auth-page">
    <section class="auth-brand"><a href="${href("/")}" data-link>${logo()}</a><div class="auth-message"><h1>O controle do seu atendimento começa aqui.</h1><p>Acompanhe a agenda, veja os horários disponíveis e gerencie sua fila em tempo real.</p><div class="auth-points"><div class="auth-point"><span class="auth-check">✓</span>Dados exclusivos do seu estabelecimento</div><div class="auth-point"><span class="auth-check">✓</span>Agenda e senhas no mesmo painel</div><div class="auth-point"><span class="auth-check">✓</span>Acesso simples para toda a equipe</div></div></div></section>
    <section class="auth-panel"><div class="auth-form-wrap"><a class="back-home" href="${href("/")}" data-link>← Voltar para o início</a><h2>Bem-vindo de volta</h2><p>Entre com os dados do seu estabelecimento.</p>
      <form id="login-form"><div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required value="renam@agendae.com.br"></div><div class="field"><div class="password-line"><label for="password">Senha</label><a href="#" data-forgot>Esqueci minha senha</a></div><input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Digite sua senha"></div><button class="btn btn-primary btn-block" type="submit">Entrar no painel</button></form>
      <div class="demo-access"><strong>${firebaseConnected ? "Firebase conectado" : "Conectando ao Firebase"}</strong><br>Ative o provedor E-mail/senha e crie o usuário <b>renam@agendae.com.br</b> no Authentication.</div>
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
  const professionals = professionalDirectory(establishment);
  const employeeMode = usesEmployeeSchedules(establishment);
  const times = employeeMode
    ? (booking.professional ? scheduleFor(establishment, booking.professional) : [])
    : (establishment.availableTimes || []);
  const bookingData = getData(establishment);
  const busy = new Set(
    bookingData.slots
      ? bookingData.slots.filter((item) => !employeeMode || item.id?.endsWith("_establishment") || item.professional === booking.professional).map((item) => item.time)
      : bookingData.appointments
        .filter((item) => item.date === booking.date && item.professional === booking.professional)
        .map((item) => item.time)
  );

  if (booking.step === 1) return `${progress(1)}<h2 class="booking-title">Quando você quer ser atendido?</h2><p class="booking-lead">Escolha o dia, o serviço e um horário disponível.</p>
    <div class="date-choice"><button class="choice-btn ${booking.dateMode === "today" ? "selected" : ""}" data-date-mode="today"><span class="choice-radio"></span><span><strong>Agendar para hoje</strong><small>${prettyDate(isoDate())} · horários disponíveis</small></span></button><button class="choice-btn ${booking.dateMode === "other" ? "selected" : ""}" data-date-mode="other"><span class="choice-radio"></span><span><strong>Escolher outro dia</strong><small>Consulte os próximos dias</small></span></button></div>
    ${booking.dateMode === "other" ? `<div class="field"><label for="booking-date">Data do atendimento</label><input id="booking-date" type="date" min="${isoDate()}" value="${booking.date}" data-booking-date></div>` : ""}
    <div class="time-label">Selecione o serviço</div><div class="service-grid">${establishment.services.map((item) => `<button class="service-btn ${booking.serviceId === item.id ? "selected" : ""}" data-service="${item.id}"><span class="service-icon">${item.icon}</span><span><strong>${item.name}</strong><small>${item.duration} minutos</small></span><span class="service-price">${item.price ? currency.format(item.price) : "Incluso"}</span></button>`).join("")}</div>
    <div class="field" style="margin-top:20px"><label for="booking-professional">Quem vai atender você?</label><select id="booking-professional" data-professional><option value="">Selecione um profissional</option>${professionals.map((professional) => `<option value="${escapeHTML(professional.name)}" ${booking.professional === professional.name ? "selected" : ""}>${escapeHTML(professional.name)}${professional.role ? ` · ${escapeHTML(professional.role)}` : ""}</option>`).join("")}</select></div>
    <div class="time-label">${employeeMode ? `Horários de ${booking.professional ? escapeHTML(booking.professional) : "cada profissional"}` : "Horários do estabelecimento"} em ${prettyDate(booking.date)}</div>${!employeeMode || booking.professional ? `<div class="time-grid">${times.map((time) => `<button class="time-btn ${booking.time === time ? "selected" : ""}" data-time="${time}" ${busy.has(time) ? "disabled" : ""}>${time}</button>`).join("") || `<div class="schedule-empty">${employeeMode ? "Este profissional não possui horários configurados para este dia." : "O estabelecimento não possui horários configurados para este dia."}</div>`}</div>` : '<div class="select-professional-note">Selecione um profissional para consultar a agenda dele.</div>'}
    <div class="booking-actions"><span></span><button class="btn btn-primary" data-booking-next ${service && booking.professional && booking.time ? "" : "disabled"}>Continuar →</button></div>`;

  if (booking.step === 2) return `${progress(2)}<h2 class="booking-title">Seus dados</h2><p class="booking-lead">Usaremos estas informações somente para confirmar o agendamento.</p>
    <form id="booking-form"><div class="mini-field-grid"><div class="field full"><label for="customer-name">Nome completo</label><input id="customer-name" name="name" autocomplete="name" required placeholder="Digite seu nome"></div><div class="field full"><label for="customer-phone">Celular</label><input id="customer-phone" name="phone" autocomplete="tel" required placeholder="(00) 00000-0000"></div></div><div class="confirmation-data"><div class="confirmation-row"><span>Profissional escolhido</span><strong>${escapeHTML(booking.professional)}</strong></div></div><div class="booking-actions"><button class="btn btn-outline" type="button" data-booking-back>← Voltar</button><button class="btn btn-yellow" type="submit">Confirmar agendamento</button></div></form>`;

  const item = booking.confirmation;
  return `${progress(3)}<div class="confirmation"><div class="confirmation-icon">✓</div><h2 class="booking-title">Agendamento confirmado</h2><p class="booking-lead">Seu horário na ${establishment.name} está reservado.</p><div class="confirmation-data"><div class="confirmation-row"><span>Serviço</span><strong>${escapeHTML(item.service)}</strong></div><div class="confirmation-row"><span>Data</span><strong>${prettyDate(item.date, true)}</strong></div><div class="confirmation-row"><span>Horário</span><strong>${item.time}</strong></div><div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(item.professional)}</strong></div></div><div class="booking-actions"><span></span><button class="btn btn-primary" data-new-booking>Fazer outro agendamento</button></div></div>`;
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
    <header class="est-topbar"><div class="est-topbar-inner"><a href="${href("/")}" data-link>${logo()}</a><div class="est-header-actions">${authenticated ? `<a class="btn btn-primary btn-sm" href="${href(`/${establishment.slug}`)}" data-link>Voltar ao painel</a>` : `<a class="btn btn-primary btn-sm" href="${href("/login")}" data-link>Área do estabelecimento</a>`}</div></div></header>
    <section class="est-cover"><div class="est-cover-inner"><div class="est-identity"><div class="est-logo">${escapeHTML(establishment.initials)}</div><div><h1>${escapeHTML(establishment.name)}</h1><p>${escapeHTML(establishment.description)}</p><div class="est-facts"><span>⌖ ${escapeHTML(establishment.address)}</span><span>◷ ${escapeHTML(establishment.todayHours)}</span><span>● ${establishment.openNow ? "Aberto agora" : "Fechado"}</span></div></div></div><div class="live-ticket"><span class="live-dot"></span><span><small>Senha chamada agora</small><strong>${data.queue.find((item) => item.status === "atendendo")?.ticket || "—"}</strong></span></div></div></section>
    <main class="est-content"><div class="public-summary"><article class="summary-card"><small>Atendimentos hoje</small><strong>${String(todayCount).padStart(2,"0")}</strong><em>Agenda atualizada</em></article><article class="summary-card"><small>Próximo horário livre</small><strong>${nextFree}</strong><em>Disponível hoje</em></article><article class="summary-card"><small>Tempo médio de espera</small><strong>${establishment.averageWaitMinutes} min</strong><em>Fila em tempo real</em></article></div>
      <section class="booking-zone" id="agendar"><div class="zone-title"><span class="zone-number">01</span><div><small>AGENDAMENTO</small><h2>Reserve seu horário</h2><p>Escolha serviço, profissional, data e horário.</p></div></div><div class="booking-layout"><section class="panel booking-panel"><div class="panel-head"><div><h2>Agendar atendimento</h2><p>Confirmação imediata, sem precisar ligar</p></div></div><div class="booking-body">${bookingContent(establishment)}</div></section><aside class="panel hours-panel"><div class="panel-head"><div><h2>Horário de funcionamento</h2><p>Atendimento presencial</p></div></div><div class="hours-body">${hoursMarkup(establishment)}</div></aside></div></section>
      <section class="queue-zone" id="painel-senhas"><div class="zone-title queue-zone-title"><span class="zone-number">02</span><div><small>FILA DE ATENDIMENTO</small><h2>Acompanhe sua senha</h2><p>Veja quem está sendo atendido e sua posição na fila.</p></div></div>${queuePanel(data, false)}</section></main>
  </div>`;
  void refreshCloudData(establishment, "public", state.booking.date);
  ensureQueueSubscription(establishment);
}

function appointmentRows(data) {
  const appointments = data.appointments.filter((item) => item.date === isoDate()).sort((a,b) => a.time.localeCompare(b.time));
  if (!appointments.length) return '<div class="empty">Nenhum atendimento marcado para hoje.</div>';
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
      <div class="admin-grid"><section class="panel"><div class="panel-head"><div><h2>Atendimentos de hoje</h2><p>${today.length} horários confirmados</p></div><button class="btn btn-soft btn-sm" data-coming>Ver agenda completa</button></div><div class="appointment-list">${appointmentRows(data)}</div></section><div class="side-stack">${queuePanel(data)}<section class="panel staff-availability-panel"><div class="panel-head"><div><h2>${usesEmployeeSchedules(establishment) ? "Agenda por profissional" : "Agenda do estabelecimento"}</h2><p>${usesEmployeeSchedules(establishment) ? "Disponibilidade individual de hoje" : "Disponibilidade compartilhada de hoje"}</p></div></div><div class="staff-schedules">${staffSchedulesMarkup(establishment, data)}</div></section></div></div>
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
  if (event.target.closest("[data-forgot]")) { event.preventDefault(); toast("A recuperação de senha será conectada ao backend.", "ⓘ"); return; }
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
  if (event.target.closest("[data-booking-next]")) { state.booking.step = 2; render(); return; }
  if (event.target.closest("[data-booking-back]")) { state.booking.step = 1; render(); return; }
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
  const addTicketButton = event.target.closest("[data-add-ticket]");
  if (addTicketButton) await addTicket(addTicketButton.dataset.priority || "normal");
  if (event.target.closest("[data-next-ticket]")) await callNext();
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-booking-date]")) {
    state.booking.date = event.target.value || isoDate(1);
    state.booking.time = null;
    const establishment = activeEstablishment();
    if (establishment) cloudCache.delete(publicCacheKey(establishment));
    render();
  }
  if (event.target.matches("[data-professional]")) { state.booking.professional = event.target.value; state.booking.time = null; render(); }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
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
    if (!firebaseApi) return toast("O Firebase ainda não respondeu. Tente novamente em instantes.", "!");
    const form = new FormData(event.target);
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Entrando…";
    authFlowInProgress = true;
    try {
      firebaseSession = await firebaseApi.login(form.get("email").trim(), form.get("password"));
      state.booking = freshBooking();
      navigate(`/${firebaseSession.slug}`);
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
      else throw new Error("Firebase indisponível");
      cloudCache.delete(publicCacheKey(establishment));
      state.booking.confirmation = appointment;
      state.booking.step = 3;
      render();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Confirmar agendamento";
      toast(firebaseApi ? firebaseApi.firebaseErrorMessage(error) : "Não foi possível conectar ao Firebase.", "!");
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
    if (!firebaseApi || !session()) throw new Error("Firebase indisponível");
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
    if (!firebaseApi || !session()) throw new Error("Firebase indisponível");
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
render();

async function initializeFirebase() {
  try {
    firebaseApi = await import("./firebase-service.js");
    firebaseConnected = true;
    const directory = await firebaseApi.loadEstablishments();
    establishments = Object.fromEntries(directory.map((item) => [item.slug || item.id, { ...item, slug: item.slug || item.id }]));
    catalogLoaded = true;
    firebaseApi.observeSession((profile, error) => {
      firebaseSession = profile;
      if (error) toast(firebaseApi.firebaseErrorMessage(error), "!");
      if (profile && route() === "login" && !authFlowInProgress) navigate(`/${profile.slug}`);
      else render();
    });
    render();
  } catch (error) {
    console.error("Agendae: falha ao carregar o Firebase.", error);
    catalogLoaded = true;
    render();
    toast("Não foi possível carregar o Firebase. Verifique a conexão.", "!");
  }
}

await initializeFirebase();
