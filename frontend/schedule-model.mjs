export function scheduleMatrix(establishment) {
  const employeeMode = establishment.scheduleMode !== "establishment";
  const professionals = (establishment.professionals || []).map((item) => {
    const professional = typeof item === "string" ? { name: item } : item;
    const source = employeeMode ? professional.availableTimes || establishment.availableTimes || [] : establishment.availableTimes || [];
    const times = [...new Set(source.filter((time) => /^\d{1,2}:\d{2}$/.test(time) && Number(time.split(":")[0]) < 24 && Number(time.split(":")[1]) < 60).map((time) => time.padStart(5, "0")))].sort((a, b) => minutes(a) - minutes(b));
    return { ...professional, availableTimes: times, lunchBreak: lunchBreakFor(establishment, professional.name) };
  });
  const times = [...new Set(professionals.flatMap((professional) => [...professional.availableTimes, ...(professional.lunchBreak ? [professional.lunchBreak.start, professional.lunchBreak.end] : [])]))].sort((a, b) => minutes(a) - minutes(b));
  return {
    times,
    professionals: professionals.map((professional) => ({ ...professional, periods: times.map((time) => professional.availableTimes.includes(time) || isLunchTime(professional.lunchBreak, time) ? time : null) })),
  };
}

export function lunchBreakFor(establishment, professionalName) {
  const professional = (establishment.professionals || []).find((item) => item.name === professionalName);
  const configured = establishment.professionalLunchBreaks || {};
  const interval = Object.hasOwn(configured, professionalName) ? configured[professionalName] : professional?.lunchBreak;
  const validTime = (time) => /^\d{2}:\d{2}$/.test(time || "") && minutes(time) >= 0 && minutes(time) < 1440 && Number(time.split(":")[1]) < 60;
  return interval && validTime(interval.start) && validTime(interval.end) && minutes(interval.end) > minutes(interval.start)
    ? { start: interval.start, end: interval.end } : null;
}

export function isLunchTime(interval, time) {
  const value = typeof time === "number" ? time : minutes(String(time || ""));
  return Boolean(interval && value >= minutes(interval.start) && value < minutes(interval.end));
}

function minutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function scheduleBands(times, columns) {
  const size = Math.max(1, Math.floor(Number(columns) || 1));
  return Array.from({ length: Math.ceil(times.length / size) }, (_, index) => ({ start: index * size, end: Math.min(times.length, (index + 1) * size), times: times.slice(index * size, (index + 1) * size) }));
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

export function serviceFitsSlot(establishment, professionalName, time, service, bookings = []) {
  const start = minutes(time);
  const end = start + serviceDurationFor(establishment, professionalName, service);
  const lunch = lunchBreakFor(establishment, professionalName);
  if (lunch && start < minutes(lunch.end) && end > minutes(lunch.start)) return false;
  return !bookings.some((item) => {
    if (["concluido", "cancelado"].includes(item.status)) return false;
    if (establishment.scheduleMode !== "establishment" && item.professional !== professionalName && !item.id?.endsWith("_establishment")) return false;
    const bookedStart = minutes(item.time);
    const bookedEnd = bookedStart + serviceDurationFor(establishment, item.professional, item.service);
    return start < bookedEnd && end > bookedStart;
  });
}

export function scheduleTimeline(establishment, bookings = []) {
  const matrix = scheduleMatrix(establishment);
  if (!matrix.times.length) return { ...matrix, step: 60, majorStep: 60 };
  // Hourly headings share exact internal tracks for each professional's start times.
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const openingHours = (establishment.hours || []).flatMap((item) => {
    const matches = [...String(item.value || "").matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map((match) => Number(match[1]) * 60 + Number(match[2])).filter((value) => value >= 0 && value <= 1440);
    return matches.length >= 2 && matches[1] > matches[0] ? [{ start: matches[0], end: matches[1] }] : [];
  });
  const first = Math.floor(Math.min(minutes(matrix.times[0]), ...openingHours.map((item) => item.start)) / 60) * 60;
  const jobsFor = (professional) => professional.availableTimes.map((time) => {
    const booking = bookings.find((item) => item.time === time && (item.professional === professional.name || item.id?.endsWith("_establishment")));
    const duration = serviceDurationFor(establishment, professional.name, booking?.service);
    return { time, start: minutes(time), end: minutes(time) + duration, booked: Boolean(booking), valid: Boolean(booking) || serviceFitsSlot(establishment, professional.name, time, undefined, bookings) };
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
    times.forEach((time, index) => {
      const onLunch = isLunchTime(professional.lunchBreak, time);
      const active = jobs[professionalIndex].filter((job) => job.valid && job.start <= minutes(time) && job.end > minutes(time) && !isLunchTime(professional.lunchBreak, job.time));
      const job = active.find((item) => item.booked) || active[0];
      const type = onLunch ? "lunch" : job ? "slot" : "unavailable";
      const slot = type === "slot" ? job.time : null;
      const previous = segments.at(-1);
      if (previous && previous.type === type && previous.time === slot) previous.end = index + 1;
      else segments.push({ type, time: slot, start: index, end: index + 1 });
    });
    return { ...professional, segments };
  });
  const formatTime = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return { times, professionals, step, majorStep: 60, startTime: formatTime(first), endTime: formatTime(last) };
}
