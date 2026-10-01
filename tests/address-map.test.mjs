import assert from "node:assert/strict";
import test from "node:test";
import { addressFallbackQuery, addressMapQuery, geocodeAddress, singleEstablishmentStyle, validMapPoint } from "../frontend/address-map.mjs";

test("cada endereço gera sua própria busca e um mapa com marcador", () => {
  const establishment = {
    street: "Avenida Antônio Carlos Magalhães", number: "100", city: "Salvador", state: "BA", complement: "Edifício Bahia Center, sala 1306",
    street2: "Rua Chile", number2: "20", city2: "Salvador", state2: "BA",
  };
  const first = addressMapQuery(establishment);
  const second = addressMapQuery(establishment, "2");
  assert.equal(first, "Edifício Bahia Center, Salvador, BA, Brasil");
  assert.equal(addressMapQuery({ ...establishment, complement2: "Sala 1306, Edifício Chile" }, "2"), "Edifício Chile, Salvador, BA, Brasil");
  assert.match(addressFallbackQuery(establishment), /Avenida Antônio Carlos Magalhães, 100, Salvador, BA, Brasil/);
  assert.match(second, /Rua Chile, 20, Salvador, BA, Brasil/);
  assert.notEqual(first, second);
  const point = { lat: -12.98, lon: -38.47, query: second };
  assert.equal(validMapPoint(point, second), true);
  assert.equal(validMapPoint(point, first), false);
  const style = singleEstablishmentStyle({ layers: [
    { id: "streets", type: "line" },
    { id: "clinic", type: "symbol", "source-layer": "poi" },
    { id: "road-name", type: "symbol", "source-layer": "transportation_name" },
  ] });
  assert.deepEqual(style.layers.map(layer => layer.id), ["streets", "road-name"]);
  assert.equal(addressMapQuery({ address: "Avenida Antônio Carlos Magalhães, Edifício Bahia Center, sala 1306, Salvador Bahia" }), "Avenida Antônio Carlos Magalhães, Salvador Bahia");
});

test("geocodificação guarda coordenadas de uma rua para reutilização", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  const calls = [];
  globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  globalThis.fetch = async url => {
    calls.push(String(url));
    return { ok: true, json: async () => [{ lat: "-12.98", lon: "-38.47", addresstype: "road" }] };
  };
  try {
    const query = "Avenida Antônio Carlos Magalhães, Salvador Bahia";
    const point = await geocodeAddress(query);
    assert.deepEqual(point, { lat: -12.98, lon: -38.47, query, matchedBy: "address" });
    assert.match(calls[0], /countrycodes=br/);
    assert.deepEqual(await geocodeAddress(query), point);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
  }
});

test("busca edifício primeiro e usa a rua se o edifício não estiver no mapa", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(new URL(url).searchParams.get("q"));
    return { ok: true, json: async () => calls.length === 1 ? [] : [{ lat: "-12.98", lon: "-38.47", addresstype: "road" }] };
  };
  try {
    const point = await geocodeAddress("Edifício Bahia Center, Salvador, BA, Brasil", "Avenida Antônio Carlos Magalhães, 100, Salvador, BA, Brasil");
    assert.deepEqual(calls, ["Edifício Bahia Center, Salvador, BA, Brasil", "Avenida Antônio Carlos Magalhães, 100, Salvador, BA, Brasil"]);
    assert.equal(point.matchedBy, "address");
    assert.equal(point.query, calls[0]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
  }
});
