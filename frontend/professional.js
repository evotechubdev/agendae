const BASE = location.hostname.endsWith("github.io") ? "/agendae" : "";
const app = document.querySelector("#app");
const toastArea = document.querySelector("#toast-region");
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
let firebaseApi = null;
let firebaseSession = null;
let firebaseConnected = false;
let authFlowInProgress = false;
const cloudCache = new Map();
const cloudLoading = new Set();

const establishments = {
  barbeariadorenam: {
    slug: "barbeariadorenam",
    name: "Barbearia do Renam",
    initials: "BR",
    category: "Barbearia",
    address: "Rua das Palmeiras, 248 — Centro",
    phone: "(11) 99999-1234",
    description: "Cortes, barba e cuidado masculino com hora marcada.",
    currentTicket: "R-023",
    services: [
      { id: "corte", icon: "✂", name: "Corte masculino", duration: 40, price: 45 },
      { id: "barba", icon: "◒", name: "Barba completa", duration: 30, price: 35 },
      { id: "combo", icon: "✦", name: "Corte + barba", duration: 60, price: 70 },
      { id: "acabamento", icon: "⌁", name: "Acabamento", duration: 20, price: 20 },
    ],
    professionals: ["Renam Silva", "Bruno Alves", "Caio Santos"],
  },
  clinicaviva: {
    slug: "clinicaviva",
    name: "Clínica Viva",
    initials: "CV",
    category: "Clínica de saúde",
    address: "Av. Brasil, 1260 — Jardim Paulista",
    phone: "(11) 98888-5642",
    description: "Consultas e avaliações com atendimento humanizado.",
    currentTicket: "A-014",
    services: [
      { id: "consulta", icon: "+", name: "Consulta clínica", duration: 45, price: 180 },
      { id: "retorno", icon: "↻", name: "Consulta de retorno", duration: 30, price: 0 },
      { id: "avaliacao", icon: "♡", name: "Avaliação preventiva", duration: 60, price: 220 },
      { id: "exame", icon: "⌁", name: "Coleta de exames", duration: 20, price: 85 },
    ],
    professionals: ["Dra. Marina Costa", "Dr. Lucas Freire", "Dra. Ana Melo"],
  },
};

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

function storageKey(slug) { return `agendae:v2:establishment:${slug}`; }

function seedData(establishment) {
  const clinic = establishment.slug === "clinicaviva";
  return {
    appointments: clinic ? [
      { id: crypto.randomUUID(), date: isoDate(), time: "08:00", client: "Fernanda Souza", service: "Consulta clínica", professional: "Dra. Marina Costa", status: "confirmado" },
      { id: crypto.randomUUID(), date: isoDate(), time: "09:15", client: "Carlos Nunes", service: "Avaliação preventiva", professional: "Dr. Lucas Freire", status: "aguardando" },
      { id: crypto.randomUUID(), date: isoDate(), time: "10:30", client: "Paula Ribeiro", service: "Consulta de retorno", professional: "Dra. Ana Melo", status: "confirmado" },
      { id: crypto.randomUUID(), date: isoDate(), time: "14:00", client: "Roberto Dias", service: "Coleta de exames", professional: "Dra. Marina Costa", status: "confirmado" },
    ] : [
      { id: crypto.randomUUID(), date: isoDate(), time: "08:30", client: "Matheus Rocha", service: "Corte masculino", professional: "Renam Silva", status: "concluido" },
      { id: crypto.randomUUID(), date: isoDate(), time: "09:20", client: "Diego Martins", service: "Corte + barba", professional: "Bruno Alves", status: "aguardando" },
      { id: crypto.randomUUID(), date: isoDate(), time: "10:30", client: "André Ribeiro", service: "Barba completa", professional: "Caio Santos", status: "confirmado" },
      { id: crypto.randomUUID(), date: isoDate(), time: "13:00", client: "Lucas Almeida", service: "Corte masculino", professional: "Renam Silva", status: "confirmado" },
      { id: crypto.randomUUID(), date: isoDate(), time: "15:10", client: "João Pedro", service: "Acabamento", professional: "Bruno Alves", status: "confirmado" },
    ],
    queue: clinic ? [
      { ticket: "A-014", name: "Elisa Prado", status: "atendendo" },
      { ticket: "A-015", name: "Marcos Silva", status: "aguardando" },
      { ticket: "A-016", name: "Nádia Alves", status: "aguardando" },
    ] : [
      { ticket: "R-023", name: "Felipe Cardoso", status: "atendendo" },
      { ticket: "R-024", name: "Gustavo Melo", status: "aguardando" },
      { ticket: "R-025", name: "Henrique Luz", status: "aguardando" },
      { ticket: "R-026", name: "Samuel Reis", status: "aguardando" },
    ],
  };
}

