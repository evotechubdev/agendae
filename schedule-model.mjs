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
