import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { addressMapLabel, googleMapsEmbedUrl, googleMapsPlaceQuery } from "../frontend/address-map.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const panel = { outerHTML: "" };
const context = vm.createContext({
  state: { mapAddressType: "address1" },
  firebaseApi: { googleMapsEmbedKey: "test-key" },
  URL,
  URLSearchParams,
  document: { querySelector: () => panel },
  escapeHTML: value => String(value),
  addressMapLabel, googleMapsEmbedUrl, googleMapsPlaceQuery,
});
vm.runInContext(source.slice(source.indexOf("function publicMapMarkup("), source.indexOf("function serviceWeeklyLabel(")), context);

test("o Google Maps mostra o local físico do endereço selecionado sem botão externo", () => {
  const establishment = {
    name: "Clínica", address: "Rua A, 10", address2: "Rua B, 20",
    street: "Rua A", number: "10", city: "Salvador", state: "BA", complement: "Edifício Bahia Center, sala 1306",
    street2: "Rua B", number2: "20", city2: "Salvador", state2: "BA", complement2: "Edifício B, sala 2",
  };
  const first = context.publicMapMarkup(establishment);
  assert.match(first, /google\.com\/maps\/embed\/v1\/place\?key=test-key&amp;q=/);
  assert.match(decodeURIComponent(first.match(/&amp;q=([^"&]+)/)[1].replaceAll("+", " ")), /Edifício Bahia Center, Rua A, 10, Salvador, BA, Brasil/);
  assert.match(first, /Localização de Edifício Bahia Center, sala 1306/);
  assert.doesNotMatch(first, /Abrir no Google Maps|location-map\.html|maplibre/i);
  assert.match(first, /data-map-address="address2"/);
  context.selectPublicMapAddress(establishment, "address2");
  assert.equal(context.state.mapAddressType, "address2");
  assert.match(decodeURIComponent(panel.outerHTML.match(/&amp;q=([^"&]+)/)[1].replaceAll("+", " ")), /Edifício B, Rua B, 20, Salvador, BA, Brasil/);
  assert.doesNotMatch(panel.outerHTML, /Edifício Bahia Center/);
});

test("mapa fixo funciona sem chave e acompanha o endereço selecionado", () => {
  context.firebaseApi = null;
  context.state.mapAddressType = "address1";
  const establishment = { address: "Rua A, 10", address2: "Rua B, 20", mapEmbedUrl: "https://www.google.com/maps/embed?pb=local1", mapEmbedUrl2: "https://www.google.com/maps/embed?pb=local2" };
  const html = context.publicMapMarkup(establishment);
  assert.match(html, /google\.com\/maps\/embed\?pb=local1/);
  assert.doesNotMatch(html, /embed\/v1\/place|Abrir no Google Maps/);
  context.selectPublicMapAddress(establishment, "address2");
  assert.match(panel.outerHTML, /google\.com\/maps\/embed\?pb=local2/);
  assert.doesNotMatch(panel.outerHTML, /pb=local1/);
  const missing = context.publicMapMarkup({ address: "Rua A, 10" });
  assert.match(missing, /Mapa deste endereço ainda não cadastrado/);
  assert.doesNotMatch(missing, /<iframe|Abrir no Google Maps/);
  context.state.mapAddressType = "address1";
  context.firebaseApi = { googleMapsEmbedKey: "test-key" };
});
