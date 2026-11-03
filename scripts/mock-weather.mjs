/**
 * A controllable fake of every weather service the bot talks to, for the end-to-end test.
 * Times follow the REAL clock (Kuala Lumpur, UTC+8, or Tokyo, UTC+9 for longitudes >= 130),
 * so the Worker's real cron logic sees realistic "now / tomorrow / yesterday" data.
 *
 * Control it with:  GET /__set?rainSoon=1&aqi=130&forecastDown=1   (numbers/booleans are parsed)
 *                   GET /__state                                   (counters + current settings)
 */
import { readFileSync } from "node:fs";
import http from "node:http";

const SAMPLE = JSON.parse(readFileSync(new URL("../test/data/metno-kl.json", import.meta.url), "utf8"));

export const state = {
  forecastDown: false,
  metnoDown: false,
  rainSoon: false, // rain 1-2 hours from now (not raining yet)
  rainingNow: false,
  prob: 10, // base rain probability
  aqi: 62, // modelled AQI now
  stationAqi: null, // measured AQI (null = no WAQI station answer)
  todayMax: 33.1,
  yesterdayMax: 30.5,
};
export const counts = { forecast: 0, air: 0, geo: 0, reverse: 0, waqi: 0, metno: 0 };

const sinDay = (h) => Math.max(0, Math.sin((Math.PI * (h - 6)) / 12));
const offsetFor = (lon) => (lon >= 130 ? 9 : 8);
const tzFor = (lon) => (lon >= 130 ? "Asia/Tokyo" : "Asia/Kuala_Lumpur");

function localNow(offsetH) {
  return new Date(Date.now() + offsetH * 3_600_000); // a Date whose UTC fields are the local wall clock
}

