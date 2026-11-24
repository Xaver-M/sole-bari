import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";
import "./style.css";
import { getSunPosition, getSunTimes } from "./sun.js";
import { computeShadow, moveOutOfBuilding } from "./shadow.js";

// --- Konstanten ---
const START = [41.12029, 16.85897];
const START_ZOOM = 15;
const LEVEL_HEIGHT = 3.2; // Meter pro Stockwerk
const DEFAULT_HEIGHT = 16; // Standardhöhe ohne OSM-Angabe

// Zum Testen eine feste Uhrzeit, z. B. new Date("2026-11-25T11:00:00")
// null = aktuelle Uhrzeit
const TEST_TIME = new Date("2026-11-25T12:00:00");

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

// --- Sonne ---
const now = TEST_TIME ?? new Date();
const sun = getSunPosition(now, START[0], START[1]);
const times = getSunTimes(now, START[0], START[1]);

document.getElementById("info").textContent =
  `${formatTime(now)} · Sonnenhöhe: ${sun.elevation.toFixed(1)}° · Richtung: ${sun.azimuth.toFixed(0)}° · ` +
  `Aufgang: ${formatTime(times.sunrise)} · Untergang: ${formatTime(times.sunset)}`;

// --- Karte ---
const map = L.map("map", { preferCanvas: true }).setView(START, START_ZOOM);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Eigene Ebene für Schatten: unter den Gebäuden, einheitlich halbtransparent
map.createPane("shadows");
map.getPane("shadows").style.zIndex = 350;
map.getPane("shadows").style.opacity = 0.45;
const shadowRenderer = L.canvas({ pane: "shadows" });

// Koordinaten bei Klick auf die Karte anzeigen
map.on("click", (e) => {
  const { lat, lng } = e.latlng;
  L.popup()
    .setLatLng(e.latlng)
    .setContent(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
    .openOn(map);
});

// --- Cafés (vorerst noch manuell) ---
const cafes = [
  { name: "Café Gioto", coords: [41.12029, 16.85897] },
  { name: "Caffetteria del Tribunale", coords: [41.12413, 16.8573] },
];

const cafeMarkers = cafes.map((cafe) =>
  L.circleMarker(cafe.coords, { radius: 7, color: "red" })
    .bindPopup(cafe.name)
    .addTo(map),
);

// --- Gebäude und Schatten ---
async function loadBuildings() {
  const res = await fetch("/data/buildings.geojson");
  const data = await res.json();

  // Nur echte Flächen (keine Punkte oder offenen Linien)
  const buildings = data.features.filter((f) =>
    ["Polygon", "MultiPolygon"].includes(f.geometry.type),
  );
  console.log(`${buildings.length} Gebäude geladen`);

  const polygons = buildings.flatMap((b) => turf.flatten(b).features);

  // Schatten berechnen
  console.time("Schattenberechnung");
  const shadows = [];
  buildings.forEach((building) => {
    const shadow = computeShadow(building, getHeight(building.properties), sun);
    if (shadow) shadows.push(shadow);
  });
  console.timeEnd("Schattenberechnung");
  console.log(`${shadows.length} Schatten berechnet`);

  // Cafés auf Sonne/Schatten prüfen
  const isNight = sun.elevation <= 0;

  cafes.forEach((cafe, i) => {
    const [lat, lng] = cafe.coords;
    const original = turf.point([lng, lat]);
    const point = moveOutOfBuilding(original, polygons);

    // Marker auf die verschobene Position setzen (Turf: [lng, lat] → Leaflet: [lat, lng])
    const [newLng, newLat] = point.geometry.coordinates;
    cafeMarkers[i].setLatLng([newLat, newLng]);

    const inShadow =
      isNight ||
      shadows.some((shadow) => turf.booleanPointInPolygon(point, shadow));

    const color = inShadow ? "#555" : "#e69500";
    const fillColor = inShadow ? "#999" : "#ffd54f";

    cafeMarkers[i].setStyle({ color, fillColor, fillOpacity: 0.9 });
    cafeMarkers[i].setPopupContent(
      `${cafe.name}<br>${inShadow ? "🌥️ im Schatten" : "☀️ in der Sonne"}`,
    );
  });

  // Schatten zeichnen
  L.geoJSON(turf.featureCollection(shadows), {
    pane: "shadows",
    renderer: shadowRenderer,
    interactive: false,
    style: { stroke: false, fillColor: "#1a1a2e", fillOpacity: 1 },
  }).addTo(map);

  // Gebäude dezent darüber zeichnen
  L.geoJSON(buildings, {
    style: { color: "#666", weight: 1, fillColor: "#ddd", fillOpacity: 0.6 },
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      const levelsText = props["building:levels"] ?? "unbekannt";
      layer.bindPopup(
        `Stockwerke: ${levelsText}<br>Angenommene Höhe: ${getHeight(props).toFixed(1)} m`,
      );
    },
  }).addTo(map);

  cafeMarkers.forEach((marker) => marker.bringToFront());
}

loadBuildings();
