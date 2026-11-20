/**
 * Synthetic reports for the mini app's preview mode (FR-11): /app/?demo=sunny|cloudy|rainy|windy|storm|night
 *
 * Nothing here is real weather and nothing is fetched. The page labels it "Demo data".
 * The numbers are shaped like a Kuala Lumpur day so every card has something sensible to show.
 */
import { addDays, addHours } from "./insights";
import { presetPlace } from "./presets";
import type { Air, AirHourly, Forecast, Lang, Report } from "./types";
import { localParts } from "./util";
import type { IpuReading } from "./ipu";
import { warningId, type State, type Warning } from "./warnings";

export const DEMO_SCENES = ["sunny", "cloudy", "rainy", "windy", "storm", "night", "haze"] as const;
export type DemoScene = (typeof DEMO_SCENES)[number];

export const isDemoScene = (s: string | null): s is DemoScene => (DEMO_SCENES as readonly string[]).includes(s ?? "");

interface Spec {
  hour: number; // local hour the scene is set at
  code: number; // WMO weather code now
  temp: number;
  feels: number;
  wind: number; // km/h
  gusts: number;
  cloud: number;
  precip: number;
  prob: number; // chance of rain for the next few hours
  humidity: number;
  aqi: number;
  measured?: boolean; // show the air reading as coming from a monitoring station
}

const SPECS: Record<DemoScene, Spec> = {
  sunny: { hour: 13, code: 0, temp: 33, feels: 38, wind: 9, gusts: 16, cloud: 8, precip: 0, prob: 10, humidity: 58, aqi: 48 },
  cloudy: { hour: 10, code: 3, temp: 28, feels: 31, wind: 8, gusts: 15, cloud: 96, precip: 0, prob: 35, humidity: 80, aqi: 74 },
  rainy: { hour: 16, code: 63, temp: 25, feels: 27, wind: 14, gusts: 28, cloud: 100, precip: 2.4, prob: 90, humidity: 93, aqi: 38 },
  windy: { hour: 15, code: 2, temp: 29, feels: 30, wind: 34, gusts: 56, cloud: 45, precip: 0, prob: 15, humidity: 66, aqi: 55 },
  storm: { hour: 17, code: 95, temp: 24, feels: 26, wind: 22, gusts: 48, cloud: 100, precip: 6.5, prob: 95, humidity: 95, aqi: 112, measured: true },
  night: { hour: 21, code: 0, temp: 26, feels: 29, wind: 6, gusts: 11, cloud: 5, precip: 0, prob: 5, humidity: 84, aqi: 62 },
  haze: { hour: 11, code: 1, temp: 32, feels: 36, wind: 5, gusts: 9, cloud: 20, precip: 0, prob: 5, humidity: 62, aqi: 168, measured: true },
};

/** What the days after today look like (a typical mixed week). */
const NEXT_DAYS = [2, 80, 3, 95, 1, 63];
const WET = new Set([61, 63, 65, 80, 81, 82, 95, 96, 99]);

const sinDay = (h: number) => Math.max(0, Math.sin((Math.PI * (h - 6)) / 12));
const pad = (n: number) => String(n).padStart(2, "0");

