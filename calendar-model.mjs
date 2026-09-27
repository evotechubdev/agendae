export function shiftCalendarMonth(month, offset) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function calendarMonthDays(month) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const last = new Date(`${shiftCalendarMonth(month, 1)}-01T12:00:00Z`);
  last.setUTCDate(0);
  const days = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 1; day <= last.getUTCDate(); day++) days.push(`${month}-${String(day).padStart(2, "0")}`);
  while (days.length % 7) days.push(null);
  return days;
}

export function renderBookingCalendar({ selectedDate, today, month = selectedDate.slice(0, 7), open = false, dateMode = "other" }) {
  const displayedMonth = month || selectedDate.slice(0, 7);
  const selectedLabel = dateMode === "other" ? selectedDate.split("-").reverse().join("/") : "Escolher data";
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${displayedMonth}-01T12:00:00Z`));
  const formatDate = date => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  const calendar = !open ? "" : `<div class="booking-calendar-popover" id="booking-calendar-popover" role="dialog" aria-labelledby="booking-calendar-title"><div class="booking-calendar-heading"><button type="button" data-calendar-month-step="-1" aria-label="Mês anterior">‹</button><strong id="booking-calendar-title" aria-live="polite">${monthLabel}</strong><button type="button" data-calendar-month-step="1" aria-label="Próximo mês">›</button><button type="button" data-calendar-close aria-label="Fechar calendário">×</button></div><div class="booking-calendar-grid" role="group" aria-label="Datas de ${monthLabel}">${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(day => `<span class="booking-calendar-weekday">${day}</span>`).join("")}${calendarMonthDays(displayedMonth).map(date => date === null ? '<span class="booking-calendar-blank" aria-hidden="true"></span>' : `<button type="button" data-calendar-date="${date}" aria-label="${formatDate(date)}${date < today ? ", data passada" : ""}" aria-pressed="${date === selectedDate}" ${date === today ? 'aria-current="date"' : ""} ${date < today ? "disabled" : ""}>${Number(date.slice(-2))}</button>`).join("")}</div><p class="booking-calendar-note">Escolha uma data para consultar os horários.</p></div>`;
  return `<div class="schedule-date-field booking-calendar" data-booking-calendar><span>Outra data</span><button class="booking-calendar-toggle" type="button" data-calendar-toggle data-booking-date aria-haspopup="dialog" aria-expanded="${open}" aria-controls="booking-calendar-popover" aria-label="Escolha outra data: ${selectedLabel}"><span>${selectedLabel}</span><span aria-hidden="true">▦</span></button>${calendar}</div>`;
}
