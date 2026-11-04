/**
 * Checks against the REAL services. Skipped unless LIVE=1 (needs internet; slower; results change daily):
 *     LIVE=1 npx vitest run test/live.test.ts
 */
import { describe, expect, it } from "vitest";
import { hourlyMessage, tomorrowMessage, weatherMessage, weekMessage } from "../src/format";
import { bestOutside, dailyIndex, hourIndex } from "../src/insights";
import { convertMetNo, sunTimes, type MetNoResponse } from "../src/metno";
import type { Place, Report } from "../src/types";
import { WeatherService } from "../src/weather";
import { canonicalState, currentLandWarnings, nowMalaysia } from "../src/warnings";
import { warningMessage, warningsListMessage } from "../src/format";
import { P } from "./fixtures";

const LIVE = process.env.LIVE === "1";
const UA = "skybrief-telegram-bot/2.1 github.com/VincentTeo1116/skybrief-telegram-bot";

const CITIES: Place[] = [
  { name: "Kuala Lumpur", lat: 3.139, lon: 101.6869, country: "Malaysia", tz: "Asia/Kuala_Lumpur" },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503, country: "Japan", tz: "Asia/Tokyo" },
  { name: "London", lat: 51.5074, lon: -0.1278, country: "UK", tz: "Europe/London" },
  { name: "Sydney", lat: -33.8688, lon: 151.2093, country: "Australia", tz: "Australia/Sydney" },
  { name: "New York", lat: 40.7128, lon: -74.006, country: "USA", tz: "America/New_York" },
  { name: "Delhi", lat: 28.6139, lon: 77.209, country: "India", tz: "Asia/Kolkata" }, // UTC+5:30
  { name: "Auckland", lat: -36.8485, lon: 174.7633, country: "NZ", tz: "Pacific/Auckland" }, // UTC+13: local day != UTC day
  { name: "Honolulu", lat: 21.3069, lon: -157.8583, country: "USA", tz: "Pacific/Honolulu" },
  { name: "Reykjavik", lat: 64.1466, lon: -21.9426, country: "Iceland", tz: "Atlantic/Reykjavik" },
];

