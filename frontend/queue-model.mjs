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
  if (index < 0) return "";
  const position = String(index + 1).padStart(2, "0");
  return `${professionalInitial(professional)}${serviceInitials(service)}-${position}`;
}

export function queueView(establishment, data, clock) {
  const publicSlots = Array.isArray(data.todaySlots);
  const entries = publicSlots ? data.todaySlots : (data.appointments || []);
  const professionals = [...new Set((establishment?.professionals || []).map((item) => typeof item === "string" ? item : item.name).filter(Boolean))];
  const validSlot = (item) => professionals.includes(item.professional) && scheduleTimes(establishment, item.professional).includes(item.time);
  const paused = new Set((data.staffStatuses || []).filter((item) => item.paused && (!item.pausedDate || item.pausedDate === clock.date)).map((item) => item.professional));
  const activeStaff = (data.staffStatuses || []).filter((item) => item.currentDate === clock.date && validSlot({ professional: item.professional, time: item.currentTime }));
  const scheduled = entries
    .filter((item) => item.date === clock.date && validSlot(item) && !["concluido", "cancelado"].includes(item.status))
    .map((item) => ({ ...item, ticket: scheduledTicket(establishment, item.time, item.professional, item.service), kind: "scheduled" }))
    .filter((item) => /^[A-Z]{3}-\d{2,}$/.test(item.ticket))
    .sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const current = [];
  for (const professional of professionals) {
    const times = scheduleTimes(establishment, professional);
    const status = activeStaff.find((item) => item.professional === professional);
    const ongoing = scheduled.filter((item) => item.professional === professional && item.status === "atendendo").at(-1);
    const onShift = times.length && clock.minutes >= timeMinutes(times[0]) && clock.minutes <= timeMinutes(times.at(-1));
    const time = status?.currentTime || ongoing?.time || (onShift ? times.filter((slot) => timeMinutes(slot) <= clock.minutes).at(-1) : null);
    if (!time) continue;
    const appointment = entries.find((item) => item.date === clock.date && item.time === time && item.professional === professional)
      || (data.slots || []).find((item) => item.date === clock.date && item.time === time && item.professional === professional);
    if (["concluido", "cancelado"].includes(appointment?.status)) continue;
    const service = appointment?.service || (status?.currentTime === time ? status.currentService : undefined);
    const ticket = scheduledTicket(establishment, time, professional, service);
    if (!/^[A-Z]{3}-\d{2,}$/.test(ticket)) continue;
    current.push({ ...appointment, date: clock.date, time, professional, service, kind: "scheduled", unbooked: !appointment, ticket });
  }
  current.sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const currentSlots = new Set(current.map((item) => `${item.time}|${item.professional}`));
  const upcoming = scheduled.filter((item) => !currentSlots.has(`${item.time}|${item.professional}`) && (publicSlots
    ? timeMinutes(item.time) >= clock.minutes
    : ["confirmado", "presente"].includes(item.status)));
  return {
    current: current.map((item) => ({ ...item, ticketState: paused.has(item.professional) ? "paused" : "in-service" })),
    waiting: upcoming.map((item) => ({ ...item, ticketState: "reserved" })),
  };
}
