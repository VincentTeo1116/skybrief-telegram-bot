/**
 * Backup weather source: MET Norway Locationforecast (free, no key, global).
 * Used only when Open-Meteo is unreachable, and only for places whose timezone we already know.
 *
 * It does not provide rain PROBABILITY, so that is estimated from the forecast rainfall amount. The report
 * footer tells the user the data comes from the backup source.
 */
import type { Forecast, Place } from "./types";
import { localParts } from "./util";

interface Next {
  summary?: { symbol_code?: string };
  details?: { precipitation_amount?: number; air_temperature_max?: number; air_temperature_min?: number };
}
interface MetPoint {
  time: string;
  data: { instant: { details: Record<string, number | undefined> }; next_1_hours?: Next; next_6_hours?: Next; next_12_hours?: Next };
}
export interface MetNoResponse {
  properties: { timeseries: MetPoint[] };
}

// ----------------------------------------------------------------- mapping
const WMO_BY_SYMBOL: Record<string, number> = {
  clearsky: 0,
  fair: 1,
  partlycloudy: 2,
  cloudy: 3,
  fog: 45,
  lightrain: 61,
  rain: 63,
  heavyrain: 65,
  lightrainshowers: 80,
  rainshowers: 81,
  heavyrainshowers: 82,
  lightsleet: 67,
  sleet: 67,
  heavysleet: 67,
  lightsleetshowers: 67,
  sleetshowers: 67,
  heavysleetshowers: 67,
  lightsnow: 71,
  snow: 73,
  heavysnow: 75,
  lightsnowshowers: 85,
  snowshowers: 85,
  heavysnowshowers: 86,
};

/** MET Norway symbol (e.g. "lightrainshowers_day") -> the WMO weather code the rest of the bot understands. */
export function symbolToWmo(symbol?: string): number | null {
  if (!symbol) return null;
  const base = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (base.includes("thunder")) return base.includes("heavy") ? 99 : 95;
  return WMO_BY_SYMBOL[base] ?? null;
}

export function isDaySymbol(symbol?: string): boolean | null {
  if (!symbol) return null;
  if (symbol.endsWith("_night")) return false;
  if (symbol.endsWith("_day")) return true;
  return null;
}

/** Rain probability is not provided by this source; estimate it from the expected amount (mm in that period). */
export function probFromAmount(mm: number | undefined): number {
  const a = mm ?? 0;
  if (a >= 1) return 90;
  if (a >= 0.5) return 75;
  if (a >= 0.2) return 55;
  return a > 0 ? 25 : 0;
}

/** Australian Bureau of Meteorology "apparent temperature" (used only if the source omits it). */
export function apparentTemp(tC: number, rh: number, windMs: number): number {
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * tC) / (237.7 + tC));
  return tC + 0.33 * e - 0.7 * windMs - 4;
}

// --------------------------------------------------------------- sun times
const rad = Math.PI / 180;
const deg = 180 / Math.PI;
const mod = (a: number, n: number) => ((a % n) + n) % n;

function localIso(d: Date, tz: string): string {
  const { date, time } = localParts(tz, d);
  return `${date}T${time}`;
}

/** Sunrise and sunset (local "YYYY-MM-DDTHH:MM") for a local date, from the standard almanac algorithm (±2 min). */
export function sunTimes(lat: number, lon: number, date: string, tz: string): { sunrise: string; sunset: string } {
  const [y, m, d] = date.split("-").map(Number);
  const dayOfYear = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
  const lngHour = lon / 15;

  const universalHour = (rising: boolean): number | null => {
    const t = dayOfYear + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    const L = mod(M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634, 360);
    let RA = mod(Math.atan(0.91764 * Math.tan(L * rad)) * deg, 360);
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null; // polar day / night
    const H = (rising ? 360 - Math.acos(cosH) * deg : Math.acos(cosH) * deg) / 15;
    return mod(H + RA - 0.06571 * t - 6.622 - lngHour, 24);
  };

  const toLocal = (ut: number | null, fallbackHour: string): string => {
    if (ut === null) return `${date}T${fallbackHour}:00`;
    let ms = Date.UTC(y, m - 1, d) + ut * 3_600_000;
    for (let i = 0; i < 2; i++) {
      const iso = localIso(new Date(ms), tz);
      if (iso.slice(0, 10) < date) ms += 86_400_000;
      else if (iso.slice(0, 10) > date) ms -= 86_400_000;
      else break;
    }
    return localIso(new Date(ms), tz);
  };

  return { sunrise: toLocal(universalHour(true), "06"), sunset: toLocal(universalHour(false), "18") };
}

