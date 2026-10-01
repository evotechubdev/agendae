export function scheduleMatrix(establishment, date = null) {
  const employeeMode = establishment.scheduleMode !== "establishment";
  const professionals = (establishment.professionals || []).map((item) => {
    const professional = typeof item === "string" ? { name: item } : item;
    const lunchBreak = lunchBreakFor(establishment, professional.name, date);
    const dailySchedule = date && professional.slotDuration === 20 && professional.workPeriods?.length
      ? scheduleFromPeriods(professional.workPeriods, lunchBreak) : null;
    const source = employeeMode ? dailySchedule?.availableTimes || professional.availableTimes || establishment.availableTimes || [] : establishment.availableTimes || [];
    const times = [...new Set(source.filter((time) => /^\d{1,2}:\d{2}$/.test(time) && Number(time.split(":")[0]) < 24 && Number(time.split(":")[1]) < 60).map((time) => time.padStart(5, "0")))].sort((a, b) => minutes(a) - minutes(b));
    return { ...professional, availableTimes: times, lunchBreak, pauseIntervals: dailySchedule?.pauseIntervals || professional.pauseIntervals || [] };
  });
  const times = [...new Set(professionals.flatMap((professional) => [...professional.availableTimes, ...(professional.lunchBreak ? [professional.lunchBreak.start, professional.lunchBreak.end] : []), ...(professional.pauseIntervals || []).flatMap(interval => [interval.start, interval.end])]))].sort((a, b) => minutes(a) - minutes(b));
  return {
    times,
    professionals: professionals.map((professional) => ({ ...professional, periods: times.map((time) => professional.availableTimes.includes(time) || isLunchTime(professional.lunchBreak, time) ? time : null) })),
  };
}

export function lunchBreakFor(establishment, professionalName, date = null) {
  const professional = (establishment.professionals || []).find((item) => item.name === professionalName);
  const configured = establishment.professionalLunchBreaks || {};
  const interval = Object.hasOwn(configured, professionalName) ? configured[professionalName] : professional?.lunchBreak;
  const validTime = (time) => /^\d{2}:\d{2}$/.test(time || "") && minutes(time) >= 0 && minutes(time) < 1440 && Number(time.split(":")[1]) < 60;
  const validDays = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
  if (!interval || !validTime(interval.start) || !validTime(interval.end) || minutes(interval.end) <= minutes(interval.start)
    || (interval.days != null && (!Array.isArray(interval.days) || !interval.days.length || interval.days.some(day => !validDays.includes(day))))) return null;
  const day = date && validDays[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
  if (day && interval.days && !interval.days.includes(day)) return null;
  return { start: interval.start, end: interval.end, ...(interval.days ? { days: interval.days } : {}) };
}

export function isLunchTime(interval, time) {
  const value = typeof time === "number" ? time : minutes(String(time || ""));
  return Boolean(interval && value >= minutes(interval.start) && value < minutes(interval.end));
}

export function workplaceHours(establishment, locationType = "address1") {
  if (locationType === "address2") return establishment.hours2?.length ? establishment.hours2 : establishment.hours || [];
  return establishment.hours || [];
}

export function businessHoursForDate(establishment, date, locationType = "address1") {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const day = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][weekday];
  const key = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const weekdayGroup = label => label.includes("diasuteis") || label === "uteis" || label.includes("seg") && label.includes("sex");
  const hours = workplaceHours(establishment, locationType);
  return hours.find(item => key(item.label).startsWith(day) && !weekdayGroup(key(item.label)))
    || (weekday >= 1 && weekday <= 5 ? hours.find(item => weekdayGroup(key(item.label))) : null)
    || hours.find(item => ["todososdias", "diariamente"].includes(key(item.label)));
}

export function businessDayIsClosed(establishment, date, locationType = null) {
  if (establishment.extraWorkingDates?.[date] === true) return false;
  if (!locationType && establishment.address2 && !businessDayIsClosed(establishment, date, "address2")) return false;
  const hours = workplaceHours(establishment, locationType || "address1");
  const entry = businessHoursForDate(establishment, date, locationType || "address1");
  return entry ? /fechado/i.test(entry.value || "") : Boolean(hours.length);
}

export function businessHoursRangeForDate(establishment, date, locationType = "address1") {
  if (businessDayIsClosed(establishment, date, locationType) || establishment.extraWorkingDates?.[date] === true) return null;
  const value = String(businessHoursForDate(establishment, date, locationType)?.value || "");
  const times = [...value.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)].map(match => minutes(match[0]));
  return times.length >= 2 && times[1] > times[0] ? { start: times[0], end: times[1] } : null;
}