function forecast(lat, lon) {
  const off = offsetFor(lon);
  const now = localNow(off);
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = midnight - 24 * 3_600_000; // yesterday 00:00 local
  const hours = Array.from({ length: 192 }, (_, i) => new Date(start + i * 3_600_000).toISOString().slice(0, 16));
  const days = Array.from({ length: 8 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  const nowIdx = 24 + now.getUTCHours();
  const rainy = (i) => (state.rainSoon && (i === nowIdx + 1 || i === nowIdx + 2)) || (state.rainingNow && i === nowIdx);
  return {
    timezone: tzFor(lon),
    current: {
      time: now.toISOString().slice(0, 16),
      temperature_2m: 28.4,
      relative_humidity_2m: 78,
      apparent_temperature: 33,
      precipitation: state.rainingNow ? 1.2 : 0,
      weather_code: state.rainingNow ? 63 : 2,
      cloud_cover: 60,
      pressure_msl: 1009.2,
      wind_speed_10m: 11.6,
      wind_direction_10m: 45,
      wind_gusts_10m: 20,
      is_day: now.getUTCHours() >= 7 && now.getUTCHours() < 19 ? 1 : 0,
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 26 + 6 * sinDay(i % 24)),
      apparent_temperature: hours.map((_, i) => 30 + 6 * sinDay(i % 24)),
      precipitation_probability: hours.map((_, i) => (rainy(i) ? 85 : state.prob)),
      precipitation: hours.map((_, i) => (rainy(i) ? 1.5 : 0)),
      weather_code: hours.map((_, i) => (rainy(i) ? 63 : 2)),
      uv_index: hours.map((_, i) => 9 * sinDay(i % 24) ** 2),
      is_day: hours.map((_, i) => ((i % 24) >= 7 && (i % 24) < 19 ? 1 : 0)),
    },
    daily: {
      time: days,
      weather_code: days.map(() => 2),
      temperature_2m_max: days.map((_, i) => (i === 0 ? state.yesterdayMax : state.todayMax)),
      temperature_2m_min: days.map(() => 25),
      apparent_temperature_max: days.map(() => 38),
      precipitation_probability_max: days.map(() => state.prob),
      precipitation_sum: days.map(() => 0),
      sunrise: days.map((d) => `${d}T07:01`),
      sunset: days.map((d) => `${d}T19:12`),
      uv_index_max: days.map(() => 9),
      wind_speed_10m_max: days.map(() => 18),
    },
  };
}

function air(lat, lon) {
  const off = offsetFor(lon);
  const now = localNow(off);
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const time = Array.from({ length: 72 }, (_, i) => new Date(midnight + i * 3_600_000).toISOString().slice(0, 16));
  const cur = now.getUTCHours();
  // flat, with a bump of +30 starting 3 hours from now -> the report should say "rising"
  const us_aqi = time.map((_, i) => state.aqi + (i >= cur + 3 && i <= cur + 5 ? 30 : 0));
  return { current: { us_aqi: state.aqi, pm2_5: 20, pm10: 30 }, hourly: { time, us_aqi } };
}

function metno() {
  const first = Date.parse(SAMPLE.properties.timeseries[0].time);
  const shift = Math.floor(Date.now() / 3_600_000) * 3_600_000 - first; // make the recorded data start at the current UTC hour
  const copy = JSON.parse(JSON.stringify(SAMPLE));
  for (const p of copy.properties.timeseries) p.time = new Date(Date.parse(p.time) + shift).toISOString().replace(".000Z", "Z");
  return copy;
}

const GEO = {
  ipoh: { name: "Ipoh", latitude: 4.5975, longitude: 101.0901, country: "Malaysia", country_code: "MY", admin1: "Perak", timezone: "Asia/Kuala_Lumpur" },
  tokyo: { name: "Tokyo", latitude: 35.6762, longitude: 139.6503, country: "Japan", country_code: "JP", admin1: "Tokyo", timezone: "Asia/Tokyo" },
  penang: { name: "George Town", latitude: 5.4141, longitude: 100.3288, country: "Malaysia", country_code: "MY", admin1: "Penang", timezone: "Asia/Kuala_Lumpur" },
};
const ZH = { Ipoh: ["怡保", "霹雳", "马来西亚"], Tokyo: ["東京", "东京都", "日本"], "George Town": ["乔治市", "槟城", "马来西亚"] };

function geo(name, language) {
  const key = { 怡保: "ipoh", 東京: "tokyo", 东京: "tokyo" }[name] ?? name.toLowerCase();
  const hit = GEO[key];
  if (!hit) return { results: [] };
  const r = { ...hit };
  if (language === "zh" && ZH[r.name]) [r.name, r.admin1, r.country] = ZH[r.name];
  return { results: [r] };
}

export function startMockWeather(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const q = Object.fromEntries(url.searchParams);
    const send = (body, status = 200) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    const lat = Number(q.latitude ?? q.lat ?? 3.139);
    const lon = Number(q.longitude ?? q.lon ?? 101.687);

    if (url.pathname === "/__set") {
      for (const [k, v] of Object.entries(q)) state[k] = v === "null" ? null : v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : isNaN(Number(v)) ? v : Number(v);
      return send({ ok: true, state });
    }
    if (url.pathname === "/__state") return send({ state, counts });

    if (url.pathname === "/forecast") {
      counts.forecast++;
      return state.forecastDown ? send({ error: true, reason: "down" }, 503) : send(forecast(lat, lon));
    }
    if (url.pathname === "/air") {
      counts.air++;
      return send(air(lat, lon));
    }
    if (url.pathname === "/geo") {
      counts.geo++;
      return send(geo(q.name ?? "", q.language));
    }
    if (url.pathname === "/reverse") {
      counts.reverse++;
      return send({ address: { suburb: "Bukit Bintang", city: "Kuala Lumpur", state: "Wilayah Persekutuan", country: "Malaysia" } });
    }
    if (url.pathname.startsWith("/waqi/")) {
      counts.waqi++;
      if (state.stationAqi === null) return send({ status: "error", data: "Unknown station" });
      const [, glat, glon] = /geo:([-\d.]+);([-\d.]+)/.exec(url.pathname) ?? [];
      return send({
        status: "ok",
        data: { aqi: state.stationAqi, city: { name: "Cheras, Kuala Lumpur", geo: [Number(glat) + 0.02, Number(glon)] }, time: { iso: new Date().toISOString() }, dominentpol: "pm25" },
      });
    }
    if (url.pathname === "/metno") {
      counts.metno++;
      return state.metnoDown ? send({ error: true }, 503) : send(metno());
    }
    send({ error: "not found" }, 404);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