// -------------------------------------------------------------- conversion
const num = (v: number | undefined | null): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface DayAcc {
  tmax: number;
  tmin: number;
  feelsMax: number;
  windMax: number;
  precip: number;
  prob: number;
  code: number | null;
  anyCode: number | null;
  uv: number | null;
}

/** Convert a MET Norway response into the same Forecast shape Open-Meteo gives us. Throws on unusable data. */
export function convertMetNo(json: MetNoResponse, place: Place): Forecast {
  const ts = json?.properties?.timeseries;
  if (!ts?.length) throw new Error("MET Norway returned no data");
  const tz = place.tz;
  const first = ts[0];
  const inst = first.data.instant.details;
  const temp0 = num(inst.air_temperature);
  if (temp0 === null) throw new Error("MET Norway data is missing the temperature");

  const sym0 = first.data.next_1_hours?.summary?.symbol_code ?? first.data.next_6_hours?.summary?.symbol_code;
  const nowLocal = localIso(new Date(first.time), tz);
  const hour0 = Number(nowLocal.slice(11, 13));
  const isDay = isDaySymbol(sym0) ?? (hour0 >= 6 && hour0 < 19);
  const wind0 = num(inst.wind_speed) ?? 0;
  const gust0 = num(inst.wind_speed_of_gust);

  const hourly: Forecast["hourly"] = {
    time: [],
    temperature_2m: [],
    apparent_temperature: [],
    precipitation_probability: [],
    precipitation: [],
    weather_code: [],
    uv_index: [],
    is_day: [],
  };
  const days = new Map<string, DayAcc>();

  for (let idx = 0; idx < ts.length; idx++) {
    const p = ts[idx];
    const d = p.data;
    const t = num(d.instant.details.air_temperature);
    const local = localIso(new Date(p.time), tz);
    const date = local.slice(0, 10);
    const hh = Number(local.slice(11, 13));
    const rh = num(d.instant.details.relative_humidity) ?? 70;
    const windMs = num(d.instant.details.wind_speed) ?? 0;
    const feels = num(d.instant.details.apparent_air_temperature) ?? (t === null ? null : apparentTemp(t, rh, windMs));
    const uv = num(d.instant.details.ultraviolet_index_clear_sky);
    const n1 = d.next_1_hours;
    const n6 = d.next_6_hours;

    // hourly arrays: only the contiguous hourly part at the start of the series
    if (n1 && hourly.time.length === idx) {
      hourly.time.push(`${date}T${String(hh).padStart(2, "0")}:00`);
      hourly.temperature_2m.push(t);
      hourly.apparent_temperature!.push(feels);
      hourly.precipitation!.push(n1.details?.precipitation_amount ?? 0);
      hourly.precipitation_probability.push(probFromAmount(n1.details?.precipitation_amount));
      hourly.weather_code.push(symbolToWmo(n1.summary?.symbol_code));
      hourly.uv_index!.push(uv);
      const day = isDaySymbol(n1.summary?.symbol_code);
      hourly.is_day!.push(day === null ? null : day ? 1 : 0);
    }

    // daily aggregation over every point (hourly and 6-hourly alike)
    let acc = days.get(date);
    if (!acc) {
      acc = { tmax: -Infinity, tmin: Infinity, feelsMax: -Infinity, windMax: 0, precip: 0, prob: 0, code: null, anyCode: null, uv: null };
      days.set(date, acc);
    }
    const hi = Math.max(t ?? -Infinity, n6?.details?.air_temperature_max ?? -Infinity);
    const lo = Math.min(t ?? Infinity, n6?.details?.air_temperature_min ?? Infinity);
    acc.tmax = Math.max(acc.tmax, hi);
    acc.tmin = Math.min(acc.tmin, lo);
    if (feels !== null) acc.feelsMax = Math.max(acc.feelsMax, feels);
    acc.windMax = Math.max(acc.windMax, windMs * 3.6);
    if (n1) {
      acc.precip += n1.details?.precipitation_amount ?? 0;
      acc.prob = Math.max(acc.prob, probFromAmount(n1.details?.precipitation_amount));
    } else if (n6) {
      acc.precip += n6.details?.precipitation_amount ?? 0;
      acc.prob = Math.max(acc.prob, probFromAmount((n6.details?.precipitation_amount ?? 0) / 3));
    }
    const code = symbolToWmo(n1?.summary?.symbol_code ?? n6?.summary?.symbol_code ?? d.next_12_hours?.summary?.symbol_code);
    if (code !== null) {
      acc.anyCode = Math.max(acc.anyCode ?? 0, code);
      if (hh >= 6 && hh <= 20) acc.code = Math.max(acc.code ?? 0, code);
    }
    if (uv !== null) acc.uv = Math.max(acc.uv ?? 0, uv);
  }

  const dates = [...days.keys()].sort().slice(0, 8);
  const daily: Forecast["daily"] = {
    time: dates,
    weather_code: [],
    temperature_2m_max: [],
    temperature_2m_min: [],
    apparent_temperature_max: [],
    precipitation_probability_max: [],
    precipitation_sum: [],
    sunrise: [],
    sunset: [],
    uv_index_max: [],
    wind_speed_10m_max: [],
  };
  for (const date of dates) {
    const a = days.get(date)!;
    const sun = sunTimes(place.lat, place.lon, date, tz);
    daily.weather_code.push(a.code ?? a.anyCode);
    daily.temperature_2m_max.push(Number.isFinite(a.tmax) ? a.tmax : null);
    daily.temperature_2m_min.push(Number.isFinite(a.tmin) ? a.tmin : null);
    daily.apparent_temperature_max!.push(Number.isFinite(a.feelsMax) ? a.feelsMax : null);
    daily.precipitation_probability_max.push(a.prob);
    daily.precipitation_sum!.push(Math.round(a.precip * 10) / 10);
    daily.sunrise.push(sun.sunrise);
    daily.sunset.push(sun.sunset);
    daily.uv_index_max.push(a.uv);
    daily.wind_speed_10m_max!.push(Math.round(a.windMax));
  }

  return {
    timezone: tz,
    current: {
      time: nowLocal,
      temperature_2m: temp0,
      relative_humidity_2m: num(inst.relative_humidity) ?? 0,
      apparent_temperature: num(inst.apparent_air_temperature) ?? apparentTemp(temp0, num(inst.relative_humidity) ?? 70, wind0),
      precipitation: first.data.next_1_hours?.details?.precipitation_amount ?? 0,
      weather_code: symbolToWmo(sym0),
      cloud_cover: num(inst.cloud_area_fraction) ?? 0,
      pressure_msl: num(inst.air_pressure_at_sea_level) ?? 1013,
      wind_speed_10m: wind0 * 3.6,
      wind_direction_10m: num(inst.wind_from_direction),
      wind_gusts_10m: gust0 === null ? null : gust0 * 3.6,
      is_day: isDay ? 1 : 0,
    },
    hourly,
    daily,
  };
}
