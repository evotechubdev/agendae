import assert from "node:assert/strict";
import test from "node:test";
import { addressMapLabel, googleMapsEmbedUrl, googleMapsPlaceQuery } from "../frontend/address-map.mjs";

test("cada endereço busca seu local físico no Google Maps", () => {
  const establishment = {
    street: "Avenida Antônio Carlos Magalhães", number: "100", city: "Salvador", state: "BA", complement: "Edifício Bahia Center, sala 1306",
    street2: "Rua Chile", number2: "20", city2: "Salvador", state2: "BA",
  };
  assert.equal(addressMapLabel(establishment), "Edifício Bahia Center, sala 1306");
  assert.equal(googleMapsPlaceQuery(establishment), "Edifício Bahia Center, Avenida Antônio Carlos Magalhães, 100, Salvador, BA, Brasil");
  assert.equal(googleMapsPlaceQuery(establishment, "2"), "Rua Chile, 20, Salvador, BA, Brasil");
  assert.equal(googleMapsPlaceQuery({ ...establishment, number: "SN" }), "Edifício Bahia Center, Avenida Antônio Carlos Magalhães, Salvador, BA, Brasil");
  assert.equal(googleMapsPlaceQuery({ address: "Rua A, 10, Salvador" }), "Rua A, 10, Salvador");
});

test("aceita somente o código de incorporação do Google Maps", () => {
  const source = "https://www.google.com/maps/embed?pb=%21local1&amp;hl=pt-BR";
  assert.equal(googleMapsEmbedUrl(`<iframe src="${source}" width="600" height="450"></iframe>`), "https://www.google.com/maps/embed?pb=%21local1&hl=pt-BR");
  assert.equal(googleMapsEmbedUrl(source), "https://www.google.com/maps/embed?pb=%21local1&hl=pt-BR");
  assert.equal(googleMapsEmbedUrl("https://www.google.com/maps/search/?api=1&query=Salvador"), "");
  assert.equal(googleMapsEmbedUrl('<iframe src="https://evil.example/maps/embed?pb=abc"></iframe>'), "");
  assert.equal(googleMapsEmbedUrl('<iframe src="javascript:alert(1)"></iframe>'), "");
});
