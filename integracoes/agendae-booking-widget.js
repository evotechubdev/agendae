/*
 * Agendae Booking Widget
 * Interface de agendamento independente para sites clientes.
 * Configuração: data-agendae-api no elemento <script> que carrega este arquivo.
 */
(function agendaeBookingWidget() {
  "use strict";

  const loader = document.currentScript;
  const config = {
    apiBase: String(loader?.dataset.agendaeApi || "").trim().replace(/\/$/, ""),
    establishmentName: String(loader?.dataset.agendaeEstablishment || "").trim(),
    logoUrl: String(loader?.dataset.agendaeLogo || "https://evotechubdev.github.io/agendae/public/imagens/logo_agendae.png").trim(),
    openSelector: String(loader?.dataset.agendaeOpenSelector || "[data-agendae-open]").trim(),
  };

  const state = {
    catalog: null,
    availabilityController: null,
    returnFocus: null,
    previousOverflow: "",
  };

  let host;
  let root;
  let elements;

  const styles = `
    :host { all: initial; color-scheme: light; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center;
      padding: 24px; background: rgba(4, 19, 48, .72); backdrop-filter: blur(5px);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .dialog {
      display: flex; width: min(940px, 100%); max-height: min(880px, calc(100dvh - 48px));
      flex-direction: column; overflow: hidden; border: 1px solid rgba(255,255,255,.2);
      border-radius: 22px; background: #fff; box-shadow: 0 32px 90px rgba(0, 16, 48, .34);
    }
    .head {
      display: flex; min-height: 88px; align-items: center; justify-content: space-between; gap: 22px;
      padding: 15px 18px 15px 26px; border-bottom: 1px solid #dce5f1;
      background: linear-gradient(135deg, #f8fbff, #eef4ff);
    }
    .brand { display: flex; min-width: 0; align-items: center; gap: 22px; }
    .logo { width: 152px; height: 48px; object-fit: contain; }
    .logo-fallback { color: #073b91; font-size: 1.55rem; font-weight: 900; letter-spacing: -.06em; }
    .brand-copy { display: flex; min-width: 0; flex-direction: column; }
    .brand-copy span { color: #1752a5; font-size: .68rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .brand-copy strong { overflow: hidden; color: #102c52; font-size: 1.04rem; text-overflow: ellipsis; white-space: nowrap; }
    .close {
      display: grid; width: 44px; height: 44px; flex: 0 0 44px; place-items: center; padding: 0;
      border: 1px solid #cbd8e8; border-radius: 50%; background: #fff; color: #173b6b;
      cursor: pointer; font: 400 1.7rem/1 Arial, sans-serif;
    }
    .close:hover { border-color: #0b4ca3; background: #edf4ff; }
    .close:focus-visible, :is(input, select, button):focus-visible { outline: 3px solid rgba(255, 189, 0, .5); outline-offset: 2px; }
    .content { min-height: 0; overflow-y: auto; padding: clamp(24px, 4vw, 42px); background: #fff; }
    .loading { display: grid; min-height: 320px; place-items: center; color: #55677e; font-size: .96rem; font-weight: 700; text-align: center; }
    .loading.error { color: #a33131; }
    form { display: grid; gap: 28px; margin: 0; }
    .intro span, .success > span:not(.success-icon) { color: #0b4ca3; font-size: .7rem; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
    .intro h2, .success h2 { margin: 6px 0 8px; color: #102c52; font-size: clamp(1.45rem, 3vw, 2rem); line-height: 1.16; letter-spacing: -.025em; }
    .intro p, .success p { margin: 0; color: #637287; line-height: 1.55; }
    .fields { display: grid; grid-template-columns: 1.25fr 1fr .85fr; gap: 14px; }
    .client-fields { grid-template-columns: 1fr 1fr; }
    label.field { display: grid; gap: 8px; color: #344a68; font-size: .8rem; font-weight: 800; }
    :is(input, select) {
      width: 100%; min-height: 50px; padding: 0 13px; border: 1px solid #c9d6e5; border-radius: 10px;
      background: #fff; color: #183653; font-family: inherit; font-size: .91rem; font-weight: 500;
    }
    :is(input, select):focus { border-color: #0b4ca3; outline: none; box-shadow: 0 0 0 3px rgba(11, 76, 163, .1); }
    fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
    legend { margin-bottom: 12px; color: #203a5b; font-size: .92rem; font-weight: 850; }
    .empty { margin: 0; padding: 18px; border: 1px dashed #c6d4e4; border-radius: 10px; background: #f7faff; color: #6d7e92; text-align: center; }
    .slot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(126px, 1fr)); gap: 9px; }
    .slot { position: relative; }
    .slot input { position: absolute; opacity: 0; pointer-events: none; }
    .slot span {
      display: grid; min-height: 62px; place-content: center; padding: 8px; border: 1px solid #cbd8e7;
      border-radius: 10px; background: #fff; color: #233f61; cursor: pointer; text-align: center; transition: 150ms ease;
    }
    .slot strong { font-size: .96rem; }
    .slot small { margin-top: 3px; color: #6c7c90; font-size: .69rem; }
    .slot input:checked + span { border-color: #0b4ca3; background: #edf4ff; box-shadow: inset 0 0 0 1px #0b4ca3; color: #073b91; }
    .slot input:focus-visible + span { outline: 3px solid rgba(255, 189, 0, .5); outline-offset: 2px; }
    .actions { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-top: 20px; border-top: 1px solid #e1e8f1; }
    .message { margin: 0; color: #a33131; font-size: .82rem; font-weight: 750; }
    .message.success { color: #176b44; }
    .button {
      min-height: 50px; padding: 0 22px; border: 1px solid transparent; border-radius: 10px;
      cursor: pointer; font-family: inherit; font-size: .88rem; font-weight: 800; transition: 150ms ease;
    }
    .button.primary { background: #0b4ca3; color: #fff; box-shadow: 0 8px 22px rgba(11, 76, 163, .2); }
    .button.primary:hover { background: #073b91; }
    .button.secondary { border-color: #c3d1e3; background: #fff; color: #0b4ca3; }
    .button:disabled { cursor: not-allowed; opacity: .5; box-shadow: none; }
    .success { display: grid; max-width: 620px; justify-items: center; gap: 11px; margin: 0 auto; padding: 20px 0; text-align: center; }
    .success-icon { display: grid; width: 70px; height: 70px; place-items: center; margin-bottom: 5px; border-radius: 50%; background: #fff3cb; color: #073b91; font-size: 2rem; font-weight: 900; }
    .success dl { display: grid; width: 100%; grid-template-columns: repeat(2, 1fr); gap: 1px; overflow: hidden; margin: 14px 0 0; border: 1px solid #d9e3ef; border-radius: 11px; background: #d9e3ef; text-align: left; }
    .success dl div { padding: 13px 15px; background: #fff; }
    .success dt { color: #708095; font-size: .68rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    .success dd { margin: 3px 0 0; color: #183653; font-weight: 800; }
    .checkin { width: 100%; padding: 17px; border-radius: 11px; background: #073b91; color: #fff; }
    .checkin span, .checkin strong { display: block; }
    .checkin span { font-size: .7rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .checkin strong { margin-top: 5px; font-size: 1.7rem; letter-spacing: .12em; }
    @media (max-width: 700px) {
      .backdrop { padding: 0; }
      .dialog { width: 100%; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
      .head { min-height: 68px; padding: 10px 10px 10px 15px; }
      .brand { gap: 12px; }
      .logo { width: 112px; height: 37px; }
      .brand-copy span { display: none; }
      .brand-copy strong { font-size: .86rem; }
      .content { padding: 23px 16px 32px; }
      .fields, .client-fields { grid-template-columns: 1fr; }
      .slot-grid { grid-template-columns: repeat(2, 1fr); }
      .actions { align-items: stretch; flex-direction: column; }
      .actions .button { width: 100%; }
      .success dl { grid-template-columns: 1fr; }
    }
  `;

  const markup = `
    <div class="backdrop" part="backdrop" hidden>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="agendae-widget-title">
        <header class="head">
          <div class="brand">
            <img class="logo" alt="Agendae">
            <span class="logo-fallback" hidden>Agendae</span>
            <div class="brand-copy"><span>Agendamento por Agendae</span><strong id="agendae-widget-title">Agende seu atendimento</strong></div>
          </div>
          <button class="close" type="button" aria-label="Fechar agendamento">&times;</button>
        </header>
        <div class="content">
          <div class="loading" role="status">Carregando serviços e profissionais…</div>
          <form hidden>
            <div class="intro"><span>Reserva on-line</span><h2>Escolha o melhor horário para você</h2><p class="catalog-message">Os horários são consultados em tempo real.</p></div>
            <div class="fields">
              <label class="field"><span>Serviço</span><select name="service" required><option value="">Selecione um serviço</option></select></label>
              <label class="field"><span>Profissional</span><select name="professionalFilter"><option value="">Qualquer profissional</option></select></label>
              <label class="field"><span>Data</span><input name="date" type="date" required></label>
            </div>
            <fieldset><legend>Horários disponíveis</legend><p class="empty">Selecione o serviço e a data para consultar os horários.</p><div class="slot-grid"></div></fieldset>
            <div class="fields client-fields">
              <label class="field"><span>Seu nome</span><input name="client" autocomplete="name" minlength="2" maxlength="80" required></label>
              <label class="field"><span>Telefone com DDD</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" minlength="10" maxlength="22" pattern="\\+?[0-9 ()-]{10,22}" placeholder="(71) 99999-9999" required></label>
            </div>
            <div class="actions"><p class="message" role="status" aria-live="polite"></p><button class="button primary submit" type="submit" disabled>Confirmar agendamento</button></div>
          </form>
          <section class="success" aria-live="polite" tabindex="-1" hidden>
            <span class="success-icon" aria-hidden="true">✓</span><span>Agendamento confirmado</span>
            <h2 class="success-title">Seu horário está reservado.</h2><dl class="success-details"></dl>
            <div class="checkin"><span>Código de presença</span><strong class="checkin-code"></strong></div>
            <p>Guarde esse código para consultar e confirmar sua presença no Agendae.</p>
            <button class="button secondary new-booking" type="button">Fazer outro agendamento</button>
          </section>
        </div>
      </section>
    </div>`;

  function localDate(date = new Date()) {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(date);
  }

  function maximumDate() {
    const date = new Date(`${localDate()}T12:00:00Z`);
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    return date.toISOString().slice(0, 10);
  }

  async function request(path, options = {}) {
    if (!config.apiBase) throw new Error("A URL da API de agendamento não foi configurada.");
    const response = await fetch(`${config.apiBase}${path}`, {
      method: options.method || "GET",
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Não foi possível consultar a agenda neste momento.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setMessage(message = "", success = false) {
    elements.message.textContent = message;
    elements.message.classList.toggle("success", success);
  }

  function selectedSlot() {
    return elements.form.querySelector('input[name="slot"]:checked');
  }

  function updateSubmit() {
    elements.submit.disabled = !selectedSlot() || !elements.form.checkValidity();
  }

  function clearSlots(message) {
    elements.slotGrid.replaceChildren();
    elements.empty.textContent = message;
    elements.empty.hidden = false;
    updateSubmit();
  }

  function renderCatalog(catalog) {
    elements.service.replaceChildren(new Option("Selecione um serviço", ""));
    (catalog.services || []).forEach((service) => {
      const price = Number(service.price);
      const suffix = Number.isFinite(price) && price > 0
        ? ` · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(price)}` : "";
      elements.service.add(new Option(`${service.name}${suffix}`, service.id || service.name));
    });
    elements.professional.replaceChildren(new Option("Qualquer profissional", ""));
    (catalog.professionals || []).forEach((professional) => {
      const label = professional.role ? `${professional.name} · ${professional.role}` : professional.name;
      elements.professional.add(new Option(label, professional.name));
    });
    const establishment = config.establishmentName || catalog.name;
    elements.catalogMessage.textContent = establishment
      ? `Os horários são consultados em tempo real na agenda de ${establishment}.`
      : "Os horários são consultados em tempo real.";
  }

  function renderSlots(slots) {
    elements.slotGrid.replaceChildren();
    if (!slots.length) {
      clearSlots("Não há horários disponíveis para essa seleção. Tente outra data ou profissional.");
      return;
    }
    elements.empty.hidden = true;
    slots.forEach((slot, index) => {
      const label = document.createElement("label");
      label.className = "slot";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "slot";
      input.value = String(index);
      input.dataset.time = slot.time;
      input.dataset.professional = slot.professional;
      input.required = true;
      const content = document.createElement("span");
      const time = document.createElement("strong");
      time.textContent = slot.time;
      const professional = document.createElement("small");
      professional.textContent = slot.professional;
      content.append(time, professional);
      label.append(input, content);
      elements.slotGrid.append(label);
    });
    updateSubmit();
  }

  async function loadCatalog() {
    if (state.catalog) return;
    elements.loading.hidden = false;
    elements.loading.classList.remove("error");
    elements.loading.textContent = "Carregando serviços e profissionais…";
    elements.form.hidden = true;
    elements.success.hidden = true;
    try {
      state.catalog = await request("/catalog");
      renderCatalog(state.catalog);
      elements.loading.hidden = true;
      elements.form.hidden = false;
    } catch (error) {
      elements.loading.classList.add("error");
      elements.loading.textContent = error.message;
    }
  }

  async function updateAvailability() {
    const service = elements.service.value;
    const date = elements.date.value;
    state.availabilityController?.abort();
    setMessage();
    if (!service || !date) {
      clearSlots("Selecione o serviço e a data para consultar os horários.");
      return;
    }
    const controller = new AbortController();
    state.availabilityController = controller;
    clearSlots("Consultando horários disponíveis…");
    const query = new URLSearchParams({ date, service });
    if (elements.professional.value) query.set("professional", elements.professional.value);
    try {
      const availability = await request(`/availability?${query}`, { signal: controller.signal });
      if (state.availabilityController === controller) renderSlots(availability.slots || []);
    } catch (error) {
      if (error.name === "AbortError") return;
      clearSlots("Não foi possível carregar os horários.");
      setMessage(error.message);
    }
  }

  function detail(term, description) {
    const wrapper = document.createElement("div");
    const title = document.createElement("dt");
    const value = document.createElement("dd");
    title.textContent = term;
    value.textContent = description || "—";
    wrapper.append(title, value);
    return wrapper;
  }

  function showSuccess(booking) {
    const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${booking.date}T12:00:00Z`));
    elements.successTitle.textContent = `${booking.service} reservado para ${date}.`;
    elements.successDetails.replaceChildren(
      detail("Horário", booking.time),
      detail("Profissional", booking.professional),
      detail("Atendimento", booking.locationType === "online" ? "On-line" : booking.serviceAddress || "Local informado pelo estabelecimento"),
      detail("Status", "Confirmado")
    );
    elements.checkinCode.textContent = booking.checkInCode || "—";
    elements.form.hidden = true;
    elements.success.hidden = false;
    elements.success.focus();
  }

  function reset() {
    elements.form.reset();
    elements.date.min = localDate();
    elements.date.max = maximumDate();
    clearSlots("Selecione o serviço e a data para consultar os horários.");
    setMessage();
    elements.success.hidden = true;
    elements.form.hidden = false;
  }

  async function submit(event) {
    event.preventDefault();
    const slot = selectedSlot();
    if (!slot || !elements.form.reportValidity()) return;
    const form = new FormData(elements.form);
    elements.submit.disabled = true;
    elements.submit.textContent = "Confirmando…";
    setMessage();
    try {
      const booking = await request("/appointments", { method: "POST", body: {
        date: form.get("date"), time: slot.dataset.time, professional: slot.dataset.professional,
        service: form.get("service"), client: String(form.get("client") || "").trim(), phone: String(form.get("phone") || "").trim(),
      } });
      showSuccess(booking);
    } catch (error) {
      setMessage(error.message);
      if (error.status === 409) await updateAvailability();
    } finally {
      elements.submit.textContent = "Confirmar agendamento";
      updateSubmit();
    }
  }

  function open() {
    if (!elements.backdrop.hidden) return;
    state.returnFocus = document.activeElement;
    state.previousOverflow = document.documentElement.style.overflow;
    elements.backdrop.hidden = false;
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => elements.close.focus());
    void loadCatalog();
  }

  function close() {
    if (elements.backdrop.hidden) return;
    elements.backdrop.hidden = true;
    document.documentElement.style.overflow = state.previousOverflow;
    state.returnFocus?.focus?.();
  }

  function initialize() {
    if (host) return;
    host = document.createElement("agendae-booking-widget");
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${styles}</style>${markup}`;
    document.body.append(host);
    elements = {
      backdrop: root.querySelector(".backdrop"), close: root.querySelector(".close"), loading: root.querySelector(".loading"),
      form: root.querySelector("form"), service: root.querySelector('[name="service"]'), professional: root.querySelector('[name="professionalFilter"]'),
      date: root.querySelector('[name="date"]'), slotGrid: root.querySelector(".slot-grid"), empty: root.querySelector(".empty"),
      message: root.querySelector(".message"), submit: root.querySelector(".submit"), success: root.querySelector(".success"),
      successTitle: root.querySelector(".success-title"), successDetails: root.querySelector(".success-details"),
      checkinCode: root.querySelector(".checkin-code"), newBooking: root.querySelector(".new-booking"), catalogMessage: root.querySelector(".catalog-message"),
    };
    const logo = root.querySelector(".logo");
    const logoFallback = root.querySelector(".logo-fallback");
    logo.src = config.logoUrl;
    logo.addEventListener("error", () => { logo.hidden = true; logoFallback.hidden = false; });
    elements.date.min = localDate();
    elements.date.max = maximumDate();
    elements.close.addEventListener("click", close);
    elements.backdrop.addEventListener("click", event => { if (event.target === elements.backdrop) close(); });
    elements.service.addEventListener("change", updateAvailability);
    elements.professional.addEventListener("change", updateAvailability);
    elements.date.addEventListener("change", updateAvailability);
    elements.form.addEventListener("input", updateSubmit);
    elements.form.addEventListener("change", updateSubmit);
    elements.form.addEventListener("submit", submit);
    elements.newBooking.addEventListener("click", reset);
    document.addEventListener("click", event => { if (event.target.closest(config.openSelector)) open(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !elements.backdrop.hidden) close(); });
    window.AgendaeBooking = Object.freeze({ open, close });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
