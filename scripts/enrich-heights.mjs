import fs from "node:fs";

const MIN_ML_HEIGHT = 2; // kleinere Werte sind Messartefakte

const overture = JSON.parse(
  fs.readFileSync("overture-buildings.geojson", "utf8"),
);
const osmFile = "public/data/buildings.geojson";
const osm = JSON.parse(fs.readFileSync(osmFile, "utf8"));

function osmIdFromRecord(recordId) {
  const match = /^([wr])(\d+)/.exec(recordId ?? "");
  if (!match) return null;
  return `${match[1] === "w" ? "way" : "relation"}/${match[2]}`;
}

// 1. KI-Höhen nach OSM-ID sammeln (nur echte Microsoft-Schätzungen)
const mlHeights = new Map();
for (const f of overture.features) {
  const { height, sources = [] } = f.properties;
  if (height == null || height < MIN_ML_HEIGHT) continue;

  const heightSource = sources.find((s) => s.property?.includes("height"));
  if (heightSource?.dataset !== "Microsoft ML Buildings") continue;

  const osmSource = sources.find((s) => s.dataset === "OpenStreetMap");
  const id = osmIdFromRecord(osmSource?.record_id);
  if (id) mlHeights.set(id, Math.round(height * 10) / 10);
}

// 2. In die OSM-Gebäude schreiben
let enriched = 0;
for (const f of osm.features) {
  const id = f.id ?? f.properties["@id"];
  if (mlHeights.has(id)) {
    f.properties.ml_height = mlHeights.get(id);
    enriched++;
  }
}

fs.writeFileSync(osmFile, JSON.stringify(osm));
console.log(
  `${enriched} von ${osm.features.length} OSM-Gebäuden mit KI-Höhe ergänzt ` +
    `(${((enriched / osm.features.length) * 100).toFixed(4)} %)`,
);
