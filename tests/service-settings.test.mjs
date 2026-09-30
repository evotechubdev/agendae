import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { businessHoursForDate } from "../frontend/schedule-model.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const context = vm.createContext({
  escapeHTML: value => String(value), businessHoursForDate,
  session: () => ({ role: "admin" }),
});
vm.runInContext(source.slice(source.indexOf("function serviceIntervalMarkup("), source.indexOf("function hoursSettingsMarkup(")), context);
vm.runInContext(source.slice(source.indexOf("function storeSettingsMarkup("), source.indexOf("function apiSettingsMarkup(")), context);

test("loja oferece expediente independente em cada dia e segundo endereço", () => {
  const html = context.storeSettingsMarkup({ slug: "clinica", name: "Clínica", address: "Rua A", address2: "Rua B", hours: [
    { label: "Segunda", value: "08:00 - 12:00" }, { label: "Terça", value: "Fechado" },
  ], services: [], professionals: [] });
  assert.match(html, /name="address2" value="Rua B"/);
  assert.match(html, /name="day_seg_open" checked/);
  assert.match(html, /name="day_seg_end" value="12:00"/);
  assert.match(html, /name="day_ter_open" /);
  assert.doesNotMatch(html, /name="day_ter_open" checked/);
  assert.match(html, /name="day_dom_start"/);
});

test("serviço oferece local online e intervalos por dia", () => {
  const html = context.serviceSettingsMarkup({ services: [{
    id: "consulta", name: "Consulta", duration: 40, price: 100,
    locationType: "online", meetingUrl: "https://meet.example.test/sala",
    weeklyAvailability: { qua: [{ start: "09:00", end: "10:00" }, { start: "14:00", end: "16:00" }] },
  }] });
  assert.match(html, /value="online" selected>Atendimento On line/);
  assert.match(html, /name="meetingUrl" type="url" value="https:\/\/meet.example.test\/sala"/);
  assert.match(html, /data-service-day="qua"/);
  assert.match(html, /value="14:00"/);
  assert.match(html, /data-add-service-interval/);
});
