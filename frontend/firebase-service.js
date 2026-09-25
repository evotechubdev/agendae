import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
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

const firebaseConfig = {
  apiKey: "AIzaSyAwW4poyzbL0sLbbTjGONqN7JxsIuzDDeA",
  authDomain: "agendae-prod.firebaseapp.com",
  projectId: "agendae-prod",
  storageBucket: "agendae-prod.firebasestorage.app",
  messagingSenderId: "921429063351",
  appId: "1:921429063351:web:1b173346971b1013ccff32",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

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
    const error = new Error("Usuário sem estabelecimento vinculado.");
    error.code = "agendae/profile-not-found";
    throw error;
  }

  const profile = profileSnapshot.data();
  return {
    uid: user.uid,
    email: user.email,
    name: profile.name || user.displayName || user.email,
    role: profile.role || "staff",
    slug: profile.establishmentSlug,
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

export async function loadEstablishments() {
  const establishmentsQuery = query(collection(db, "establishments"), where("active", "==", true));
  const snapshot = await getDocs(establishmentsQuery);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function updateScheduleMode(slug, scheduleMode) {
  if (!['employee', 'establishment'].includes(scheduleMode)) throw new Error("Modelo de agenda inválido.");
  await updateDoc(doc(db, "establishments", slug), {
    scheduleMode,
    updatedAt: serverTimestamp(),
  });
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
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const todaySlotsQuery = query(collection(db, "establishments", slug, "slots"), where("date", "==", today));
  const emit = () => callback({ queue, staffStatuses, ...(todaySlots ? { todaySlots } : {}) });
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
  const refsToCheck = scheduleMode === "establishment"
    ? [sharedSlotRef, ...professionalNames.map((name) => doc(db, "establishments", slug, "slots", `${slotBase}_${documentKey(name)}`))]
    : [slotRef, sharedSlotRef];

  await runTransaction(db, async (transaction) => {
    const [existingSlots, lookupSnapshot, codeLookupSnapshot] = await Promise.all([
      Promise.all(refsToCheck.map((reference) => transaction.get(reference))),
      transaction.get(lookupRef),
      transaction.get(codeLookupRef),
    ]);
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
      status: "confirmado",
      createdAt: serverTimestamp(),
    });
    const publicAppointment = {
      appointmentId: appointmentRef.id,
      date: appointment.date,
      time: appointment.time,
      service: appointment.service,
      professional: appointment.professional,
      status: "confirmado",
    };
    transaction.set(lookupRef, {
      appointments: [...(lookupSnapshot.exists() ? lookupSnapshot.data().appointments || [] : []), publicAppointment],
      updatedAt: serverTimestamp(),
    });
    transaction.set(codeLookupRef, {
      appointments: [publicAppointment],
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
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(configRef);
    if (snapshot.exists() && snapshot.data().token) return snapshot.data();
    const token = crypto.randomUUID().replace(/-/g, "");
    transaction.set(configRef, { token, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { token };
  });
}

export async function confirmPresenceWithQr(slug, appointmentId, checkInToken, date, presenceExists = true) {
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
  await batch.commit();
}

export async function confirmPresenceManually(slug, appointmentId) {
  const appointmentRef = doc(db, "establishments", slug, "appointments", appointmentId);
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
  await batch.commit();
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
    const [appointmentSnapshot, statusSnapshot] = await Promise.all([transaction.get(appointmentRef), transaction.get(statusRef)]);
    if (!appointmentSnapshot.exists()) throw new Error("Atendimento não encontrado.");
    const appointment = appointmentSnapshot.data();
    const staffStatus = statusSnapshot.exists() ? statusSnapshot.data() : {};
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
    await transaction.get(statusRef);
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
    "auth/user-not-found": "Login não encontrado.",
    "auth/wrong-password": "Login ou senha inválidos.",
    "auth/email-already-in-use": "Este login já está em uso neste estabelecimento.",
    "auth/requires-recent-login": "Entre novamente para concluir a atualização do acesso.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/operation-not-allowed": "O acesso por login e senha ainda não está disponível.",
    "auth/network-request-failed": "Não foi possível conectar ao serviço de acesso.",
    "agendae/profile-not-found": "Este usuário ainda não está vinculado a um estabelecimento.",
    "agendae/establishment-mismatch": "Este funcionário não pertence ao estabelecimento selecionado.",
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
