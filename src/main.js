import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { getSunPosition, getSunTimes } from "./sun.js";

// --- Konstanten ---
const START = [41.12029, 16.85897];
const START_ZOOM = 14;
const LEVEL_HEIGHT = 3.2; // Meter pro Stockwerk
const DEFAULT_HEIGHT = 16; // Platzhalter, wird aus dem Median abgeleitet

// --- Hilfsfunktionen ---
function formatTime(date) {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getHeight(props) {
  if (props.height) return parseFloat(props.height);
  if (props["building:levels"])
    return parseFloat(props["building:levels"]) * LEVEL_HEIGHT;
  return DEFAULT_HEIGHT;
}

function mean(values) {
  const sum = values.reduce((acc, x) => acc + x, 0);
  return sum / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 0) {
    return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }
  return sorted[Math.floor(n / 2)];
}

// --- Karte ---
const map = L.map("map", { preferCanvas: true }).setView(START, START_ZOOM);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Koordinaten bei Klick auf die Karte anzeigen
map.on("click", (e) => {
  const { lat, lng } = e.latlng;
  L.popup()
    .setLatLng(e.latlng)
    .setContent(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
    .openOn(map);
  console.log(lat, lng);
});

// --- Cafés ---
const cafes = [
  { name: "Café Gioto", coords: [41.12029, 16.85897] },
  { name: "Caffetteria del Tribunale", coords: [41.12413, 16.8573] },
];

// Marker merken, damit wir sie später nach vorne holen können
const cafeMarkers = cafes.map((cafe) =>
  L.circleMarker(cafe.coords, { radius: 7, color: "red" })
    .bindPopup(cafe.name)
    .addTo(map),
);

// --- Gebäude ---
async function loadBuildings() {
  const res = await fetch("/data/buildings.geojson");
  const data = await res.json();

  console.log(`${data.features.length} Gebäude geladen`);

  // Statistik der Stockwerke
  const levels = data.features
    .map((f) => parseFloat(f.properties["building:levels"]))
    .filter((x) => !isNaN(x));

  console.log(`Gebäude mit Stockwerksangabe: ${levels.length}`);
  console.log(`Mittelwert Stockwerke: ${mean(levels).toFixed(4)}`);
  console.log(`Median Stockwerke: ${median(levels).toFixed(4)}`);
  console.log(
    `→ Vorschlag Standardhöhe: ${(median(levels) * LEVEL_HEIGHT).toFixed(4)} m`,
  );
  const counts = {};
  levels.forEach((l) => {
    counts[l] = (counts[l] ?? 0) + 1;
  });
  console.table(counts);

  L.geoJSON(data, {
    style: { color: "#555", weight: 1, fillOpacity: 0.3 },
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      const levelsText = props["building:levels"] ?? "unbekannt";
      layer.bindPopup(
        `Stockwerke: ${levelsText}<br>Angenommene Höhe: ${getHeight(props).toFixed(1)} m`,
      );
    },
  }).addTo(map);

  // Cafés wieder über die Gebäude legen
  cafeMarkers.forEach((marker) => marker.bringToFront());
}

loadBuildings();

// --- Sonne ---
const now = new Date();
const sun = getSunPosition(now, START[0], START[1]);
const times = getSunTimes(now, START[0], START[1]);

document.getElementById("info").textContent =
  `Sonnenposition: ${sun.elevation.toFixed(1)}° · Richtung: ${sun.azimuth.toFixed(0)}° · ` +
  `Aufgang: ${formatTime(times.sunrise)} · Untergang: ${formatTime(times.sunset)}`;
