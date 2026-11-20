/**
 * Malaysia's official Air Pollutant Index (API, in Malay IPU) from the Department of Environment (FR-14).
 *
 * Source: the service behind the Department's public APIMS map
 *   https://eqms.doe.gov.my/api3/publicmapproxy/PUBLIC_DISPLAY/CAQM_MCAQM_Current_Reading/MapServer/0/query
 * It answers with every monitoring station's latest hourly reading (68 stations, about 16 KB, checked 20 Nov 2026).
 *
 * It is NOT a documented public API: it has no published terms and may change or disappear without notice. So it is
 * strictly optional. Any problem at all (down, slow, changed format, stale data, no station nearby) means "no
 * official reading", and the dashboard shows its usual US AQI card without the IPU block. Nothing else depends on it.
 */
import { hoursBetween } from "./insights";
import type { Env, Place } from "./types";
import { haversineKm } from "./util";
import { nowMalaysia } from "./warnings";

const DEFAULT_URL = "https://eqms.doe.gov.my/api3/publicmapproxy/PUBLIC_DISPLAY/CAQM_MCAQM_Current_Reading/MapServer/0/query";
const QUERY = "where=1%3D1&outFields=STATION_ID,DATETIME,API,STATION_LOCATION,LONGITUDE,LATITUDE&returnGeometry=false&f=json";
const USER_AGENT = "skybrief-telegram-bot/2.3 github.com/VincentTeo1116/skybrief-telegram-bot";

export const IPU_MAX_KM = 40;
export const IPU_MAX_AGE_H = 3;
const CACHE_MS = 15 * 60 * 1000; // readings are hourly
const FAIL_CACHE_MS = 3 * 60 * 1000; // after a failure, don't ask again on every page load
const TIMEOUT_MS = 5000;

export interface IpuStation {
  name: string;
  lat: number;
  lon: number;
  value: number;
  /** Malaysian local time of the reading, "YYYY-MM-DDTHH:MM". */
  time: string;
}

export interface IpuReading extends IpuStation {
  km: number;
}

let cache: { at: number; stations: IpuStation[]; ok: boolean } | null = null;
export const clearIpuCache = () => {
  cache = null;
};

/** "Cheras, W.P. KUALA LUMPUR" -> "Cheras": the state is already on screen as the place name. */
const stationName = (s: string) => s.split(",")[0].trim() || s.trim();

/** Read the feed defensively: anything unusable is skipped. */
export function parseIpu(raw: unknown): IpuStation[] {
  const features = (raw as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: IpuStation[] = [];
  for (const f of features as { attributes?: Record<string, unknown> }[]) {
    const a = f?.attributes;
    if (!a) continue;
    const value = a.API;
    const lat = a.LATITUDE;
    const lon = a.LONGITUDE;
    const stamp = a.DATETIME;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000) continue;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (typeof stamp !== "number" || !Number.isFinite(stamp) || typeof a.STATION_LOCATION !== "string" || !a.STATION_LOCATION.trim()) continue;
    out.push({
      name: stationName(a.STATION_LOCATION).slice(0, 60),
      lat,
      lon,
      value: Math.round(value),
      // The feed stores Malaysian wall-clock time as if it were UTC, so its UTC fields ARE the local time.
      time: new Date(stamp).toISOString().slice(0, 16),
    });
  }
  return out;
}

async function stations(env: Env, nowMs: number): Promise<IpuStation[]> {
  if (cache && nowMs - cache.at < (cache.ok ? CACHE_MS : FAIL_CACHE_MS)) return cache.stations;
  let list: IpuStation[] = [];
  let ok = false;
  try {
    const base = env.IPU_URL || DEFAULT_URL;
    const res = await fetch(`${base}?${QUERY}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      list = parseIpu(await res.json());
      ok = list.length > 0;
    }
  } catch {
    /* optional data: no reading */
  }
  cache = { at: nowMs, stations: list, ok };
  return list;
}

/** Nearest station with a fresh reading, from an already-parsed list. Pure, for tests. */
export function nearestIpu(list: IpuStation[], place: Pick<Place, "lat" | "lon">, nowLocal: string): IpuReading | null {
  let best: IpuReading | null = null;
  for (const s of list) {
    const age = hoursBetween(s.time, nowLocal);
    if (!Number.isFinite(age) || age > IPU_MAX_AGE_H || age < -1.5) continue; // stale, or dated in the future
    const km = haversineKm(place.lat, place.lon, s.lat, s.lon);
    if (km <= IPU_MAX_KM && (!best || km < best.km)) best = { ...s, km };
  }
  return best;
}

/** The official reading for a place in Malaysia, or null. Never throws. */
export async function officialIpu(env: Env, place: Place, now = new Date()): Promise<IpuReading | null> {
  if (env.IPU_URL === "off" || !/malaysia|马来西亚/i.test(place.country)) return null;
  try {
    return nearestIpu(await stations(env, now.getTime()), place, nowMalaysia(now));
  } catch {
    return null;
  }
}

/** Malaysia's own bands: 0-50 good, 51-100 moderate, 101-200 unhealthy, 201-300 very unhealthy, above 300 hazardous. */
export function ipuBand(value: number): 0 | 1 | 3 | 4 | 5 {
  return value <= 50 ? 0 : value <= 100 ? 1 : value <= 200 ? 3 : value <= 300 ? 4 : 5; // indexes into the shared band names and colours
}
