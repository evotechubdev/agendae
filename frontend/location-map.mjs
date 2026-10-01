import { singleEstablishmentStyle } from "./address-map.mjs";

const params = new URLSearchParams(location.search);
const lat = Number(params.get("lat"));
const lon = Number(params.get("lon"));
const name = String(params.get("name") || "Estabelecimento").slice(0, 100);
const message = document.querySelector("#message");

if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
  message.textContent = "Localização indisponível.";
} else {
  try {
    const [maplibregl, response] = await Promise.all([
      import("https://unpkg.com/maplibre-gl@6.9.1/dist/maplibre-gl.mjs"),
      fetch("https://tiles.openfreemap.org/styles/positron"),
    ]);
    if (!response.ok) throw new Error("Estilo do mapa indisponível.");
    const style = singleEstablishmentStyle(await response.json());
    const map = new maplibregl.Map({
      container: "map",
      style,
      center: [lon, lat],
      zoom: 16,
      attributionControl: true,
    });
    const marker = document.createElement("div");
    marker.className = "store-marker";
    const label = document.createElement("span");
    label.textContent = name;
    marker.append(label);
    new maplibregl.Marker({ element: marker, anchor: "bottom" }).setLngLat([lon, lat]).addTo(map);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => { message.hidden = true; });
    map.on("error", () => { if (!message.hidden) message.textContent = "Não foi possível carregar o mapa agora."; });
  } catch {
    message.textContent = "Não foi possível carregar o mapa agora.";
  }
}
