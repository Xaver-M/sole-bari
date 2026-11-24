import fs from "node:fs";
import * as turf from "@turf/turf";

const data = JSON.parse(fs.readFileSync("overture-buildings.geojson", "utf8"));
const features = data.features.filter((f) =>
  ["Polygon", "MultiPolygon"].includes(f.geometry?.type),
);
const withHeight = features.filter((f) => f.properties.height != null);

// 1. Woher kommen die Höhen?
const heightSources = {};
withHeight.forEach((f) => {
  const sources = f.properties.sources ?? [];
  const forHeight = sources.filter((s) => s.property?.includes("height"));
  const names = (forHeight.length ? forHeight : sources).map((s) => s.dataset);
  names.forEach((n) => {
    heightSources[n] = (heightSources[n] ?? 0) + 1;
  });
});
console.log("Quellen der Höhenangaben:");
console.table(heightSources);

// 2. Flächenanteil mit Höhe
const totalArea = features.reduce((sum, f) => sum + turf.area(f), 0);
const heightArea = withHeight.reduce((sum, f) => sum + turf.area(f), 0);
console.log(
  `Fläche mit Höhe: ${(heightArea / 1e4).toFixed(4)} ha von ${(totalArea / 1e4).toFixed(4)} ha ` +
    `(${((heightArea / totalArea) * 100).toFixed(4)} %)`,
);

// 3. Verteilung der Höhen
const heights = withHeight
  .map((f) => f.properties.height)
  .sort((a, b) => a - b);
const n = heights.length;
const mean = heights.reduce((s, h) => s + h, 0) / n;
const median =
  n % 2 === 0
    ? (heights[n / 2 - 1] + heights[n / 2]) / 2
    : heights[Math.floor(n / 2)];
console.log(
  `Höhen: min ${heights[0].toFixed(4)} m · Median ${median.toFixed(4)} m · ` +
    `Mittel ${mean.toFixed(4)} m · max ${heights[n - 1].toFixed(4)} m`,
);

const bins = {};
heights.forEach((h) => {
  const lower = Math.floor(h / 5) * 5;
  const label = `${lower}–${lower + 5} m`;
  bins[label] = (bins[label] ?? 0) + 1;
});
console.log("Verteilung in 5-m-Klassen:");
console.table(bins);

// 4. Ein Beispiel mit Höhe, um die Quelle im Detail zu sehen
console.log("\nBeispiel eines Gebäudes mit Höhe:");
console.log(JSON.stringify(withHeight[0].properties, null, 2));