function getData(establishment) {
  const adminMode = session()?.slug === establishment.slug && new URLSearchParams(location.search).get("public") !== "1";
  const cloud = cloudCache.get(`${adminMode ? "admin" : "public"}:${establishment.slug}`);
  if (cloud) return cloud;
  try {
    const saved = localStorage.getItem(storageKey(establishment.slug));
    if (saved) return JSON.parse(saved);
  } catch { /* inicia novamente */ }
  const data = seedData(establishment);
  saveData(establishment, data);
  return data;
}

function saveData(establishment, data) {
  localStorage.setItem(storageKey(establishment.slug), JSON.stringify(data));
}

async function refreshCloudData(establishment, mode) {
  if (!firebaseApi) return;
  const key = `${mode}:${establishment.slug}`;
  if (cloudLoading.has(key) || cloudCache.has(key)) return;
  cloudLoading.add(key);
  try {
    if (mode === "admin") {
      let remote = await firebaseApi.loadAdminData(establishment.slug, isoDate());
      if (remote.empty) {
        await firebaseApi.bootstrapEstablishment(establishment.slug, seedData(establishment));
        remote = await firebaseApi.loadAdminData(establishment.slug, isoDate());
      }
      cloudCache.set(key, { appointments: remote.appointments, queue: remote.queue });
    } else {
      const remote = await firebaseApi.loadPublicData(establishment.slug, isoDate());
      if (remote) cloudCache.set(key, { appointments: [], ...remote });
    }
    if (route() === establishment.slug) render();
  } catch (error) {
    console.warn("Agendae: usando dados locais porque o Firebase não respondeu.", error);
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
          <div class="finder-note"><span>Exemplo:</span><a href="${href("/barbeariadorenam")}" data-link>Barbearia do Renam</a></div>
        </div>
        <aside class="directory-card">
          <div class="directory-label">Estabelecimentos disponíveis</div>
          <button class="directory-item" data-open-establishment="barbeariadorenam"><span class="est-avatar">BR</span><span class="directory-meta"><strong>Barbearia do Renam</strong><small>Barbearia · Centro</small></span><span class="open-tag">ABERTO</span></button>
          <button class="directory-item" data-open-establishment="clinicaviva"><span class="est-avatar green">CV</span><span class="directory-meta"><strong>Clínica Viva</strong><small>Clínica de saúde · Jardim Paulista</small></span><span class="open-tag">ABERTO</span></button>
          <div class="queue-preview"><span class="queue-preview-number">R-23</span><span><strong>Senhas em tempo real</strong><small>Acompanhe sem precisar esperar no local</small></span></div>
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
  const times = ["08:00", "08:40", "09:20", "10:00", "10:40", "11:20", "13:00", "13:40", "14:20", "15:10", "16:00", "17:20", "18:00"];
  const bookingData = getData(establishment);
  const busy = new Set(bookingData.busySlots || bookingData.appointments.filter((item) => item.date === booking.date).map((item) => item.time));

  if (booking.step === 1) return `${progress(1)}<h2 class="booking-title">Quando você quer ser atendido?</h2><p class="booking-lead">Escolha o dia, o serviço e um horário disponível.</p>
    <div class="date-choice"><button class="choice-btn ${booking.dateMode === "today" ? "selected" : ""}" data-date-mode="today"><span class="choice-radio"></span><span><strong>Agendar para hoje</strong><small>${prettyDate(isoDate())} · horários disponíveis</small></span></button><button class="choice-btn ${booking.dateMode === "other" ? "selected" : ""}" data-date-mode="other"><span class="choice-radio"></span><span><strong>Escolher outro dia</strong><small>Consulte os próximos dias</small></span></button></div>
    ${booking.dateMode === "other" ? `<div class="field"><label for="booking-date">Data do atendimento</label><input id="booking-date" type="date" min="${isoDate()}" value="${booking.date}" data-booking-date></div>` : ""}
    <div class="time-label">Selecione o serviço</div><div class="service-grid">${establishment.services.map((item) => `<button class="service-btn ${booking.serviceId === item.id ? "selected" : ""}" data-service="${item.id}"><span class="service-icon">${item.icon}</span><span><strong>${item.name}</strong><small>${item.duration} minutos</small></span><span class="service-price">${item.price ? currency.format(item.price) : "Incluso"}</span></button>`).join("")}</div>
    <div class="time-label">Horários livres em ${prettyDate(booking.date)}</div><div class="time-grid">${times.map((time) => `<button class="time-btn ${booking.time === time ? "selected" : ""}" data-time="${time}" ${busy.has(time) ? "disabled" : ""}>${time}</button>`).join("")}</div>
    <div class="booking-actions"><span></span><button class="btn btn-primary" data-booking-next ${service && booking.time ? "" : "disabled"}>Continuar →</button></div>`;

  if (booking.step === 2) return `${progress(2)}<h2 class="booking-title">Seus dados</h2><p class="booking-lead">Usaremos estas informações somente para confirmar o agendamento.</p>
    <form id="booking-form"><div class="mini-field-grid"><div class="field full"><label for="customer-name">Nome completo</label><input id="customer-name" name="name" autocomplete="name" required placeholder="Digite seu nome"></div><div class="field"><label for="customer-phone">Celular</label><input id="customer-phone" name="phone" autocomplete="tel" required placeholder="(00) 00000-0000"></div><div class="field"><label for="professional">Profissional</label><select id="professional" name="professional"><option value="">Sem preferência</option>${establishment.professionals.map((name) => `<option>${name}</option>`).join("")}</select></div></div><div class="booking-actions"><button class="btn btn-outline" type="button" data-booking-back>← Voltar</button><button class="btn btn-yellow" type="submit">Confirmar agendamento</button></div></form>`;

  const item = booking.confirmation;
  return `${progress(3)}<div class="confirmation"><div class="confirmation-icon">✓</div><h2 class="booking-title">Agendamento confirmado</h2><p class="booking-lead">Seu horário na ${establishment.name} está reservado.</p><div class="confirmation-data"><div class="confirmation-row"><span>Serviço</span><strong>${escapeHTML(item.service)}</strong></div><div class="confirmation-row"><span>Data</span><strong>${prettyDate(item.date, true)}</strong></div><div class="confirmation-row"><span>Horário</span><strong>${item.time}</strong></div><div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(item.professional)}</strong></div></div><div class="booking-actions"><span></span><button class="btn btn-primary" data-new-booking>Fazer outro agendamento</button></div></div>`;
}

function queuePanel(data, showNames = true) {
  const current = data.queue.find((item) => item.status === "atendendo");
  const waiting = data.queue.filter((item) => item.status === "aguardando");
  return `<section class="panel"><div class="panel-head"><div><h2>Senhas chamadas</h2><p>Atualização em tempo real</p></div><span class="open-tag">AO VIVO</span></div><div class="queue-current"><small>Atendendo agora</small><strong>${current?.ticket || "—"}</strong><span>${showNames ? escapeHTML(current?.name || "Fila livre") : current ? "Em atendimento" : "Fila livre"}</span></div><div class="queue-list">${waiting.slice(0,3).map((item,index) => `<div class="queue-row"><span class="ticket">${item.ticket}</span><strong>${showNames ? escapeHTML(item.name || "Cliente") : "Aguardando"}</strong><small>${index === 0 ? "Próximo" : `+${index}`}</small></div>`).join("") || '<div class="empty">Ninguém aguardando.</div>'}</div></section>`;
}

function renderEstablishmentPublic(establishment) {
  document.title = `${establishment.name} — Agendae`;
  const data = getData(establishment);
  const todayAppointments = data.appointments.filter((item) => item.date === isoDate());
  const todayCount = Number.isFinite(data.todayAppointments) ? data.todayAppointments : todayAppointments.length;
  const authenticated = session()?.slug === establishment.slug;
  app.innerHTML = `<div class="est-page">
    <header class="est-topbar"><div class="est-topbar-inner"><a href="${href("/")}" data-link>${logo()}</a><div class="est-header-actions"><a class="btn btn-outline btn-sm" href="${href("/")}" data-link>Trocar estabelecimento</a><span class="divider"></span>${authenticated ? `<a class="btn btn-primary btn-sm" href="${href(`/${establishment.slug}`)}" data-link>Voltar ao painel</a>` : `<a class="btn btn-primary btn-sm" href="${href("/login")}" data-link>Área do estabelecimento</a>`}</div></div></header>
    <section class="est-cover"><div class="est-cover-inner"><div class="est-identity"><div class="est-logo">${establishment.initials}</div><div><h1>${establishment.name}</h1><p>${establishment.description}</p><div class="est-facts"><span>⌖ ${establishment.address}</span><span>◷ Hoje, 08h às 19h</span><span>● Aberto agora</span></div></div></div><div class="live-ticket"><span class="live-dot"></span><span><small>Senha chamada agora</small><strong>${data.queue.find((item) => item.status === "atendendo")?.ticket || "—"}</strong></span></div></div></section>
    <main class="est-content"><div><div class="public-summary"><article class="summary-card"><small>Atendimentos hoje</small><strong>${String(todayCount).padStart(2,"0")}</strong><em>Agenda atualizada</em></article><article class="summary-card"><small>Próximo horário livre</small><strong>11:20</strong><em>Disponível hoje</em></article><article class="summary-card"><small>Tempo médio de espera</small><strong>9 min</strong><em>Fila em tempo real</em></article></div><section class="panel booking-panel" id="agendar"><div class="panel-head"><div><h2>Agendar atendimento</h2><p>Confirmação imediata, sem precisar ligar</p></div></div><div class="booking-body">${bookingContent(establishment)}</div></section></div><aside class="side-stack">${queuePanel(data, false)}<section class="panel"><div class="panel-head"><div><h2>Horário de funcionamento</h2><p>Atendimento presencial</p></div></div><div class="hours-body"><div class="hours-row today"><span>Hoje</span><strong>08:00 — 19:00</strong></div><div class="hours-row"><span>Segunda a sexta</span><span>08:00 — 19:00</span></div><div class="hours-row"><span>Sábado</span><span>08:00 — 17:00</span></div><div class="hours-row"><span>Domingo</span><span>Fechado</span></div></div></section></aside></main>
  </div>`;
  void refreshCloudData(establishment, "public");
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
  const freeSlots = ["11:20","11:50","13:40","14:20","16:00","17:20"];
  app.innerHTML = `<div class="admin-shell">
    <aside class="sidebar ${state.mobileMenu ? "mobile-open" : ""}"><a href="${href("/")}" data-link>${logo()}</a><div class="workspace"><span class="est-avatar">${establishment.initials}</span><span><strong>${establishment.name}</strong><small>${establishment.category}</small></span></div><div class="side-label">Gestão</div><nav class="side-nav"><button class="side-link active"><span class="side-icon">⌂</span>Visão geral</button><button class="side-link" data-coming><span class="side-icon">▣</span>Agenda</button><button class="side-link" data-coming><span class="side-icon">☷</span>Fila de senhas</button><button class="side-link" data-coming><span class="side-icon">♙</span>Clientes</button><button class="side-link" data-coming><span class="side-icon">⌁</span>Relatórios</button></nav><div class="side-spacer"></div><a class="side-link" href="${href(`/${establishment.slug}?public=1`)}" data-link><span class="side-icon">↗</span>Ver página pública</a><button class="side-link" data-logout><span class="side-icon">←</span>Sair</button><div class="sidebar-user"><span class="user-avatar">RS</span><span><strong>Renam Silva</strong><small>Administrador</small></span></div></aside>
    <main class="admin-main"><header class="admin-topbar"><button class="icon-btn mobile-admin-menu" data-mobile-admin>☰</button><div class="admin-title"><h1>Bom dia, Renam</h1><p>${prettyDate(isoDate(),true)} · acompanhe o movimento de hoje.</p></div><div class="admin-actions"><button class="icon-btn" data-notification>♢</button><a class="btn btn-primary btn-sm" href="${href(`/${establishment.slug}?public=1#agendar`)}" data-link>+ Novo agendamento</a></div></header>
      <section class="admin-stats"><article class="admin-stat"><div class="admin-stat-head"><span>Atendimentos hoje</span><span class="stat-icon">▣</span></div><strong>${String(today.length).padStart(2,"0")}</strong><em>Agenda atualizada agora</em></article><article class="admin-stat"><div class="admin-stat-head"><span>Horários livres</span><span class="stat-icon">◷</span></div><strong>${String(freeSlots.length).padStart(2,"0")}</strong><em>Próximo às 11:20</em></article><article class="admin-stat"><div class="admin-stat-head"><span>Clientes na fila</span><span class="stat-icon">☷</span></div><strong>${String(waiting).padStart(2,"0")}</strong><em>Espera média de 9 min</em></article><article class="admin-stat"><div class="admin-stat-head"><span>Atendidos</span><span class="stat-icon">✓</span></div><strong>${String(completed).padStart(2,"0")}</strong><em>Hoje até agora</em></article></section>
      <div class="admin-grid"><section class="panel"><div class="panel-head"><div><h2>Atendimentos de hoje</h2><p>${today.length} horários confirmados</p></div><button class="btn btn-soft btn-sm" data-coming>Ver agenda completa</button></div><div class="appointment-list">${appointmentRows(data)}</div></section><div class="side-stack">${queuePanel(data)}<section class="panel"><div class="panel-head"><div><h2>Horários livres</h2><p>Disponibilidade de hoje</p></div></div><div class="free-slots">${freeSlots.map((time) => `<span class="free-slot">${time}</span>`).join("")}</div></section></div></div>
    </main></div>`;
  const queueSection = app.querySelector(".admin-grid .side-stack .panel");
  if (queueSection) queueSection.insertAdjacentHTML("beforeend", `<div class="queue-admin-actions"><button class="btn btn-soft btn-sm" data-add-ticket>+ Nova senha</button><button class="btn btn-primary btn-sm" data-next-ticket>Chamar próxima</button></div>`);
  void refreshCloudData(establishment, "admin");
}

function renderNotFound() {
  document.title = "Estabelecimento não encontrado — Agendae";
  app.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:30px;background:var(--canvas)"><div style="max-width:520px;text-align:center">${logo()}<h1 style="margin:35px 0 10px;color:var(--navy);font:800 34px Manrope">Estabelecimento não encontrado</h1><p style="color:var(--muted);line-height:1.6">Confira o endereço ou volte para pesquisar na Agendae.</p><a class="btn btn-primary" style="margin-top:18px" href="${href("/")}" data-link>Encontrar estabelecimento</a></div></main>`;
}

function render() {
  const current = route();
  if (current === "home") return renderHome();
  if (current === "login") return renderLogin();
  const establishment = establishments[current];
  if (!establishment) return renderNotFound();
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
  if (event.target.closest("[data-logout]")) {
    try { if (firebaseApi) await firebaseApi.logout(); } catch { /* a interface encerra mesmo sem rede */ }
    firebaseSession = null;
    cloudCache.clear();
    state.booking = freshBooking();
    navigate("/login");
    toast("Sessão encerrada.");
    return;
  }
  if (event.target.closest("[data-add-ticket]")) await addTicket();
  if (event.target.closest("[data-next-ticket]")) await callNext();
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-booking-date]")) { state.booking.date = event.target.value || isoDate(1); state.booking.time = null; render(); }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "finder-form") {
    const query = new FormData(event.target).get("query") || document.querySelector("#finder-input")?.value || "";
    const normalized = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    if (!normalized) return toast("Digite o nome do estabelecimento.", "!");
    if (normalized.includes("clinica") || normalized.includes("viva")) navigate("/clinicaviva");
    else if (normalized.includes("renam") || normalized.includes("barbearia")) navigate("/barbeariadorenam");
    else toast("Não encontramos esse estabelecimento. Tente “Barbearia do Renam”.", "!");
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
    const appointment = { id: crypto.randomUUID(), date: state.booking.date, time: state.booking.time, client: form.get("name").trim(), phone: form.get("phone").trim(), service: service.name, professional: form.get("professional") || establishment.professionals[0], status: "confirmado" };
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Confirmando…";
    try {
      if (firebaseApi) await firebaseApi.createAppointment(establishment.slug, appointment);
      else throw new Error("Firebase indisponível");
      const data = getData(establishment);
      data.appointments.push(appointment);
      saveData(establishment, data);
      cloudCache.delete(`public:${establishment.slug}`);
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
        cloudCache.delete(`public:${establishment.slug}`);
        render();
      }
    }
  }
});

