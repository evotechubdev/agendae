import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { lunchBreakFor, isLunchTime, scheduleFromPeriods, scheduleMatrix, workPeriodsFor, serviceFitsSlot, serviceAvailableAt, businessDayIsClosed, appointmentDurationMinutes, appointmentPresenceWindow } from "./schedule-model.mjs";
import { normalizeWeeklyAvailability, normalizeReservedService } from "./establishment-model.mjs";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export const integrationApiBaseUrl = "https://agendae-backend-t5ax.onrender.com";
let firebaseConfigResponse;
try {
  firebaseConfigResponse = await fetch(`${integrationApiBaseUrl}/v1/config/firebase`, { cache: "no-store" });
} catch {
  throw new Error("Não foi possível carregar a configuração do Firebase no Render.");
}
if (!firebaseConfigResponse.ok) throw new Error("Configuração do Firebase indisponível no Render.");
const { mapsEmbedKey, ...firebaseConfig } = await firebaseConfigResponse.json();
export const googleMapsEmbedKey = String(mapsEmbedKey || "").trim();
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

async function systemRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${integrationApiBaseUrl}/v1/admin/system/${path}`, { cache: "no-store", ...options });
  } catch {
    throw new Error("Não foi possível conectar à API no Render. Tente novamente.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Não foi possível concluir a operação.");
  return result;
}

async function authenticatedSystemRequest(path, options = {}) {
  if (!auth.currentUser) throw new Error("Entre como administrador do sistema.");
  const token = await auth.currentUser.getIdToken();
  return systemRequest(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
}

async function integrationAdminRequest(slug, method = "GET") {
  if (!auth.currentUser) throw new Error("Entre como administrador para configurar a API.");
  const token = await auth.currentUser.getIdToken(true);
  let response;
  try {
    response = await fetch(`${integrationApiBaseUrl}/v1/admin/establishments/${encodeURIComponent(slug)}/api-key`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    throw new Error("Não foi possível conectar à API no Render. Verifique se o serviço está publicado.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Não foi possível configurar a chave de API.");
  return result;
}

export function getIntegrationApiKeyStatus(slug) {
  return integrationAdminRequest(slug);
}

export function generateIntegrationApiKey(slug) {
  return integrationAdminRequest(slug, "POST");
}

export function revokeIntegrationApiKey(slug) {
  return integrationAdminRequest(slug, "DELETE");
}

function documentKey(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-");
}

function slotRefsForAppointment(slug, appointment) {
  const base = `${appointment.date}_${String(appointment.time).replace(":", "")}`;
  return [
    doc(db, "establishments", slug, "slots", `${base}_${documentKey(appointment.professional)}`),
    doc(db, "establishments", slug, "slots", `${base}_establishment`),
  ];
}

async function existingAppointmentSlot(transaction, slug, appointment) {
  const snapshots = await Promise.all(slotRefsForAppointment(slug, appointment).map((reference) => transaction.get(reference)));
  return snapshots.find((snapshot) => snapshot.exists())?.ref || null;
}

function nextEligibleAppointment(items, excludedId = "") {
  return items
    .filter((item) => item.id !== excludedId && item.professional && ["presente", "confirmado"].includes(item.status))
    .sort((a, b) => Number(b.status === "presente") - Number(a.status === "presente") || String(a.time).localeCompare(String(b.time)))[0] || null;
}

function normalizedAppointmentName(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

async function appointmentLookupKey(slug, name) {
  const source = new TextEncoder().encode(`${slug}:${normalizedAppointmentName(name)}`);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function appointmentCodeLookupKey(slug, code) {
  const normalizedCode = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  const source = new TextEncoder().encode(`${slug}:code:${normalizedCode}`);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function profileFor(user) {
  if (!user) return null;
  const profileRef = doc(db, "users", user.uid);
  const profileSnapshot = await getDoc(profileRef);

  if (!profileSnapshot.exists()) {
    return authenticatedSystemRequest("session");
  }

  const profile = profileSnapshot.data();
  return {
    uid: user.uid,
    email: user.email,
    name: profile.name || user.displayName || user.email,
    role: profile.role || "staff",
    slug: profile.establishmentSlug,
    mustChangePassword: profile.mustChangePassword === true,
  };
}

export function observeSession(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) return callback(null);
    try {
      callback(await profileFor(user));
    } catch (error) {
      callback(null, error);
    }
  });
}

export async function login(email, password, remember = true, legacyEmail = "", expectedSlug = "") {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence).catch(() => {});
  let credential;
  let migrateLegacyEmail = false;

  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    const canTryLegacyAccount = legacyEmail
      && legacyEmail !== email
      && ["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(error.code);
    if (!canTryLegacyAccount) throw error;
    credential = await signInWithEmailAndPassword(auth, legacyEmail, password);
    migrateLegacyEmail = true;
  }

  try {
    const profile = await profileFor(credential.user);
    if (expectedSlug && profile.slug !== expectedSlug) {
      const mismatch = new Error("Funcionário vinculado a outro estabelecimento.");
      mismatch.code = "agendae/establishment-mismatch";
      throw mismatch;
    }

    if (migrateLegacyEmail) {
      await updateEmail(credential.user, email);
      await updateDoc(doc(db, "users", credential.user.uid), {
        email,
        updatedAt: serverTimestamp(),
      });
      profile.email = email;
    }

    return profile;
  } catch (error) {
    await signOut(auth);
    throw error;
  }
}

export async function logout() {
  await signOut(auth);
}

export async function changeOwnPassword(password) {
  if (!auth.currentUser) throw new Error("Entre novamente para trocar a senha.");
  await updatePassword(auth.currentUser, password);
  await updateDoc(doc(db, "users", auth.currentUser.uid), {
    mustChangePassword: false, updatedAt: serverTimestamp(),
  });
}

export async function loginSystemAdmin(login, password) {
  const input = String(login || "").trim().toLowerCase();
  const { email } = await systemRequest(`login-email?login=${encodeURIComponent(input)}`);
  await setPersistence(auth, browserLocalPersistence);
  const credential = await signInWithEmailAndPassword(auth, email, password);
  try {
    const profile = await profileFor(credential.user);
    if (profile.role !== "system_admin") {
      const error = new Error("Esta conta não possui acesso de administrador do sistema.");
      error.code = "agendae/system-admin-required";
      throw error;
    }
    return profile;
  } catch (error) {
    await signOut(auth);
    throw error;
  }
}

export async function createEstablishmentWithOwner(details) {
  return authenticatedSystemRequest("establishments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: details.name }),
  });
}

export async function saveStoreProfile(slug, profile) {
  const reference = doc(db, "establishments", slug);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) throw new Error("Estabelecimento não encontrado.");
  const establishment = snapshot.data();
  if (!profile.address2 && (establishment.services || []).some(service => service.locationType === "address2")) throw new Error("O Endereço 2 está associado a um serviço. Altere o local do serviço antes de remover o endereço.");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const slots = await getDocs(query(collection(db, "establishments", slug, "slots"), where("date", ">=", today)));
  const updated = { ...establishment, ...profile };
  if (slots.docs.some(item => {
    const booking = item.data();
    const service = (establishment.services || []).find(value => value.name === booking.service);
    return service && !serviceAvailableAt(updated, service, booking.date, booking.time);
  })) throw new Error("O novo expediente conflita com reservas futuras. Ajuste os horários ou reagende os atendimentos antes de salvar.");
  await updateDoc(reference, { ...profile, updatedAt: serverTimestamp() });
}

export async function publishStore(slug) {
  await updateDoc(doc(db, "establishments", slug), { setupComplete: true, updatedAt: serverTimestamp() });
}

export async function loadEstablishments() {
  const establishmentsQuery = query(collection(db, "establishments"), where("active", "==", true));
  const snapshot = await getDocs(establishmentsQuery);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function loadSystemEstablishments() {
  await authenticatedSystemRequest("session");
  const snapshot = await getDocs(collection(db, "establishments"));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function updateScheduleMode(slug, scheduleMode) {
  if (!['employee', 'establishment'].includes(scheduleMode)) throw new Error("Modelo de agenda inválido.");
  await updateDoc(doc(db, "establishments", slug), {
    scheduleMode,
    updatedAt: serverTimestamp(),
  });
}

export async function updateProfessionalLunchBreak(slug, professionalName, interval) {
  const reference = doc(db, "establishments", slug);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const establishment = snapshot.data();
    if (!establishment || !(establishment.professionals || []).some((item) => (typeof item === "string" ? item : item.name) === professionalName)) throw new Error("Profissional não encontrado.");
    if (interval && !lunchBreakFor({ ...establishment, professionalLunchBreaks: { [professionalName]: interval } }, professionalName)) throw new Error("Informe um intervalo de almoço válido.");
    const professionalLunchBreaks = { ...establishment.professionalLunchBreaks, [professionalName]: interval };
    const professionals = establishment.professionals.map((professional) => professional.name === professionalName && professional.slotDuration === 20
      ? { ...professional, ...scheduleFromPeriods(workPeriodsFor(professional)) }
      : professional);
    const changed = professionals.find(professional => professional.name === professionalName);
    if (changed?.slotDuration === 20) {
      const slotsSnapshot = await getDocs(query(collection(db, "establishments", slug, "slots"), where("professional", "==", professionalName)));
      const updated = { ...establishment, professionalLunchBreaks, professionals };
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      if (slotsSnapshot.docs.some(item => {
        const booking = item.data();
        return booking.date >= today && (!scheduleMatrix(updated, booking.date).professionals.find(item => item.name === professionalName)?.availableTimes.includes(booking.time) || !serviceFitsSlot(updated, professionalName, booking.time, booking.service, [], booking.date));
      })) throw new Error("Este almoço conflita com um agendamento existente. Ajuste o intervalo ou reagende o atendimento antes de salvar.");
    }
    const availableTimes = [...new Set(professionals.flatMap(item => item.availableTimes || establishment.availableTimes || []))].sort();
    transaction.update(reference, { professionalLunchBreaks, professionals, availableTimes, updatedAt: serverTimestamp() });
    return professionalLunchBreaks;
  });
}

export async function updateProfessionalWorkPeriods(slug, professionalName, periods) {
  const reference = doc(db, "establishments", slug);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const establishment = snapshot.data();
    const professional = (establishment?.professionals || []).find(item => item.name === professionalName);
    if (!professional) throw new Error("Profissional não encontrado.");
    const schedule = scheduleFromPeriods(periods);
    const professionals = establishment.professionals.map(item => item.name === professionalName ? { ...item, ...schedule } : item);
    const updated = { ...establishment, professionals };
    const slotsSnapshot = await getDocs(query(collection(db, "establishments", slug, "slots"), where("professional", "==", professionalName)));
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    if (slotsSnapshot.docs.some(item => {
      const booking = item.data();
      return booking.date >= today && (!scheduleMatrix(updated, booking.date).professionals.find(item => item.name === professionalName)?.availableTimes.includes(booking.time) || !serviceFitsSlot(updated, professionalName, booking.time, booking.service, [], booking.date));
    })) throw new Error("Esta escala conflita com um agendamento existente. Ajuste os períodos ou reagende o atendimento antes de salvar.");
    const availableTimes = [...new Set(professionals.flatMap(item => item.availableTimes || []))].sort();
    transaction.update(reference, { professionals, availableTimes, updatedAt: serverTimestamp() });
    return professionals;
  });
}

export async function saveProfessional(slug, originalName, details) {
  const name = String(details.name || "").trim().replace(/\s+/g, " ");
  const role = String(details.role || "").trim();
  if (!name || name.length > 80 || role.length > 80) throw new Error("Informe um nome e uma função válidos.");
  const reference = doc(db, "establishments", slug);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error("Estabelecimento não encontrado.");
    const establishment = snapshot.data();
    const existing = (establishment.professionals || []).map(item => typeof item === "string" ? { name: item, role: "", availableTimes: establishment.availableTimes || [] } : item);
    if (existing.some(item => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR") && item.name !== originalName)) throw new Error("Já existe um funcionário com este nome.");
    const current = existing.find(item => item.name === originalName);
    if (originalName && !current) throw new Error("Funcionário não encontrado.");
    if (current && originalName !== name) {
      const slots = await getDocs(query(collection(db, "establishments", slug, "slots"), where("professional", "==", originalName)));
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      if (slots.docs.some(item => item.data().date >= today)) throw new Error("Este funcionário possui reservas futuras. Mantenha o nome até os atendimentos terminarem.");
    }
    const professionals = current
      ? existing.map(item => item.name === originalName ? { ...item, name, role } : item)
      : [...existing, { name, role, slotDuration: 20, workPeriods: [], availableTimes: [], pauseIntervals: [] }];
    const professionalLunchBreaks = { ...establishment.professionalLunchBreaks };
    if (current && originalName !== name && Object.hasOwn(professionalLunchBreaks, originalName)) {
      professionalLunchBreaks[name] = professionalLunchBreaks[originalName];
      delete professionalLunchBreaks[originalName];
    }
    const reservedServices = (establishment.reservedServices || []).map(item => current && item.professional === originalName ? { ...item, professional: name } : item);
    transaction.update(reference, { professionals, professionalLunchBreaks, reservedServices, updatedAt: serverTimestamp() });
    return { professionals, professionalLunchBreaks, reservedServices };
  });
}

export async function removeProfessional(slug, name) {
  const reference = doc(db, "establishments", slug);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const establishment = snapshot.data();
    const professionals = (establishment?.professionals || []).filter(item => (typeof item === "string" ? item : item.name) !== name);
    if (!establishment || professionals.length === (establishment.professionals || []).length) throw new Error("Funcionário não encontrado.");
    if ((establishment.reservedServices || []).some(item => item.professional === name)) throw new Error("Este profissional tem serviços reservados. Remova-os antes de excluir o profissional.");
    const slots = await getDocs(query(collection(db, "establishments", slug, "slots"), where("professional", "==", name)));
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    if (slots.docs.some(item => item.data().date >= today)) throw new Error("Este funcionário possui reservas futuras. Remova após os atendimentos terminarem.");
    const professionalLunchBreaks = { ...establishment.professionalLunchBreaks };
    delete professionalLunchBreaks[name];
    const availableTimes = professionals.length && (establishment.scheduleMode === "establishment" || professionals.some(item => typeof item === "string"))
      ? establishment.availableTimes || []
      : [...new Set(professionals.flatMap(item => item.availableTimes || []))].sort();
    transaction.update(reference, { professionals, professionalLunchBreaks, availableTimes, updatedAt: serverTimestamp() });
    return { professionals, professionalLunchBreaks, availableTimes };
  });
}

export async function saveService(slug, serviceId, details) {
  const name = String(details.name || "").trim().replace(/\s+/g, " ");
  const duration = Number(details.duration);
  const price = Number(details.price);
  const icon = String(details.icon || "✦").trim().slice(0, 8) || "✦";
  if (!name || name.length > 80 || !Number.isInteger(duration) || duration < 1 || duration > 1440 || !Number.isFinite(price) || price < 0) throw new Error("Informe nome, duração e preço válidos.");
  const reference = doc(db, "establishments", slug);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error("Estabelecimento não encontrado.");
    const establishment = snapshot.data();
    const services = establishment.services || [];
    const current = services.find(item => item.id === serviceId);
    if (serviceId && !current) throw new Error("Serviço não encontrado.");
    if (services.some(item => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR") && item.id !== serviceId)) throw new Error("Já existe um serviço com este nome.");
    const locationType = String(details.locationType || current?.locationType || "address1");
    if (!["address1", "address2", "online"].includes(locationType)) throw new Error("Selecione um local de atendimento válido.");
    if (locationType === "address2" && !establishment.address2) throw new Error("Cadastre o Endereço 2 na aba Loja antes de usá-lo em um serviço.");
    const meetingUrl = locationType === "online" ? String(details.meetingUrl ?? current?.meetingUrl ?? "").trim() : "";
    if (meetingUrl) {
      let url;
      try { url = new URL(meetingUrl); } catch { throw new Error("Informe um link de reunião válido."); }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("O link de reunião deve começar com http ou https.");
    }
    const weeklyAvailability = Object.hasOwn(details, "weeklyAvailability") ? normalizeWeeklyAvailability(details.weeklyAvailability) : current?.weeklyAvailability ?? null;
    const coreChanged = current && (current.name !== name || Number(current.duration) !== duration || (current.locationType || "address1") !== locationType);
    const scheduleChanged = current && JSON.stringify(current.weeklyAvailability ?? null) !== JSON.stringify(weeklyAvailability);
    if (coreChanged || scheduleChanged) {
      const slots = await getDocs(query(collection(db, "establishments", slug, "slots"), where("service", "==", current.name)));
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      if (slots.docs.some(snapshot => {
        const booking = snapshot.data();
        return booking.date >= today && (coreChanged || !serviceAvailableAt(establishment, { ...current, duration, weeklyAvailability }, booking.date, booking.time));
      })) throw new Error("Este serviço possui reservas futuras incompatíveis. Mantenha o local, nome, duração e horários desses atendimentos.");
    }
    const item = { ...(current || {}), id: serviceId || documentKey(name) || crypto.randomUUID(), name, duration, price, icon, locationType, meetingUrl, weeklyAvailability };
    if (!current && services.some(service => service.id === item.id)) throw new Error("Já existe um serviço com este identificador.");
    const next = current ? services.map(service => service.id === serviceId ? item : service) : [...services, item];
    const serviceDurations = Object.fromEntries(next.map(service => [service.name, Number(service.duration) || 20]));
    transaction.update(reference, { services: next, serviceDurations, updatedAt: serverTimestamp() });
    return next;
  });
}

export async function removeService(slug, serviceId) {
  const reference = doc(db, "establishments", slug);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const establishment = snapshot.data();
    const current = (establishment?.services || []).find(item => item.id === serviceId);
    if (!current) throw new Error("Serviço não encontrado.");
    const slots = await getDocs(query(collection(db, "establishments", slug, "slots"), where("service", "==", current.name)));
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    if (slots.docs.some(item => item.data().date >= today)) throw new Error("Este serviço possui reservas futuras. Remova após os atendimentos terminarem.");
    const services = establishment.services.filter(item => item.id !== serviceId);
    const serviceDurations = Object.fromEntries(services.map(service => [service.name, Number(service.duration) || 20]));
    transaction.update(reference, { services, serviceDurations, updatedAt: serverTimestamp() });
    return services;
  });
}

export async function saveReservedService(slug, reservedId, details) {
  const item = normalizeReservedService(details);
  const reference = doc(db, "establishments", slug);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) throw new Error("Estabelecimento não encontrado.");
  const establishment = snapshot.data();
  if (!(establishment.professionals || []).some(professional => (typeof professional === "string" ? professional : professional.name) === item.professional)) throw new Error("Selecione um profissional cadastrado.");
  const current = establishment.reservedServices || [];
  if (reservedId && !current.some(value => value.id === reservedId)) throw new Error("Serviço reservado não encontrado.");
  const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  if (current.some(value => value.id !== reservedId && value.professional === item.professional && value.weekday === item.weekday && toMinutes(item.start) < toMinutes(value.end) && toMinutes(item.end) > toMinutes(value.start))) throw new Error("Este profissional já tem um serviço reservado nesse horário.");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const slots = await getDocs(query(collection(db, "establishments", slug, "slots"), where("date", ">=", today)));
  if (slots.docs.some(snapshot => {
    const booking = snapshot.data();
    const weekday = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date(`${booking.date}T12:00:00Z`).getUTCDay()];
    const start = toMinutes(booking.time || "00:00");
    const end = start + appointmentDurationMinutes(establishment, booking);
    return booking.professional === item.professional && weekday === item.weekday && start < toMinutes(item.end) && end > toMinutes(item.start) && !["cancelado", "concluido"].includes(booking.status);
  })) throw new Error("Há agendamentos futuros nesse horário. Reagende-os antes de reservar o serviço.");
  const next = reservedId ? current.map(value => value.id === reservedId ? { ...value, ...item } : value) : [...current, { ...item, id: crypto.randomUUID() }];
  await updateDoc(reference, { reservedServices: next, updatedAt: serverTimestamp() });
  return next;
}

export async function removeReservedService(slug, reservedId) {
  const reference = doc(db, "establishments", slug);
  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) throw new Error("Estabelecimento não encontrado.");
  const current = snapshot.data().reservedServices || [];
  if (!current.some(item => item.id === reservedId)) throw new Error("Serviço reservado não encontrado.");
  const next = current.filter(item => item.id !== reservedId);
  await updateDoc(reference, { reservedServices: next, updatedAt: serverTimestamp() });
  return next;
}

export async function loadPublicData(slug, date) {
  const stateRef = doc(db, "establishments", slug, "public", "state");
  const slotsQuery = query(collection(db, "establishments", slug, "slots"), where("date", "==", date));
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const todaySlotsQuery = date === today ? slotsQuery : query(collection(db, "establishments", slug, "slots"), where("date", "==", today));
  const [stateSnapshot, slotsSnapshot, todaySlotsSnapshot, staffStatusSnapshot] = await Promise.all([
    getDoc(stateRef),
    getDocs(slotsQuery),
    getDocs(todaySlotsQuery),
    getDocs(collection(db, "establishments", slug, "staffStatus")).catch(() => null),
  ]);
  if (!stateSnapshot.exists() && slotsSnapshot.empty && todaySlotsSnapshot.empty && !staffStatusSnapshot?.size) return null;

  const publicState = stateSnapshot.exists() ? stateSnapshot.data() : {};
  const current = publicState.current || (publicState.currentTicket ? { ticket: publicState.currentTicket } : null);
  const waiting = Array.isArray(publicState.waiting)
    ? publicState.waiting
    : (Array.isArray(publicState.waitingTickets) ? publicState.waitingTickets.map((ticket) => ({ ticket })) : []);
  return {
    slots: slotsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    todaySlots: todaySlotsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    staffStatuses: (staffStatusSnapshot?.docs || []).map((item) => ({ id: item.id, ...item.data() })),
    todayAppointments: todaySlotsSnapshot.size,
    queue: [
      ...(current ? [{ ...current, status: "atendendo" }] : []),
      ...waiting.map((item, index) => ({ ...item, status: "aguardando", position: index + 1 })),
    ],
  };
}

export async function findPublicAppointments(slug, credential, method = "name") {
  const lookupKey = method === "code"
    ? await appointmentCodeLookupKey(slug, credential)
    : await appointmentLookupKey(slug, credential);
  const lookupCollection = method === "code" ? "appointmentCodeLookups" : "appointmentLookups";
  const lookupSnapshot = await getDoc(doc(db, "establishments", slug, lookupCollection, lookupKey));
  if (!lookupSnapshot.exists()) return [];
  const appointments = lookupSnapshot.data().appointments || [];
  const presenceSnapshots = await Promise.all(appointments.map((item) => getDoc(doc(db, "establishments", slug, "appointmentPresence", item.appointmentId))));
  return appointments
    .map((item, index) => ({
      ...item,
      presenceExists: presenceSnapshots[index].exists(),
      status: presenceSnapshots[index].exists() ? presenceSnapshots[index].data().status : item.status,
    }))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function observePublicState(slug, callback) {
  const stateRef = doc(db, "establishments", slug, "public", "state");
  let queue = [];
  let staffStatuses = [];
  let todaySlots = null;
  let professionalLunchBreaks = null;
  let establishmentHours = null;
  let establishmentSchedule = null;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const todaySlotsQuery = query(collection(db, "establishments", slug, "slots"), where("date", "==", today));
  const emit = () => callback({ queue, staffStatuses, ...(todaySlots ? { todaySlots } : {}), ...(professionalLunchBreaks ? { professionalLunchBreaks } : {}), ...(establishmentHours ? { establishmentHours } : {}), ...(establishmentSchedule ? { establishmentSchedule } : {}) });
  const unsubscribeEstablishment = onSnapshot(doc(db, "establishments", slug), (snapshot) => {
    const establishment = snapshot.data() || {};
    establishmentHours = establishment.hours || [];
    establishmentSchedule = { name: establishment.name || "", address: establishment.address || "", address2: establishment.address2 || "", hours2: establishment.hours2 || [], professionals: establishment.professionals || [], services: establishment.services || [], reservedServices: establishment.reservedServices || [], availableTimes: establishment.availableTimes || [], scheduleMode: establishment.scheduleMode || "employee", extraWorkingDates: establishment.extraWorkingDates || {} };
    professionalLunchBreaks = { ...Object.fromEntries((establishment.professionals || []).filter((item) => item.lunchBreak).map((item) => [item.name, item.lunchBreak])), ...establishment.professionalLunchBreaks };
    emit();
  }, () => emit());
  const unsubscribeQueue = onSnapshot(stateRef, (snapshot) => {
    const publicState = snapshot.exists() ? snapshot.data() : {};
    const current = publicState.current || (publicState.currentTicket ? { ticket: publicState.currentTicket } : null);
    const waiting = Array.isArray(publicState.waiting)
      ? publicState.waiting
      : (Array.isArray(publicState.waitingTickets) ? publicState.waitingTickets.map((ticket) => ({ ticket })) : []);
    queue = [
      ...(current ? [{ ...current, status: "atendendo" }] : []),
      ...waiting.map((item, index) => ({ ...item, status: "aguardando", position: index + 1 })),
    ];
    emit();
  });
  const unsubscribeStaff = onSnapshot(collection(db, "establishments", slug, "staffStatus"), (snapshot) => {
    staffStatuses = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    emit();
  }, () => emit());
  const unsubscribeSlots = onSnapshot(todaySlotsQuery, (snapshot) => {
    todaySlots = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    emit();
  }, () => emit());
  return () => {
    unsubscribeQueue();
    unsubscribeStaff();
    unsubscribeSlots();
    unsubscribeEstablishment();
  };
}

export async function loadAdminData(slug, date) {
  const appointmentsQuery = query(collection(db, "establishments", slug, "appointments"), where("date", "==", date));
  const slotsQuery = query(collection(db, "establishments", slug, "slots"), where("date", "==", date));
  const [appointmentsSnapshot, queueSnapshot, slotsSnapshot, staffStatusSnapshot] = await Promise.all([
    getDocs(appointmentsQuery),
    getDocs(collection(db, "establishments", slug, "queue")),
    getDocs(slotsQuery),
    getDocs(collection(db, "establishments", slug, "staffStatus")).catch(() => null),
  ]);
  return {
    appointments: appointmentsSnapshot.docs.map((item) => ({ ...item.data(), id: item.id })),
    queue: queueSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => {
      if (a.status === "atendendo") return -1;
      if (b.status === "atendendo") return 1;
      const priorityDifference = Number(b.priority === "preferencial") - Number(a.priority === "preferencial");
      return priorityDifference || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
    }),
    slots: slotsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    staffStatuses: (staffStatusSnapshot?.docs || []).map((item) => ({ id: item.id, ...item.data() })),
  };
}

export async function createAppointment(slug, appointment, scheduleMode = "employee", professionalNames = []) {
  const appointmentRef = doc(collection(db, "establishments", slug, "appointments"));
  const lookupKey = await appointmentLookupKey(slug, appointment.client);
  const codeLookupKey = await appointmentCodeLookupKey(slug, appointment.checkInCode);
  const lookupRef = doc(db, "establishments", slug, "appointmentLookups", lookupKey);
  const codeLookupRef = doc(db, "establishments", slug, "appointmentCodeLookups", codeLookupKey);
  const presenceRef = doc(db, "establishments", slug, "appointmentPresence", appointmentRef.id);
  const professionalKey = documentKey(appointment.professional);
  const scheduleKey = scheduleMode === "establishment" ? "establishment" : professionalKey;
  const slotBase = `${appointment.date}_${appointment.time.replace(":", "")}`;
  const slotId = `${slotBase}_${scheduleKey}`;
  const slotRef = doc(db, "establishments", slug, "slots", slotId);
  const sharedSlotRef = doc(db, "establishments", slug, "slots", `${slotBase}_establishment`);
  const staffStatusRef = doc(db, "establishments", slug, "staffStatus", professionalKey);
  const refsToCheck = scheduleMode === "establishment"
    ? [sharedSlotRef, ...professionalNames.map((name) => doc(db, "establishments", slug, "slots", `${slotBase}_${documentKey(name)}`))]
    : [slotRef, sharedSlotRef];

  await runTransaction(db, async (transaction) => {
    const [existingSlots, lookupSnapshot, codeLookupSnapshot, establishmentSnapshot, staffStatusSnapshot] = await Promise.all([
      Promise.all(refsToCheck.map((reference) => transaction.get(reference))),
      transaction.get(lookupRef),
      transaction.get(codeLookupRef),
      transaction.get(doc(db, "establishments", slug)),
      transaction.get(staffStatusRef),
    ]);
    if (staffStatusSnapshot.exists() && staffStatusSnapshot.data().closedDate === appointment.date) {
      const error = new Error("O expediente deste profissional foi encerrado hoje. Escolha outro horário.");
      error.code = "agendae/slot-unavailable";
      throw error;
    }
    if (isLunchTime(lunchBreakFor(establishmentSnapshot.data() || {}, appointment.professional, appointment.date), appointment.time)) {
      const error = new Error("Este profissional está em horário de almoço. Escolha outro horário.");
      error.code = "agendae/slot-unavailable";
      throw error;
    }
    const establishment = establishmentSnapshot.data() || {};
    if (businessDayIsClosed(establishment, appointment.date)) {
      const error = new Error("Sem expediente neste dia. Escolha outra data para agendar.");
      error.code = "agendae/slot-unavailable";
      throw error;
    }
    const service = (establishment.services || []).find(item => item.name === appointment.service);
    if (!serviceAvailableAt(establishment, service, appointment.date, appointment.time)) {
      const error = new Error("Este serviço não está disponível neste dia e horário.");
      error.code = "agendae/slot-unavailable";
      throw error;
    }
    if (!serviceFitsSlot(establishment, appointment.professional, appointment.time, service.name, [], appointment.date)) {
      const error = new Error("Este profissional tem um compromisso reservado ou está indisponível neste horário.");
      error.code = "agendae/slot-unavailable";
      throw error;
    }
    const durationMinutes = appointmentDurationMinutes(establishment, { ...appointment, durationMinutes: undefined });
    const locationType = service.locationType || "address1";
    const serviceAddress = locationType === "online" ? "" : locationType === "address2" ? establishment.address2 || "" : establishment.address || "";
    const professional = (establishment.professionals || []).find(item => item.name === appointment.professional);
    if (professional?.workPeriods?.length && (!scheduleMatrix(establishment, appointment.date).professionals.find(item => item.name === appointment.professional)?.availableTimes.includes(appointment.time) || !serviceFitsSlot(establishment, appointment.professional, appointment.time, appointment.service, [], appointment.date))) {
      const error = new Error("Este atendimento não cabe na escala do profissional. Escolha outro horário.");
      error.code = "agendae/slot-unavailable";
      throw error;
    }
    if (professional?.workPeriods?.length) {
      const candidates = new Map();
      const employees = (establishment.professionals || []).filter(item => scheduleMode === "establishment" || item.name === appointment.professional);
      for (const employee of employees) {
        for (const time of employee.availableTimes || []) {
          for (const ref of slotRefsForAppointment(slug, { date: appointment.date, time, professional: employee.name })) candidates.set(ref.path || String(ref), ref);
        }
      }
      const snapshots = await Promise.all([...candidates.values()].map(ref => transaction.get(ref)));
      const reservations = snapshots.filter(snapshot => snapshot.exists()).map(snapshot => ({ ...snapshot.data(), id: snapshot.id }));
      if (!serviceFitsSlot(establishment, appointment.professional, appointment.time, appointment.service, reservations, appointment.date)) {
        const error = new Error("Este serviço se sobrepõe a um atendimento reservado. Escolha outro horário.");
        error.code = "agendae/slot-unavailable";
        throw error;
      }
    }
    if (existingSlots.some((snapshot) => snapshot.exists())) {
      const error = new Error("Este horário acabou de ser reservado. Escolha outro.");
      error.code = "agendae/slot-unavailable";
      throw error;
    }
    if (codeLookupSnapshot.exists()) {
      const error = new Error("Não foi possível gerar uma senha única. Tente confirmar novamente.");
      error.code = "agendae/checkin-code-collision";
      throw error;
    }
    transaction.set(slotRef, {
      date: appointment.date,
      time: appointment.time,
      service: appointment.service,
      professional: appointment.professional,
      createdAt: serverTimestamp(),
    });
    transaction.set(appointmentRef, {
      ...appointment,
      locationType,
      serviceAddress,
      meetingUrl: locationType === "online" ? service.meetingUrl || "" : "",
      durationMinutes,
      status: "confirmado",
      createdAt: serverTimestamp(),
    });
    const publicAppointment = {
      appointmentId: appointmentRef.id,
      durationMinutes,
      date: appointment.date,
      time: appointment.time,
      service: appointment.service,
      professional: appointment.professional,
      locationType,
      serviceAddress,
      status: "confirmado",
    };
    transaction.set(lookupRef, {
      appointments: [...(lookupSnapshot.exists() ? lookupSnapshot.data().appointments || [] : []), publicAppointment],
      updatedAt: serverTimestamp(),
    });
    transaction.set(codeLookupRef, {
      appointments: [{ ...publicAppointment, meetingUrl: locationType === "online" ? service.meetingUrl || "" : "" }],
      updatedAt: serverTimestamp(),
    });
    transaction.set(presenceRef, {
      appointmentId: appointmentRef.id,
      date: appointment.date,
      status: "confirmado",
      createdAt: serverTimestamp(),
    });
  });
  return appointmentRef.id;
}

export async function getOrCreateCheckInConfig(slug) {
  const configRef = doc(db, "establishments", slug, "checkIn", "config");
  const establishmentRef = doc(db, "establishments", slug);
  return runTransaction(db, async (transaction) => {
    const [snapshot, establishmentSnapshot] = await Promise.all([transaction.get(configRef), transaction.get(establishmentRef)]);
    const establishment = establishmentSnapshot.data() || {};
    const serviceDurations = Object.fromEntries((establishment.services || []).map(service => [service.name, appointmentDurationMinutes(establishment, { service: service.name })]));
    if (JSON.stringify(establishment.serviceDurations || {}) !== JSON.stringify(serviceDurations)) transaction.update(establishmentRef, { serviceDurations });
    if (snapshot.exists() && snapshot.data().token) return snapshot.data();
    const token = crypto.randomUUID().replace(/-/g, "");
    transaction.set(configRef, { token, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { token };
  });
}

export async function confirmPresenceWithQr(slug, appointmentId, checkInToken, date, presenceExists = true, appointment) {
  if (!appointment?.time || !appointment?.professional || appointment.date !== date) throw new Error("Horário do agendamento não encontrado.");
  const establishment = (await getDoc(doc(db, "establishments", slug))).data() || {};
  if (!appointmentPresenceWindow(establishment, appointment).allowed) throw new Error("A presença só pode ser confirmada na data do atendimento, de uma hora antes do início até o término previsto.");
  const slotRef = await existingAppointmentSlot({ get: getDoc }, slug, appointment);
  const appointmentRef = doc(db, "establishments", slug, "appointments", appointmentId);
  const presenceRef = doc(db, "establishments", slug, "appointmentPresence", appointmentId);
  const batch = writeBatch(db);
  batch.update(appointmentRef, {
    status: "presente",
    checkedInAt: serverTimestamp(),
    checkInMethod: "qr",
    checkInToken,
  });
  const presenceData = {
    status: "presente",
    checkedInAt: serverTimestamp(),
    checkInMethod: "qr",
  };
  if (presenceExists) batch.update(presenceRef, presenceData);
  else batch.set(presenceRef, { appointmentId, date, ...presenceData });
  if (slotRef) batch.update(slotRef, { ...presenceData, appointmentId });
  await batch.commit();
}

export async function confirmPresenceManually(slug, appointmentId) {
  const appointmentRef = doc(db, "establishments", slug, "appointments", appointmentId);
  const appointmentSnapshot = await getDoc(appointmentRef);
  if (!appointmentSnapshot.exists()) throw new Error("Agendamento não encontrado.");
  const appointment = appointmentSnapshot.data();
  const establishment = (await getDoc(doc(db, "establishments", slug))).data() || {};
  if (appointment.status !== "confirmado" || !appointmentPresenceWindow(establishment, appointment).allowed) throw new Error("A presença só pode ser confirmada na data do atendimento, de uma hora antes do início até o término previsto.");
  const slotRef = await existingAppointmentSlot({ get: getDoc }, slug, appointmentSnapshot.data());
  const presenceRef = doc(db, "establishments", slug, "appointmentPresence", appointmentId);
  const batch = writeBatch(db);
  batch.update(appointmentRef, {
    status: "presente",
    checkedInAt: serverTimestamp(),
    checkInMethod: "employee",
  });
  batch.set(presenceRef, {
    appointmentId,
    status: "presente",
    checkedInAt: serverTimestamp(),
    checkInMethod: "employee",
  }, { merge: true });
  if (slotRef) batch.update(slotRef, { appointmentId, status: "presente", checkedInAt: serverTimestamp(), checkInMethod: "employee" });
  await batch.commit();
}

export async function updateExtraWorkingDate(slug, date, enabled) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const selected = new Date(`${date}T12:00:00-03:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(selected.getTime()) || selected.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) !== date || date < today) throw new Error("Escolha hoje ou uma data futura para o expediente extra.");
  const ref = doc(db, "establishments", slug);
  return runTransaction(db, async transaction => {
    const establishment = (await transaction.get(ref)).data() || {};
    const extraWorkingDates = { ...establishment.extraWorkingDates };
    if (enabled) extraWorkingDates[date] = true;
    else delete extraWorkingDates[date];
    const serviceDurations = Object.fromEntries((establishment.services || []).map(service => [service.name, appointmentDurationMinutes(establishment, { service: service.name })]));
    transaction.update(ref, { extraWorkingDates, serviceDurations });
    return extraWorkingDates;
  });
}

