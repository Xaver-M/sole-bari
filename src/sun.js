import * as SunCalc from "suncalc";

export function getSunPosition(date, lat, lng) {
  const pos = SunCalc.getPosition(date, lat, lng);

  const elevation = pos.altitude;
  const azimuth = pos.azimuth;

  return { elevation, azimuth };
}

export function getSunTimes(date, lat, lng) {
  const times = SunCalc.getTimes(date, lat, lng);
  return { sunrise: times.sunrise, sunset: times.sunset };
}
