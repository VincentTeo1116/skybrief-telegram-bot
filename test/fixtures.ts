import type { Air, Forecast, Report, User } from "../src/types";

/** A deterministic forecast: Tue 3 Nov 2026, 08:15 local in Kuala Lumpur. */
export function makeForecast(o: { prob?: number | null; code?: number; precip?: number; feels?: number; uv?: number; gusts?: number } = {}): Forecast {
  const { prob = 10, code = 2, precip = 0, feels = 33, uv = 9, gusts = 20 } = o;
  const hours = Array.from({ length: 96 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10, 3, 0, 0) + i * 3_600_000);
    return d.toISOString().slice(0, 16);
  });
  const days = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
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
      temperature_2m: hours.map(() => 27),
      precipitation_probability: hours.map(() => prob),
      weather_code: hours.map(() => code),
    },
    daily: {
      time: days,
      weather_code: days.map(() => code),
      temperature_2m_max: days.map(() => 33.1),
      temperature_2m_min: days.map(() => 25),
      precipitation_probability_max: days.map(() => prob),
      sunrise: days.map((d) => `${d}T07:01`),
      sunset: days.map((d) => `${d}T19:12`),
      uv_index_max: days.map(() => uv),
    },
  };
}

export const MODEL_AQ: Air = { aqi: 62, pm25: 18.4, pm10: 30, source: "Open-Meteo (model)", station: null, km: null, dominant: null };
export const STATION_AQ: Air = { aqi: 112, pm25: 40, pm10: 55, source: "WAQI (measured)", station: "Cheras, Kuala Lumpur", km: 4.2, dominant: "PM2.5" };

export function makeReport(aq: Air | null = null, o: Parameters<typeof makeForecast>[0] = {}): Report {
  return {
    place: { name: "Kuala Lumpur", lat: 3.139, lon: 101.687, country: "Malaysia", tz: "Asia/Kuala_Lumpur" },
    wx: makeForecast(o),
    aq,
    fetchedAt: Date.now(),
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
    ...o,
  };
}
