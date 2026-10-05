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

export function loginIdentity(email, expectedSlug = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const suffix = "@agendae.com.br";
  if (!normalizedEmail.endsWith(suffix)) return null;
  const localPart = normalizedEmail.slice(0, -suffix.length);
  const slug = String(expectedSlug || "").trim().toLowerCase();

  if (slug) {
    const prefix = `${slug}-`;
    const login = localPart.startsWith(prefix) ? localPart.slice(prefix.length) : localPart;
    return /^[a-z0-9._-]+$/.test(login) ? { slug, login } : null;
  }

  const separator = localPart.indexOf("-");
  if (separator <= 0 || separator === localPart.length - 1) return null;
  const inferredSlug = localPart.slice(0, separator);
  const login = localPart.slice(separator + 1);
  return /^[a-z0-9]+$/.test(inferredSlug) && /^[a-z0-9._-]+$/.test(login)
    ? { slug: inferredSlug, login }
    : null;
}
