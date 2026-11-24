import fs from "node:fs";

const LEVEL_HEIGHT = 3.2;

const osm = JSON.parse(
  fs.readFileSync("public/data/buildings.geojson", "utf8"),
);
const overture = JSON.parse(
  fs.readFileSync("overture-buildings.geojson", "utf8"),
);

// 1. OSM-Höhen nach ID sammeln (nur Gebäude mit echter Angabe)
const osmHeights = new Map();
for (const f of osm.features) {
  const id = f.id ?? f.properties["@id"];
  const p = f.properties;
  if (p.height) osmHeights.set(id, parseFloat(p.height));
  else if (p["building:levels"])
    osmHeights.set(id, parseFloat(p["building:levels"]) * LEVEL_HEIGHT);
}

// 2. Overture-Gebäude mit KI-Höhe der OSM-ID zuordnen
function osmIdFromRecord(recordId) {
  // "w416564885@2" → "way/416564885", "r123@1" → "relation/123"
  const match = /^([wr])(\d+)/.exec(recordId ?? "");
  if (!match) return null;
  return `${match[1] === "w" ? "way" : "relation"}/${match[2]}`;
}

const pairs = [];
for (const f of overture.features) {
  const ml = f.properties.height;
  if (ml == null) continue;
  const osmSource = (f.properties.sources ?? []).find(
    (s) => s.dataset === "OpenStreetMap",
  );
  const id = osmIdFromRecord(osmSource?.record_id);
  if (id && osmHeights.has(id)) {
    pairs.push({ id, osm: osmHeights.get(id), ml });
  }
}

// 3. Statistik
const n = pairs.length;
console.log(`Gebäude mit beiden Höhenangaben: ${n}`);
if (n === 0) process.exit();

const diffs = pairs.map((p) => p.ml - p.osm);
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
const meanDiff = mean(diffs);
const mae = mean(diffs.map(Math.abs));

const mOsm = mean(pairs.map((p) => p.osm));
const mMl = mean(pairs.map((p) => p.ml));
const cov = mean(pairs.map((p) => (p.osm - mOsm) * (p.ml - mMl)));
const sdOsm = Math.sqrt(mean(pairs.map((p) => (p.osm - mOsm) ** 2)));
const sdMl = Math.sqrt(mean(pairs.map((p) => (p.ml - mMl) ** 2)));
const r = cov / (sdOsm * sdMl);

console.log(`Mittlere Abweichung (KI − OSM): ${meanDiff.toFixed(4)} m`);
console.log(`Mittlerer absoluter Fehler:    ${mae.toFixed(4)} m`);
console.log(`Korrelation (Pearson r):       ${r.toFixed(4)}`);

console.table(
  pairs.map((p) => ({
    id: p.id,
    "OSM (m)": p.osm.toFixed(1),
    "KI (m)": p.ml.toFixed(1),
    "Diff (m)": (p.ml - p.osm).toFixed(1),
  })),
);
