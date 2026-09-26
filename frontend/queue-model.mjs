function timeMinutes(time) {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  return hours * 60 + minutes;
}

export const TICKET_STATES = Object.freeze({
  free: "Livre",
  reserved: "Reservado",
  "in-service": "Em Atendimento",
  paused: "Pausado",
  closed: "Encerrado",
});

export function ticketState(item, clock) {
  if (["concluido", "cancelado"].includes(item.status) || item.date < clock.date) return "closed";
  if (item.date === clock.date && (item.time === item.currentTime || item.status === "atendendo")) return item.paused ? "paused" : "in-service";
  if (item.date === clock.date && timeMinutes(item.time) <= clock.minutes) return "closed";
  return item.booked ? "reserved" : "free";
}

function normalizedWords(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().match(/[A-Z0-9]+/g) || [];
}

export function professionalInitial(name) {
  return normalizedWords(name)[0]?.[0] || "P";
}

export function serviceInitials(service) {
  const words = normalizedWords(service).filter((word) => !["DE", "DA", "DO", "DAS", "DOS", "E", "COM", "A", "O"].includes(word));
  if (!words.length) return "SI";
  return words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : (words[0] || "SS").slice(0, 2).padEnd(2, "S");
}

function scheduleTimes(establishment, professional) {
  const employee = (establishment?.professionals || []).find((item) => (typeof item === "string" ? item : item.name) === professional);
  const times = establishment?.scheduleMode === "establishment" || typeof employee === "string"
    ? establishment?.availableTimes || []
    : employee?.availableTimes || establishment?.availableTimes || [];
  return [...new Set(times)].sort((a, b) => timeMinutes(a) - timeMinutes(b));
}

export function scheduledTicket(establishment, time, professional, service) {
  // Count the full schedule, including occupied and past slots, so reservations do not renumber tickets.
  const orderedTimes = scheduleTimes(establishment, professional);
  const index = orderedTimes.findIndex((slot) => timeMinutes(slot) === timeMinutes(time));
  const position = index >= 0 ? String(index + 1).padStart(2, "0") : "--";
  return `${professionalInitial(professional)}${serviceInitials(service)}-${position}`;
}

export function queueView(establishment, data, clock) {
  const publicSlots = Array.isArray(data.todaySlots);
  const entries = publicSlots ? data.todaySlots : (data.appointments || []);
  const paused = new Set((data.staffStatuses || []).filter((item) => item.paused && (!item.pausedDate || item.pausedDate === clock.date)).map((item) => item.professional));
  const activeStaff = (data.staffStatuses || []).filter((item) => item.currentDate === clock.date && item.currentTime && item.professional);
  const activeKeys = new Set(activeStaff.map((item) => `${item.currentTime}|${item.professional}`));
  const scheduled = entries
    .filter((item) => item.date === clock.date && item.time && item.professional && !["concluido", "cancelado"].includes(item.status))
    .map((item) => ({ ...item, ticket: scheduledTicket(establishment, item.time, item.professional, item.service), kind: "scheduled" }))
    .sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const current = scheduled.filter((item) => item.status === "atendendo" || activeKeys.has(`${item.time}|${item.professional}`));
  for (const status of activeStaff) {
    if (entries.some((item) => item.date === clock.date && item.time === status.currentTime && item.professional === status.professional && ["concluido", "cancelado"].includes(item.status))) continue;
    if (current.some((item) => item.time === status.currentTime && item.professional === status.professional)) continue;
    const slot = (data.slots || []).find((item) => item.date === clock.date && item.time === status.currentTime && item.professional === status.professional);
    const service = status.currentService || slot?.service;
    current.push({ kind: "scheduled", ticket: scheduledTicket(establishment, status.currentTime, status.professional, service), time: status.currentTime, professional: status.professional, service });
  }
  for (const employee of establishment?.professionals || []) {
    const professional = typeof employee === "string" ? employee : employee.name;
    if (current.some((item) => item.professional === professional)) continue;
    const times = scheduleTimes(establishment, professional);
    if (!times.length || clock.minutes < timeMinutes(times[0]) || clock.minutes > timeMinutes(times.at(-1))) continue;
    const time = times.filter((slot) => timeMinutes(slot) <= clock.minutes).at(-1);
    const appointment = entries.find((item) => item.date === clock.date && item.time === time && item.professional === professional)
      || (data.slots || []).find((item) => item.date === clock.date && item.time === time && item.professional === professional);
    if (["concluido", "cancelado"].includes(appointment?.status)) continue;
    const service = appointment?.service;
    current.push({ ...appointment, date: clock.date, time, professional, service, kind: "scheduled", unbooked: !appointment, ticket: scheduledTicket(establishment, time, professional, service) });
  }
  current.sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const currentSlots = new Set(current.map((item) => `${item.time}|${item.professional}`));
  const upcoming = scheduled.filter((item) => !currentSlots.has(`${item.time}|${item.professional}`) && (publicSlots
    ? timeMinutes(item.time) >= clock.minutes
    : ["confirmado", "presente"].includes(item.status)));
  const walkIns = data.queue || [];
  return {
    current: [...current.map((item) => ({ ...item, ticketState: paused.has(item.professional) ? "paused" : "in-service" })), ...walkIns.filter((item) => item.status === "atendendo").map((item) => ({ ...item, kind: "walk-in", ticketState: "in-service" }))],
    waiting: [...upcoming.map((item) => ({ ...item, ticketState: "reserved" })), ...walkIns.filter((item) => item.status === "aguardando").map((item) => ({ ...item, kind: "walk-in", ticketState: "reserved" }))],
  };
}
