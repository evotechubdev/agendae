import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { serviceAvailableAt, scheduleTimeline, businessDayIsClosed } from "../frontend/schedule-model.mjs";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");
const start = source.indexOf("function compactBusinessHours(");
const end = source.indexOf("function renderEstablishmentPublic(", start);
const context = vm.createContext({ escapeHTML: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") });
vm.runInContext(source.slice(start, end), context);
const render = (hours) => context.compactBusinessHours({ hours });

test("dias úteis e sábado aparecem juntos no painel de serviços", () => {
  for (const label of ["Dias úteis", "Seg a sex", "Segunda a sexta-feira", "Seg. – Sex."]) {
    const result = render([{ label, value: "08:00 - 18:00" }, { label: "Sábado", value: "08:00 - 17:00" }]);
    assert.match(result, /Seg a sex<\/strong> das 08:00 às 18:00/);
    assert.match(result, /Sáb<\/strong> das 08:00 às 17:00/);
  }
});

test("dias abreviados com o mesmo expediente são agrupados", () => {
  const result = render(["Seg", "Ter", "Qua", "Qui", "Sex"].map((label) => ({ label, value: "09:00 às 18:00" })));
  assert.match(result, /Seg a sex<\/strong> das 09:00 às 18:00/);
});

test("expedientes distintos por dia não são substituídos pelo horário de segunda", () => {
  const result = render([{ label: "Segunda", value: "09:00 - 18:00" }, { label: "Sexta", value: "09:00 - 16:00" }]);
  assert.match(result, /Seg<\/strong> das 09:00 às 18:00/);
  assert.match(result, /Sex<\/strong> das 09:00 às 16:00/);
  assert.doesNotMatch(result, /Seg a sex/);
});

test("serviço só cabe no intervalo do dia e no expediente da loja", () => {
  const store = { hours: [{ label: "Segunda", value: "08:00 - 12:00" }, { label: "Terça", value: "Fechado" }, { label: "Quarta", value: "13:00 - 19:00" }] };
  const service = { duration: 40, weeklyAvailability: { seg: [{ start: "09:00", end: "10:00" }], qua: [{ start: "14:00", end: "15:00" }] } };
  assert.equal(serviceAvailableAt(store, service, "2026-09-28", "09:00"), true);
  assert.equal(serviceAvailableAt(store, service, "2026-09-28", "09:30"), false);
  assert.equal(serviceAvailableAt(store, service, "2026-09-29", "09:00"), false);
  assert.equal(serviceAvailableAt(store, service, "2026-09-30", "14:00"), true);
  assert.equal(serviceAvailableAt(store, { duration: 40 }, "2026-09-28", "11:30"), false);
});

test("cada endereço atende somente no seu expediente e a agenda reúne os turnos", () => {
  const store = {
    address2: "Clínica B", hours: [{ label: "Segunda", value: "08:00 - 12:00" }, { label: "Terça", value: "Fechado" }],
    hours2: [{ label: "Segunda", value: "14:00 - 18:00" }, { label: "Terça", value: "09:00 - 13:00" }],
    professionals: [{ name: "Ana", availableTimes: ["08:00", "09:00", "11:40", "14:00", "17:40"] }],
  };
  const first = { locationType: "address1", duration: 40 };
  const second = { locationType: "address2", duration: 40 };
  assert.equal(serviceAvailableAt(store, first, "2026-09-28", "09:00"), true);
  assert.equal(serviceAvailableAt(store, first, "2026-09-28", "14:00"), false);
  assert.equal(serviceAvailableAt(store, second, "2026-09-28", "09:00"), false);
  assert.equal(serviceAvailableAt(store, second, "2026-09-28", "14:00"), true);
  assert.equal(serviceAvailableAt(store, second, "2026-09-28", "17:40"), false);
  assert.equal(serviceAvailableAt(store, first, "2026-09-28", "11:40"), false);
  assert.equal(businessDayIsClosed(store, "2026-09-29"), false);
  assert.equal(businessDayIsClosed(store, "2026-09-29", "address1"), true);
  assert.deepEqual(scheduleTimeline(store, [], "2026-09-28").professionals[0].availableTimes, ["08:00", "09:00", "11:40", "14:00", "17:40"]);
  assert.equal(serviceAvailableAt({ ...store, address2: "" }, second, "2026-09-28", "14:00"), false);
});

test("linha do tempo mostra somente o expediente do dia selecionado", () => {
  const store = { hours: [{ label: "Segunda", value: "08:00 - 12:00" }, { label: "Quarta", value: "13:00 - 19:00" }],
    professionals: [{ name: "Ana", availableTimes: ["08:00", "09:00", "13:00", "14:00"] }] };
  const monday = scheduleTimeline(store, [], "2026-09-28");
  const wednesday = scheduleTimeline(store, [], "2026-09-30");
  assert.equal(monday.startTime, "08:00");
  assert.equal(monday.endTime, "12:00");
  assert.equal(wednesday.startTime, "13:00");
  assert.equal(wednesday.endTime, "19:00");
  assert.deepEqual(wednesday.professionals[0].availableTimes, ["13:00", "14:00"]);
});
