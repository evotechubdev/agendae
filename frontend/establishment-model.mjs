export function establishmentSlug(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function newEstablishment(input) {
  const name = String(input.name || "").trim().replace(/\s+/g, " ");
  const slug = establishmentSlug(name).replace(/-/g, "");
  const ownerPassword = String(input.ownerPassword || "");
  if (!name || name.length > 100 || !/^[a-z0-9]+$/.test(slug) || slug.length > 60 || ["home", "login"].includes(slug)) throw new Error("Informe um nome válido para o estabelecimento.");
  if (ownerPassword.length < 6) throw new Error("A senha inicial precisa ter pelo menos 6 caracteres.");
  return {
    slug, owner: { name: "Administrador", email: `${slug}-admin@agendae.com.br`, password: ownerPassword },
    establishment: {
      slug, name, active: true, setupComplete: false,
      initials: name.split(" ").map(part => part[0]).slice(0, 2).join("").toLocaleUpperCase("pt-BR"),
      category: "", neighborhood: "", street: "", number: "", zipCode: "", city: "", state: "", complement: "", address: "", street2: "", number2: "", neighborhood2: "", zipCode2: "", city2: "", state2: "", complement2: "", address2: "", mapCoordinates1: null, mapCoordinates2: null, type: "business",
      openNow: false, averageWaitMinutes: 20, scheduleMode: "employee",
      hours: [], hours2: [], availableTimes: [], professionals: [], services: [], serviceDurations: {},
      professionalLunchBreaks: {}, extraWorkingDates: {}, staffClosedDates: {},
    },
  };
}

export function storeProfile(input) {
  const name = String(input.name || "").trim().replace(/\s+/g, " ");
  const category = String(input.category || "").trim();
  const readAddress = (suffix, required) => {
    const values = Object.fromEntries(["street", "number", "neighborhood", "zipCode", "city", "state", "complement"].map(key => [key, String(input[`${key}${suffix}`] || "").trim()]));
    const { street, neighborhood, zipCode, city, complement } = values;
    const number = /^s\/?n$/i.test(values.number) ? "SN" : values.number;
    const state = values.state.toUpperCase();
    if (!required && !Object.values(values).some(Boolean)) return { ...values, state, address: "" };
    if (!street || !number || !neighborhood || !/^\d{5}-?\d{3}$/.test(zipCode) || !city || !/^[A-Z]{2}$/.test(state)) throw new Error(`Preencha rua, número, bairro, CEP, cidade e estado válidos do Endereço ${suffix ? "2" : "1"}.`);
    const formattedZipCode = `${zipCode.replace(/\D/g, "").slice(0, 5)}-${zipCode.replace(/\D/g, "").slice(5)}`;
    return { street, number, neighborhood, zipCode: formattedZipCode, city, state, complement, address: `${street}, ${number}${complement ? `, ${complement}` : ""} - ${neighborhood}, ${city} - ${state}, ${formattedZipCode}` };
  };
  const first = readAddress("", true);
  const second = readAddress("2", false);
  const opening = String(input.opening || "");
  const closing = String(input.closing || "");
  const minutes = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  if (!name || name.length > 100 || !category) throw new Error("Preencha nome e categoria da loja.");
  const days = [["seg", "Segunda"], ["ter", "Terça"], ["qua", "Quarta"], ["qui", "Quinta"], ["sex", "Sexta"], ["sab", "Sábado"], ["dom", "Domingo"]];
  const weekly = days.some(([day]) => Object.hasOwn(input, `day_${day}_start`));
  let hours;
  const weeklyHours = (suffix, addressLabel) => {
    const result = days.map(([day, label]) => {
      if (!input[`day${suffix}_${day}_open`]) return { label, value: "Fechado" };
      const start = String(input[`day${suffix}_${day}_start`] || "");
      const end = String(input[`day${suffix}_${day}_end`] || "");
      if (!Number.isFinite(minutes(start)) || !Number.isFinite(minutes(end)) || minutes(end) <= minutes(start)) throw new Error(`Informe um horário válido para ${label} do ${addressLabel}.`);
      return { label, value: `${start} - ${end}` };
    });
    if (result.every(item => item.value === "Fechado")) throw new Error(`Abra pelo menos um dia da semana no ${addressLabel}.`);
    return result;
  };
  if (weekly) {
    hours = weeklyHours("", "Endereço 1");
  } else {
    if (!Number.isFinite(minutes(opening)) || !Number.isFinite(minutes(closing)) || minutes(closing) <= minutes(opening)) throw new Error("Informe um horário de abertura e fechamento válido.");
    hours = [
      { label: "Seg a sex", value: `${opening} - ${closing}` },
      { label: "Sábado", value: input.saturdayOpen ? `${opening} - ${closing}` : "Fechado" },
      { label: "Domingo", value: input.sundayOpen ? `${opening} - ${closing}` : "Fechado" },
    ];
  }
  const hours2 = second.address ? (days.some(([day]) => Object.hasOwn(input, `day2_${day}_start`)) ? weeklyHours("2", "Endereço 2") : hours) : [];
  return {
    name, category, ...first,
    street2: second.street, number2: second.number, neighborhood2: second.neighborhood, zipCode2: second.zipCode, city2: second.city, state2: second.state, complement2: second.complement, address2: second.address,
    initials: name.split(" ").map(part => part[0]).slice(0, 2).join("").toLocaleUpperCase("pt-BR"),
    hours, hours2,
  };
}

export function normalizeWeeklyAvailability(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Informe os dias disponíveis do serviço.");
  const days = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
  const minutes = time => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || "")) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN;
  const normalized = {};
  for (const day of days) {
    const intervals = value[day] || [];
    if (!Array.isArray(intervals) || intervals.length > 8) throw new Error("Use no máximo oito intervalos por dia para cada serviço.");
    const ordered = intervals.map(interval => ({ start: String(interval.start || ""), end: String(interval.end || "") }))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const [index, interval] of ordered.entries()) {
      if (!Number.isFinite(minutes(interval.start)) || !Number.isFinite(minutes(interval.end)) || minutes(interval.end) <= minutes(interval.start)) throw new Error("Informe horários válidos para o serviço.");
      if (index && minutes(interval.start) < minutes(ordered[index - 1].end)) throw new Error("Os intervalos do serviço não podem se sobrepor.");
    }
    if (ordered.length) normalized[day] = ordered;
  }
  if (!Object.keys(normalized).length) throw new Error("Selecione pelo menos um dia e horário para o serviço.");
  return normalized;
}
