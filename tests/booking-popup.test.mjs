import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/professional.js", import.meta.url), "utf8");

function fixture() {
  const state = { booking: { step: 1, date: "2026-09-26", time: null, professional: "" }, publicLookup: {}, scheduleAuto: true };
  const listeners = {};
  let renders = 0, restoredFocus = 0;
  const slot = { dataset: { professionalName: "Renam", slotTime: "08:20" }, focus: () => { restoredFocus++; } };
  const context = vm.createContext({ state,
    document: { addEventListener: (name, callback) => { listeners[name] = callback; }, querySelector: () => null, querySelectorAll: () => [slot] },
    render: () => { renders++; }, requestAnimationFrame: callback => callback(),
    pauseScheduleTurn: () => { state.scheduleAuto = false; },
    escapeHTML: value => String(value), professionalInitial: name => name[0], prettyDate: value => value,
  });
  vm.runInContext(source.slice(source.indexOf("function selectedBookingPopup("), source.indexOf("function publicAccessMenu(")), context);
  vm.runInContext(source.slice(source.indexOf('document.addEventListener("click",'), source.indexOf('document.addEventListener("input",')), context);
  vm.runInContext(source.slice(source.indexOf('document.addEventListener("keydown",'), source.indexOf("\nrender();", source.indexOf('document.addEventListener("keydown",'))), context);
  const click = (selector, backdrop = false) => listeners.click({ preventDefault() {}, target: { closest: value => !backdrop && value === selector ? slot : null, matches: value => backdrop && value === selector } });
  return { context, state, click, listeners, get renders() { return renders; }, get restoredFocus() { return restoredFocus; } };
}

test("seleção abre o resumo e continua ao formulário sem perder o horário nem retomar a alternância", async () => {
  const f = fixture();
  const establishment = { professionals: [{ name: "Renam", role: "Barbeiro" }] };
  assert.equal(f.context.selectedBookingPopup(establishment), "");
  await f.click("[data-public-slot]");
  assert.equal(f.state.booking.step, 1);
  assert.equal(f.state.booking.time, "08:20");
  assert.equal(f.state.booking.professional, "Renam");
  assert.match(f.context.selectedBookingPopup(establishment), /role="dialog"/);
  await f.click("[data-booking-next]");
  assert.equal(f.state.booking.step, 2);
  assert.equal(f.context.selectedBookingPopup(establishment), "");
  await f.click("[data-booking-back]");
  assert.equal(f.state.booking.step, 1);
  assert.equal(f.state.booking.time, "08:20");
  assert.equal(f.state.scheduleAuto, false);
});

test("fechar pelo botão, fundo ou Escape libera a seleção e devolve o foco ao horário", async () => {
  for (const close of ["button", "backdrop", "escape", "form-backdrop"]) {
    const f = fixture();
    await f.click("[data-public-slot]");
    if (close === "form-backdrop") { await f.click("[data-booking-next]"); await f.click("[data-booking-modal-backdrop]", true); }
    else if (close === "escape") f.listeners.keydown({ key: "Escape" });
    else await f.click(close === "button" ? "[data-close-selected-booking]" : "[data-selected-booking-backdrop]", close === "backdrop");
    assert.equal(f.state.booking.time, null);
    assert.equal(f.state.booking.step, 1);
    assert.equal(f.state.scheduleAuto, false);
    assert.equal(f.restoredFocus, 1);
    assert.equal(f.context.selectedBookingPopup({}), "");
  }
});
