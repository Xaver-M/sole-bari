import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

// Startansicht: Bari Vecchia
const START = [41.1285, 16.869];
const START_ZOOM = 16;

const map = L.map("map").setView(START, START_ZOOM);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// Klick auf die Karte → Koordinaten anzeigen
map.on("click", (e) => {
  const { lat, lng } = e.latlng;
  L.popup()
    .setLatLng(e.latlng)
    .setContent(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
    .openOn(map);
  console.log(lat, lng);
});