async function professionalAppointments(slug, professional, date) {
  const snapshot = await getDocs(query(collection(db, "establishments", slug, "appointments"), where("date", "==", date)));
  return snapshot.docs
    .map((item) => ({ id: item.id, ref: item.ref, ...item.data() }))
    .filter((item) => item.professional === professional)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

export async function startProfessionalAppointment(slug, appointmentId, professional, date) {
  const appointmentRef = doc(db, "establishments", slug, "appointments", appointmentId);
  const presenceRef = doc(db, "establishments", slug, "appointmentPresence", appointmentId);
  const statusRef = doc(db, "establishments", slug, "staffStatus", documentKey(professional));
  return runTransaction(db, async (transaction) => {
    const [appointmentSnapshot, statusSnapshot, establishmentSnapshot] = await Promise.all([transaction.get(appointmentRef), transaction.get(statusRef), transaction.get(doc(db, "establishments", slug))]);
    if (!appointmentSnapshot.exists()) throw new Error("Atendimento não encontrado.");
    const appointment = appointmentSnapshot.data();
    const staffStatus = statusSnapshot.exists() ? statusSnapshot.data() : {};
    if (staffStatus.closedDate === date) throw new Error("O expediente deste profissional foi encerrado hoje.");
    const time = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (isLunchTime(lunchBreakFor(establishmentSnapshot.data() || {}, professional, date), time)) {
      const error = new Error("Este profissional está em horário de almoço. O atendimento está pausado.");
      error.code = "agendae/professional-paused";
      throw error;
    }
    if (staffStatus.paused && (!staffStatus.pausedDate || staffStatus.pausedDate === date)) {
      const error = new Error("Retome o atendimento do profissional antes de iniciar o próximo cliente.");
      error.code = "agendae/professional-paused";
      throw error;
    }
    if (staffStatus.currentAppointmentId && (!staffStatus.currentDate || staffStatus.currentDate === date) && staffStatus.currentAppointmentId !== appointmentId) {
      const error = new Error("Este profissional já possui um atendimento em andamento.");
      error.code = "agendae/professional-busy";
      throw error;
    }
    if (!["confirmado", "presente", "atendendo"].includes(appointment.status)) throw new Error("Este atendimento não pode mais ser iniciado.");
    const slotRef = await existingAppointmentSlot(transaction, slug, appointment);
    transaction.update(appointmentRef, { status: "atendendo", startedAt: serverTimestamp() });
    if (slotRef) transaction.update(slotRef, { status: "atendendo" });
    transaction.set(presenceRef, { appointmentId, date, status: "atendendo", startedAt: serverTimestamp() }, { merge: true });
    transaction.set(statusRef, {
      professional,
      paused: false,
      currentAppointmentId: appointmentId,
      currentDate: date,
      currentTime: appointment.time,
      currentService: appointment.service,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { id: appointmentId, client: appointment.client, time: appointment.time };
  });
}

export async function startNextProfessionalAppointment(slug, professional, date) {
  const appointments = await professionalAppointments(slug, professional, date);
  const current = appointments.find((item) => item.status === "atendendo");
  if (current) {
    const statusRef = doc(db, "establishments", slug, "staffStatus", documentKey(professional));
    await runTransaction(db, async (transaction) => {
      const statusSnapshot = await transaction.get(statusRef);
      if (statusSnapshot.exists() && statusSnapshot.data().closedDate === date) throw new Error("O expediente deste profissional foi encerrado hoje.");
      if (statusSnapshot.exists() && statusSnapshot.data().paused && (!statusSnapshot.data().pausedDate || statusSnapshot.data().pausedDate === date)) return;
      transaction.set(statusRef, {
        professional,
        paused: false,
        currentAppointmentId: current.id,
        currentDate: date,
        currentTime: current.time,
        currentService: current.service,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    return { id: current.id, client: current.client, time: current.time, existing: true };
  }
  const next = nextEligibleAppointment(appointments);
  if (!next) return null;
  return startProfessionalAppointment(slug, next.id, professional, date);
}

export async function setProfessionalPause(slug, professional, paused, date, startNext = true) {
  const statusRef = doc(db, "establishments", slug, "staffStatus", documentKey(professional));
  await runTransaction(db, async (transaction) => {
    const statusSnapshot = await transaction.get(statusRef);
    if (statusSnapshot.exists() && statusSnapshot.data().closedDate === date) throw new Error("O expediente deste profissional foi encerrado hoje.");
    transaction.set(statusRef, {
      professional,
      paused,
      pausedDate: paused ? date : null,
      ...(paused ? { pausedAt: serverTimestamp() } : { resumedAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
  if (!paused && startNext) return startNextProfessionalAppointment(slug, professional, date);
  return null;
}

export async function completeAppointmentAndAdvance(slug, appointmentId, professional, date, advance = true) {
  const appointments = await professionalAppointments(slug, professional, date);
  const candidate = nextEligibleAppointment(appointments, appointmentId);
  const appointmentRef = doc(db, "establishments", slug, "appointments", appointmentId);
  const presenceRef = doc(db, "establishments", slug, "appointmentPresence", appointmentId);
  const statusRef = doc(db, "establishments", slug, "staffStatus", documentKey(professional));
  const candidateRef = candidate ? doc(db, "establishments", slug, "appointments", candidate.id) : null;
  const candidatePresenceRef = candidate ? doc(db, "establishments", slug, "appointmentPresence", candidate.id) : null;
  return runTransaction(db, async (transaction) => {
    const reads = [transaction.get(appointmentRef), transaction.get(statusRef)];
    if (candidateRef) reads.push(transaction.get(candidateRef));
    const [appointmentSnapshot, statusSnapshot, candidateSnapshot] = await Promise.all(reads);
    if (!appointmentSnapshot.exists()) throw new Error("Atendimento não encontrado.");
    const [slotRef, candidateSlotRef] = await Promise.all([
      existingAppointmentSlot(transaction, slug, appointmentSnapshot.data()),
      candidateSnapshot?.exists() ? existingAppointmentSlot(transaction, slug, candidateSnapshot.data()) : null,
    ]);
    const staffStatus = statusSnapshot.exists() ? statusSnapshot.data() : {};
    if (staffStatus.closedDate === date) throw new Error("O expediente deste profissional foi encerrado hoje.");
    if (appointmentSnapshot.data().status !== "atendendo") throw new Error("Este atendimento já foi finalizado ou mudou de estado.");
    transaction.update(appointmentRef, { status: "concluido", completedAt: serverTimestamp() });
    if (slotRef) transaction.update(slotRef, { status: "concluido" });
    transaction.set(presenceRef, { appointmentId, date, status: "concluido", completedAt: serverTimestamp() }, { merge: true });

    const pausedToday = Boolean(staffStatus.paused && (!staffStatus.pausedDate || staffStatus.pausedDate === date));
    const next = advance && !pausedToday && candidateSnapshot?.exists() && ["confirmado", "presente"].includes(candidateSnapshot.data().status)
      ? { id: candidateSnapshot.id, ...candidateSnapshot.data() }
      : null;
    if (next) {
      transaction.update(candidateRef, { status: "atendendo", startedAt: serverTimestamp() });
      if (candidateSlotRef) transaction.update(candidateSlotRef, { status: "atendendo" });
      transaction.set(candidatePresenceRef, { appointmentId: next.id, date, status: "atendendo", startedAt: serverTimestamp() }, { merge: true });
    }
    transaction.set(statusRef, {
      professional,
      currentAppointmentId: next?.id || null,
      currentDate: next ? date : null,
      currentTime: next?.time || null,
      currentService: next?.service || null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { next: next ? { id: next.id, client: next.client, time: next.time } : null, paused: pausedToday };
  });
}

export async function finishProfessionalTurn(slug, professional, date, action) {
  if (!["next", "pause", "close"].includes(action)) throw new Error("Ação de atendimento inválida.");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  if (date !== today) throw new Error("Esta ação está disponível somente para o expediente de hoje.");
  const appointments = await professionalAppointments(slug, professional, date);
  const current = appointments.find(item => item.status === "atendendo") || null;
  const candidate = nextEligibleAppointment(appointments, current?.id || "");
  if (action === "close" && candidate) throw new Error("Há reservas pendentes para este funcionário. Reagende-as antes de encerrar o expediente.");
  const establishmentRef = doc(db, "establishments", slug);
  const statusRef = doc(db, "establishments", slug, "staffStatus", documentKey(professional));
  const currentRef = current ? doc(db, "establishments", slug, "appointments", current.id) : null;
  const candidateRef = action === "next" && candidate ? doc(db, "establishments", slug, "appointments", candidate.id) : null;
  return runTransaction(db, async transaction => {
    const [establishmentSnapshot, statusSnapshot, currentSnapshot, candidateSnapshot] = await Promise.all([
      transaction.get(establishmentRef),
      transaction.get(statusRef),
      currentRef ? transaction.get(currentRef) : null,
      candidateRef ? transaction.get(candidateRef) : null,
    ]);
    const establishment = establishmentSnapshot.data() || {};
    const staffStatus = statusSnapshot.exists() ? statusSnapshot.data() : {};
    const listed = (establishment.professionals || []).some(item => (typeof item === "string" ? item : item.name) === professional);
    if (!listed) throw new Error("Funcionário não encontrado.");
    if (staffStatus.closedDate === date) throw new Error("O expediente deste funcionário já foi encerrado hoje.");
    if (current && (!currentSnapshot?.exists() || currentSnapshot.data().status !== "atendendo")) throw new Error("O atendimento atual mudou. Atualize a agenda e tente novamente.");
    if (candidateRef && (!candidateSnapshot?.exists() || !["confirmado", "presente"].includes(candidateSnapshot.data().status))) throw new Error("A próxima senha mudou. Atualize a agenda e tente novamente.");
    if (action === "next") {
      const time = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      const entry = (establishment.professionals || []).find(item => (typeof item === "string" ? item : item.name) === professional);
      const times = typeof entry === "string" ? establishment.availableTimes || [] : entry.availableTimes || establishment.availableTimes || [];
      const start = entry?.scheduleStart || times[0];
      const end = entry?.scheduleEnd || times.at(-1);
      if (!start || !end || time < start || (entry?.scheduleEnd ? time >= end : time > end)
        || isLunchTime(lunchBreakFor(establishment, professional, date), time)
        || (scheduleMatrix(establishment, date).professionals.find(item => item.name === professional)?.pauseIntervals || []).some(interval => isLunchTime(interval, time))) {
        throw new Error("Este funcionário está fora do horário de atendimento. Inicie uma pausa ou encerre o expediente.");
      }
    }
    if (action === "close") {
      const entry = (establishment.professionals || []).find(item => (typeof item === "string" ? item : item.name) === professional);
      const times = typeof entry === "string" ? establishment.availableTimes || [] : entry.availableTimes || establishment.availableTimes || [];
      const refs = new Map();
      for (const time of times) for (const ref of slotRefsForAppointment(slug, { date, time, professional })) refs.set(ref.path || String(ref), ref);
      const slots = await Promise.all([...refs.values()].map(ref => transaction.get(ref)));
      if (slots.some(snapshot => snapshot.exists() && snapshot.data().professional === professional
        && !["concluido", "cancelado"].includes(snapshot.data().status)
        && !(current && snapshot.data().time === current.time))) {
        throw new Error("Há reservas pendentes para este funcionário. Reagende-as antes de encerrar o expediente.");
      }
    }
    const [currentSlotRef, candidateSlotRef] = await Promise.all([
      currentSnapshot?.exists() ? existingAppointmentSlot(transaction, slug, currentSnapshot.data()) : null,
      candidateSnapshot?.exists() ? existingAppointmentSlot(transaction, slug, candidateSnapshot.data()) : null,
    ]);
    if (currentSnapshot?.exists()) {
      transaction.update(currentRef, { status: "concluido", completedAt: serverTimestamp() });
      if (currentSlotRef) transaction.update(currentSlotRef, { status: "concluido" });
      transaction.set(doc(db, "establishments", slug, "appointmentPresence", current.id), { appointmentId: current.id, date, status: "concluido", completedAt: serverTimestamp() }, { merge: true });
    }
    const next = candidateSnapshot?.exists() ? { id: candidateSnapshot.id, ...candidateSnapshot.data() } : null;
    if (next) {
      transaction.update(candidateRef, { status: "atendendo", startedAt: serverTimestamp() });
      if (candidateSlotRef) transaction.update(candidateSlotRef, { status: "atendendo" });
      transaction.set(doc(db, "establishments", slug, "appointmentPresence", next.id), { appointmentId: next.id, date, status: "atendendo", startedAt: serverTimestamp() }, { merge: true });
    }
    if (action === "close") {
      transaction.update(establishmentRef, {
        staffClosedDates: { ...(establishment.staffClosedDates || {}), [professional]: date },
      });
    }
    transaction.set(statusRef, {
      professional,
      paused: action === "pause",
      pausedDate: action === "pause" ? date : null,
      closedDate: action === "close" ? date : null,
      ...(action === "pause" ? { pausedAt: serverTimestamp() } : action === "close" ? { closedAt: serverTimestamp() } : { resumedAt: serverTimestamp() }),
      currentAppointmentId: next?.id || null,
      currentDate: next ? date : null,
      currentTime: next?.time || null,
      currentService: next?.service || null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { completed: Boolean(current), next: next ? { id: next.id, time: next.time, client: next.client } : null, action };
  });
}

export async function addQueueTicket(slug, ticket, name, priority = "normal", servicePoint = "Atendimento") {
  const queueRef = doc(collection(db, "establishments", slug, "queue"));
  const stateRef = doc(db, "establishments", slug, "public", "state");
  await runTransaction(db, async (transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    const stateData = stateSnapshot.exists() ? stateSnapshot.data() : {};
    const waiting = Array.isArray(stateData.waiting)
      ? stateData.waiting
      : (Array.isArray(stateData.waitingTickets) ? stateData.waitingTickets.map((item) => ({ ticket: item, priority: "normal" })) : []);
    transaction.set(queueRef, { ticket, name, priority, servicePoint, status: "aguardando", createdAt: serverTimestamp() });
    const nextWaiting = [...waiting];
    const publicTicket = { ticket, priority };
    if (priority === "preferencial") {
      const insertAt = nextWaiting.filter((item) => item.priority === "preferencial").length;
      nextWaiting.splice(insertAt, 0, publicTicket);
    } else {
      nextWaiting.push(publicTicket);
    }
    transaction.set(stateRef, {
      waiting: nextWaiting,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}

export async function callNextTicket(slug, defaultServicePoint = "Atendimento") {
  const queueSnapshot = await getDocs(collection(db, "establishments", slug, "queue"));
  const items = queueSnapshot.docs.map((item) => ({ id: item.id, ref: item.ref, ...item.data() }));
  const current = items.find((item) => item.status === "atendendo");
  const waiting = items
    .filter((item) => item.status === "aguardando")
    .sort((a, b) => {
      const priorityDifference = Number(b.priority === "preferencial") - Number(a.priority === "preferencial");
      return priorityDifference || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
    });
  const next = waiting[0] || null;
  const batch = writeBatch(db);
  if (current) batch.update(current.ref, { status: "concluido", completedAt: serverTimestamp() });
  if (next) batch.update(next.ref, { status: "atendendo", calledAt: serverTimestamp() });
  batch.set(doc(db, "establishments", slug, "public", "state"), {
    current: next ? {
      ticket: next.ticket,
      priority: next.priority || "normal",
      servicePoint: next.servicePoint || defaultServicePoint,
    } : null,
    waiting: waiting.slice(1).map((item) => ({ ticket: item.ticket, priority: item.priority || "normal" })),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return next?.ticket || null;
}

export function firebaseErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "Login ou senha inválidos.",
    "auth/invalid-email": "Digite um login ou e-mail válido.",
    "auth/user-disabled": "Este acesso foi desativado. Entre em contato com o administrador do estabelecimento.",
    "auth/user-not-found": "Login não encontrado.",
    "auth/wrong-password": "Login ou senha inválidos.",
    "auth/email-already-in-use": "Este login já está em uso neste estabelecimento.",
    "auth/requires-recent-login": "Entre novamente para concluir a atualização do acesso.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/operation-not-allowed": "O acesso por login e senha ainda não está disponível.",
    "auth/network-request-failed": "Não foi possível conectar ao serviço de acesso.",
    "agendae/profile-not-found": "Este usuário ainda não está vinculado a um estabelecimento.",
    "agendae/establishment-mismatch": "Este funcionário não pertence ao estabelecimento selecionado.",
    "agendae/system-admin-required": "Esta conta não possui acesso de administrador do sistema.",
    "agendae/slot-unavailable": error?.message,
    "agendae/professional-paused": error?.message,
    "agendae/professional-busy": error?.message,
    "agendae/checkin-code-collision": error?.message,
    "not-found": "Este agendamento não está disponível para confirmação por QR. Peça ajuda à equipe.",
    "failed-precondition": "Esta presença já foi confirmada ou o agendamento ainda não está disponível.",
    "permission-denied": "Seu usuário não possui permissão para esta operação.",
  };
  return messages[error?.code] || error?.message || "Não foi possível concluir a operação.";
}
