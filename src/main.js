import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";
import "./style.css";
import { getSunPosition, getSunTimes } from "./sun.js";
import { computeShadow, getOuterRings, moveOutOfBuilding } from "./shadow.js";

// --- Konstanten ---
const START = [41.12029, 16.85897];
const START_ZOOM = 15;
const LEVEL_HEIGHT = 3.2; // Meter pro Stockwerk
const DEFAULT_HEIGHT = 16; // Standardhöhe ohne OSM-Angabe
const SLIDER_STEP = 10; // Minuten pro Slider-Schritt
const COS_LAT = Math.cos((START[0] * Math.PI) / 180); // für Meter → Grad

// Zum Testen ein anderer Tag, z. B. new Date("2027-06-21")
// null = heute
const TEST_DATE = null;

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

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function inBBox([lng, lat], [minLng, minLat, maxLng, maxLat]) {
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

// Ray Casting: Strahl vom Punkt nach rechts, Schnittpunkte mit den Kanten zählen.
// Ungerade Anzahl = drinnen.
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// --- Der Tag, um den es geht ---
const day = TEST_DATE ? new Date(TEST_DATE) : new Date();
day.setHours(0, 0, 0, 0); // Mitternacht

const noon = new Date(day);
noon.setHours(12);
const times = getSunTimes(noon, START[0], START[1]);

function dateFromMinutes(minutes) {
  const date = new Date(day);
  date.setMinutes(minutes);
  return date;
}

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

// Ein einziges Polygon für alle Schatten, das bei jedem Update neue Koordinaten bekommt
const shadowPolygon = L.polygon([], {
  pane: "shadows",
  renderer: shadowRenderer,
  interactive: false,
  stroke: false,
  fillColor: "#1a1a2e",
  fillOpacity: 1,
  fillRule: "nonzero",
}).addTo(map);

// --- Zustand der App (wird in init() befüllt) ---
let shadowSources = []; // { ring, height } pro Gebäudeteil
let cafes = [];

// --- Darstellung ---
function popupHtml(cafe) {
  const status = cafe.inShadow ? "🌥️ im Schatten" : "☀️ in der Sonne";
  const outdoorText = cafe.outdoor ? "<br>🪑 Außenplätze" : "";
  return `<b>${cafe.name}</b> (${cafe.type})<br>${status}${outdoorText}`;
}

function renderList() {
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

// --- Bei jeder Zeitänderung ---
function update(date) {
  console.time("Update gesamt");

  const sun = getSunPosition(date, START[0], START[1]);
  const isNight = sun.elevation <= 0;

  // 1. Schatten berechnen
  console.time("1 Schatten berechnen");
  const shadows = isNight
    ? []
    : shadowSources
        .map((s) => computeShadow(s.ring, s.height, sun, COS_LAT))
        .filter(Boolean);
  console.timeEnd("1 Schatten berechnen");

  // 2. Schatten zeichnen: nur Koordinaten austauschen ([lng, lat] → [lat, lng])
  console.time("2 Schatten zeichnen");
  shadowPolygon.setLatLngs(
    shadows.map((s) => [s.ring.map(([lng, lat]) => [lat, lng])]),
  );
  console.timeEnd("2 Schatten zeichnen");

  // 3. Cafés prüfen und nur bei Änderung umfärben
  console.time("3 Cafés prüfen");
  cafes.forEach((cafe) => {
    const coords = cafe.point.geometry.coordinates;
    const wasInShadow = cafe.inShadow;

    cafe.inShadow =
      isNight ||
      shadows.some(
        (shadow) =>
          inBBox(coords, shadow.bbox) && pointInRing(coords, shadow.ring),
      );

    if (cafe.inShadow !== wasInShadow) {
      cafe.marker.setStyle({
        color: cafe.inShadow ? "#555" : "#e69500",
        fillColor: cafe.inShadow ? "#999" : "#ffd54f",
      });
      cafe.marker.setPopupContent(popupHtml(cafe));
    }
  });
  console.timeEnd("3 Cafés prüfen");

  // 4. Liste und Infobox
  console.time("4 Liste");
  renderList();

  document.getElementById("info").textContent =
    `☀️ Höhe ${sun.elevation.toFixed(1)}° · Richtung ${sun.azimuth.toFixed(0)}°\n` +
    `🌅 ${formatTime(times.sunrise)} · 🌇 ${formatTime(times.sunset)}`;
  console.timeEnd("4 Liste");

  console.timeEnd("Update gesamt");
}

// --- Einmal beim Start ---
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

  // Umriss + Höhe pro Gebäudeteil einmalig vorbereiten
  shadowSources = buildings.flatMap((b) => {
    const height = getHeight(b.properties);
    return getOuterRings(b).map((ring) => ({ ring, height }));
  });

  // 3. Gebäude dezent zeichnen (ändert sich nie)
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

  // 4. Cafés aufbereiten (Position ändert sich nie) und Marker erzeugen
  cafes = cafeData.features
    .filter((f) => f.geometry)
    .map((f) => {
      const props = f.properties;
      const center = f.geometry.type === "Point" ? f : turf.centroid(f);
      const point = moveOutOfBuilding(
        turf.point(center.geometry.coordinates),
        polygons,
      );
      const [lng, lat] = point.geometry.coordinates;

      const cafe = {
        name: props.name ?? "Unbenannt",
        type: TYPE_LABELS[props.amenity] ?? props.amenity,
        outdoor: props.outdoor_seating === "yes",
        point,
        inShadow: null, // noch nicht berechnet
      };

      cafe.marker = L.circleMarker([lat, lng], {
        radius: 4,
        color: "#999",
        fillColor: "#ddd",
        fillOpacity: 0.6,
      })
        .bindPopup(popupHtml(cafe))
        .addTo(map);

      return cafe;
    });

  // 5. Slider einrichten: von Sonnenaufgang bis Sonnenuntergang
  const slider = document.getElementById("time-slider");
  const timeLabel = document.getElementById("time-label");
  const nowBtn = document.getElementById("now-btn");

  const minMinutes =
    Math.ceil(minutesOfDay(times.sunrise) / SLIDER_STEP) * SLIDER_STEP;
  const maxMinutes =
    Math.floor(minutesOfDay(times.sunset) / SLIDER_STEP) * SLIDER_STEP;

  slider.min = minMinutes;
  slider.max = maxMinutes;
  slider.step = SLIDER_STEP;

  function nowMinutes() {
    const rounded =
      Math.round(minutesOfDay(new Date()) / SLIDER_STEP) * SLIDER_STEP;
    return clamp(rounded, minMinutes, maxMinutes);
  }

  // Updates bündeln: höchstens eins pro Bildschirm-Frame
  let updateScheduled = false;

  function onTimeChange() {
    const date = dateFromMinutes(Number(slider.value));
    timeLabel.textContent = formatTime(date);

    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(() => {
      updateScheduled = false;
      update(dateFromMinutes(Number(slider.value)));
    });
  }

  slider.addEventListener("input", onTimeChange);

  nowBtn.addEventListener("click", () => {
    slider.value = nowMinutes();
    onTimeChange();
  });

  // 6. Start mit der aktuellen Uhrzeit
  console.log(
    `${buildings.length} Gebäude (${shadowSources.length} Teile), ${cafes.length} Cafés`,
  );
  slider.value = nowMinutes();
  onTimeChange();
}

init();