const minutes = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const clean = (text: string) => expect(text).not.toMatch(/undefined|NaN|null|\[object/);

describe.skipIf(!LIVE)("live data", () => {
  it(
    "the Open-Meteo response has everything the bot reads, and every view renders from it",
    async () => {
      const svc = new WeatherService(process.env.WAQI_TOKEN);
      for (const place of CITIES.slice(0, 4)) {
        const r = await svc.fetchReport(place, true);
        expect(r.source, place.name).toBe("open-meteo");
        expect(r.wx.daily.time.length, place.name).toBe(8); // yesterday + today + 6
        expect(dailyIndex(r), place.name).toBe(1);
        expect(r.wx.hourly.time).toContain(r.wx.current.time.slice(0, 13) + ":00");
        expect(r.wx.hourly.uv_index?.length).toBe(r.wx.hourly.time.length);
        expect(r.aqHourly?.time.length, place.name).toBeGreaterThan(24);
        for (const lang of ["en", "ms", "zh"] as const) {
          for (const text of [
            weatherMessage(r, P(lang)),
            weatherMessage(r, P(lang, { compact: true, tempUnit: "f", windUnit: "mph", clock: "24" })),
            hourlyMessage(r, P(lang)),
            tomorrowMessage(r, P(lang)),
            weekMessage(r, P(lang)),
          ]) {
            clean(text);
            expect(text.length).toBeLessThan(4096);
          }
        }
        expect(() => bestOutside(r)).not.toThrow();
      }
    },
    60_000,
  );

  it(
    "my sunrise/sunset maths agrees with Open-Meteo in every timezone (within a few minutes)",
    async () => {
      const svc = new WeatherService();
      for (const place of CITIES) {
        const r = await svc.fetchReport(place, true);
        const di = dailyIndex(r);
        const date = r.wx.daily.time[di];
        const mine = sunTimes(place.lat, place.lon, date, place.tz);
        const tolerance = Math.abs(place.lat) > 50 ? 7 : 4;
        expect(mine.sunrise.slice(0, 10), `${place.name} sunrise date`).toBe(date);
        expect(mine.sunset.slice(0, 10), `${place.name} sunset date`).toBe(date);
        const dRise = Math.abs(minutes(mine.sunrise) - minutes(r.wx.daily.sunrise[di]));
        const dSet = Math.abs(minutes(mine.sunset) - minutes(r.wx.daily.sunset[di]));
        expect(dRise, `${place.name} sunrise ${mine.sunrise} vs ${r.wx.daily.sunrise[di]}`).toBeLessThanOrEqual(tolerance);
        expect(dSet, `${place.name} sunset ${mine.sunset} vs ${r.wx.daily.sunset[di]}`).toBeLessThanOrEqual(tolerance);
      }
    },
    90_000,
  );

  it(
    "the MET Norway backup, converted, agrees with Open-Meteo and renders in every view",
    async () => {
      const svc = new WeatherService();
      for (const place of CITIES) {
        const om = await svc.fetchReport(place, true);
        const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}`, {
          headers: { "User-Agent": UA },
        });
        expect(res.status, place.name).toBe(200);
        const wx = convertMetNo((await res.json()) as MetNoResponse, place);
        const backup: Report = { place, wx, aq: null, aqHourly: null, fetchedAt: Date.now(), source: "met-no" };

        // same moment, same place -> the two models should be in the same ballpark
        expect(Math.abs(wx.current.temperature_2m - om.wx.current.temperature_2m), `${place.name} temperature`).toBeLessThan(6);
        expect(Math.abs(minutes(wx.current.time) - minutes(om.wx.current.time)) % 1440, `${place.name} local time`).toBeLessThanOrEqual(75);
        expect(wx.current.time.slice(0, 10), `${place.name} date`).toBe(om.wx.current.time.slice(0, 10));
        expect(wx.daily.time[0], place.name).toBe(om.wx.current.time.slice(0, 10));
        const i = dailyIndex(om);
        expect(Math.abs((wx.daily.temperature_2m_max[0] ?? 0) - (om.wx.daily.temperature_2m_max[i] ?? 0)), `${place.name} daily high`).toBeLessThan(6);
        expect(hourIndex(backup), place.name).toBe(0);

        for (const lang of ["en", "ms", "zh"] as const) {
          for (const text of [weatherMessage(backup, P(lang)), hourlyMessage(backup, P(lang)), tomorrowMessage(backup, P(lang)), weekMessage(backup, P(lang))]) {
            clean(text);
            expect(text.length, place.name).toBeLessThan(4096);
          }
        }
      }
    },
    120_000,
  );

  it(
    "the service falls back to MET Norway by itself when Open-Meteo is unreachable",
    async () => {
      const svc = new WeatherService(undefined, { forecast: "http://127.0.0.1:9/never" }); // nothing listens on port 9
      const r = await svc.fetchReport(CITIES[0], true);
      expect(r.source).toBe("met-no");
      clean(weatherMessage(r, P()));
    },
    60_000,
  );
});

describe.skipIf(!(LIVE && process.env.WAQI_TOKEN))("live WAQI", () => {
  it("returns a measured reading for Kuala Lumpur", async () => {
    const r = await new WeatherService(process.env.WAQI_TOKEN).fetchReport(CITIES[0], true);
    expect(r.aq?.source).toBe("WAQI (measured)");
    expect(r.aq!.km!).toBeLessThan(40);
  });
});

describe.skipIf(!LIVE)("live MetMalaysia warnings", () => {
  it(
    "the real feed parses, and every warning in it renders for every state in every language",
    async () => {
      const all = await new WeatherService().warnings(true);
      expect(all.length).toBeGreaterThan(0); // the feed always has at least "No Advisory"
      const now = new Date();
      const nowLocal = nowMalaysia(now);
      const states = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu", "Kuala Lumpur", "Putrajaya", "Labuan"] as const;
      for (const w of all.filter((x) => x.kind === "land" && x.from && x.to)) {
        for (const state of states) {
          for (const lang of ["en", "ms", "zh"] as const) {
            const text = warningMessage(w, state, P(lang), nowLocal);
            expect(text.length, `${w.titleEn} / ${state} / ${lang}`).toBeLessThan(2000);
            clean(text);
          }
        }
      }
      for (const state of states) clean(warningsListMessage(currentLandWarnings(all, now), state, 0, P("en"), nowLocal));
      for (const w of all) expect(["land", "sea", "none"]).toContain(w.kind);
      expect(canonicalState("Wilayah Persekutuan Kuala Lumpur")).toBe("Kuala Lumpur");
    },
    60_000,
  );
});
