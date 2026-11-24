import * as turf from "@turf/turf";

const OBSERVER_HEIGHT = 1.2; // Sitzhöhe in Metern
const MAX_SHADOW_LENGTH = 500; // Deckel für sehr tiefe Sonne

export function computeShadow(building, height, sun) {
  // Nachts oder bei Sonne am Horizont: kein sinnvoller Schatten
  if (sun.elevation <= 0) return null;

  const effectiveHeight = height - OBSERVER_HEIGHT;
  if (effectiveHeight <= 0) return null;

  const elevationRad = (sun.elevation * Math.PI) / 180;
  const length = Math.min(
    effectiveHeight / Math.tan(elevationRad),
    MAX_SHADOW_LENGTH,
  );
  const direction = (sun.azimuth + 180) % 360;

  const moved = turf.transformTranslate(building, length, direction, {
    units: "meters",
  });

  const points = turf.featureCollection([
    ...turf.explode(building).features,
    ...turf.explode(moved).features,
  ]);

  return turf.convex(points);
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
