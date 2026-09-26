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
