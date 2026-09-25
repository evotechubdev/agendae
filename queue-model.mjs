function timeMinutes(time) {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  return hours * 60 + minutes;
}

export function scheduledTicket(establishment, time, professional) {
  const prefix = String(establishment?.queuePrefix || "H").replace(/[^a-z0-9]/gi, "").toUpperCase() || "H";
  const minutes = String(time || "").replace(/\D/g, "").padStart(4, "0");
  const name = String(professional || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < name.length; index++) hash = Math.imul(hash ^ name.charCodeAt(index), 16777619);
  return `${prefix}-${minutes}-${((hash >>> 0) % 1679616).toString(36).toUpperCase().padStart(4, "0")}`;
}

export function queueView(establishment, data, clock) {
  const publicSlots = Array.isArray(data.todaySlots);
  const entries = publicSlots ? data.todaySlots : (data.appointments || []);
  const activeStaff = (data.staffStatuses || []).filter((item) => item.currentDate === clock.date && item.currentTime && item.professional);
  const activeKeys = new Set(activeStaff.map((item) => `${item.currentTime}|${item.professional}`));
  const scheduled = entries
    .filter((item) => item.date === clock.date && item.time && item.professional && !["concluido", "cancelado"].includes(item.status))
    .map((item) => ({ ...item, ticket: scheduledTicket(establishment, item.time, item.professional), kind: "scheduled" }))
    .sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const current = scheduled.filter((item) => item.status === "atendendo" || activeKeys.has(`${item.time}|${item.professional}`));
  for (const status of activeStaff) {
    if (current.some((item) => item.time === status.currentTime && item.professional === status.professional)) continue;
    current.push({ kind: "scheduled", ticket: scheduledTicket(establishment, status.currentTime, status.professional), time: status.currentTime, professional: status.professional });
  }
  current.sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.professional.localeCompare(b.professional));
  const currentTickets = new Set(current.map((item) => item.ticket));
  const upcoming = scheduled.filter((item) => !currentTickets.has(item.ticket) && (publicSlots
    ? timeMinutes(item.time) >= clock.minutes
    : ["confirmado", "presente"].includes(item.status)));
  const walkIns = data.queue || [];
  return {
    current: [...current, ...walkIns.filter((item) => item.status === "atendendo").map((item) => ({ ...item, kind: "walk-in" }))],
    waiting: [...upcoming, ...walkIns.filter((item) => item.status === "aguardando").map((item) => ({ ...item, kind: "walk-in" }))],
  };
}
