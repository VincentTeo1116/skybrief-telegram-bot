/**
 * Data layer: forecast + air quality + place search.
 *
 * Sources
 *  - Open-Meteo forecast       current conditions, hourly + 7-day forecast, yesterday (free, no key)
 *  - MET Norway                BACKUP forecast, used automatically if Open-Meteo is unreachable
 *  - Open-Meteo air quality    modelled US AQI now + hourly outlook (free, no key)
 *  - WAQI (optional)           MEASURED AQI from the nearest monitoring station; used instead of the
 *                              model when a token is set and a fresh station is within MAX_STATION_KM
 *  - Open-Meteo geocoding      city name -> coordinates
 *  - OpenStreetMap Nominatim   coordinates -> readable place name (for shared GPS locations)
 */
import { convertMetNo, type MetNoResponse } from "./metno";
import { nearestPreset, presetPlace } from "./presets";
import type { Air, AirHourly, Env, Forecast, Lang, Place, Report, Source } from "./types";
import { haversineKm, sleep } from "./util";

export interface ServiceUrls {
  forecast: string;
  air: string;
  geo: string;
  reverse: string;
  waqi: string;
  metno: string;
}

const DEFAULT_URLS: ServiceUrls = {
  forecast: "https://api.open-meteo.com/v1/forecast",
  air: "https://air-quality-api.open-meteo.com/v1/air-quality",
  geo: "https://geocoding-api.open-meteo.com/v1/search",
  reverse: "https://nominatim.openstreetmap.org/reverse",
  waqi: "https://api.waqi.info/feed",
  metno: "https://api.met.no/weatherapi/locationforecast/2.0/complete",
};

const REPO = "github.com/VincentTeo1116/skybrief-telegram-bot";
const USER_AGENT = `skybrief-telegram-bot/2.1 ${REPO}`; // MET Norway and Nominatim require an identifying User-Agent

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

