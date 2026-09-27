import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { TICKET_STATES, allProfessionalsClosed } from "../frontend/queue-model.mjs";
import { businessOpeningMinutes } from "../frontend/schedule-model.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const context = vm.createContext({ TICKET_STATES, allProfessionalsClosed, businessOpeningMinutes, escapeHTML: (value) => String(value) });
vm.runInContext(source.slice(source.indexOf("function queueDetail("), source.indexOf("function ticketStatusLegend(")), context);

test("card encerrado mostra Encerrado e nome sem código ou horário nulo", () => {
  const html = context.currentTicketCards([{ professional: "Renam Silva", ticketState: "closed", ticket: null, time: null, kind: "scheduled" }]);
  assert.match(html, /ticket-state-closed/);
  assert.match(html, /<strong>Encerrado<\/strong>/);
  assert.match(html, /Renam Silva/);
  assert.doesNotMatch(html, /null/);
});

test("bolinha só recebe a classe preta se todos estiverem encerrados", () => {
  assert.match(context.liveStatusDot([{ ticketState: "closed" }, { ticketState: "closed" }]), /class="live-dot closed"/);
  assert.doesNotMatch(context.liveStatusDot([{ ticketState: "closed" }, { ticketState: "in-service" }]), /live-dot closed/);
  assert.doesNotMatch(context.liveStatusDot([{ ticketState: "paused" }]), /live-dot closed/);
  assert.doesNotMatch(context.liveStatusDot([]), /live-dot closed/);
});

test("pausa de almoço exibe o motivo abaixo de Pausado sem código de senha", () => {
  const html = context.currentTicketCards([{ professional: "Renam Silva", ticketState: "paused", ticket: null, pauseReason: "Almoço", kind: "scheduled" }]);
  assert.match(html, /<strong>Pausado<\/strong><small class="current-ticket-reason">Almoço<\/small>/);
  assert.doesNotMatch(html, /null|RSI-/);
});

test("data futura exibe expediente não iniciado com indicador preto sem senhas de hoje", () => {
  context.state = { booking: { date: "2026-09-28" } };
  context.queueView = () => { throw new Error("Não deve exibir atendimento de hoje em uma data futura"); };
  const html = context.publicCurrentAttendance({}, {}, { date: "2026-09-27", minutes: 10 * 60 });
  assert.match(html, /class="live-dot closed" aria-label="Expediente não Iniciado"/);
  assert.match(html, /role="status">Expediente não Iniciado/);
  assert.doesNotMatch(html, /current-ticket-list|Pausado|Encerrado/);
});

test("voltar para hoje ou alcançar a data selecionada restaura o atendimento atual", () => {
  context.state = { booking: { date: "2026-09-28" } };
  context.queueView = () => ({ current: [{ ticket: "RSI-01", time: "08:00", professional: "Renam", ticketState: "in-service", kind: "scheduled" }] });
  let html = context.publicCurrentAttendance({}, {}, { date: "2026-09-28", minutes: 8 * 60 });
  assert.match(html, /RSI-01/);
  assert.doesNotMatch(html, /Expediente não Iniciado|live-dot closed/);
  context.state.booking.date = "2026-09-27";
  html = context.publicCurrentAttendance({}, {}, { date: "2026-09-27", minutes: 8 * 60 });
  assert.match(html, /RSI-01/);
  assert.doesNotMatch(html, /Expediente não Iniciado/);
});

test("hoje antes da abertura fica preto e retoma exatamente ao iniciar o expediente", () => {
  context.state = { booking: { date: "2026-09-28" } };
  const establishment = { hours: [{ label: "Seg a sex", value: "08:00 - 18:00" }], professionals: [{ name: "Renam", availableTimes: ["08:00"] }] };
  context.queueView = () => ({ current: [{ ticket: "RSI-01", professional: "Renam", time: "08:00", kind: "scheduled", ticketState: "in-service" }] });
  const before = context.publicCurrentAttendance(establishment, {}, { date: "2026-09-28", minutes: 479 });
  assert.match(before, /live-dot closed/);
  assert.match(before, /role="status">Expediente não Iniciado/);
  assert.doesNotMatch(before, /RSI-01/);
  const atOpening = context.publicCurrentAttendance(establishment, {}, { date: "2026-09-28", minutes: 480 });
  assert.match(atOpening, /RSI-01/);
  assert.doesNotMatch(atOpening, /Expediente não Iniciado|live-dot closed/);
});

test("abertura respeita o dia, o minuto exato e a grade quando não há horário comercial", () => {
  const establishment = { hours: [{ label: "Dias úteis", value: "08:30 - 18:00" }, { label: "Sábado", value: "09:20 - 17:00" }, { label: "Domingo", value: "Fechado" }], professionals: [{ name: "Renam", availableTimes: ["08:00"] }] };
  assert.equal(businessOpeningMinutes(establishment, "2026-09-28"), 510);
  assert.equal(businessOpeningMinutes(establishment, "2026-09-26"), 560);
  assert.equal(businessOpeningMinutes(establishment, "2026-09-27"), null);
  establishment.hours.push({ label: "Segunda", value: "10:00 - 18:00" });
  assert.equal(businessOpeningMinutes(establishment, "2026-09-28"), 600);
  assert.equal(businessOpeningMinutes({ professionals: [{ name: "A", availableTimes: ["09:20"] }, { name: "B", availableTimes: ["08:40"] }] }, "2026-09-28"), 520);
});
