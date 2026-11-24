import * as turf from "@turf/turf";

const OBSERVER_HEIGHT = 1.2; // Sitzhöhe in Metern
const MAX_SHADOW_LENGTH = 500; // Deckel für sehr tiefe Sonne
const METERS_PER_DEG_LAT = 111320; // ungefähre Länge eines Breitengrads

// Äußere Umrisse eines Gebäudes (bei MultiPolygon: einer pro Teil)
export function getOuterRings(feature) {
  const geom = feature.geometry;
  if (geom.type === "Polygon") return [geom.coordinates[0]];
  if (geom.type === "MultiPolygon")
    return geom.coordinates.map((poly) => poly[0]);
  return [];
}

// Konvexe Hülle nach Andrews Monotone-Chain-Algorithmus
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Kreuzprodukt: > 0 heißt Linksknick, <= 0 heißt Rechtsknick oder gerade
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  // Letzter Punkt jeder Hälfte ist der erste der anderen → entfernen
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Schatten für einen Gebäudeumriss, direkt auf den Koordinaten berechnet
export function computeShadow(ring, height, sun, cosLat) {
  if (sun.elevation <= 0) return null;

  const effectiveHeight = height - OBSERVER_HEIGHT;
  if (effectiveHeight <= 0) return null;

  const elevationRad = (sun.elevation * Math.PI) / 180;
  const length = Math.min(
    effectiveHeight / Math.tan(elevationRad),
    MAX_SHADOW_LENGTH,
  );

  const directionRad = (((sun.azimuth + 180) % 360) * Math.PI) / 180;
  const dLng =
    (length * Math.sin(directionRad)) / (METERS_PER_DEG_LAT * cosLat);
  const dLat = (length * Math.cos(directionRad)) / METERS_PER_DEG_LAT;

  // Originalpunkte + verschobene Punkte sammeln
  const points = [];
  for (const [lng, lat] of ring) {
    points.push([lng, lat], [lng + dLng, lat + dLat]);
  }

  const hull = convexHull(points);
  hull.push(hull[0]); // Polygon schließen

  // Bounding Box gleich mitberechnen
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of hull) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return { ring: hull, bbox: [minLng, minLat, maxLng, maxLat] };
}

const TERRACE_OFFSET = 2; // Meter vor der Fassade

export function moveOutOfBuilding(point, polygons) {
  const container = polygons.find((poly) =>
    turf.booleanPointInPolygon(point, poly),
  );
  if (!container) return point;

  const outline = turf.polygonToLine(container);
  const nearest = turf.nearestPointOnLine(outline, point, { units: "meters" });
  const bearing = turf.bearing(point, nearest);

  return turf.destination(nearest, TERRACE_OFFSET, bearing, {
    units: "meters",
  });
}
