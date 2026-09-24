const tenants = {
  barbearia: {
    id: "barbearia-horizonte",
    name: "Barbearia Horizonte",
    shortName: "Horizonte",
    initials: "BH",
    category: "Barbearia",
    address: "Rua das Palmeiras, 248 — Centro",
    hours: "Seg a sáb, das 8h às 19h",
    phone: "(11) 99999-1234",
    services: [
      { id: "corte", icon: "✂", name: "Corte masculino", duration: 40, price: 45 },
      { id: "barba", icon: "◒", name: "Barba completa", duration: 30, price: 35 },
      { id: "combo", icon: "✦", name: "Corte + barba", duration: 60, price: 70 },
      { id: "pezinho", icon: "⌁", name: "Acabamento", duration: 20, price: 20 },
    ],
    professionals: ["Rafael Lima", "Bruno Alves", "Caio Santos"],
  },
  clinica: {
    id: "clinica-viva",
    name: "Clínica Viva",
    shortName: "Clínica Viva",
    initials: "CV",
    category: "Clínica de saúde",
    address: "Av. Brasil, 1260 — Jardim Paulista",
    hours: "Seg a sex, das 7h às 18h",
    phone: "(11) 98888-5642",
    services: [
      { id: "consulta", icon: "+", name: "Consulta clínica", duration: 45, price: 180 },
      { id: "retorno", icon: "↻", name: "Consulta de retorno", duration: 30, price: 0 },
      { id: "avaliacao", icon: "♡", name: "Avaliação preventiva", duration: 60, price: 220 },
      { id: "exames", icon: "⌁", name: "Coleta de exames", duration: 20, price: 85 },
    ],
    professionals: ["Dra. Marina Costa", "Dr. Lucas Freire", "Dra. Ana Melo"],
  },
};

const state = {
  tenantKey: localStorage.getItem("agendae:active-tenant") || "barbearia",
  dashboardView: "overview",
  tenantMenuOpen: false,
  mobileSidebarOpen: false,
  booking: {
    step: 1,
    tenantKey: "barbearia",
    serviceId: null,
    professional: "",
    date: null,
    time: null,
    customer: { name: "", phone: "", email: "" },
    confirmed: null,
  },
};

const app = document.querySelector("#app");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function isoDay(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function displayDate(iso, options = { day: "2-digit", month: "short" }) {
  return new Intl.DateTimeFormat("pt-BR", options).format(new Date(`${iso}T12:00:00`));
}

function seedFor(key) {
  const isClinic = key === "clinica";
  return {
    appointments: isClinic
      ? [
          { id: crypto.randomUUID(), time: "08:00", client: "Fernanda Souza", service: "Consulta clínica", professional: "Dra. Marina Costa", status: "confirmado", date: isoDay() },
          { id: crypto.randomUUID(), time: "09:15", client: "Carlos Nunes", service: "Avaliação preventiva", professional: "Dr. Lucas Freire", status: "aguardando", date: isoDay() },
          { id: crypto.randomUUID(), time: "10:30", client: "Paula Ribeiro", service: "Consulta de retorno", professional: "Dra. Ana Melo", status: "confirmado", date: isoDay() },
          { id: crypto.randomUUID(), time: "14:00", client: "Roberto Dias", service: "Coleta de exames", professional: "Dra. Marina Costa", status: "confirmado", date: isoDay() },
        ]
      : [
          { id: crypto.randomUUID(), time: "08:30", client: "Matheus Rocha", service: "Corte masculino", professional: "Rafael Lima", status: "confirmado", date: isoDay() },
          { id: crypto.randomUUID(), time: "09:20", client: "Diego Martins", service: "Corte + barba", professional: "Bruno Alves", status: "aguardando", date: isoDay() },
          { id: crypto.randomUUID(), time: "10:30", client: "André Ribeiro", service: "Barba completa", professional: "Caio Santos", status: "confirmado", date: isoDay() },
          { id: crypto.randomUUID(), time: "13:00", client: "Lucas Almeida", service: "Corte masculino", professional: "Rafael Lima", status: "confirmado", date: isoDay() },
          { id: crypto.randomUUID(), time: "15:10", client: "João Pedro", service: "Acabamento", professional: "Bruno Alves", status: "confirmado", date: isoDay() },
        ],
    queue: isClinic
      ? [
          { ticket: "A-021", name: "Elisa Prado", service: "Consulta clínica", wait: "12 min", status: "atendendo" },
          { ticket: "A-022", name: "Marcos Silva", service: "Consulta de retorno", wait: "8 min", status: "aguardando" },
          { ticket: "A-023", name: "Nádia Alves", service: "Coleta de exames", wait: "3 min", status: "aguardando" },
        ]
      : [
          { ticket: "B-047", name: "Felipe Cardoso", service: "Corte + barba", wait: "18 min", status: "atendendo" },
          { ticket: "B-048", name: "Gustavo Melo", service: "Corte masculino", wait: "11 min", status: "aguardando" },
          { ticket: "B-049", name: "Henrique Luz", service: "Barba completa", wait: "6 min", status: "aguardando" },
          { ticket: "B-050", name: "Samuel Reis", service: "Acabamento", wait: "2 min", status: "aguardando" },
        ],
  };
}

function tenantStoreKey(key) {
  return `agendae:v1:tenant:${tenants[key].id}:data`;
}

function getTenantData(key = state.tenantKey) {
  const storageKey = tenantStoreKey(key);
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }
  const data = seedFor(key);
  localStorage.setItem(storageKey, JSON.stringify(data));
  return data;
}

