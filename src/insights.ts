/**
 * Pure analysis of a Report: rain detection, "best time outside", AQI outlook, yesterday trend, day periods.
 * No I/O and no text here, so every rule is easy to unit-test.
 *
 * All times are LOCAL ISO strings "YYYY-MM-DDTHH:MM" (as returned by Open-Meteo), never JS Dates in the
 * server's timezone.
 */
import type { Report } from "./types";

export const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
export const STORM_CODES = new Set([95, 96, 99]);

/** What counts as a comfortable hour to be outside (tuned for the tropics, where midday is always hot). */
export const COMFORT = {
  feelsMin: 8,
  feelsMax: 32,
  uvMax: 5,
  probMax: 39,
  precipMax: 0.29,
  aqiMax: 100,
  firstHour: 6,
  lastHour: 21,
} as const;

export const pct = (v: number | null | undefined): number => (v == null ? 0 : Math.round(v));

// ---------------------------------------------------------------- time helpers
function toMs(iso: string): number {
  const [d, t = "00:00"] = iso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return Date.UTC(y, mo - 1, da, h, mi);
}

export function addHours(iso: string, n: number): string {
  return new Date(toMs(iso) + n * 3_600_000).toISOString().slice(0, 16);
}

export function addDays(date: string, n: number): string {
  return new Date(toMs(date) + n * 86_400_000).toISOString().slice(0, 10);
}

export function hoursBetween(a: string, b: string): number {
  return (toMs(b) - toMs(a)) / 3_600_000;
}

const hourOf = (iso: string) => Number(iso.slice(11, 13));

// ----------------------------------------------------------------- indexing
/** Index of today's local date in wx.daily (the API is asked for yesterday too, so it is usually 1). */
export function dailyIndex(r: Report): number {
  const i = r.wx.daily.time.indexOf(r.wx.current.time.slice(0, 10));
  return i >= 0 ? i : 0;
}

export function hourIndex(r: Report): number {
  const i = r.wx.hourly.time.indexOf(r.wx.current.time.slice(0, 13) + ":00");
  return i >= 0 ? i : 0;
}

export interface HourRow {
  time: string;
  temp: number | null;
  prob: number;
  code: number | null;
  precip: number;
}

export function nextHours(r: Report, n: number): HourRow[] {
  const h = r.wx.hourly;
  const start = hourIndex(r);
  const rows: HourRow[] = [];
  for (let k = start; k < Math.min(start + n, h.time.length); k++) {
    rows.push({
      time: h.time[k],
      temp: h.temperature_2m[k],
      prob: pct(h.precipitation_probability[k]),
      code: h.weather_code[k],
      precip: h.precipitation?.[k] ?? 0,
    });
  }
  return rows;
}

// --------------------------------------------------------------------- rain
export function isRainingNow(r: Report): boolean {
  const c = r.wx.current;
  return (c.precipitation ?? 0) >= 0.1 || (c.weather_code != null && RAIN_CODES.has(c.weather_code));
}

/** Rain likely to START within the next ~2 hours (hourly data). Null if it is already raining or nothing is coming. */
export function rainAlert(r: Report): { time: string; prob: number; mm: number } | null {
  if (isRainingNow(r)) return null;
  const hit = nextHours(r, 3)
    .slice(1)
    .find((x) => x.prob >= 60);
  return hit ? { time: hit.time, prob: hit.prob, mm: hit.precip } : null;
}

// -------------------------------------------------------------------- trend
/** Today's forecast high minus yesterday's high, in °C. Null when yesterday isn't available. */
export function trend(r: Report): number | null {
  const d = r.wx.daily;
  const i = dailyIndex(r);
  if (i < 1) return null;
  const today = d.temperature_2m_max[i];
  const yesterday = d.temperature_2m_max[i - 1];
  return today == null || yesterday == null ? null : today - yesterday;
}

// ------------------------------------------------------------- air quality
/** Modelled AQI per local hour, keyed by "YYYY-MM-DDTHH:00". */
function aqiByHour(r: Report): Map<string, number> {
  const m = new Map<string, number>();
  const h = r.aqHourly;
  if (h) h.time.forEach((t, i) => h.us_aqi[i] != null && m.set(t, h.us_aqi[i] as number));
  return m;
}

export type AqiOutlook = { kind: "rising" | "falling" | "steady"; aqi: number; time: string; base: number };

/** How air quality is expected to move over the next 12 hours, from the model's hourly forecast. */
export function aqiOutlook(r: Report): AqiOutlook | null {
  const map = aqiByHour(r);
  const nowKey = r.wx.current.time.slice(0, 13) + ":00";
  const base = map.get(nowKey);
  if (base == null) return null;
  let peak = { v: base, t: nowKey };
  let low = { v: base, t: nowKey };
  for (let k = 1; k <= 12; k++) {
    const t = addHours(nowKey, k);
    const v = map.get(t);
    if (v == null) continue;
    if (v > peak.v) peak = { v, t };
    if (v < low.v) low = { v, t };
  }
  const rise = peak.v - base;
  const fall = base - low.v;
  if (Math.max(rise, fall) < 10) return { kind: "steady", aqi: Math.round(base), time: nowKey, base };
  return rise >= fall
    ? { kind: "rising", aqi: Math.round(peak.v), time: peak.t, base }
    : { kind: "falling", aqi: Math.round(low.v), time: low.t, base };
}

