import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { addressMapLabel, addressMapQuery, cachedMapPoint, googleMapsPlaceQuery, validMapPoint } from "../frontend/address-map.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const panel = { outerHTML: "" };
const context = vm.createContext({
  state: { mapAddressType: "address1" },
  BASE: "",
  location: { origin: "https://agendae.example" },
  URL,
  URLSearchParams,
  document: { querySelector: () => panel },
  escapeHTML: value => String(value),
  addressMapLabel, addressMapQuery, cachedMapPoint, googleMapsPlaceQuery, validMapPoint,
});
vm.runInContext(source.slice(source.indexOf("function publicMapMarkup("), source.indexOf("function serviceWeeklyLabel(")), context);

test("o mapa troca o marcador para o segundo endereço selecionado", () => {
  const establishment = {
    name: "Clínica", address: "Rua A, 10", address2: "Rua B, 20",
    street: "Rua A", number: "10", city: "Salvador", state: "BA", complement: "Edifício Bahia Center, sala 1306",
    street2: "Rua B", number2: "20", city2: "Salvador", state2: "BA", complement2: "Edifício B, sala 2",
  };
  establishment.mapCoordinates1 = { lat: -12.9, lon: -38.4, query: addressMapQuery(establishment) };
  establishment.mapCoordinates2 = { lat: -12.8, lon: -38.5, query: addressMapQuery(establishment, "2") };
  const first = context.publicMapMarkup(establishment);
  assert.match(first, /location-map\.html\?lat=-12\.9&amp;lon=-38\.4/);
  assert.match(first, /name=Edif%C3%ADcio\+Bahia\+Center%2C\+sala\+1306/);
  assert.match(first, /Abrir no Google Maps/);
  assert.match(decodeURIComponent(first.match(/google\.com\/maps\/search\/\?api=1&amp;query=([^" ]+)/)[1]), /Edifício Bahia Center, Rua A, 10, Salvador, BA, Brasil/);
  assert.doesNotMatch(first, /name=Cl%C3%ADnica/);
  assert.match(first, /data-map-address="address2"/);
  context.selectPublicMapAddress(establishment, "address2");
  assert.equal(context.state.mapAddressType, "address2");
  assert.match(panel.outerHTML, /location-map\.html\?lat=-12\.8&amp;lon=-38\.5/);
  assert.match(panel.outerHTML, /name=Edif%C3%ADcio\+B%2C\+sala\+2/);
  assert.match(decodeURIComponent(panel.outerHTML.match(/google\.com\/maps\/search\/\?api=1&amp;query=([^" ]+)/)[1]), /Edifício B, Rua B, 20, Salvador, BA, Brasil/);
  assert.doesNotMatch(panel.outerHTML, /location-map\.html\?lat=-12\.9&amp;lon=-38\.4/);
});
