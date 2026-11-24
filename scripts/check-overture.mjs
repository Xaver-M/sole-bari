import fs from "node:fs";

const data = JSON.parse(fs.readFileSync("overture-buildings.geojson", "utf8"));
const total = data.features.length;
const withHeight = data.features.filter(
  (f) => f.properties.height != null,
).length;
const withFloors = data.features.filter(
  (f) => f.properties.num_floors != null,
).length;

console.log(`Gebäude gesamt: ${total}`);
console.log(
  `mit height: ${withHeight} (${((withHeight / total) * 100).toFixed(4)} %)`,
);
console.log(
  `mit num_floors: ${withFloors} (${((withFloors / total) * 100).toFixed(4)} %)`,
);

// Einmal ein Beispiel-Gebäude anzeigen, damit wir die Struktur sehen
console.log("\nBeispiel-Properties:");
console.log(data.features[0].properties);
