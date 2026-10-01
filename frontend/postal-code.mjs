const BASE = "https://viacep.com.br/ws";
const postalCache = new Map();

export function postalDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function formatPostalCode(value) {
  const digits = postalDigits(value);
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : String(value || "");
}

async function getPostalJson(url) {
  if (postalCache.has(url)) return postalCache.get(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Não foi possível consultar o CEP agora.");
  const result = await response.json();
  postalCache.set(url, result);
  return result;
}

export async function lookupPostalCode(value) {
  const digits = postalDigits(value);
  if (digits.length !== 8) throw new Error("Informe um CEP com 8 dígitos.");
  const result = await getPostalJson(`${BASE}/${digits}/json/`);
  if (result.erro) throw new Error("CEP não encontrado.");
  return result;
}

export async function searchPostalCodes({ state, city, street }) {
  const uf = String(state || "").trim().toUpperCase();
  const locality = String(city || "").trim();
  const road = String(street || "").trim();
  if (!/^[A-Z]{2}$/.test(uf) || locality.length < 3 || road.length < 3) return [];
  const url = `${BASE}/${encodeURIComponent(uf)}/${encodeURIComponent(locality)}/${encodeURIComponent(road)}/json/`;
  const result = await getPostalJson(url);
  return Array.isArray(result) ? result : [];
}

export function matchingPostalCode(entries, { street, neighborhood }) {
  const normalized = value => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const exactStreet = entries.filter(entry => normalized(entry.logradouro) === normalized(street));
  const exactNeighborhood = exactStreet.filter(entry => normalized(entry.bairro) === normalized(neighborhood));
  if (neighborhood && exactNeighborhood.length === 1) return exactNeighborhood[0];
  if (exactStreet.length === 1) return exactStreet[0];
  return null;
}
