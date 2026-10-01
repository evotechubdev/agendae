import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const address1 = "Avenida A, 10 - Centro, Salvador - BA, 40000-000";
const address2 = "Rua B, 20 - Comércio, Salvador - BA, 40000-001";
const services = [
  { id: "first", name: "Consulta", duration: 20, price: 0, locationType: "address1" },
  { id: "second", name: "Retorno", duration: 30, price: 0, locationType: "address2" },
  { id: "online", name: "Consulta remota", duration: 30, price: 0, locationType: "online" },
];
const establishment = { name: "Clínica", address: address1, address2, services };
const location = { hidden: true, text: { textContent: "" }, querySelector() { return this.text; } };
const state = { booking: { step: 2, date: "2026-10-01", time: "10:00", professional: "Ana", serviceId: "" } };
const context = vm.createContext({
  state, document: { querySelector: () => location }, escapeHTML: value => String(value),
  businessDayIsClosed: () => false, serviceAvailableAt: () => true, serviceFitsSlot: () => true,
  getData: () => ({ slots: [] }), prettyDate: () => "1º de outubro", scheduledTicket: () => "A001",
  currency: { format: value => `R$ ${value}` },
});
for (const [start, end] of [
  ["function bookingContent(", "function publicSchedule("],
  ["function serviceLocationLabel(", "function publicMapMarkup("],
  ["function serviceWeeklyLabel(", "function moveServiceCarousel("],
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);

test("cartões de serviços mostram só Presencial ou Online", () => {
  const html = context.publicServiceCards(establishment);
  assert.match(html, /20 minutos · Presencial/);
  assert.match(html, /30 minutos · Online/);
  assert.doesNotMatch(html, /Avenida A|Rua B|Endereço 1:|Endereço 2:/);
});

test("formulário mostra o endereço completo apenas após escolher o serviço", () => {
  const initial = context.bookingContent(establishment);
  assert.match(initial, /data-booking-service-location[^>]*hidden/);
  assert.doesNotMatch(initial, /Avenida A|Rua B/);

  state.booking.serviceId = "second";
  const selected = context.bookingContent(establishment);
  assert.match(selected, /30 minutos · Presencial/);
  assert.match(selected, /Local do atendimento<\/strong><span>Rua B, 20 - Comércio, Salvador - BA, 40000-001/);
  assert.doesNotMatch(selected, /Avenida A/);

  context.updateBookingServiceLocation(establishment, services[0]);
  assert.equal(location.hidden, false);
  assert.equal(location.text.textContent, address1);
  context.updateBookingServiceLocation(establishment, services[2]);
  assert.equal(location.text.textContent, "Online");
});

test("confirmação preserva o endereço completo do segundo local", () => {
  state.booking.step = 3;
  state.booking.confirmation = { service: "Retorno", date: "2026-10-01", time: "10:00", professional: "Ana", locationType: "address2", serviceAddress: "", checkInCode: "1234" };
  const html = context.bookingContent(establishment);
  assert.match(html, /<span>Local<\/span><strong>Rua B, 20 - Comércio, Salvador - BA, 40000-001<\/strong>/);
  assert.doesNotMatch(html, /Avenida A/);
});