export function serviceAvailableAt(establishment, service, date, time) {
  const locationType = service?.locationType || "address1";
  if (!service || locationType === "address2" && !establishment.address2 || businessDayIsClosed(establishment, date, locationType) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) return false;
  const start = minutes(time);
  const duration = Number(service.duration) || 20;
  const end = start + duration;
  const business = businessHoursRangeForDate(establishment, date, locationType);
  if (business && (start < business.start || end > business.end)) return false;
  if (service.weeklyAvailability == null) return true;
  const day = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date(`${date}T12:00:00Z`).getUTCDay()];
  return (service.weeklyAvailability[day] || []).some(interval => start >= minutes(interval.start) && end <= minutes(interval.end));
}

export function businessOpeningMinutes(establishment, date) {
  if (businessDayIsClosed(establishment, date)) return null;
  if (establishment.extraWorkingDates?.[date] === true) {
    const first = scheduleMatrix(establishment).times[0];
    return first ? minutes(first) : null;
  }
  if (establishment.address2) {
    const ranges = ["address1", "address2"].map(location => businessHoursRangeForDate(establishment, date, location)).filter(Boolean);
    if (ranges.length) return Math.min(...ranges.map(range => range.start));
  }
  const entry = businessHoursForDate(establishment, date);
  if (entry) {
    if (/fechado/i.test(entry.value || "")) return null;
    const match = String(entry.value || "").match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
  }
  const first = scheduleMatrix(establishment).times[0];
  return first ? minutes(first) : null;
}

function minutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function continuousSchedule(start, end, lunchBreak = null, duration = 20) {
  const format = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const availableTimes = [];
  const pauseIntervals = [];
  const first = minutes(start), last = minutes(end);
  if (!Number.isInteger(duration) || duration <= 0 || !Number.isFinite(first) || !Number.isFinite(last) || last <= first) return { availableTimes, pauseIntervals };
  const lunchStart = lunchBreak ? minutes(lunchBreak.start) : last;
  const lunchEnd = lunchBreak ? minutes(lunchBreak.end) : last;
  let cursor = first;
  while (cursor < last) {
    if (lunchBreak && cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
      continue;
    }
    const boundary = cursor < lunchStart ? Math.min(last, lunchStart) : last;
    if (cursor + duration <= boundary) {
      availableTimes.push(format(cursor));
      cursor += duration;
    } else {
      pauseIntervals.push({ start: format(cursor), end: format(boundary), reason: "Intervalo" });
      cursor = boundary;
    }
  }
  return { availableTimes, pauseIntervals };
}

export function pauseIntervalFor(establishment, professionalName, time) {
  const professional = (establishment.professionals || []).find((item) => item.name === professionalName);
  return (professional?.pauseIntervals || []).find((interval) => isLunchTime(interval, time)) || null;
}

