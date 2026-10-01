const GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
const CACHE_PREFIX = "agendae:map-point:";
let nextRequestAt = 0;
let requestQueue = Promise.resolve();

export function addressFallbackQuery(establishment, suffix = "") {
  const street = String(establishment[`street${suffix}`] || "").trim();
  const rawNumber = String(establishment[`number${suffix}`] || "").trim();
  const number = /^s\/?n$/i.test(rawNumber) ? "" : rawNumber;
  const city = String(establishment[`city${suffix}`] || "").trim();
  const state = String(establishment[`state${suffix}`] || "").trim();
  if (street && city) return [street, number, city, state, "Brasil"].filter(Boolean).join(", ");
  const legacy = String(establishment[suffix ? "address2" : "address"] || "").trim();
  return legacy.split(",").map(part => part.trim())
    .filter(part => part && !/^(edif[ií]cio|sala|andar|apto\.?|apartamento|bloco)\b/i.test(part))
    .join(", ");
}

export function addressMapQuery(establishment, suffix = "") {
  const complement = String(establishment[`complement${suffix}`] || "").split(/[,;]/).map(part => part.trim())
    .find(part => part && !/^(sala|apto\.?|apartamento|andar|bloco|fundos|casa)\b/i.test(part)) || "";
  const city = String(establishment[`city${suffix}`] || "").trim();
  const state = String(establishment[`state${suffix}`] || "").trim();
  if (complement && city) {
    return [complement, city, state, "Brasil"].filter(Boolean).join(", ");
  }
  return addressFallbackQuery(establishment, suffix);
}

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
  if (!place && !street && !city) return addressFallbackQuery(establishment, suffix);
  return [place, [street, number].filter(Boolean).join(", "), city, state, "Brasil"].filter(Boolean).join(", ");
}

export function validMapPoint(point, query) {
  return point?.query === query && typeof point.lat === "number" && typeof point.lon === "number"
    && Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
}

export function cachedMapPoint(query) {
  try {
    const point = JSON.parse(localStorage.getItem(CACHE_PREFIX + query) || "null");
    return validMapPoint(point, query) ? point : null;
  } catch { return null; }
}

export function singleEstablishmentStyle(style) {
  const allowedLabels = new Set(["transportation_name", "place", "water_name"]);
  return {
    ...style,
    layers: style.layers.filter(layer => layer.type !== "symbol" || allowedLabels.has(layer["source-layer"]) && !/(?:^|[-_])shield(?:[-_]|$)/i.test(layer.id)),
  };
}

export async function geocodeAddress(query, fallbackQuery = "") {
  const cached = cachedMapPoint(query);
  if (cached) return cached;
  const searchOnce = async (searchQuery) => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + 1100;
    const url = new URL(GEOCODER_URL);
    url.search = new URLSearchParams({ q: searchQuery, format: "jsonv2", limit: "1", countrycodes: "br", addressdetails: "1" }).toString();
    const response = await fetch(url, { referrerPolicy: "strict-origin-when-cross-origin" });
    if (!response.ok) throw new Error("Não foi possível consultar o mapa agora.");
    const results = await response.json();
    const first = results[0];
    const point = { lat: Number(first?.lat), lon: Number(first?.lon), query, matchedBy: fallbackQuery && fallbackQuery !== query && searchQuery === query ? "complement" : "address" };
    if (!first || !validMapPoint(point, query) || ["city", "town", "village", "municipality", "county", "state", "country", "postcode", "suburb"].includes(first.addresstype)) return null;
    return point;
  };
  const search = async () => {
    const point = await searchOnce(query) || (fallbackQuery && fallbackQuery !== query ? await searchOnce(fallbackQuery) : null);
    if (!point) return null;
    try { localStorage.setItem(CACHE_PREFIX + query, JSON.stringify(point)); } catch { /* Storage can be unavailable. */ }
    return point;
  };
  const pending = requestQueue.then(search, search);
  requestQueue = pending.catch(() => {});
  return pending;
}
