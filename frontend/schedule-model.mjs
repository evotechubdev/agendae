export function scheduleMatrix(establishment) {
  const employeeMode = establishment.scheduleMode !== "establishment";
  const professionals = (establishment.professionals || []).map((item) => {
    const professional = typeof item === "string" ? { name: item } : item;
    const source = employeeMode ? professional.availableTimes || establishment.availableTimes || [] : establishment.availableTimes || [];
    const times = [...new Set(source.filter((time) => /^\d{1,2}:\d{2}$/.test(time) && Number(time.split(":")[0]) < 24 && Number(time.split(":")[1]) < 60).map((time) => time.padStart(5, "0")))].sort((a, b) => minutes(a) - minutes(b));
    return { ...professional, availableTimes: times };
  });
  const times = [...new Set(professionals.flatMap((professional) => professional.availableTimes))].sort((a, b) => minutes(a) - minutes(b));
  return {
    times,
    professionals: professionals.map((professional) => ({ ...professional, periods: times.map((time) => professional.availableTimes.includes(time) ? time : null) })),
  };
}

function minutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
