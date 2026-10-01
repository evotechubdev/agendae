import assert from "node:assert/strict";
import test from "node:test";
import { newEstablishment } from "../frontend/establishment-model.mjs";

const project = "demo-agendae";
const root = `projects/${project}/databases/(default)/documents`;
const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/${root}`;

function tokenFor(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: `https://securetoken.google.com/${project}`, aud: project, sub: uid, user_id: uid, iat: now, exp: now + 3600, firebase: { sign_in_provider: "password" } })).toString("base64url");
  return `${header}.${payload}.`;
}

function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, field(value)]));
}

function field(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  return { mapValue: { fields: fields(value) } };
}

async function request(path, body, token = "owner") {
  const response = await fetch(`${base}${path}`, {
    method: path === ":commit" ? "POST" : "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function write(path, data, mask) {
  return { update: { name: `${root}/${path}`, fields: fields(data) }, ...(mask ? { updateMask: { fieldPaths: Object.keys(data) } } : {}) };
}

test("somente o backend cria a loja e a conta; a loja exige configuração para publicar", async () => {
  const details = newEstablishment({ name: "Nova Loja", ownerPassword: "senha123" });
  const create = { writes: [
    write("establishments/novaloja", details.establishment),
    write("users/owner", { name: "Administrador", email: "novaloja-admin@agendae.com.br", role: "admin", establishmentSlug: "novaloja", mustChangePassword: true }),
  ] };
  const denied = await request(":commit", create, tokenFor("visitor"));
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  const deniedSystem = await request(":commit", create, tokenFor("sys"));
  assert.equal(deniedSystem.status, 403, JSON.stringify(deniedSystem.body));
  const created = await request(":commit", create);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const premature = await request(":commit", { writes: [write("establishments/novaloja", { setupComplete: true }, true)] }, tokenFor("owner"));
  assert.equal(premature.status, 403, JSON.stringify(premature.body));
  const booking = await request(":commit", { writes: [write("establishments/novaloja/appointments/test", { id: "test", date: "2026-10-01", time: "09:00", client: "Cliente", phone: "11999999999", service: "Corte", professional: "Ana", status: "confirmado", checkInCode: "ABC123", durationMinutes: 20 })] }, tokenFor("visitor"));
  assert.equal(booking.status, 403, JSON.stringify(booking.body));
  const profile = await request(":commit", { writes: [write("establishments/novaloja", { name: "Nova Loja", initials: "NL", category: "Salão", neighborhood: "Centro", address: "Rua A, 10", hours: [{ label: "Seg a sex", value: "08:00 - 18:00" }] }, true)] }, tokenFor("owner"));
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  const catalog = await request(":commit", { writes: [write("establishments/novaloja", { professionals: [{ name: "Ana", availableTimes: ["09:00"] }], availableTimes: ["09:00"], services: [{ id: "corte", name: "Corte", duration: 20, price: 0 }] }, true)] }, tokenFor("owner"));
  assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
  const published = await request(":commit", { writes: [write("establishments/novaloja", { setupComplete: true }, true)] }, tokenFor("owner"));
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const addressUpdate = {
    street: "Avenida Antônio Carlos Magalhães", number: "2671", neighborhood: "Brotas", zipCode: "40280-900", city: "Salvador", state: "BA", complement: "Edifício Bahia Center, sala 1306", address: "Avenida Antônio Carlos Magalhães, 2671 - Salvador, BA",
    street2: "Rua B", number2: "SN", neighborhood2: "Centro", zipCode2: "40000-000", city2: "Salvador", state2: "BA", complement2: "Edifício B", address2: "Rua B, SN - Salvador, BA",
    mapCoordinates1: { lat: -13, lon: -38, query: "Edifício Bahia Center, Salvador, BA, Brasil" }, mapCoordinates2: { lat: -13, lon: -38, query: "Edifício B, Salvador, BA, Brasil" },
  };
  const edited = await request(":commit", { writes: [write("establishments/novaloja", addressUpdate, true)] }, tokenFor("owner"));
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const visitorEdit = await request(":commit", { writes: [write("establishments/novaloja", { complement: "Outro edifício" }, true)] }, tokenFor("visitor"));
  assert.equal(visitorEdit.status, 403, JSON.stringify(visitorEdit.body));
});
