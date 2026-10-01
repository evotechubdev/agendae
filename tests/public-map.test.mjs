import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { addressMapLabel, googleMapsPlaceQuery } from "../frontend/address-map.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const panel = { outerHTML: "" };
const cards = ["address1", "address2"].map(mapAddress => ({ dataset: { mapAddress }, pressed: "", setAttribute(name, value) { if (name === "aria-pressed") this.pressed = value; } }));
const context = vm.createContext({
  state: { mapAddressType: "address1" },
  firebaseApi: { googleMapsEmbedKey: "test-key" },
  URL,
  URLSearchParams,
  document: { querySelector: () => panel, querySelectorAll: () => cards },
  escapeHTML: value => String(value),
  addressMapLabel, googleMapsPlaceQuery,
});
vm.runInContext(source.slice(source.indexOf("function publicMapMarkup("), source.indexOf("function serviceWeeklyLabel(")), context);

test("o Google Maps mostra o local físico do endereço selecionado sem botão externo", () => {
  const establishment = {
    name: "Clínica", address: "Rua A, 10", address2: "Rua B, 20",
    street: "Rua A", number: "10", city: "Salvador", state: "BA", complement: "Edifício Bahia Center, sala 1306",
    street2: "Rua B", number2: "20", city2: "Salvador", state2: "BA", complement2: "Edifício B, sala 2",
  };
  const first = context.publicMapMarkup(establishment);
  assert.match(first, /<h2 id="public-location-title">Localização<\/h2>/);
  assert.match(first, /google\.com\/maps\/embed\/v1\/place\?key=test-key&amp;q=/);
  assert.match(decodeURIComponent(first.match(/&amp;q=([^"&]+)/)[1].replaceAll("+", " ")), /Edifício Bahia Center, Rua A, 10, Salvador, BA, Brasil/);
  assert.match(first, /Localização de Edifício Bahia Center, sala 1306/);
  assert.doesNotMatch(first, /Abrir no Google Maps|location-map\.html|maplibre/i);
  assert.match(first, /data-map-address="address2"/);
  assert.match(first, /class="public-location-selected">Endere.o 1<\/strong>/);
  context.selectPublicMapAddress(establishment, "address2");
  assert.equal(context.state.mapAddressType, "address2");
  assert.deepEqual(cards.map(card => card.pressed), ["false", "true"]);
  assert.match(panel.outerHTML, /class="public-location-selected">Endere.o 2<\/strong>/);
  assert.match(decodeURIComponent(panel.outerHTML.match(/&amp;q=([^"&]+)/)[1].replaceAll("+", " ")), /Edifício B, Rua B, 20, Salvador, BA, Brasil/);
  assert.doesNotMatch(panel.outerHTML, /Edifício Bahia Center/);
});

test("sem chave não carrega um mapa incorreto", () => {
  context.firebaseApi = null;
  context.state.mapAddressType = "address1";
  const html = context.publicMapMarkup({ address: "Rua A, 10" });
  assert.match(html, /Mapa indisponível no momento/);
  assert.doesNotMatch(html, /<iframe|Abrir no Google Maps/);
  context.firebaseApi = { googleMapsEmbedKey: "test-key" };
});
