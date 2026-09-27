export function loginCredentials(value, establishmentSlug) {
  const input = String(value || "").trim().toLowerCase();
  if (input.includes("@")) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return null;
    return { email: input, legacyEmail: "" };
  }

  const login = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._-]/g, "");
  if (!login) return null;
  return {
    email: `${establishmentSlug}-${login}@agendae.com.br`,
    legacyEmail: `${login}@agendae.com.br`,
  };
}
