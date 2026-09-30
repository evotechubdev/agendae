export function establishmentSlug(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function newEstablishment(input) {
  const slug = establishmentSlug(input.slug);
  const ownerName = String(input.ownerName || "").trim().replace(/\s+/g, " ");
  const ownerEmail = String(input.ownerEmail || "").trim().toLowerCase();
  const ownerPassword = String(input.ownerPassword || "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60 || ["home", "login"].includes(slug)) throw new Error("Informe um identificador válido para a URL da loja.");
  if (!ownerName || ownerName.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || ownerPassword.length < 6) throw new Error("Informe o nome, um e-mail válido e uma senha de pelo menos 6 caracteres para o administrador da loja.");
  return {
    slug, owner: { name: ownerName, email: ownerEmail, password: ownerPassword },
    establishment: {
      slug, name: "Estabelecimento em configuração", active: true, setupComplete: false,
      initials: "EC", category: "", neighborhood: "", address: "", type: "business",
      openNow: false, averageWaitMinutes: 20, scheduleMode: "employee",
      hours: [], availableTimes: [], professionals: [], services: [], serviceDurations: {},
      professionalLunchBreaks: {}, extraWorkingDates: {}, staffClosedDates: {},
    },
  };
}

export function storeProfile(input) {
  const name = String(input.name || "").trim().replace(/\s+/g, " ");
  const category = String(input.category || "").trim();
  const neighborhood = String(input.neighborhood || "").trim();
  const address = String(input.address || "").trim();
  const opening = String(input.opening || "");
  const closing = String(input.closing || "");
  const minutes = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  if (!name || name.length > 100 || !category || !neighborhood || !address) throw new Error("Preencha nome, categoria, bairro e endereço da loja.");
  if (!Number.isFinite(minutes(opening)) || !Number.isFinite(minutes(closing)) || minutes(closing) <= minutes(opening)) throw new Error("Informe um horário de abertura e fechamento válido.");
  return {
    name, category, neighborhood, address,
    initials: name.split(" ").map(part => part[0]).slice(0, 2).join("").toLocaleUpperCase("pt-BR"),
    hours: [
      { label: "Seg a sex", value: `${opening} - ${closing}` },
      { label: "Sábado", value: input.saturdayOpen ? `${opening} - ${closing}` : "Fechado" },
      { label: "Domingo", value: input.sundayOpen ? `${opening} - ${closing}` : "Fechado" },
    ],
  };
}