function setTenantData(data, key = state.tenantKey) {
  localStorage.setItem(tenantStoreKey(key), JSON.stringify(data));
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function initials(name) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function icon(name) {
  const icons = {
    calendar: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    users: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    queue: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>',
    chart: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 11 9-8 9 8v10h-6v-6H9v6H3z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.38.36.72.6 1 .3.3.68.43 1.1.4h.09v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M13.7 21h-3.4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    code: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/></svg>',
  };
  return icons[name] || "";
}

function header(active = "") {
  return `
    <header class="site-header">
      <div class="nav-wrap">
        <a href="#/" aria-label="Agendae — início"><img class="brand-logo" src="./public/imagens/logo_agendae.png" alt="Agendae" /></a>
        <nav class="main-nav" aria-label="Navegação principal">
          <a class="nav-link ${active === "home" ? "active" : ""}" href="#/">Início</a>
          <a class="nav-link" href="#/" data-scroll="recursos">Recursos</a>
          <a class="nav-link ${active === "api" ? "active" : ""}" href="#/api">API</a>
          <a class="nav-link" href="#/" data-scroll="negocios">Para negócios</a>
        </nav>
        <div class="nav-actions">
          <a class="btn btn-ghost" href="#/painel">Acessar painel</a>
          <a class="btn btn-primary" href="#/agendar">Agendar agora</a>
          <button class="icon-button mobile-menu-button" aria-label="Abrir menu" data-mobile-menu>${icon("menu")}</button>
        </div>
      </div>
    </header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="footer-inner">
    <img class="brand-logo" src="./public/imagens/logo_agendae.png" alt="Agendae" />
    <span>© ${new Date().getFullYear()} Agendae. Especialistas em organizar o seu tempo.</span>
    <span>Produto em fase de demonstração</span>
  </div></footer>`;
}

function renderHome() {
  app.innerHTML = `${header("home")}
    <main>
      <section class="hero">
        <div class="hero-inner">
          <div class="hero-copy">
            <div class="eyebrow"><i class="eyebrow-dot"></i> Agendamentos e filas, finalmente juntos</div>
            <h1>Seu tempo merece uma gestão <span>mais simples.</span></h1>
            <p>Uma plataforma feita para negócios que vivem de agenda. Seus clientes marcam em segundos e sua equipe organiza horários e senhas em um só painel.</p>
            <div class="hero-actions">
              <a class="btn btn-yellow" href="#/agendar">Experimentar agendamento ${icon("arrow")}</a>
              <a class="btn btn-ghost" href="#/painel">Conhecer o painel</a>
            </div>
            <div class="hero-proof">
              <div class="avatars"><span class="avatar">BH</span><span class="avatar">CV</span><span class="avatar">+</span></div>
              <span>Uma experiência pensada para barbearias, clínicas, salões e muito mais.</span>
            </div>
          </div>
          <div class="hero-visual" aria-label="Prévia do painel Agendae">
            <div class="mock-window">
              <div class="mock-top"><div class="mock-dots"><i></i><i></i><i></i></div><strong style="font-size:12px;color:#8490a3">Barbearia Horizonte</strong></div>
              <div class="mock-body">
                <div class="mock-heading"><h3>Olá, Rafael 👋</h3><span class="status-pill">Aberto agora</span></div>
                <div class="mock-stats">
                  <div class="mock-stat"><small>Hoje</small><strong>18</strong></div>
                  <div class="mock-stat"><small>Na fila</small><strong>04</strong></div>
                  <div class="mock-stat"><small>Ocupação</small><strong>82%</strong></div>
                </div>
                <div class="mock-list">
                  <div class="mock-row"><span class="mock-time">09:20</span><span class="mock-person"><strong>Diego Martins</strong><small>Corte + barba · Bruno</small></span><span class="status-pill">Confirmado</span></div>
                  <div class="mock-row"><span class="mock-time">10:30</span><span class="mock-person"><strong>André Ribeiro</strong><small>Barba completa · Caio</small></span><span class="status-pill">Confirmado</span></div>
                  <div class="mock-row"><span class="mock-time">13:00</span><span class="mock-person"><strong>Lucas Almeida</strong><small>Corte masculino · Rafael</small></span><span class="status-pill">Confirmado</span></div>
                </div>
              </div>
            </div>
            <div class="floating-card queue-float"><span class="queue-number">B-47</span><span><strong>Senha chamada</strong><small>Box 02 · Agora</small></span></div>
          </div>
        </div>
      </section>

      <section class="section" id="recursos">
        <div class="section-heading">
          <div class="kicker">Tudo no mesmo ritmo</div>
          <h2>Da reserva ao atendimento, sem perder nenhum detalhe</h2>
          <p>Menos ferramentas espalhadas, menos conflito de horários e mais clareza para a equipe e para o cliente.</p>
        </div>
        <div class="feature-grid">
          <article class="feature-card"><div class="feature-icon">${icon("calendar")}</div><h3>Agenda inteligente</h3><p>Serviços, profissionais e horários disponíveis em um fluxo rápido, responsivo e fácil de compartilhar.</p></article>
          <article class="feature-card"><div class="feature-icon">${icon("queue")}</div><h3>Fila de senhas</h3><p>Controle quem está aguardando, chame a próxima senha e acompanhe o tempo de espera em tempo real.</p></article>
          <article class="feature-card"><div class="feature-icon">${icon("code")}</div><h3>API para integrar</h3><p>Leve o motor de agendamento da Agendae para o site que seu estabelecimento já utiliza.</p></article>
        </div>
      </section>

      <section class="split-section" id="negocios">
        <div class="split-inner">
          <div class="tenant-stack" aria-label="Dados separados por estabelecimento">
            <div class="tenant-card"><div class="tenant-head"><span class="tenant-mark">BH</span><span><strong>Barbearia Horizonte</strong><small>18 agendamentos hoje</small></span></div><div class="data-bar"><i></i></div></div>
            <div class="isolation-line">${icon("lock")}</div>
            <div class="tenant-card"><div class="tenant-head"><span class="tenant-mark">CV</span><span><strong>Clínica Viva</strong><small>12 consultas hoje</small></span></div><div class="data-bar"><i></i></div></div>
          </div>
          <div class="split-copy">
            <div class="kicker">Multiestabelecimento de verdade</div>
            <h2>Cada negócio no seu espaço. Cada dado no lugar certo.</h2>
            <p>A arquitetura da Agendae nasce preparada para várias empresas, mantendo agendas, clientes, equipes e filas organizados por estabelecimento.</p>
            <ul class="check-list">
              <li><i>✓</i> Ambiente exclusivo para cada empresa</li>
              <li><i>✓</i> Permissões por função da equipe</li>
              <li><i>✓</i> Identidade e serviços personalizados</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="cta-wrap">
        <div class="cta-panel"><h2>Organize a agenda. Acelere a fila. Cuide melhor de cada cliente.</h2><p>Veja a experiência completa agora — faça uma reserva como cliente ou explore o painel de gestão do estabelecimento.</p><a class="btn btn-yellow" href="#/painel">Abrir painel demonstrativo ${icon("arrow")}</a></div>
      </section>
    </main>${footer()}`;
}

function bookingAside(tenant) {
  return `<aside class="booking-aside">
    <a class="back-link" href="#/">← Voltar para o início</a>
    <div class="business-badge">${tenant.initials}</div>
    <h2>${tenant.name}</h2>
    <p>${tenant.category} · Atendimento com hora marcada e fila digital.</p>
    <div class="business-details">
      <div class="detail-item">⌖ <span>${tenant.address}</span></div>
      <div class="detail-item">◷ <span>${tenant.hours}</span></div>
      <div class="detail-item">◉ <span>${tenant.phone}</span></div>
    </div>
  </aside>`;
}

function bookingSteps(current) {
  const labels = ["Serviço", "Horário", "Seus dados"];
  return `<div class="steps">${labels.map((label, index) => {
    const number = index + 1;
    const className = number < current ? "done" : number === current ? "active" : "";
    return `<div class="step ${className}"><span class="step-number">${number < current ? "✓" : number}</span><span>${label}</span></div>`;
  }).join("")}</div>`;
}

function renderBooking() {
  const booking = state.booking;
  const tenant = tenants[booking.tenantKey];
  let form = "";

  if (booking.step === 1) {
    form = `<section class="form-section"><h1>O que você deseja agendar?</h1><p class="form-lead">Escolha um serviço para ver os melhores horários.</p>
      <div class="field" style="margin-bottom:18px"><label for="booking-tenant">Estabelecimento</label><select id="booking-tenant" data-booking-tenant>
        ${Object.entries(tenants).map(([key, item]) => `<option value="${key}" ${key === booking.tenantKey ? "selected" : ""}>${item.name} · ${item.category}</option>`).join("")}
      </select></div>
      <div class="service-options">${tenant.services.map((service) => `<button class="service-option ${booking.serviceId === service.id ? "selected" : ""}" data-service="${service.id}"><span class="service-glyph">${service.icon}</span><span class="service-info"><strong>${service.name}</strong><small>${service.duration} minutos</small></span><span class="service-price">${service.price ? money.format(service.price) : "Incluso"}</span></button>`).join("")}</div>
      <div class="form-actions"><span></span><button class="btn btn-primary" data-booking-next ${booking.serviceId ? "" : "disabled"}>Escolher horário ${icon("arrow")}</button></div></section>`;
  }

  if (booking.step === 2) {
    const service = tenant.services.find((item) => item.id === booking.serviceId);
    const days = [0, 1, 2, 3, 4].map((offset) => {
      const date = isoDay(offset);
      const dayName = offset === 0 ? "Hoje" : new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(new Date(`${date}T12:00:00`)).replace(".", "");
      return `<button class="date-button ${booking.date === date ? "selected" : ""}" data-date="${date}"><small>${dayName}</small><strong>${new Date(`${date}T12:00:00`).getDate()}</strong></button>`;
    }).join("");
    const times = ["08:00", "08:40", "09:20", "10:30", "11:10", "13:00", "14:20", "15:10", "16:30", "17:20", "18:00", "18:40"];
    form = `<section class="form-section"><h1>Escolha o melhor horário</h1><p class="form-lead">${service.name} · ${service.duration} min</p>
      <div class="field" style="margin-bottom:22px"><label for="professional">Profissional</label><select id="professional" data-professional><option value="">Sem preferência</option>${tenant.professionals.map((person) => `<option ${booking.professional === person ? "selected" : ""}>${person}</option>`).join("")}</select></div>
      <div class="date-strip">${days}</div>
      <div class="times-label">Horários disponíveis</div>
      <div class="time-grid">${times.map((time) => `<button class="time-button ${booking.time === time ? "selected" : ""}" data-time="${time}">${time}</button>`).join("")}</div>
      <div class="form-actions"><button class="btn btn-ghost" data-booking-back>← Voltar</button><button class="btn btn-primary" data-booking-next ${booking.date && booking.time ? "" : "disabled"}>Continuar ${icon("arrow")}</button></div></section>`;
  }

  if (booking.step === 3) {
    form = `<section class="form-section"><h1>Falta pouco!</h1><p class="form-lead">Preencha seus dados para confirmar o agendamento.</p>
      <form id="customer-form"><div class="field-grid">
        <div class="field full"><label for="customer-name">Nome completo</label><input id="customer-name" name="name" autocomplete="name" required placeholder="Como podemos chamar você?" value="${escapeHTML(booking.customer.name)}" /></div>
        <div class="field"><label for="customer-phone">Celular</label><input id="customer-phone" name="phone" autocomplete="tel" required placeholder="(00) 00000-0000" value="${escapeHTML(booking.customer.phone)}" /></div>
        <div class="field"><label for="customer-email">E-mail</label><input id="customer-email" name="email" type="email" autocomplete="email" required placeholder="voce@email.com" value="${escapeHTML(booking.customer.email)}" /></div>
      </div><div class="form-actions"><button type="button" class="btn btn-ghost" data-booking-back>← Voltar</button><button class="btn btn-yellow" type="submit">Confirmar agendamento</button></div></form></section>`;
  }

  if (booking.step === 4) {
    const item = booking.confirmed;
    form = `<section class="form-section confirmation"><div class="success-check">✓</div><h1>Agendamento confirmado!</h1><p class="form-lead">Tudo certo, ${escapeHTML(item.client.split(" ")[0])}. Seu horário foi reservado.</p>
      <div class="confirmation-card">
        <div class="confirmation-row"><span>Serviço</span><strong>${escapeHTML(item.service)}</strong></div>
        <div class="confirmation-row"><span>Data</span><strong>${displayDate(item.date, { weekday: "long", day: "2-digit", month: "long" })}</strong></div>
        <div class="confirmation-row"><span>Horário</span><strong>${item.time}</strong></div>
        <div class="confirmation-row"><span>Profissional</span><strong>${escapeHTML(item.professional)}</strong></div>
      </div>
      <div class="form-actions"><a class="btn btn-ghost" href="#/">Ir para o início</a><button class="btn btn-primary" data-new-booking>Fazer outro agendamento</button></div></section>`;
  }

  app.innerHTML = `${header()}<main class="page-shell"><div class="booking-wrap">${bookingAside(tenant)}<div class="booking-main">${booking.step < 4 ? bookingSteps(booking.step) : ""}${form}</div></div></main>`;
}

function appointmentRows(appointments, limit) {
  const todayAppointments = appointments.filter((item) => item.date === isoDay()).sort((a, b) => a.time.localeCompare(b.time));
  const rows = typeof limit === "number" ? todayAppointments.slice(0, limit) : todayAppointments;
  if (!rows.length) return `<div class="empty-state"><span style="font-size:28px">◷</span><strong>Nenhum agendamento hoje</strong><span>Os novos horários aparecerão aqui.</span></div>`;
  return rows.map((item) => `<div class="appointment-row">
    <span class="appointment-time">${item.time}</span>
    <span class="client-cell"><span class="client-avatar">${initials(item.client)}</span><span class="client-info"><strong>${escapeHTML(item.client)}</strong><small>${escapeHTML(item.service)}</small></span></span>
    <span class="professional">${escapeHTML(item.professional)}</span>
    <span class="status ${item.status}">${item.status[0].toUpperCase() + item.status.slice(1)}</span>
  </div>`).join("");
}

function queueSmall(queue) {
  const current = queue.find((item) => item.status === "atendendo");
  const waiting = queue.filter((item) => item.status === "aguardando").slice(0, 3);
  return `<div class="queue-now"><small>Atendendo agora</small><div class="ticket-big">${current?.ticket || "—"}</div><span style="font-size:12px">${escapeHTML(current?.name || "Fila livre")}</span></div>
    <div class="queue-items">${waiting.length ? waiting.map((item) => `<div class="queue-item"><span class="ticket">${item.ticket}</span><span class="queue-person">${escapeHTML(item.name)}</span><span class="wait-time">${item.wait}</span></div>`).join("") : '<div class="empty-state" style="padding:28px 10px">Ninguém aguardando</div>'}</div>
    <div class="queue-actions"><button class="btn btn-soft btn-sm" data-queue-add>${icon("plus")} Nova senha</button><button class="btn btn-primary btn-sm" data-queue-next>Chamar próximo</button></div>`;
}

function overviewView(data) {
  const today = data.appointments.filter((item) => item.date === isoDay());
  const waiting = data.queue.filter((item) => item.status === "aguardando").length;
  const completed = today.filter((item) => item.status === "concluido").length;
  return `<div class="stat-grid">
    <article class="stat-card"><div class="stat-top"><span>Agendamentos hoje</span><i class="stat-icon">${icon("calendar")}</i></div><strong>${String(today.length).padStart(2, "0")}</strong><span class="trend">↑ 12% esta semana</span></article>
    <article class="stat-card"><div class="stat-top"><span>Clientes na fila</span><i class="stat-icon">${icon("queue")}</i></div><strong>${String(waiting).padStart(2, "0")}</strong><span class="trend">~ 9 min de espera</span></article>
    <article class="stat-card"><div class="stat-top"><span>Atendidos</span><i class="stat-icon">${icon("users")}</i></div><strong>${String(completed + 7).padStart(2, "0")}</strong><span class="trend">Hoje até agora</span></article>
    <article class="stat-card"><div class="stat-top"><span>Taxa de ocupação</span><i class="stat-icon">${icon("chart")}</i></div><strong>${Math.min(96, 62 + today.length * 4)}%</strong><span class="trend">↑ 5% no período</span></article>
  </div>
  <div class="dashboard-grid">
    <section class="panel"><div class="panel-head"><div><h2>Agenda de hoje</h2><p>${displayDate(isoDay(), { weekday: "long", day: "2-digit", month: "long" })}</p></div><button class="text-button" data-view="appointments">Ver agenda completa →</button></div><div class="appointment-list">${appointmentRows(data.appointments, 5)}</div></section>
    <section class="panel queue-panel"><div class="panel-head"><div><h2>Fila de atendimento</h2><p>Atualizada agora</p></div><button class="text-button" data-view="queue">Ver fila →</button></div>${queueSmall(data.queue)}</section>
  </div>`;
}

function appointmentsView(data) {
  return `<section class="panel"><div class="panel-head"><div><h2>Todos os horários de hoje</h2><p>${data.appointments.filter((item) => item.date === isoDay()).length} agendamentos encontrados</p></div><a class="btn btn-primary btn-sm" href="#/agendar">${icon("plus")} Novo agendamento</a></div><div class="appointment-list">${appointmentRows(data.appointments)}</div></section>`;
}

function queueView(data) {
  const current = data.queue.find((item) => item.status === "atendendo");
  const waiting = data.queue.filter((item) => item.status === "aguardando");
  return `<div class="queue-full">
    <section class="queue-call-card"><small>Senha em atendimento</small><h2>${current?.ticket || "—"}</h2><p>${escapeHTML(current?.name || "Fila livre")}${current ? ` · ${escapeHTML(current.service)}` : ""}</p><button class="btn btn-yellow" data-queue-next>${current ? "Concluir e chamar próximo" : "Chamar próximo"} ${icon("arrow")}</button></section>
    <section class="panel"><div class="panel-head"><div><h2>Resumo da fila</h2><p>Atendimento em tempo real</p></div></div><div style="padding:24px"><div class="confirmation-row"><span>Aguardando</span><strong>${waiting.length}</strong></div><div class="confirmation-row"><span>Espera estimada</span><strong>${waiting.length ? `${waiting.length * 6} min` : "—"}</strong></div><div class="confirmation-row"><span>Atendidos hoje</span><strong>12</strong></div></div><div style="padding:0 20px 20px"><button class="btn btn-soft" style="width:100%" data-queue-add>${icon("plus")} Adicionar senha</button></div></section>
  </div>
  <section class="panel queue-table"><div class="panel-head"><div><h2>Próximos da fila</h2><p>Ordem de chegada</p></div></div><div class="table-header"><span>Senha</span><span>Cliente</span><span>Serviço</span><span>Espera</span><span>Status</span></div>${waiting.length ? waiting.map((item) => `<div class="table-row"><span class="ticket">${item.ticket}</span><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(item.service)}</span><span>${item.wait}</span><span class="status aguardando">Aguardando</span></div>`).join("") : '<div class="empty-state"><strong>A fila está vazia</strong><span>Adicione uma senha para começar.</span></div>'}</section>`;
}

