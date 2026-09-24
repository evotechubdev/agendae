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

function normalizedAppointmentName(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

async function appointmentLookupKey(slug, name) {
  const source = new TextEncoder().encode(`${slug}:${normalizedAppointmentName(name)}`);
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
  const [stateSnapshot, slotsSnapshot, todaySlotsSnapshot] = await Promise.all([getDoc(stateRef), getDocs(slotsQuery), getDocs(todaySlotsQuery)]);
  if (!stateSnapshot.exists() && slotsSnapshot.empty) return null;

  const publicState = stateSnapshot.exists() ? stateSnapshot.data() : {};
  const current = publicState.current || (publicState.currentTicket ? { ticket: publicState.currentTicket } : null);
  const waiting = Array.isArray(publicState.waiting)
    ? publicState.waiting
    : (Array.isArray(publicState.waitingTickets) ? publicState.waitingTickets.map((ticket) => ({ ticket })) : []);
  return {
    slots: slotsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    todayAppointments: todaySlotsSnapshot.size,
    queue: [
      ...(current ? [{ ...current, status: "atendendo" }] : []),
      ...waiting.map((item, index) => ({ ...item, status: "aguardando", position: index + 1 })),
    ],
  };
}

export async function findPublicAppointments(slug, fullName) {
  const lookupKey = await appointmentLookupKey(slug, fullName);
  const lookupSnapshot = await getDoc(doc(db, "establishments", slug, "appointmentLookups", lookupKey));
  if (!lookupSnapshot.exists()) return [];
  return (lookupSnapshot.data().appointments || []).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function observePublicState(slug, callback) {
  const stateRef = doc(db, "establishments", slug, "public", "state");
  return onSnapshot(stateRef, (snapshot) => {
    const publicState = snapshot.exists() ? snapshot.data() : {};
    const current = publicState.current || (publicState.currentTicket ? { ticket: publicState.currentTicket } : null);
    const waiting = Array.isArray(publicState.waiting)
      ? publicState.waiting
      : (Array.isArray(publicState.waitingTickets) ? publicState.waitingTickets.map((ticket) => ({ ticket })) : []);
    callback({
      queue: [
        ...(current ? [{ ...current, status: "atendendo" }] : []),
        ...waiting.map((item, index) => ({ ...item, status: "aguardando", position: index + 1 })),
      ],
    });
  });
}

export async function loadAdminData(slug, date) {
  const appointmentsQuery = query(collection(db, "establishments", slug, "appointments"), where("date", "==", date));
  const slotsQuery = query(collection(db, "establishments", slug, "slots"), where("date", "==", date));
  const [appointmentsSnapshot, queueSnapshot, slotsSnapshot] = await Promise.all([
    getDocs(appointmentsQuery),
    getDocs(collection(db, "establishments", slug, "queue")),
    getDocs(slotsQuery),
  ]);
  return {
    appointments: appointmentsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    queue: queueSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => {
      if (a.status === "atendendo") return -1;
      if (b.status === "atendendo") return 1;
      const priorityDifference = Number(b.priority === "preferencial") - Number(a.priority === "preferencial");
      return priorityDifference || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
    }),
    slots: slotsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
  };
}

export async function createAppointment(slug, appointment, scheduleMode = "employee", professionalNames = []) {
  const appointmentRef = doc(collection(db, "establishments", slug, "appointments"));
  const lookupKey = await appointmentLookupKey(slug, appointment.client);
  const lookupRef = doc(db, "establishments", slug, "appointmentLookups", lookupKey);
  const keyFor = (name) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-");
  const professionalKey = keyFor(appointment.professional);
  const scheduleKey = scheduleMode === "establishment" ? "establishment" : professionalKey;
  const slotBase = `${appointment.date}_${appointment.time.replace(":", "")}`;
  const slotId = `${slotBase}_${scheduleKey}`;
  const slotRef = doc(db, "establishments", slug, "slots", slotId);
  const sharedSlotRef = doc(db, "establishments", slug, "slots", `${slotBase}_establishment`);
  const refsToCheck = scheduleMode === "establishment"
    ? [sharedSlotRef, ...professionalNames.map((name) => doc(db, "establishments", slug, "slots", `${slotBase}_${keyFor(name)}`))]
    : [slotRef, sharedSlotRef];

  await runTransaction(db, async (transaction) => {
    const [existingSlots, lookupSnapshot] = await Promise.all([
      Promise.all(refsToCheck.map((reference) => transaction.get(reference))),
      transaction.get(lookupRef),
    ]);
    if (existingSlots.some((snapshot) => snapshot.exists())) {
      const error = new Error("Este horário acabou de ser reservado. Escolha outro.");
      error.code = "agendae/slot-unavailable";
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
  });
  return appointmentRef.id;
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
    "permission-denied": "Seu usuário não possui permissão para esta operação.",
  };
  return messages[error?.code] || error?.message || "Não foi possível concluir a operação.";
}