export function workPeriodsFor(professional) {
  if (professional?.workPeriods?.length) return professional.workPeriods;
  if (professional?.scheduleStart && professional?.scheduleEnd) return [{ start: professional.scheduleStart, end: professional.scheduleEnd }];
  const times = [...(professional?.availableTimes || [])].sort((a, b) => minutes(a) - minutes(b));
  if (!times.length) return [];
  const end = Math.min(1440, minutes(times.at(-1)) + 20);
  return [{ start: times[0], end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` }];
}

export function scheduleFromPeriods(periods, lunchBreak = null) {
  const valid = (time, allowMidnight = false) => /^\d{2}:\d{2}$/.test(time || "") && Number(time.slice(3)) < 60 && minutes(time) >= 0 && (minutes(time) < 1440 || allowMidnight && time === "24:00");
  if (!Array.isArray(periods) || !periods.length || periods.some(item => !valid(item.start) || !valid(item.end, true) || minutes(item.end) <= minutes(item.start))) throw new Error("Informe início e fim válidos para cada período de trabalho.");
  const workPeriods = periods.map(({ start, end }) => ({ start, end })).sort((a, b) => minutes(a.start) - minutes(b.start));
  if (workPeriods.slice(1).some((item, index) => minutes(item.start) < minutes(workPeriods[index].end))) throw new Error("Os períodos de trabalho não podem se sobrepor.");
  const schedules = workPeriods.map(period => continuousSchedule(period.start, period.end, lunchBreak));
  const availableTimes = schedules.flatMap(item => item.availableTimes);
  if (!availableTimes.length) throw new Error("A escala precisa ter pelo menos um atendimento completo de 20 minutos.");
  const pauseIntervals = schedules.flatMap(item => item.pauseIntervals);
  workPeriods.slice(1).forEach((period, index) => {
    const previous = workPeriods[index];
    if (previous.end !== period.start) pauseIntervals.push({ start: previous.end, end: period.start, reason: "Intervalo" });
  });
  return { workPeriods, availableTimes, pauseIntervals: pauseIntervals.sort((a, b) => minutes(a.start) - minutes(b.start)), scheduleStart: workPeriods[0].start, scheduleEnd: workPeriods.at(-1).end, slotDuration: 20 };
}

export function scheduleBands(times, columns) {
  const size = Math.max(1, Math.floor(Number(columns) || 1));
  return Array.from({ length: Math.ceil(times.length / size) }, (_, index) => ({ start: index * size, end: Math.min(times.length, (index + 1) * size), times: times.slice(index * size, (index + 1) * size) }));
}

export function scheduleDayPeriods(timeline) {
  const times = timeline.times || [];
  if (!times.length) return [];
  const split = times.findIndex(time => minutes(time) >= 13 * 60);
  const boundary = split < 0 ? times.length : split;
  return [{ id: "morning", label: "Manhã", start: 0, end: boundary }, { id: "afternoon", label: "Tarde", start: boundary, end: times.length }]
    .filter(period => period.end > period.start)
    .map(period => ({ ...period, times: times.slice(period.start, period.end), startTime: times[period.start], endTime: times[period.end] || timeline.endTime }));
}

export function serviceDurationFor(establishment, professionalName, service) {
  const professional = (establishment.professionals || []).find((item) => (typeof item === "string" ? item : item.name) === professionalName);
  const key = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (!key(service) || ["si", "servico indefinido"].includes(key(service))) return 20;
  const configured = (establishment.services || []).find((item) => key(item.name) === key(service) || key(item.id) === key(service));
  const configuredDuration = Number(configured?.duration);
  if (configuredDuration > 0 && Number.isInteger(configuredDuration)) return configuredDuration;
  const source = establishment.scheduleMode === "establishment" ? establishment.availableTimes || [] : professional?.availableTimes || establishment.availableTimes || [];
  const ordered = [...new Set(source.map(minutes).filter(Number.isFinite))].sort((a, b) => a - b);
  const gaps = ordered.slice(1).map((time, index) => time - ordered[index]).filter((gap) => gap > 0 && gap <= 120).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : 30;
}

export function appointmentDurationMinutes(establishment, appointment) {
  const saved = Number(appointment?.durationMinutes);
  return Number.isInteger(saved) && saved > 0 ? saved : serviceDurationFor(establishment, appointment?.professional, appointment?.service);
}

export function appointmentPresenceWindow(establishment, appointment, now = new Date()) {
  const start = new Date(`${appointment?.date}T${appointment?.time}:00-03:00`).getTime();
  const end = start + appointmentDurationMinutes(establishment, appointment) * 60000;
  const opens = start - 60 * 60000;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(now);
  const allowed = Number.isFinite(start) && appointment.date === today && now.getTime() >= opens && now.getTime() <= end;
  return { allowed, opens, end };
}

export function reservedServicesForDate(establishment, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return [];
  const weekday = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][new Date(`${date}T12:00:00Z`).getUTCDay()];
  return (establishment.reservedServices || []).filter(item => item.weekday === weekday);
}

export function reservedServiceOverlaps(establishment, professionalName, date, start, end) {
  return reservedServicesForDate(establishment, date).some(item => item.professional === professionalName && start < minutes(item.end) && end > minutes(item.start));
}

export function serviceFitsSlot(establishment, professionalName, time, service, bookings = [], date = null) {
  const start = minutes(time);
  const end = start + serviceDurationFor(establishment, professionalName, service);
  if (date && reservedServiceOverlaps(establishment, professionalName, date, start, end)) return false;
  const lunch = lunchBreakFor(establishment, professionalName, date);
  if (lunch && start < minutes(lunch.end) && end > minutes(lunch.start)) return false;
  const professional = (establishment.professionals || []).find((item) => item.name === professionalName);
  const pauses = date && professional?.slotDuration === 20 && professional.workPeriods?.length
    ? scheduleFromPeriods(professional.workPeriods, lunch).pauseIntervals : professional?.pauseIntervals || [];
  if (pauses.some((interval) => start < minutes(interval.end) && end > minutes(interval.start))) return false;
  if (professional?.workPeriods?.length && !professional.workPeriods.some(period => start >= minutes(period.start) && end <= minutes(period.end))) return false;
  if (professional?.scheduleEnd && end > minutes(professional.scheduleEnd)) return false;
  return !bookings.some((item) => {
    if (["concluido", "cancelado"].includes(item.status)) return false;
    if (establishment.scheduleMode !== "establishment" && item.professional !== professionalName && !item.id?.endsWith("_establishment")) return false;
    const bookedStart = minutes(item.time);
    const bookedEnd = bookedStart + serviceDurationFor(establishment, item.professional, item.service);
    return start < bookedEnd && end > bookedStart;
  });
}

export function scheduleTimeline(establishment, bookings = [], date = null) {
  const locations = establishment.address2 ? ["address1", "address2"] : ["address1"];
  const dailyHours = date ? locations.map(location => businessHoursRangeForDate(establishment, date, location)).filter(Boolean) : [];
  const fullMatrix = scheduleMatrix(establishment, date);
  const withinDay = time => !date || establishment.extraWorkingDates?.[date] === true || dailyHours.some(range => minutes(time) >= range.start && minutes(time) < range.end);
  const matrix = date && (establishment.hours || []).length ? { times: fullMatrix.times.filter(withinDay), professionals: fullMatrix.professionals.map(item => ({ ...item, availableTimes: item.availableTimes.filter(withinDay) })) } : fullMatrix;
  if (!matrix.times.length) return { ...matrix, step: 60, majorStep: 60 };
  // Hourly headings share exact internal tracks for each professional's start times.
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const openingHours = dailyHours.length ? dailyHours : [...(establishment.hours || []), ...(establishment.address2 ? establishment.hours2 || [] : [])].flatMap((item) => {
    const matches = [...String(item.value || "").matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map((match) => Number(match[1]) * 60 + Number(match[2])).filter((value) => value >= 0 && value <= 1440);
    return matches.length >= 2 && matches[1] > matches[0] ? [{ start: matches[0], end: matches[1] }] : [];
  });
  const first = Math.floor(Math.min(minutes(matrix.times[0]), ...openingHours.map((item) => item.start)) / 60) * 60;
  const jobsFor = (professional) => professional.availableTimes.map((time) => {
    const booking = bookings.find((item) => item.time === time && (item.professional === professional.name || item.id?.endsWith("_establishment")));
    const duration = serviceDurationFor(establishment, professional.name, booking?.service);
    return { time, start: minutes(time), end: minutes(time) + duration, booked: Boolean(booking), valid: Boolean(booking) || serviceFitsSlot(establishment, professional.name, time, undefined, bookings, date) };
  });
  const jobs = matrix.professionals.map(jobsFor);
  const step = jobs.flat().reduce((value, job) => gcd(value, job.end), matrix.times.reduce((value, time) => gcd(value, minutes(time)), 60));
  const last = Math.min(1440, Math.ceil(Math.max(minutes(matrix.times.at(-1)), ...openingHours.map((item) => item.end), ...jobs.flat().map((job) => job.end)) / 60) * 60);
  const times = Array.from({ length: (last - first) / step }, (_, index) => {
    const value = first + index * step;
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  });
  const professionals = matrix.professionals.map((professional, professionalIndex) => {
    const segments = [];
    const reservedServices = date ? reservedServicesForDate(establishment, date).filter(item => item.professional === professional.name) : [];
    times.forEach((time, index) => {
      const onLunch = isLunchTime(professional.lunchBreak, time);
      const pause = pauseIntervalFor(establishment, professional.name, time);
      const reserved = reservedServices.find(item => minutes(time) >= minutes(item.start) && minutes(time) < minutes(item.end));
      const active = jobs[professionalIndex].filter((job) => job.valid && job.start <= minutes(time) && job.end > minutes(time) && !isLunchTime(professional.lunchBreak, job.time));
      const job = active.find((item) => item.booked) || active[0];
      const type = job?.booked ? "slot" : onLunch ? "lunch" : pause ? "pause" : reserved ? "reserved" : job ? "slot" : "unavailable";
      const slot = type === "slot" ? job.time : null;
      const reason = reserved ? `${reserved.name} · ${reserved.place}` : pause?.reason;
      const previous = segments.at(-1);
      if (previous && previous.type === type && previous.time === slot && previous.reason === reason) previous.end = index + 1;
      else segments.push({ type, time: slot, start: index, end: index + 1, ...(reason ? { reason } : {}) });
    });
    return { ...professional, segments };
  });
  const formatTime = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return { times, professionals, step, majorStep: 60, startTime: formatTime(first), endTime: formatTime(last) };
}