function renderDashboard() {
  const tenant = tenants[state.tenantKey];
  const data = getTenantData();
  const viewTitles = {
    overview: ["Visão geral", `Acompanhe o movimento da ${tenant.shortName} hoje.`],
    appointments: ["Agenda", "Visualize e organize os horários do dia."],
    queue: ["Fila de senhas", "Gerencie a ordem e o tempo de atendimento."],
  };
  const [title, subtitle] = viewTitles[state.dashboardView] || viewTitles.overview;
  const content = state.dashboardView === "queue" ? queueView(data) : state.dashboardView === "appointments" ? appointmentsView(data) : overviewView(data);
  app.innerHTML = `<div class="dashboard">
    <aside class="sidebar ${state.mobileSidebarOpen ? "mobile-open" : ""}">
      <a href="#/"><img class="brand-logo" src="./public/imagens/logo_agendae.png" alt="Agendae" /></a>
      <button class="workspace-switcher" data-tenant-menu><span class="workspace-avatar">${tenant.initials}</span><span class="workspace-meta"><strong>${tenant.name}</strong><small>${tenant.category}</small></span><span>⌄</span></button>
      <div class="sidebar-label">Gestão</div>
      <nav class="side-nav">
        <button class="side-link ${state.dashboardView === "overview" ? "active" : ""}" data-view="overview"><span class="nav-icon">${icon("home")}</span>Visão geral</button>
        <button class="side-link ${state.dashboardView === "appointments" ? "active" : ""}" data-view="appointments"><span class="nav-icon">${icon("calendar")}</span>Agenda</button>
        <button class="side-link ${state.dashboardView === "queue" ? "active" : ""}" data-view="queue"><span class="nav-icon">${icon("queue")}</span>Fila de senhas</button>
        <button class="side-link" data-coming-soon><span class="nav-icon">${icon("users")}</span>Clientes</button>
        <button class="side-link" data-coming-soon><span class="nav-icon">${icon("chart")}</span>Relatórios</button>
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="demo-note"><strong>Modo demonstração</strong><br>Os dados ficam salvos apenas neste navegador.</div>
      <button class="side-link" data-coming-soon><span class="nav-icon">${icon("settings")}</span>Configurações</button>
      <a class="side-link" href="#/"><span class="nav-icon">←</span>Voltar ao site</a>
    </aside>
    <main class="dashboard-main">
      <header class="dash-topbar"><button class="icon-button mobile-dash-toggle" data-sidebar-toggle aria-label="Abrir menu">${icon("menu")}</button><div class="dash-title"><h1>${title}</h1><p>${subtitle}</p></div><div class="top-actions"><button class="icon-button" aria-label="Notificações" data-notifications>${icon("bell")}</button><a class="btn btn-primary btn-sm" href="#/agendar">${icon("plus")} Novo agendamento</a></div></header>
      ${content}
    </main>
  </div>${state.tenantMenuOpen ? `<div class="tenant-menu">${Object.entries(tenants).map(([key, item]) => `<button data-select-tenant="${key}"><span class="workspace-avatar">${item.initials}</span><span class="workspace-meta"><strong>${item.name}</strong><small>${key === state.tenantKey ? "Ambiente atual" : "Trocar ambiente"}</small></span></button>`).join("")}</div>` : ""}`;
}

