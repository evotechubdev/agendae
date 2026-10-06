import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("widget distribuível é isolado e não contém segredo", async () => {
  const [widget, manual] = await Promise.all([
    readFile(new URL("frontend/integracoes/agendae-booking-widget.js", root), "utf8"),
    readFile(new URL("frontend/integracoes/INSTALACAO.md", root), "utf8"),
  ]);

  assert.match(widget, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(widget, /dataset\.agendaeApi/);
  assert.match(widget, /logo_agendae\.png/);
  assert.match(widget, /request\("\/catalog"\)/);
  assert.match(widget, /request\("\/appointments"/);
  assert.doesNotMatch(widget, /ag_live_[A-Za-z0-9_-]{10,}/);
  assert.match(manual, /API_AGENDAE_\{SLUG/);
  assert.match(manual, /data-agendae-open/);
  assert.match(manual, /data-agendae-api/);
});