export function demoReport(scene: DemoScene, lang: Lang = "en", now = new Date()): { report: Report; warnings: Warning[]; state: State; ipu: IpuReading } {
  const s = SPECS[scene];
  const place = presetPlace(0, lang); // Kuala Lumpur
  const today = localParts(place.tz, now).date;
  const nowIso = `${today}T${pad(s.hour)}:20`;
  const start = `${addDays(today, -1)}T00:00`; // yesterday 00:00, like the real API (past_days=1)
  const hours = Array.from({ length: 192 }, (_, i) => addHours(start, i));
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i - 1));
  const nowIdx = 24 + s.hour;

  const dayCode = (d: number) => (d <= 1 ? s.code : NEXT_DAYS[(d - 2) % NEXT_DAYS.length]);
  const offset = s.temp - (25 + 7 * sinDay(s.hour)); // shift the daily curve so "now" matches the scene
  const near = (i: number) => i >= nowIdx && i < nowIdx + 3;
  const codeAt = (i: number) => {
    const h = i % 24;
    const d = Math.floor(i / 24);
    if (near(i)) return s.code;
    if (d > 1 && WET.has(dayCode(d)) && h >= 14 && h <= 18) return dayCode(d); // afternoon showers on the wet days
    return d > 1 && dayCode(d) === 3 ? 3 : h >= 9 && h <= 17 ? 2 : 1;
  };
  const probAt = (i: number) => (near(i) ? s.prob : WET.has(codeAt(i)) ? 75 : 12);
  const temps = hours.map((_, i) => Math.round((25 + 7 * sinDay(i % 24) + offset) * 10) / 10);
  const ofDay = (d: number, arr: number[]) => arr.slice(d * 24, d * 24 + 24);

  const wx: Forecast = {
    timezone: place.tz,
    current: {
      time: nowIso,
      temperature_2m: s.temp,
      relative_humidity_2m: s.humidity,
      apparent_temperature: s.feels,
      precipitation: s.precip,
      weather_code: s.code,
      cloud_cover: s.cloud,
      pressure_msl: 1009,
      wind_speed_10m: s.wind,
      wind_direction_10m: 225,
      wind_gusts_10m: s.gusts,
      is_day: s.hour >= 7 && s.hour < 19 ? 1 : 0,
    },
    hourly: {
      time: hours,
      temperature_2m: temps,
      apparent_temperature: temps.map((v) => v + (s.feels - s.temp)),
      precipitation_probability: hours.map((_, i) => probAt(i)),
      precipitation: hours.map((_, i) => (near(i) ? s.precip : WET.has(codeAt(i)) ? 1.8 : 0)),
      weather_code: hours.map((_, i) => codeAt(i)),
      uv_index: hours.map((_, i) => Math.round(10 * sinDay(i % 24) ** 2 * (s.cloud > 80 ? 0.5 : 1) * 10) / 10),
      is_day: hours.map((_, i) => (i % 24 >= 7 && i % 24 < 19 ? 1 : 0)),
    },
    daily: {
      time: days,
      weather_code: days.map((_, d) => dayCode(d)),
      // yesterday was a little cooler on the sunny day, so the "warmer than yesterday" line has something to say
      temperature_2m_max: days.map((_, d) => Math.max(...ofDay(d, temps)) - (d === 0 && scene === "sunny" ? 3 : 0)),
      temperature_2m_min: days.map((_, d) => Math.min(...ofDay(d, temps))),
      apparent_temperature_max: days.map((_, d) => Math.max(...ofDay(d, temps)) + (s.feels - s.temp)),
      precipitation_probability_max: days.map((_, d) => (d <= 1 ? s.prob : WET.has(dayCode(d)) ? 75 : 12)),
      precipitation_sum: days.map((_, d) => (d <= 1 ? s.precip * 3 : WET.has(dayCode(d)) ? 9 : 0)),
      sunrise: days.map((d) => `${d}T07:01`),
      sunset: days.map((d) => `${d}T19:12`),
      uv_index_max: days.map((_, d) => (WET.has(dayCode(d)) || dayCode(d) === 3 ? 6 : 10)),
      wind_speed_10m_max: days.map((_, d) => (d <= 1 ? Math.max(s.wind, s.gusts * 0.6) : 16)),
    },
  };

  const aq: Air = {
    aqi: s.aqi,
    pm25: Math.round(s.aqi * 0.3),
    pm10: Math.round(s.aqi * 0.5),
    source: s.measured ? "WAQI (measured)" : "Open-Meteo (model)",
    station: s.measured ? "Cheras, Kuala Lumpur" : null,
    km: s.measured ? 4.2 : null,
    dominant: s.measured ? "PM2.5" : null,
  };
  const airTimes = Array.from({ length: 72 }, (_, i) => addHours(`${today}T00:00`, i));
  const aqHourly: AirHourly = {
    time: airTimes,
    // flat, with a bump a few hours from now so the outlook line reads "rising"
    us_aqi: airTimes.map((_, i) => s.aqi + (i >= s.hour + 3 && i <= s.hour + 5 ? 18 : 0)),
  };

  const warnings: Warning[] = [];
  if (scene === "storm") {
    const issued = addHours(nowIso, -1);
    warnings.push({
      id: warningId(issued, "Thunderstorms Warning"),
      issued,
      from: issued,
      to: addHours(nowIso, 3),
      titleEn: "Thunderstorms Warning",
      titleBm: "Amaran Ribut Petir",
      textEn: "Thunderstorms, heavy rain and strong winds are expected over the states of Selangor (Petaling, Klang) • Kuala Lumpur until later this evening.",
      textBm: "Ribut petir, hujan lebat dan angin kencang dijangka di negeri Selangor (Petaling, Klang) • Kuala Lumpur sehingga lewat petang ini.",
      instructionEn: "Stay away from open areas and tall trees.",
      instructionBm: "Jauhi kawasan terbuka dan pokok tinggi.",
      kind: "land",
    });
  }

  // a made-up official reading from a nearby station, so the IPU block can be reviewed too
  const ipu: IpuReading = { name: "Cheras", lat: 3.1063, lon: 101.7179, value: Math.max(12, Math.round(s.aqi * 0.85)), time: `${today}T${pad(s.hour)}:00`, km: 4.2 };
  return { report: { place, wx, aq, aqHourly, fetchedAt: now.getTime(), source: "open-meteo" }, warnings, state: "Kuala Lumpur", ipu };
}
