import { lunchBreakFor, isLunchTime, pauseIntervalFor, scheduleMatrix, serviceFitsSlot, businessDayIsClosed, businessHoursRangeForDate, serviceAvailableAt } from "./schedule-model.mjs";

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

export function ticketSubstatus(item, state) {
  return state === "reserved" && item?.status === "presente" ? "Presença Confirmada" : "";
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
  const dailyHours = businessHoursRangeForDate(establishment, clock.date);
  const publicSlots = Array.isArray(data.todaySlots);
  const entries = publicSlots ? data.todaySlots : (data.appointments || []);
  const professionals = [...new Set((establishment?.professionals || []).map((item) => typeof item === "string" ? item : item.name).filter(Boolean))];
  const validSlot = (item) => professionals.includes(item.professional) && scheduleTimes(establishment, item.professional).includes(item.time);
  const paused = new Set((data.staffStatuses || []).filter((item) => item.paused && (!item.pausedDate || item.pausedDate === clock.date)).map((item) => item.professional));
  const closed = new Set((data.staffStatuses || []).filter((item) => item.closedDate === clock.date).map((item) => item.professional));
  const activeStaff = (data.staffStatuses || []).filter((item) => item.currentDate === clock.date && validSlot({ professional: item.professional, time: item.currentTime }));
  const scheduled = entries
    .filter((item) => item.date === clock.date && validSlot(item) && !["concluido", "cancelado"].includes(item.status))
    .map((item) => ({ ...item, ticket: scheduledTicket(establishment, item.time, item.professional, item.service), kind: "scheduled" }))
    .filter((item) => /^[A-Z]{3}-\d{2,}$/.test(item.ticket))
    .sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const current = [];
  const inactivePosition = (professional, time = null, ticketState = "paused") => ({ date: clock.date, time, professional, kind: "scheduled", ticket: null, ticketState });
  for (const professional of professionals) {
    const times = scheduleTimes(establishment, professional).filter((time) => !dailyHours || timeMinutes(time) >= dailyHours.start && timeMinutes(time) < dailyHours.end);
    const directoryEntry = (establishment.professionals || []).find((item) => item.name === professional);
    const shiftEnd = dailyHours
      ? Math.min(directoryEntry?.scheduleEnd ? timeMinutes(directoryEntry.scheduleEnd) : dailyHours.end, dailyHours.end)
      : directoryEntry?.scheduleEnd ? timeMinutes(directoryEntry.scheduleEnd) : null;
    if (closed.has(professional)) {
      current.push(inactivePosition(professional, null, "closed"));
      continue;
    }
    if (times.length && (shiftEnd !== null ? clock.minutes >= shiftEnd : clock.minutes > timeMinutes(times.at(-1)))) {
      current.push(inactivePosition(professional, null, "closed"));
      continue;
    }
    const status = activeStaff.find((item) => item.professional === professional);
    const ongoing = scheduled.filter((item) => item.professional === professional && item.status === "atendendo").at(-1);
    const onShift = times.length && clock.minutes >= timeMinutes(times[0]) && (shiftEnd !== null ? clock.minutes < shiftEnd : clock.minutes <= timeMinutes(times.at(-1)));
    const time = status?.currentTime || ongoing?.time || (onShift ? times.filter((slot) => timeMinutes(slot) <= clock.minutes).at(-1) : null);
    const onLunch = isLunchTime(lunchBreakFor(establishment, professional), clock.minutes);
    const interval = pauseIntervalFor(establishment, professional, clock.minutes);
    if (!onShift || paused.has(professional) || onLunch || interval || !time) {
      current.push({ ...inactivePosition(professional, onShift ? time : null), ...(onLunch ? { pauseReason: "Almoço" } : interval ? { pauseReason: interval.reason } : {}) });
      continue;
    }
    const appointment = entries.find((item) => item.date === clock.date && item.time === time && item.professional === professional)
      || (data.slots || []).find((item) => item.date === clock.date && item.time === time && item.professional === professional);
    if (["concluido", "cancelado"].includes(appointment?.status)) {
      current.push(inactivePosition(professional, time));
      continue;
    }
    const service = appointment?.service || (status?.currentTime === time ? status.currentService : undefined);
    const ticket = scheduledTicket(establishment, time, professional, service);
    if (!/^[A-Z]{3}-\d{2,}$/.test(ticket)) {
      current.push(inactivePosition(professional, time));
      continue;
    }
    current.push({ ...appointment, date: clock.date, time, professional, service, kind: "scheduled", unbooked: !appointment, ticket, ticketState: "in-service" });
  }
  const currentSlots = new Set(current.map((item) => `${item.time}|${item.professional}`));
  const upcoming = scheduled.filter((item) => !closed.has(item.professional) && !currentSlots.has(`${item.time}|${item.professional}`) && (publicSlots
    ? timeMinutes(item.time) >= clock.minutes
    : ["confirmado", "presente"].includes(item.status)));
  return {
    current,
    waiting: upcoming.map((item) => ({ ...item, ticketState: "reserved" })),
  };
}

export function upcomingFreeSlots(establishment, data, clock) {
  if (businessDayIsClosed(establishment, clock.date)) return [];
  const dailyHours = businessHoursRangeForDate(establishment, clock.date);
  const entries = Array.isArray(data.todaySlots) ? data.todaySlots : (data.slots || data.appointments || []);
  const bookings = entries.filter((item) => item.date === clock.date);
  const closed = new Set((data.staffStatuses || []).filter(item => item.closedDate === clock.date).map(item => item.professional));
  return scheduleMatrix(establishment).professionals.filter(professional => !closed.has(professional.name)).flatMap((professional) => professional.availableTimes
    .filter((time) => timeMinutes(time) > clock.minutes
      && (!dailyHours || timeMinutes(time) >= dailyHours.start && timeMinutes(time) < dailyHours.end)
      && ((establishment.services || []).length
        ? establishment.services.some((service) => serviceAvailableAt(establishment, service, clock.date, time)
          && serviceFitsSlot(establishment, professional.name, time, service.name, bookings))
        : serviceFitsSlot(establishment, professional.name, time, undefined, bookings)))
    .map((time) => ({ kind: "free", time, professional: professional.name })))
    .sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional, "pt-BR"));
}

export function allProfessionalsClosed(current) {
  return current.length > 0 && current.every((item) => item.ticketState === "closed");
}
