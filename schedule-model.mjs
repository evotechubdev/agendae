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

export function scheduleTimeline(establishment) {
  const matrix = scheduleMatrix(establishment);
  if (!matrix.times.length) return { ...matrix, step: 60, majorStep: 60 };
  // Hourly headings share exact internal tracks for each professional's start times.
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const openingHours = (establishment.hours || []).flatMap((item) => {
    const matches = [...String(item.value || "").matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map((match) => Number(match[1]) * 60 + Number(match[2])).filter((value) => value >= 0 && value <= 1440);
    return matches.length >= 2 && matches[1] > matches[0] ? [{ start: matches[0], end: matches[1] }] : [];
  });
  const first = Math.floor(Math.min(minutes(matrix.times[0]), ...openingHours.map((item) => item.start)) / 60) * 60;
  const slotDuration = (professional) => {
    const gaps = professional.availableTimes.slice(1).map((time, index) => minutes(time) - minutes(professional.availableTimes[index])).filter((gap) => gap > 0 && gap <= 120).sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : 30;
  };
  const step = matrix.professionals.filter((professional) => professional.availableTimes.length).reduce((value, professional) => gcd(value, slotDuration(professional)), matrix.times.reduce((value, time) => gcd(value, minutes(time)), 60));
  const last = Math.min(1440, Math.ceil(Math.max(minutes(matrix.times.at(-1)), ...openingHours.map((item) => item.end), ...matrix.professionals.filter((professional) => professional.availableTimes.length).map((professional) => minutes(professional.availableTimes.at(-1)) + slotDuration(professional))) / 60) * 60);
  const times = Array.from({ length: (last - first) / step }, (_, index) => {
    const value = first + index * step;
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  });
  const professionals = matrix.professionals.map((professional) => {
    const segments = [];
    const duration = slotDuration(professional);
    let slotIndex = -1;
    times.forEach((time, index) => {
      while (slotIndex + 1 < professional.availableTimes.length && minutes(professional.availableTimes[slotIndex + 1]) <= minutes(time)) slotIndex++;
      const onLunch = isLunchTime(professional.lunchBreak, time);
      const inSchedule = slotIndex >= 0 && !isLunchTime(professional.lunchBreak, professional.availableTimes[slotIndex]) && minutes(time) < minutes(professional.availableTimes.at(-1)) + duration;
      const type = onLunch ? "lunch" : inSchedule ? "slot" : "unavailable";
      const slot = type === "slot" ? professional.availableTimes[slotIndex] : null;
      const previous = segments.at(-1);
      if (previous && previous.type === type && previous.time === slot) previous.end = index + 1;
      else segments.push({ type, time: slot, start: index, end: index + 1 });
    });
    return { ...professional, segments };
  });
  const formatTime = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return { times, professionals, step, majorStep: 60, startTime: formatTime(first), endTime: formatTime(last) };
}
