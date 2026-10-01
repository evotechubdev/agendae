import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { addressMapQuery, cachedMapPoint, mapEmbedUrl, validMapPoint } from "../frontend/address-map.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const panel = { outerHTML: "" };
const context = vm.createContext({
  state: { mapAddressType: "address1" },
  document: { querySelector: () => panel },
  escapeHTML: value => String(value),
  addressMapQuery, cachedMapPoint, mapEmbedUrl, validMapPoint,
});
vm.runInContext(source.slice(source.indexOf("function publicMapMarkup("), source.indexOf("function serviceWeeklyLabel(")), context);

test("o mapa troca o marcador para o segundo endereço selecionado", () => {
  const establishment = {
    name: "Clínica", address: "Rua A, 10", address2: "Rua B, 20",
    street: "Rua A", number: "10", city: "Salvador", state: "BA",
    street2: "Rua B", number2: "20", city2: "Salvador", state2: "BA",
  };
  establishment.mapCoordinates1 = { lat: -12.9, lon: -38.4, query: addressMapQuery(establishment) };
  establishment.mapCoordinates2 = { lat: -12.8, lon: -38.5, query: addressMapQuery(establishment, "2") };
  const first = context.publicMapMarkup(establishment);
  assert.match(first, /marker=-12\.9%2C-38\.4/);
  assert.match(first, /data-map-address="address2"/);
  context.selectPublicMapAddress(establishment, "address2");
  assert.equal(context.state.mapAddressType, "address2");
  assert.match(panel.outerHTML, /marker=-12\.8%2C-38\.5/);
  assert.doesNotMatch(panel.outerHTML, /marker=-12\.9%2C-38\.4/);
});