function renderApi() {
  app.innerHTML = `${header("api")}<main>
    <section class="api-hero"><div class="api-hero-inner"><div><div class="eyebrow" style="color:#ffcf49;background:rgba(255,255,255,.07);border-color:#34528f">API Agendae</div><h1>Seu site. Nosso motor de agendamento.</h1><p>Conecte disponibilidade, serviços e reservas diretamente à experiência digital que sua empresa já possui.</p><a class="btn btn-yellow" href="#/agendar">Ver fluxo funcionando ${icon("arrow")}</a></div>
      <div class="code-card"><div class="code-head"><span>POST /v1/appointments</span><span>JSON</span></div><pre>{
  <span class="code-key">"establishment_id"</span>: <span class="code-string">"est_9x2k"</span>,
  <span class="code-key">"service_id"</span>: <span class="code-string">"srv_corte"</span>,
  <span class="code-key">"starts_at"</span>: <span class="code-string">"2026-09-25T14:30:00-03:00"</span>,
  <span class="code-key">"customer"</span>: {
    <span class="code-key">"name"</span>: <span class="code-string">"Marina Costa"</span>,
    <span class="code-key">"phone"</span>: <span class="code-string">"+5511999990000"</span>
  }
}</pre></div></div></section>
    <section class="api-content"><div class="section-heading"><div class="kicker">Integração sem atrito</div><h2>Feita para crescer junto com o seu negócio</h2><p>Uma API única para consultar horários, criar reservas e acompanhar eventos do atendimento.</p></div>
      <div class="api-grid"><article class="api-card"><div class="feature-icon">${icon("lock")}</div><h3>Isolamento por empresa</h3><p>Cada credencial acessa somente os recursos do estabelecimento autorizado.</p></article><article class="api-card"><div class="feature-icon">${icon("code")}</div><h3>API REST</h3><p>Endpoints previsíveis, respostas em JSON e exemplos prontos para integração.</p></article><article class="api-card"><div class="feature-icon">↗</div><h3>Webhooks</h3><p>Receba eventos de confirmação, cancelamento e mudança na fila em tempo real.</p></article></div>
      <div class="roadmap-note"><span style="font-size:22px">ⓘ</span><span><strong>API em desenvolvimento.</strong><br>Esta versão apresenta a experiência e o contrato planejado. Autenticação, endpoints reais e documentação pública entram junto com o backend.</span></div>
    </section></main>${footer()}`;
}

