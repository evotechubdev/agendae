function timeMinutes(time) {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizedWords(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().match(/[A-Z0-9]+/g) || [];
}

export function professionalInitial(name) {
  return normalizedWords(name)[0]?.[0] || "P";
}

export function serviceInitials(service) {
  const words = normalizedWords(service).filter((word) => !["DE", "DA", "DO", "DAS", "DOS", "E", "COM", "A", "O"].includes(word));
  return words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : (words[0] || "SS").slice(0, 2).padEnd(2, "S");
}

export function scheduledTicket(establishment, time, professional, service) {
  const employee = (establishment?.professionals || []).find((item) => (typeof item === "string" ? item : item.name) === professional);
  const times = establishment?.scheduleMode === "establishment" || typeof employee === "string"
    ? establishment?.availableTimes || []
    : employee?.availableTimes || establishment?.availableTimes || [];
  // Count the full schedule, including occupied and past slots, so reservations do not renumber tickets.
  const orderedTimes = [...new Set(times)].sort((a, b) => timeMinutes(a) - timeMinutes(b));
  const index = orderedTimes.findIndex((slot) => timeMinutes(slot) === timeMinutes(time));
  const position = index >= 0 ? String(index + 1).padStart(2, "0") : "--";
  return `${professionalInitial(professional)}${serviceInitials(service)}-${position}`;
}

export function queueView(establishment, data, clock) {
  const publicSlots = Array.isArray(data.todaySlots);
  const entries = publicSlots ? data.todaySlots : (data.appointments || []);
  const activeStaff = (data.staffStatuses || []).filter((item) => item.currentDate === clock.date && item.currentTime && item.professional);
  const activeKeys = new Set(activeStaff.map((item) => `${item.currentTime}|${item.professional}`));
  const scheduled = entries
    .filter((item) => item.date === clock.date && item.time && item.professional && !["concluido", "cancelado"].includes(item.status))
    .map((item) => ({ ...item, ticket: scheduledTicket(establishment, item.time, item.professional, item.service), kind: "scheduled" }))
    .sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const current = scheduled.filter((item) => item.status === "atendendo" || activeKeys.has(`${item.time}|${item.professional}`));
  for (const status of activeStaff) {
    if (current.some((item) => item.time === status.currentTime && item.professional === status.professional)) continue;
    const slot = (data.slots || []).find((item) => item.date === clock.date && item.time === status.currentTime && item.professional === status.professional);
    const service = status.currentService || slot?.service;
    current.push({ kind: "scheduled", ticket: scheduledTicket(establishment, status.currentTime, status.professional, service), time: status.currentTime, professional: status.professional, service });
  }
  current.sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const currentSlots = new Set(current.map((item) => `${item.time}|${item.professional}`));
  const upcoming = scheduled.filter((item) => !currentSlots.has(`${item.time}|${item.professional}`) && (publicSlots
    ? timeMinutes(item.time) >= clock.minutes
    : ["confirmado", "presente"].includes(item.status)));
  const walkIns = data.queue || [];
  return {
    current: [...current, ...walkIns.filter((item) => item.status === "atendendo").map((item) => ({ ...item, kind: "walk-in" }))],
    waiting: [...upcoming, ...walkIns.filter((item) => item.status === "aguardando").map((item) => ({ ...item, kind: "walk-in" }))],
  };
}
