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

const TYPE_LABELS = {
  cafe: "Café",
  bar: "Bar",
  pub: "Pub",
  ice_cream: "Eisdiele",
};

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

async function loadJSON(url) {
  const res = await fetch(url);
  return res.json();
}

// --- Sonne ---
const now = TEST_TIME ?? new Date();
const sun = getSunPosition(now, START[0], START[1]);
const times = getSunTimes(now, START[0], START[1]);

document.getElementById("info").textContent =
  `🕒 ${formatTime(now)} Uhr\n` +
  `☀️ Höhe ${sun.elevation.toFixed(1)}° · Richtung ${sun.azimuth.toFixed(0)}°\n` +
  `🌅 ${formatTime(times.sunrise)} · 🌇 ${formatTime(times.sunset)}`;

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

// --- Liste links ---
function renderList(cafes) {
  const sunny = cafes
    .filter((cafe) => !cafe.inShadow)
    .sort(
      (a, b) => b.outdoor - a.outdoor || a.name.localeCompare(b.name, "it"),
    );

  document.getElementById("sunny-count").textContent = `(${sunny.length})`;

  const list = document.getElementById("cafe-list");
  list.innerHTML = "";

  if (sunny.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Gerade liegt kein Café in der Sonne 🌥️";
    list.appendChild(li);
    return;
  }

  sunny.forEach((cafe) => {
    const li = document.createElement("li");

    const nameEl = document.createElement("div");
    nameEl.className = "cafe-name";
    nameEl.textContent = `${cafe.outdoor ? "🪑 " : ""}${cafe.name}`;

    const metaEl = document.createElement("div");
    metaEl.className = "cafe-meta";
    metaEl.textContent = cafe.type;

    li.append(nameEl, metaEl);

    li.addEventListener("click", () => {
      map.flyTo(cafe.marker.getLatLng(), 18);
      cafe.marker.openPopup();
    });

    list.appendChild(li);
  });
}

// --- Hauptablauf ---
async function init() {
  // 1. Beide Dateien parallel laden
  const [buildingData, cafeData] = await Promise.all([
    loadJSON("/data/buildings.geojson"),
    loadJSON("/data/cafes.geojson"),
  ]);

  // 2. Gebäude aufbereiten
  const buildings = buildingData.features.filter((f) =>
    ["Polygon", "MultiPolygon"].includes(f.geometry.type),
  );
  const polygons = buildings.flatMap((b) => turf.flatten(b).features);

  // 3. Schatten berechnen
  console.time("Schattenberechnung");
  const shadows = [];
  buildings.forEach((building) => {
    const shadow = computeShadow(building, getHeight(building.properties), sun);
    if (shadow) shadows.push(shadow);
  });
  console.timeEnd("Schattenberechnung");

  // 4. Cafés aufbereiten und prüfen
  const isNight = sun.elevation <= 0;

  const cafes = cafeData.features
    .filter((f) => f.geometry)
    .map((f) => {
      const props = f.properties;
      const center = f.geometry.type === "Point" ? f : turf.centroid(f);
      const point = moveOutOfBuilding(
        turf.point(center.geometry.coordinates),
        polygons,
      );

      const inShadow =
        isNight ||
        shadows.some((shadow) => turf.booleanPointInPolygon(point, shadow));

      return {
        name: props.name ?? "Unbenannt",
        type: TYPE_LABELS[props.amenity] ?? props.amenity,
        outdoor: props.outdoor_seating === "yes",
        point,
        inShadow,
      };
    });

  // 5. Schatten zeichnen
  L.geoJSON(turf.featureCollection(shadows), {
    pane: "shadows",
    renderer: shadowRenderer,
    interactive: false,
    style: { stroke: false, fillColor: "#1a1a2e", fillOpacity: 1 },
  }).addTo(map);

  // 6. Gebäude dezent darüber zeichnen
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

  // 7. Cafés zeichnen und Marker am Café-Objekt merken
  cafes.forEach((cafe) => {
    const [lng, lat] = cafe.point.geometry.coordinates;

    const color = cafe.inShadow ? "#555" : "#e69500";
    const fillColor = cafe.inShadow ? "#999" : "#ffd54f";
    const status = cafe.inShadow ? "🌥️ im Schatten" : "☀️ in der Sonne";
    const outdoorText = cafe.outdoor ? "<br>🪑 Außenplätze" : "";

    cafe.marker = L.circleMarker([lat, lng], {
      radius: 4,
      color,
      fillColor,
      fillOpacity: 0.6,
    })
      .bindPopup(
        `<b>${cafe.name}</b> (${cafe.type})<br>${status}${outdoorText}`,
      )
      .addTo(map);
  });

  // 8. Liste füllen
  renderList(cafes);
}

init();
