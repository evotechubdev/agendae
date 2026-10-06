import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("widget distribuível é isolado e não contém segredo", async () => {
  const [widget, manual, manualHtml, manualPdf, professional, rules] = await Promise.all([
    readFile(new URL("frontend/integracoes/agendae-booking-widget.js", root), "utf8"),
    readFile(new URL("frontend/integracoes/INSTALACAO.md", root), "utf8"),
    readFile(new URL("frontend/integracoes/manual-instalacao-api-agendae.html", root), "utf8"),
    readFile(new URL("frontend/integracoes/manual-instalacao-api-agendae.pdf", root)),
    readFile(new URL("frontend/professional.js", root), "utf8"),
    readFile(new URL("firestore.rules", root), "utf8"),
  ]);

  assert.match(widget, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(widget, /dataset\.agendaeApi/);
  assert.match(widget, /logo_agendae\.png/);
  assert.match(widget, /request\("\/catalog"\)/);
  assert.match(widget, /request\("\/appointments"/);
  assert.match(widget, /bookingMode === "daily"/);
  assert.match(widget, /elements\.date\.disabled = state\.dailyTicketsOnly/);
  assert.match(widget, />Agendamento e Senha</);
  assert.doesNotMatch(widget, /Agendamento por Agendae|Agende seu atendimento|Reserva on-line|Escolha o melhor horário para você|Os horários são consultados em tempo real/);
  assert.doesNotMatch(widget, /ag_live_[A-Za-z0-9_-]{10,}/);
  assert.match(manual, /API_AGENDAE_\{SLUG/);
  assert.match(manual, /data-agendae-open/);
  assert.match(manual, /data-agendae-api/);
  assert.match(manualHtml, /API Agendae/);
  assert.match(manualHtml, /API_AGENDAE_\{SLUG_EM_MAIÚSCULAS\}/);
  assert.match(manualHtml, /data-agendae-open/);
  assert.equal(manualPdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(manualPdf.length > 100_000);
  assert.match(professional, /manual-instalacao-api-agendae\.pdf/);
  assert.match(professional, /Materiais de Apoio/);
  assert.match(professional, /name="bookingMode"/);
  assert.match(professional, /Somente senhas diárias/);
  assert.match(rules, /'bookingMode'/);
});
