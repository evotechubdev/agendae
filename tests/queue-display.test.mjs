import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { TICKET_STATES, allProfessionalsClosed } from "../frontend/queue-model.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const context = vm.createContext({ TICKET_STATES, allProfessionalsClosed, escapeHTML: (value) => String(value) });
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
