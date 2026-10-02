import test from "node:test";
import assert from "node:assert/strict";

const project = "demo-agendae";
const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents`;
const root = `projects/${project}/databases/(default)/documents`;
const token = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: `https://securetoken.google.com/${project}`, aud: project, sub: "employee", user_id: "employee", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, firebase: { sign_in_provider: "password" } })).toString("base64url")}.`;
let nextId = 0;

function fields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    typeof value === "number" ? { integerValue: String(value) } : typeof value === "boolean" ? { booleanValue: value } : typeof value === "string" ? { stringValue: value } : Array.isArray(value) ? { arrayValue: { values: value.map(item => ({ mapValue: { fields: fields(item) } })) } } : { mapValue: { fields: fields(value) } },
  ]));
}

async function request(path, body, auth = "owner") {
  const response = await fetch(`${base}${path}`, { method: path === ":commit" ? "POST" : "PATCH", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function seed(path, data) {
  const result = await request(`/${path}`, { fields: fields(data) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
}

function write(path, data, checkedIn = false) {
  return { update: { name: `${root}/${path}`, fields: fields(data) }, ...(checkedIn ? { updateTransforms: [{ fieldPath: "checkedInAt", setToServerValue: "REQUEST_TIME" }] } : {}) };
}

async function setup() {
  await seed("establishments/demo", { active: true, services: [{ name: "Corte", duration: 20 }, { name: "Combo", duration: 70 }], serviceDurations: { Corte: 20, Combo: 70 } });
  await seed("establishments/demo/checkIn/config", { token: "qr-token" });
  await seed("users/employee", { establishmentSlug: "demo", role: "employee" });
}

function appointmentAt(offsetMinutes = 0, dateOffset = 0) {
  const instant = new Date(Date.now() + offsetMinutes * 60000 + dateOffset * 86400000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, professional: "Rafael", service: "Corte", durationMinutes: 20, status: "confirmado" };
}

async function confirm(appointment, method) {
  const id = `presence-${++nextId}`;
  const appointmentPath = `establishments/demo/appointments/${id}`;
  const presencePath = `establishments/demo/appointmentPresence/${id}`;
  const slotPath = `establishments/demo/slots/${id}`;
  const slot = { date: appointment.date, time: appointment.time, professional: appointment.professional, service: appointment.service };
  await seed(appointmentPath, appointment);
  await seed(presencePath, { appointmentId: id, date: appointment.date, status: "confirmado" });
  await seed(slotPath, slot);
  return request(":commit", { writes: [
    write(appointmentPath, { ...appointment, status: "presente", checkInMethod: method, ...(method === "qr" ? { checkInToken: "qr-token" } : {}) }, true),
    write(presencePath, { appointmentId: id, date: appointment.date, status: "presente", checkInMethod: method }, true),
    write(slotPath, { ...slot, appointmentId: id, status: "presente", checkInMethod: method }, true),
  ] }, method === "qr" ? null : token);
}

test("banco permite presença dentro da janela e rejeita antecipação, atraso e outra data para QR e equipe", async () => {
  await setup();
  for (const method of ["qr", "employee"]) {
    const active = await confirm(appointmentAt(), method);
    assert.equal(active.status, 200, JSON.stringify(active.body));
    for (const appointment of [appointmentAt(61), appointmentAt(-21), appointmentAt(0, 1), appointmentAt(0, -1)]) {
      const blocked = await confirm(appointment, method);
      assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
    }
  }
});

test("reserva pública grava a duração e os documentos de consulta sob as novas regras", async () => {
  for (const legacy of [false, true]) {
  const id = `booking-${++nextId}`;
  const appointment = { ...appointmentAt(60), id, client: "Cliente", phone: "11999999999", checkInCode: "ABC123" };
  const item = { appointmentId: id, date: appointment.date, time: appointment.time, professional: appointment.professional, service: appointment.service, status: "confirmado", durationMinutes: 20 };
  if (legacy) { delete appointment.durationMinutes; delete item.durationMinutes; }
  else {
    Object.assign(appointment, { locationType: "online", serviceAddress: "", meetingUrl: "https://meet.example.com/consulta" });
    Object.assign(item, { locationType: "online", serviceAddress: "" });
  }
  const result = await request(":commit", { writes: [
    write(`establishments/demo/appointments/${id}`, appointment),
    write(`establishments/demo/slots/${id}`, { date: item.date, time: item.time, professional: item.professional, service: item.service }),
    write(`establishments/demo/appointmentLookups/${id}`, { appointments: [item] }),
    write(`establishments/demo/appointmentCodeLookups/${id}`, { appointments: [{ ...item, ...(!legacy ? { meetingUrl: appointment.meetingUrl } : {}) }] }),
    write(`establishments/demo/appointmentPresence/${id}`, { appointmentId: id, date: item.date, status: "confirmado" }),
  ] }, null);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  }
});

test("reserva antiga sem duração usa a duração do catálogo no servidor", async () => {
  const appointment = { ...appointmentAt(-30), service: "Combo" };
  delete appointment.durationMinutes;
  // O horário anterior precisa pertencer ao mesmo dia real.
  if (appointment.date !== appointmentAt().date) return;
  for (const method of ["qr", "employee"]) {
    const result = await confirm(appointment, method);
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
});

test("expediente extra só pode ser liberado pela equipe vinculada ao estabelecimento", async () => {
  const denied = await request("/establishments/demo?updateMask.fieldPaths=extraWorkingDates", { fields: fields({ extraWorkingDates: { "2099-10-04": true } }) }, null);
  assert.equal(denied.status, 403);
  const allowed = await request("/establishments/demo?updateMask.fieldPaths=extraWorkingDates", { fields: fields({ extraWorkingDates: { "2099-10-04": true } }) }, token);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
});

test("reserva pública é bloqueada para funcionário que encerrou o expediente", async () => {
  const closed = appointmentAt(60);
  await seed("establishments/demo", { staffClosedDates: { Rafael: closed.date } });
  for (const [professional, expectedStatus] of [["Rafael", 403], ["Ana", 200]]) {
    const id = `closed-day-${++nextId}`;
    const appointment = { ...closed, id, professional, client: "Cliente", phone: "11999999999", checkInCode: "ABC123" };
    const slot = { date: closed.date, time: closed.time, professional, service: "Corte" };
    const result = await request(":commit", { writes: [
      write(`establishments/demo/appointments/${id}`, appointment),
      write(`establishments/demo/slots/${id}`, slot),
    ] }, null);
    assert.equal(result.status, expectedStatus, JSON.stringify(result.body));
  }
});

test("chave de integração não pode ser lida pelo navegador, mesmo com login administrativo", async () => {
  await seed("establishments/demo/apiAccess/primary", { hash: "somente-no-servidor" });
  for (const authorization of [null, token]) {
    const response = await fetch(`${base}/establishments/demo/apiAccess/primary`, {
      headers: authorization ? { Authorization: `Bearer ${authorization}` } : {},
    });
    assert.equal(response.status, 403);
  }
});
