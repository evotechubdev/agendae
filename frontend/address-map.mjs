export function addressMapLabel(establishment, suffix = "") {
  const complement = String(establishment[`complement${suffix}`] || "").trim();
  if (complement) return complement;
  const street = String(establishment[`street${suffix}`] || "").trim();
  const number = String(establishment[`number${suffix}`] || "").trim();
  return [street, number].filter(Boolean).join(", ") || String(establishment[suffix ? "address2" : "address"] || "").trim() || "Local de atendimento";
}

export function googleMapsPlaceQuery(establishment, suffix = "") {
  const place = String(establishment[`complement${suffix}`] || "").split(/[,;]/).map(part => part.trim())
    .find(part => part && !/^(sala|apto\.?|apartamento|andar|bloco|fundos|casa)\b/i.test(part)) || "";
  const street = String(establishment[`street${suffix}`] || "").trim();
  const rawNumber = String(establishment[`number${suffix}`] || "").trim();
  const number = /^s\/?n$/i.test(rawNumber) ? "" : rawNumber;
  const city = String(establishment[`city${suffix}`] || "").trim();
  const state = String(establishment[`state${suffix}`] || "").trim();
  if (!place && !street && !city) return String(establishment[suffix ? "address2" : "address"] || "").trim();
  return [place, [street, number].filter(Boolean).join(", "), city, state, "Brasil"].filter(Boolean).join(", ");
}