function getRoute() {
  return location.hash.replace(/^#\/?/, "").split("?")[0] || "home";
}

function render() {
  const route = getRoute();
  if (route === "agendar") renderBooking();
  else if (route === "painel") renderDashboard();
  else if (route === "api") renderApi();
  else renderHome();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toast(message, symbol = "✓") {
  const element = document.createElement("div");
  element.className = "toast";
  element.innerHTML = `<span style="color:var(--success);font-size:18px">${symbol}</span><span>${escapeHTML(message)}</span>`;
  document.querySelector("#toast-region").appendChild(element);
  setTimeout(() => element.remove(), 3200);
}

function addQueueTicket() {
  const data = getTenantData();
  const prefix = state.tenantKey === "clinica" ? "A" : "B";
  const highest = data.queue.reduce((max, item) => Math.max(max, Number(item.ticket.split("-")[1]) || 0), 0);
  const service = tenants[state.tenantKey].services[(highest + 1) % tenants[state.tenantKey].services.length];
  data.queue.push({ ticket: `${prefix}-${String(highest + 1).padStart(3, "0")}`, name: "Cliente sem agendamento", service: service.name, wait: "agora", status: "aguardando" });
  setTenantData(data);
  toast(`Senha ${prefix}-${String(highest + 1).padStart(3, "0")} adicionada à fila.`);
  renderDashboard();
}

function callNextTicket() {
  const data = getTenantData();
  const current = data.queue.find((item) => item.status === "atendendo");
  if (current) current.status = "concluido";
  const next = data.queue.find((item) => item.status === "aguardando");
  if (next) {
    next.status = "atendendo";
    setTenantData(data);
    toast(`Senha ${next.ticket} chamada para atendimento.`);
  } else {
    setTenantData(data);
    toast("Fila concluída. Ninguém aguardando.", "○");
  }
  renderDashboard();
}

document.addEventListener("click", (event) => {
  const scrollLink = event.target.closest("[data-scroll]");
  if (scrollLink) {
    const targetId = scrollLink.dataset.scroll;
    if (getRoute() !== "home") {
      sessionStorage.setItem("agendae:scroll-target", targetId);
      location.hash = "#/";
    } else {
      event.preventDefault();
      document.querySelector(`#${targetId}`)?.scrollIntoView({ behavior: "smooth" });
    }
    return;
  }

  const serviceButton = event.target.closest("[data-service]");
  if (serviceButton) {
    state.booking.serviceId = serviceButton.dataset.service;
    renderBooking();
    return;
  }

  const dateButton = event.target.closest("[data-date]");
  if (dateButton) {
    state.booking.date = dateButton.dataset.date;
    renderBooking();
    return;
  }

  const timeButton = event.target.closest("[data-time]");
  if (timeButton) {
    state.booking.time = timeButton.dataset.time;
    renderBooking();
    return;
  }

  if (event.target.closest("[data-booking-next]")) {
    if (state.booking.step === 1 && state.booking.serviceId) state.booking.step = 2;
    else if (state.booking.step === 2 && state.booking.date && state.booking.time) state.booking.step = 3;
    renderBooking();
    return;
  }

  if (event.target.closest("[data-booking-back]")) {
    state.booking.step = Math.max(1, state.booking.step - 1);
    renderBooking();
    return;
  }

  if (event.target.closest("[data-new-booking]")) {
    state.booking = { ...state.booking, step: 1, serviceId: null, professional: "", date: null, time: null, customer: { name: "", phone: "", email: "" }, confirmed: null };
    renderBooking();
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.dashboardView = viewButton.dataset.view;
    state.mobileSidebarOpen = false;
    renderDashboard();
    return;
  }

  if (event.target.closest("[data-tenant-menu]")) {
    state.tenantMenuOpen = !state.tenantMenuOpen;
    renderDashboard();
    return;
  }

  const tenantButton = event.target.closest("[data-select-tenant]");
  if (tenantButton) {
    state.tenantKey = tenantButton.dataset.selectTenant;
    state.tenantMenuOpen = false;
    localStorage.setItem("agendae:active-tenant", state.tenantKey);
    toast(`Ambiente alterado para ${tenants[state.tenantKey].name}.`);
    renderDashboard();
    return;
  }

  if (event.target.closest("[data-sidebar-toggle]")) {
    state.mobileSidebarOpen = !state.mobileSidebarOpen;
    renderDashboard();
    return;
  }

  if (event.target.closest("[data-queue-add]")) {
    addQueueTicket();
    return;
  }

  if (event.target.closest("[data-queue-next]")) {
    callNextTicket();
    return;
  }

  if (event.target.closest("[data-coming-soon]")) toast("Este módulo entra na próxima etapa do produto.", "ⓘ");
  if (event.target.closest("[data-notifications]")) toast("Você não tem novas notificações.", "○");
  if (event.target.closest("[data-mobile-menu]")) toast("Use os botões para explorar o agendamento e o painel.", "ⓘ");
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-booking-tenant]")) {
    state.booking.tenantKey = event.target.value;
    state.booking.serviceId = null;
    renderBooking();
  }
  if (event.target.matches("[data-professional]")) state.booking.professional = event.target.value;
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "customer-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  const tenant = tenants[state.booking.tenantKey];
  const service = tenant.services.find((item) => item.id === state.booking.serviceId);
  state.booking.customer = { name: form.get("name").trim(), phone: form.get("phone").trim(), email: form.get("email").trim() };
  const appointment = {
    id: crypto.randomUUID(),
    date: state.booking.date,
    time: state.booking.time,
    client: state.booking.customer.name,
    phone: state.booking.customer.phone,
    email: state.booking.customer.email,
    service: service.name,
    professional: state.booking.professional || tenant.professionals[0],
    status: "confirmado",
  };
  const data = getTenantData(state.booking.tenantKey);
  data.appointments.push(appointment);
  setTenantData(data, state.booking.tenantKey);
  state.booking.confirmed = appointment;
  state.booking.step = 4;
  renderBooking();
});

window.addEventListener("hashchange", () => {
  render();
  const target = sessionStorage.getItem("agendae:scroll-target");
  if (target && getRoute() === "home") {
    sessionStorage.removeItem("agendae:scroll-target");
    requestAnimationFrame(() => document.querySelector(`#${target}`)?.scrollIntoView({ behavior: "smooth" }));
  }
});

render();
