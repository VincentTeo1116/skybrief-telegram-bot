/**
 * Data layer: forecast + air quality + place search.
 *
 * Sources
 *  - Open-Meteo forecast       current conditions, hourly + 4-day forecast (free, no key)
 *  - Open-Meteo air quality    modelled US AQI / PM2.5 / PM10 (free, no key)
 *  - WAQI (optional)           MEASURED AQI from the nearest monitoring station; used instead of the
 *                              model when a token is set and a fresh station is within MAX_STATION_KM
 *  - Open-Meteo geocoding      city name -> coordinates
 *  - OpenStreetMap Nominatim   coordinates -> readable place name (for shared GPS locations)
 */
import { nearestPreset, presetPlace } from "./presets";
import type { Air, Forecast, Lang, Place, Report } from "./types";
import { haversineKm, sleep } from "./util";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const WAQI_URL = "https://api.waqi.info/feed";
const USER_AGENT = "skybrief-telegram-bot/2.0 (personal use)";

export const MAX_STATION_KM = 40;
export const MAX_STATION_AGE_H = 3;
const CACHE_TTL_MS = 5 * 60 * 1000;

export class WeatherError extends Error {}

const cache = new Map<string, Report>(); // shared by all requests handled by this isolate

export function placeLabel(p: Place): string {
  const parts = [p.name];
  if (p.admin && p.admin !== p.name) parts.push(p.admin);
  if (p.country && !parts.includes(p.country)) parts.push(p.country);
  return parts.join(", ");
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export class WeatherService {
  constructor(private waqiToken?: string) {}

  private async getJson<T>(url: string, params: Record<string, string | number> = {}, tries = 2): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    let last: unknown;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const res = await fetch(qs ? `${url}?${qs}` : url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (e) {
        last = e;
        if (attempt < tries - 1) await sleep(500 * (attempt + 1));
      }
    }
    throw new WeatherError(`Request failed: ${new URL(url).host} (${String(last)})`);
  }

  // -------------------------------------------------------------- forecast
  private forecast(p: Place): Promise<Forecast> {
    return this.getJson<Forecast>(FORECAST_URL, {
      latitude: p.lat,
      longitude: p.lon,
      timezone: "auto",
      forecast_days: 4,
      current:
        "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover," +
        "pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day",
      hourly: "temperature_2m,precipitation_probability,weather_code",
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum," +
        "sunrise,sunset,uv_index_max",
    });
  }

  // ----------------------------------------------------------- air quality
  private async airModel(p: Place): Promise<Air | null> {
    const d = await this.getJson<{ current?: Record<string, unknown> }>(AIR_URL, {
      latitude: p.lat,
      longitude: p.lon,
      timezone: "auto",
      current: "us_aqi,pm2_5,pm10",
    });
    const c = d.current ?? {};
    const aqi = num(c.us_aqi);
    if (aqi === null) return null;
    return {
      aqi: Math.round(aqi),
      pm25: num(c.pm2_5),
      pm10: num(c.pm10),
      source: "Open-Meteo (model)",
      station: null,
      km: null,
      dominant: null,
    };
  }

  private async airStation(p: Place): Promise<Air | null> {
    if (!this.waqiToken) return null;
    const res = await this.getJson<{ status: string; data?: Record<string, any> }>(
      `${WAQI_URL}/geo:${p.lat};${p.lon}/`,
      { token: this.waqiToken },
    );
    if (res.status !== "ok" || !res.data) return null;
    const d = res.data;
    const aqi = num(d.aqi);
    const geo: unknown[] = d.city?.geo ?? [];
    if (aqi === null || geo.length !== 2) return null;
    const km = haversineKm(p.lat, p.lon, Number(geo[0]), Number(geo[1]));
    if (km > MAX_STATION_KM) return null;
    const iso: string | undefined = d.time?.iso;
    if (iso) {
      const ageH = (Date.now() - Date.parse(iso)) / 3_600_000;
      if (Number.isFinite(ageH) && ageH > MAX_STATION_AGE_H) return null;
    }
    const dom = typeof d.dominentpol === "string" && d.dominentpol ? d.dominentpol.toUpperCase().replace("PM25", "PM2.5") : null;
    return { aqi: Math.round(aqi), pm25: null, pm10: null, source: "WAQI (measured)", station: d.city?.name ?? null, km, dominant: dom };
  }

  private async air(p: Place): Promise<Air | null> {
    const [model, station] = await Promise.allSettled([this.airModel(p), this.airStation(p)]);
    const m = model.status === "fulfilled" ? model.value : null;
    const s = station.status === "fulfilled" ? station.value : null;
    if (s) {
      if (m) {
        s.pm25 = m.pm25; // keep model µg/m³ values for context
        s.pm10 = m.pm10;
      }
      return s;
    }
    return m;
  }

  // ---------------------------------------------------------------- public
  async fetchReport(place: Place, force = false): Promise<Report> {
    const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && !force && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return { ...hit, place };

    const [wx, aq] = await Promise.allSettled([this.forecast(place), this.air(place)]);
    if (wx.status === "rejected") throw new WeatherError(String(wx.reason));
    const report: Report = { place, wx: wx.value, aq: aq.status === "fulfilled" ? aq.value : null, fetchedAt: Date.now() };
    cache.set(key, report);
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return report;
  }

  /** 'Penang', 'Ipoh, Malaysia', 'Springfield Illinois' -> up to `limit` matches. */
  async searchPlaces(query: string, limit = 5, lang: Lang = "en"): Promise<Place[]> {
    const [first, ...rest] = query.split(",");
    const name = first.trim();
    const hint = rest.join(",").trim().toLowerCase();
    const data = await this.getJson<{ results?: Record<string, any>[] }>(GEO_URL, { name, count: 10, language: lang, format: "json" });
    let results = data.results ?? [];
    if (hint) {
      const narrowed = results.filter((r) =>
        ["country", "country_code", "admin1", "admin2"].map((k) => String(r[k] ?? "")).join(" ").toLowerCase().includes(hint),
      );
      if (narrowed.length) results = narrowed;
    }
    return results.slice(0, limit).map((r) => ({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      country: r.country ?? "",
      admin: r.admin1 ?? "",
      tz: r.timezone ?? "UTC",
    }));
  }

  /** Turn shared GPS coordinates into a friendly name; fall back to a nearby preset city, then raw coordinates. */
  async reverseGeocode(lat: number, lon: number, lang: Lang = "en"): Promise<Place> {
    try {
      const d = await this.getJson<{ address?: Record<string, string> }>(
        REVERSE_URL,
        { lat, lon, format: "jsonv2", zoom: 13, "accept-language": lang },
        1,
      );
      const a = d.address ?? {};
      const local = a.suburb || a.city_district || a.neighbourhood || a.quarter;
      const city = a.city || a.town || a.village || a.municipality || a.county;
      const name = local && city && local !== city ? `${local}, ${city}` : local || city;
      if (name) return { name, lat, lon, country: a.country ?? "", admin: a.state ?? "", tz: "UTC" };
    } catch {
      /* fall through to the fallbacks */
    }
    const near = nearestPreset(lat, lon, 25, haversineKm);
    if (near !== null) {
      const p = presetPlace(near, lang);
      return { ...p, name: p.name, lat, lon };
    }
    return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, country: "", tz: "UTC" };
  }
}