async function addTicket() {
  const establishment = activeEstablishment();
  const data = getData(establishment);
  const prefix = establishment.slug === "clinicaviva" ? "A" : "R";
  const nextNumber = data.queue.reduce((max, item) => Math.max(max, Number(item.ticket.split("-")[1]) || 0), 0) + 1;
  const ticket = `${prefix}-${String(nextNumber).padStart(3,"0")}`;
  try {
    if (!firebaseApi || !session()) throw new Error("Firebase indisponível");
    await firebaseApi.addQueueTicket(establishment.slug, ticket, "Cliente sem agendamento");
  } catch (error) {
    toast(firebaseApi ? firebaseApi.firebaseErrorMessage(error) : "Entre novamente para alterar a fila.", "!");
    return;
  }
  data.queue.push({ ticket, name: "Cliente sem agendamento", status: "aguardando" });
  saveData(establishment, data);
  cloudCache.delete(`admin:${establishment.slug}`);
  cloudCache.delete(`public:${establishment.slug}`);
  toast(`Senha ${ticket} adicionada.`);
  render();
}

async function callNext() {
  const establishment = activeEstablishment();
  const data = getData(establishment);
  let remoteTicket;
  try {
    if (!firebaseApi || !session()) throw new Error("Firebase indisponível");
    remoteTicket = await firebaseApi.callNextTicket(establishment.slug);
  } catch (error) {
    toast(firebaseApi ? firebaseApi.firebaseErrorMessage(error) : "Entre novamente para alterar a fila.", "!");
    return;
  }
  const current = data.queue.find((item) => item.status === "atendendo");
  if (current) current.status = "concluido";
  const next = data.queue.find((item) => item.status === "aguardando");
  if (next) next.status = "atendendo";
  saveData(establishment, data);
  cloudCache.delete(`admin:${establishment.slug}`);
  cloudCache.delete(`public:${establishment.slug}`);
  toast(remoteTicket ? `Senha ${remoteTicket} chamada.` : "Fila concluída.", remoteTicket ? "✓" : "○");
  render();
}

window.addEventListener("popstate", render);
render();

async function initializeFirebase() {
  try {
    firebaseApi = await import("./firebase-service.js");
    firebaseConnected = true;
    firebaseApi.observeSession((profile, error) => {
      firebaseSession = profile;
      if (error) toast(firebaseApi.firebaseErrorMessage(error), "!");
      if (profile && route() === "login" && !authFlowInProgress) navigate(`/${profile.slug}`);
      else render();
    });
    if (route() === "login") render();
  } catch (error) {
    console.error("Agendae: falha ao carregar o Firebase.", error);
    if (route() === "login") {
      render();
      toast("Não foi possível carregar o Firebase. Verifique a conexão.", "!");
    }
  }
}

void initializeFirebase();
