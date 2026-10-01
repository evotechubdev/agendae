import assert from "node:assert/strict";
import test from "node:test";
import { addressMapLabel, googleMapsPlaceQuery } from "../frontend/address-map.mjs";

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
