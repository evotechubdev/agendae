import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
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
  setDoc,
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
const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});

async function profileFor(user) {
  if (!user) return null;
  const profileRef = doc(db, "users", user.uid);
  let profileSnapshot = await getDoc(profileRef);

  // Inicialização controlada da conta demonstrativa da Barbearia do Renam.
  if (!profileSnapshot.exists() && user.email?.toLowerCase() === "renam@agendae.com.br") {
    await setDoc(profileRef, {
      email: user.email,
      name: user.displayName || "Renam Silva",
      role: "admin",
      establishmentSlug: "barbeariadorenam",
      createdAt: serverTimestamp(),
    });
    profileSnapshot = await getDoc(profileRef);
  }

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

export async function login(email, password) {
  await persistenceReady;
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return profileFor(credential.user);
}

export async function logout() {
  await signOut(auth);
}

export async function loadEstablishments() {
  const establishmentsQuery = query(collection(db, "establishments"), where("active", "==", true));
  const snapshot = await getDocs(establishmentsQuery);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
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
    slots: slotsSnapshot.docs.map((item) => item.data()),
    todayAppointments: todaySlotsSnapshot.size,
    queue: [
      ...(current ? [{ ...current, status: "atendendo" }] : []),
      ...waiting.map((item, index) => ({ ...item, status: "aguardando", position: index + 1 })),
    ],
  };
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

export async function createAppointment(slug, appointment) {
  const appointmentRef = doc(collection(db, "establishments", slug, "appointments"));
  const professionalKey = appointment.professional.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-");
  const slotId = `${appointment.date}_${appointment.time.replace(":", "")}_${professionalKey}`;
  const slotRef = doc(db, "establishments", slug, "slots", slotId);

  await runTransaction(db, async (transaction) => {
    const existingSlot = await transaction.get(slotRef);
    if (existingSlot.exists()) {
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
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "E-mail ou senha inválidos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/operation-not-allowed": "Ative o login por e-mail e senha no Firebase Authentication.",
    "auth/network-request-failed": "Não foi possível conectar ao Firebase.",
    "agendae/profile-not-found": "Este usuário ainda não está vinculado a um estabelecimento.",
    "agendae/slot-unavailable": error?.message,
    "permission-denied": "As regras do Firestore ainda não permitem esta operação.",
  };
  return messages[error?.code] || error?.message || "Não foi possível concluir a operação.";
}
