import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

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