/** Highest modelled AQI on a given local date. */
export function aqiPeakOn(r: Report, date: string): { aqi: number; time: string } | null {
  let best: { aqi: number; time: string } | null = null;
  for (const [t, v] of aqiByHour(r)) {
    if (t.startsWith(date) && (!best || v > best.aqi)) best = { aqi: Math.round(v), time: t };
  }
  return best;
}

// ------------------------------------------------------------- best time outside
export interface HourPoint {
  time: string;
  feels: number | null;
  uv: number | null;
  prob: number;
  precip: number;
  aqi: number | null;
}

/** All hourly rows of one local date, merged with the modelled AQI. */
export function hourPoints(r: Report, date: string): HourPoint[] {
  const h = r.wx.hourly;
  const aqi = aqiByHour(r);
  const out: HourPoint[] = [];
  h.time.forEach((time, k) => {
    if (!time.startsWith(date)) return;
    out.push({
      time,
      feels: h.apparent_temperature?.[k] ?? h.temperature_2m[k],
      uv: h.uv_index?.[k] ?? null,
      prob: pct(h.precipitation_probability[k]),
      precip: h.precipitation?.[k] ?? 0,
      aqi: aqi.get(time) ?? null,
    });
  });
  return out;
}

export function isComfortable(p: HourPoint): boolean {
  const h = hourOf(p.time);
  if (h < COMFORT.firstHour || h > COMFORT.lastHour) return false;
  if (p.feels != null && (p.feels < COMFORT.feelsMin || p.feels > COMFORT.feelsMax)) return false;
  if (p.uv != null && p.uv > COMFORT.uvMax) return false;
  if (p.prob > COMFORT.probMax || p.precip > COMFORT.precipMax) return false;
  if (p.aqi != null && p.aqi > COMFORT.aqiMax) return false;
  return true;
}

export interface Window {
  start: string;
  /** END boundary: the start of the hour after the last comfortable hour. */
  end: string;
}

/** The longest run of consecutive comfortable hours (earliest wins a tie). */
export function bestWindow(points: HourPoint[]): Window | null {
  let best: HourPoint[] = [];
  let run: HourPoint[] = [];
  for (const p of points) {
    const prev = run[run.length - 1];
    if (isComfortable(p)) {
      if (prev && hoursBetween(prev.time, p.time) !== 1) {
        if (run.length > best.length) best = run;
        run = [];
      }
      run.push(p);
    } else {
      if (run.length > best.length) best = run;
      run = [];
    }
  }
  if (run.length > best.length) best = run;
  if (!best.length) return null;
  return { start: best[0].time, end: addHours(best[best.length - 1].time, 1) };
}

export interface BestOutside {
  /** undefined = no outdoor hours left today; null = none comfortable; otherwise the window. */
  today: Window | null | undefined;
  tomorrow: Window | null;
}

export function bestOutside(r: Report): BestOutside {
  const cur = r.wx.current.time;
  const date = cur.slice(0, 10);
  const hourStart = cur.slice(0, 13) + ":00";
  const from = Number(cur.slice(14, 16)) >= 30 ? addHours(hourStart, 1) : hourStart;
  const left = hourPoints(r, date).filter(
    (p) => p.time >= from && hourOf(p.time) >= COMFORT.firstHour && hourOf(p.time) <= COMFORT.lastHour,
  );
  return {
    today: left.length ? bestWindow(left) : undefined,
    tomorrow: bestWindow(hourPoints(r, addDays(date, 1))),
  };
}

// ------------------------------------------------------------- day periods
export interface Period {
  key: "morning" | "afternoon" | "evening";
  temp: number;
  prob: number;
  code: number | null;
}

const PERIODS: { key: Period["key"]; from: number; to: number; mid: number }[] = [
  { key: "morning", from: 6, to: 12, mid: 9 },
  { key: "afternoon", from: 12, to: 18, mid: 15 },
  { key: "evening", from: 18, to: 23, mid: 20 },
];

/** Morning / afternoon / evening summary for one local date. */
export function dayPeriods(r: Report, date: string): Period[] {
  const h = r.wx.hourly;
  const out: Period[] = [];
  for (const per of PERIODS) {
    const idx: number[] = [];
    h.time.forEach((t, k) => {
      const hr = hourOf(t);
      if (t.startsWith(date) && hr >= per.from && hr < per.to) idx.push(k);
    });
    if (!idx.length) continue;
    const temps = idx.map((k) => h.temperature_2m[k]).filter((v): v is number => v != null);
    const probs = idx.map((k) => pct(h.precipitation_probability[k]));
    const maxProb = Math.max(...probs);
    // Show the weather at the wettest hour when rain is likely, otherwise at the middle of the period.
    const pick = maxProb >= 50 ? idx[probs.indexOf(maxProb)] : (idx.find((k) => hourOf(h.time[k]) === per.mid) ?? idx[0]);
    out.push({
      key: per.key,
      temp: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : NaN,
      prob: maxProb,
      code: h.weather_code[pick],
    });
  }
  return out;
}