function validTimezone(tz: string): boolean {
  if (!tz || tz === "UTC") return false; // "UTC" is our placeholder for "unknown"
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Build the service with the real endpoints, or the test mocks from the environment. */
export function makeWeather(env: Env): WeatherService {
  return new WeatherService(env.WAQI_TOKEN, {
    ...(env.OPEN_METEO_FORECAST_URL ? { forecast: env.OPEN_METEO_FORECAST_URL } : {}),
    ...(env.OPEN_METEO_AIR_URL ? { air: env.OPEN_METEO_AIR_URL } : {}),
    ...(env.OPEN_METEO_GEO_URL ? { geo: env.OPEN_METEO_GEO_URL } : {}),
    ...(env.NOMINATIM_URL ? { reverse: env.NOMINATIM_URL } : {}),
    ...(env.WAQI_URL ? { waqi: env.WAQI_URL } : {}),
    ...(env.METNO_URL ? { metno: env.METNO_URL } : {}),
  });
}

export class WeatherService {
  private urls: ServiceUrls;

  constructor(
    private waqiToken?: string,
    urls: Partial<ServiceUrls> = {},
  ) {
    this.urls = { ...DEFAULT_URLS, ...urls };
  }

  private async getJson<T>(url: string, params: Record<string, string | number> = {}, tries = 2, timeoutMs = 10_000): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    let last: unknown;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const res = await fetch(qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (e) {
        last = e;
        if (attempt < tries - 1) await sleep(400 * (attempt + 1));
      }
    }
    throw new WeatherError(`Request failed: ${new URL(url).host} (${String(last)})`);
  }

  // -------------------------------------------------------------- forecast
  private async forecastOpenMeteo(p: Place): Promise<Forecast> {
    const wx = await this.getJson<Forecast>(
      this.urls.forecast,
      {
        latitude: p.lat,
        longitude: p.lon,
        timezone: "auto",
        forecast_days: 7,
        past_days: 1, // yesterday, for the "warmer than yesterday" line
        current:
          "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover," +
          "pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day",
        hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,uv_index,is_day",
        daily:
          "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max," +
          "precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max",
      },
      2,
      7_000,
    );
    // A 200 response with a missing section would crash the formatter; treat it as a failure so the backup can step in.
    if (!wx?.current || !wx.hourly?.time?.length || !wx.daily?.time?.length) throw new WeatherError("Open-Meteo returned incomplete data");
    return wx;
  }

  /** Open-Meteo first; MET Norway if it is down (only when the place's timezone is known). */
  private async forecast(p: Place, allowFallback: boolean): Promise<{ wx: Forecast; source: Source }> {
    try {
      return { wx: await this.forecastOpenMeteo(p), source: "open-meteo" };
    } catch (primary) {
      if (!allowFallback || !validTimezone(p.tz)) throw primary;
      try {
        const raw = await this.getJson<MetNoResponse>(this.urls.metno, { lat: p.lat.toFixed(4), lon: p.lon.toFixed(4) }, 1, 8_000);
        console.log(JSON.stringify({ event: "weather_fallback", reason: String(primary).slice(0, 120) }));
        return { wx: convertMetNo(raw, p), source: "met-no" };
      } catch (backup) {
        throw new WeatherError(`Both weather sources failed (${String(primary).slice(0, 80)} | ${String(backup).slice(0, 80)})`);
      }
    }
  }

  // ----------------------------------------------------------- air quality
  private async airModel(p: Place): Promise<{ current: Air | null; hourly: AirHourly | null }> {
    const d = await this.getJson<{ current?: Record<string, unknown>; hourly?: { time?: string[]; us_aqi?: (number | null)[] } }>(
      this.urls.air,
      { latitude: p.lat, longitude: p.lon, timezone: "auto", forecast_days: 3, current: "us_aqi,pm2_5,pm10", hourly: "us_aqi" },
      1,
      5_000,
    );
    const c = d.current ?? {};
    const aqi = num(c.us_aqi);
    const hourly = d.hourly?.time && d.hourly.us_aqi ? { time: d.hourly.time, us_aqi: d.hourly.us_aqi } : null;
    const current: Air | null =
      aqi === null
        ? null
        : { aqi: Math.round(aqi), pm25: num(c.pm2_5), pm10: num(c.pm10), source: "Open-Meteo (model)", station: null, km: null, dominant: null };
    return { current, hourly };
  }

  private async airStation(p: Place): Promise<Air | null> {
    if (!this.waqiToken) return null;
    const res = await this.getJson<{ status: string; data?: Record<string, any> }>(
      `${this.urls.waqi}/geo:${p.lat};${p.lon}/`,
      { token: this.waqiToken },
      1,
      5_000,
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

  private async air(p: Place): Promise<{ aq: Air | null; aqHourly: AirHourly | null }> {
    const [model, station] = await Promise.allSettled([this.airModel(p), this.airStation(p)]);
    const m = model.status === "fulfilled" ? model.value : { current: null, hourly: null };
    const s = station.status === "fulfilled" ? station.value : null;
    if (s) {
      if (m.current) {
        s.pm25 = m.current.pm25; // keep model µg/m³ values for context
        s.pm10 = m.current.pm10;
      }
      return { aq: s, aqHourly: m.hourly };
    }
    return { aq: m.current, aqHourly: m.hourly };
  }

  // ---------------------------------------------------------------- public
  /**
   * @param allowFallback use the backup forecast source if Open-Meteo is down. Pass false when the result
   *   will be used to SAVE a new location: the backup source can't tell us the timezone.
   */
  async fetchReport(place: Place, force = false, opts: { allowFallback?: boolean } = {}): Promise<Report> {
    const allowFallback = opts.allowFallback ?? true;
    const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && !force && Date.now() - hit.fetchedAt < CACHE_TTL_MS && (allowFallback || hit.source === "open-meteo")) {
      return { ...hit, place };
    }

    const [wx, air] = await Promise.allSettled([this.forecast(place, allowFallback), this.air(place)]);
    if (wx.status === "rejected") throw wx.reason instanceof WeatherError ? wx.reason : new WeatherError(String(wx.reason));
    const a = air.status === "fulfilled" ? air.value : { aq: null, aqHourly: null };
    const report: Report = { place, wx: wx.value.wx, aq: a.aq, aqHourly: a.aqHourly, fetchedAt: Date.now(), source: wx.value.source };
    cache.set(key, report);
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return report;
  }

  /** 'Penang', 'Ipoh, Malaysia', 'Springfield Illinois' -> up to `limit` matches. */
  async searchPlaces(query: string, limit = 5, lang: Lang = "en"): Promise<Place[]> {
    const [first, ...rest] = query.split(",");
    const name = first.trim();
    const hint = rest.join(",").trim().toLowerCase();
    const data = await this.getJson<{ results?: Record<string, any>[] }>(this.urls.geo, { name, count: 10, language: lang, format: "json" });
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
        this.urls.reverse,
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
      return { ...p, lat, lon };
    }
    return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, country: "", tz: "UTC" };
  }
}
