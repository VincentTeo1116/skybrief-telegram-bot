import type { Air, AirHourly, Forecast, Prefs, Report, User } from "../src/types";
import { defaultPrefs } from "../src/units";

/**
 * A deterministic forecast: Tuesday 3 Nov 2026, 08:15 local in Kuala Lumpur, shaped like the real API
 * (yesterday + 7 days, 192 hourly rows starting yesterday 00:00).
 *
 * Diurnal curve (so the "best time outside" result is predictable):
 *   temperature = 26 + 6*sin(pi*(h-6)/12) by day, feels-like = temperature + 4  -> feels <= 32 only at h <= 7 or h >= 17
 *   UV          = uv  * sin(...)^2                                              -> UV <= 5 only at h <= 9 or h >= 15
 * so the comfortable hours are 06-08 and 17-22, and the longest run is the evening: 5 PM to 10 PM.
 */
export interface ForecastOpts {
  prob?: number | null;
  code?: number;
  precip?: number;
  feels?: number;
  uv?: number;
  gusts?: number;
  yesterdayMax?: number;
  todayMax?: number;
  /** Hours from "now" at which a rain spell starts (probability 85, 1.5 mm) and how long it lasts. */
  rainAt?: number;
  rainFor?: number;
}

const START = Date.UTC(2026, 10, 2, 0, 0); // yesterday 00:00 (local, but we treat the strings as plain local)
export const NOW_INDEX = 24 + 8; // hourly index of 2026-11-03T08:00

const sinDay = (h: number) => Math.max(0, Math.sin((Math.PI * (h - 6)) / 12));

export function makeForecast(o: ForecastOpts = {}): Forecast {
  const { prob = 10, code = 2, precip = 0, feels = 33, uv = 9, gusts = 20, yesterdayMax = 30.5, todayMax = 33.1, rainAt, rainFor = 2 } = o;
  const hours = Array.from({ length: 192 }, (_, i) => new Date(START + i * 3_600_000).toISOString().slice(0, 16));
  const days = Array.from({ length: 8 }, (_, i) => new Date(START + i * 86_400_000).toISOString().slice(0, 10));
  const hourOf = (i: number) => i % 24;
  const raining = (i: number) => rainAt !== undefined && i >= NOW_INDEX + rainAt && i < NOW_INDEX + rainAt + rainFor;
  return {
    timezone: "Asia/Kuala_Lumpur",
    current: {
      time: "2026-11-03T08:15",
      temperature_2m: 28.4,
      relative_humidity_2m: 78,
      apparent_temperature: feels,
      precipitation: precip,
      weather_code: code,
      cloud_cover: 60,
      pressure_msl: 1009.2,
      wind_speed_10m: 11.6,
      wind_direction_10m: 45,
      wind_gusts_10m: gusts,
      is_day: 1,
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 26 + 6 * sinDay(hourOf(i))),
      apparent_temperature: hours.map((_, i) => 30 + 6 * sinDay(hourOf(i))),
      precipitation_probability: hours.map((_, i) => (raining(i) ? 85 : prob)),
      precipitation: hours.map((_, i) => (raining(i) ? 1.5 : 0)),
      weather_code: hours.map((_, i) => (raining(i) ? 63 : code)),
      uv_index: hours.map((_, i) => uv * sinDay(hourOf(i)) ** 2),
      is_day: hours.map((_, i) => (hourOf(i) >= 7 && hourOf(i) < 19 ? 1 : 0)),
    },
    daily: {
      time: days,
      weather_code: days.map(() => code),
      temperature_2m_max: days.map((_, i) => (i === 0 ? yesterdayMax : todayMax)),
      temperature_2m_min: days.map(() => 25),
      apparent_temperature_max: days.map(() => 38),
      precipitation_probability_max: days.map(() => prob),
      precipitation_sum: days.map(() => 0),
      sunrise: days.map((d) => `${d}T07:01`),
      sunset: days.map((d) => `${d}T19:12`),
      uv_index_max: days.map(() => uv),
      wind_speed_10m_max: days.map(() => 18),
    },
  };
}

/** Modelled hourly AQI for 3 days from 2026-11-03T00:00: 60 at 08:00, peaking at 95 around 15:00, back to 60 by 22:00. */
export function makeAirHourly(scale = 1): AirHourly {
  const time = Array.from({ length: 72 }, (_, i) => new Date(Date.UTC(2026, 10, 3, 0, 0) + i * 3_600_000).toISOString().slice(0, 16));
  const us_aqi = time.map((_, i) => {
    const h = i % 24;
    return Math.round((60 + 35 * Math.max(0, Math.sin((Math.PI * (h - 8)) / 14))) * scale);
  });
  return { time, us_aqi };
}

export const MODEL_AQ: Air = { aqi: 62, pm25: 18.4, pm10: 30, source: "Open-Meteo (model)", station: null, km: null, dominant: null };
export const STATION_AQ: Air = { aqi: 112, pm25: 40, pm10: 55, source: "WAQI (measured)", station: "Cheras, Kuala Lumpur", km: 4.2, dominant: "PM2.5" };

export function makeReport(aq: Air | null = null, o: ForecastOpts & { aqHourly?: AirHourly | null; source?: Report["source"] } = {}): Report {
  return {
    place: { name: "Kuala Lumpur", lat: 3.139, lon: 101.687, country: "Malaysia", tz: "Asia/Kuala_Lumpur" },
    wx: makeForecast(o),
    aq,
    aqHourly: o.aqHourly === undefined ? (aq ? makeAirHourly() : null) : o.aqHourly,
    fetchedAt: Date.now(),
    source: o.source ?? "open-meteo",
  };
}

export function makeUser(o: Partial<User> = {}): User {
  return {
    chatId: 1,
    firstName: "Vince",
    username: "vince",
    status: "active",
    placeName: "Kuala Lumpur",
    lat: 3.139,
    lon: 101.6869,
    country: "Malaysia",
    tz: "Asia/Kuala_Lumpur",
    lang: "en",
    hidden: new Set(),
    dailyOn: true,
    dailyTime: "08:30",
    lastSent: "",
    searchJson: "",
    createdAt: "",
    tempUnit: "c",
    windUnit: "kmh",
    clock: "auto",
    compact: false,
    rainAlerts: false,
    aqiAlert: 0,
    aqiAlertActive: false,
    lastRainAlert: 0,
    lastAqiAlert: 0,
    lastAlertCheck: 0,
    eveningOn: false,
    eveningTime: "18:00",
    lastEvening: "",
    ...o,
  };
}

/** Prefs shorthand for tests: P("zh"), P("en", { tempUnit: "f" }). */
export const P = (lang: Prefs["lang"] = "en", o: Partial<Prefs> = {}): Prefs => ({ ...defaultPrefs(lang), ...o });
