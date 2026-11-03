import { describe, expect, it } from "vitest";
import { hourlyMessage, tomorrowMessage, weatherMessage, weekMessage } from "../src/format";
import { bestOutside, dailyIndex, hourIndex, trend } from "../src/insights";
import { apparentTemp, convertMetNo, isDaySymbol, probFromAmount, sunTimes, symbolToWmo, type MetNoResponse } from "../src/metno";
import type { Place, Report } from "../src/types";
import sample from "./data/metno-kl.json";
import { P } from "./fixtures";

const KL: Place = { name: "Kuala Lumpur", lat: 3.139, lon: 101.6869, country: "Malaysia", tz: "Asia/Kuala_Lumpur" };
const data = sample as unknown as MetNoResponse; // a real response recorded on 2026-11-03

const asReport = (wx: ReturnType<typeof convertMetNo>, place = KL): Report => ({ place, wx, aq: null, aqHourly: null, fetchedAt: 0, source: "met-no" });

describe("symbol mapping", () => {
  it("maps MET Norway symbols to the WMO codes the bot understands", () => {
    const cases: Record<string, number> = {
      clearsky_day: 0,
      fair_night: 1,
      partlycloudy_day: 2,
      cloudy: 3,
      fog: 45,
      lightrain: 61,
      rain: 63,
      heavyrain: 65,
      lightrainshowers_day: 80,
      rainshowers_night: 81,
      heavyrainshowers_day: 82,
      rainandthunder: 95,
      heavyrainandthunder: 99,
      lightrainshowersandthunder_day: 95,
      lightssleetshowersandthunder_day: 95, // the source really spells it "lightss…"
      sleet: 67,
      snow: 73,
      heavysnow: 75,
    };
    for (const [symbol, code] of Object.entries(cases)) expect(symbolToWmo(symbol), symbol).toBe(code);
  });

  it("returns null for unknown or missing symbols", () => {
    expect(symbolToWmo("somethingnew")).toBeNull();
    expect(symbolToWmo(undefined)).toBeNull();
  });

  it("reads day / night from the symbol suffix", () => {
    expect(isDaySymbol("rain_day")).toBe(true);
    expect(isDaySymbol("rain_night")).toBe(false);
    expect(isDaySymbol("rain")).toBeNull();
    expect(isDaySymbol(undefined)).toBeNull();
  });

  it("estimates rain probability from the forecast amount", () => {
    expect([0, 0.05, 0.2, 0.5, 1, 5].map(probFromAmount)).toEqual([0, 25, 55, 75, 90, 90]);
    expect(probFromAmount(undefined)).toBe(0);
  });

  it("computes apparent temperature sensibly", () => {
    expect(apparentTemp(32, 60, 2)).toBeCloseTo(36, 0); // hot and humid feels hotter
    expect(apparentTemp(20, 50, 0)).toBeLessThan(21);
    expect(apparentTemp(30, 60, 8)).toBeLessThan(apparentTemp(30, 60, 0)); // wind cools
  });
});

describe("sunrise and sunset", () => {
  const minutes = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

  it("matches the known times for Kuala Lumpur (06:56 / 18:56 on 3 Nov 2026) within a few minutes", () => {
    const s = sunTimes(3.139, 101.6869, "2026-11-03", "Asia/Kuala_Lumpur");
    expect(s.sunrise.slice(0, 10)).toBe("2026-11-03");
    expect(Math.abs(minutes(s.sunrise) - (6 * 60 + 56))).toBeLessThanOrEqual(4);
    expect(Math.abs(minutes(s.sunset) - (18 * 60 + 56))).toBeLessThanOrEqual(4);
  });

  it("always lands on the requested local date, even where UTC is a different day", () => {
    // Auckland (UTC+13 in November): local sunrise is the previous day in UTC
    const s = sunTimes(-36.85, 174.76, "2026-11-03", "Pacific/Auckland");
    expect(s.sunrise.slice(0, 10)).toBe("2026-11-03");
    expect(s.sunset.slice(0, 10)).toBe("2026-11-03");
    expect(minutes(s.sunrise)).toBeGreaterThan(5 * 60);
    expect(minutes(s.sunrise)).toBeLessThan(7 * 60);
  });

  it("gives sensible fallbacks in polar night / midnight sun instead of failing", () => {
    expect(sunTimes(69.65, 18.96, "2026-12-21", "Europe/Oslo")).toEqual({ sunrise: "2026-12-21T06:00", sunset: "2026-12-21T18:00" });
    expect(sunTimes(69.65, 18.96, "2026-06-21", "Europe/Oslo")).toEqual({ sunrise: "2026-06-21T06:00", sunset: "2026-06-21T18:00" });
  });
});

describe("converting a real MET Norway response", () => {
  const wx = convertMetNo(data, KL);

  it("converts the current conditions (UTC -> local, m/s -> km/h)", () => {
    const first = data.properties.timeseries[0];
    expect(first.time).toBe("2026-11-03T08:00:00Z");
    expect(wx.timezone).toBe("Asia/Kuala_Lumpur");
    expect(wx.current.time).toBe("2026-11-03T16:00");
    expect(wx.current.temperature_2m).toBe(first.data.instant.details.air_temperature);
    expect(wx.current.wind_speed_10m).toBeCloseTo((first.data.instant.details.wind_speed ?? 0) * 3.6, 5);
    expect(wx.current.relative_humidity_2m).toBe(first.data.instant.details.relative_humidity);
    expect(wx.current.pressure_msl).toBe(first.data.instant.details.air_pressure_at_sea_level);
    expect(wx.current.apparent_temperature).toBe(first.data.instant.details.apparent_air_temperature);
    expect(wx.current.weather_code).not.toBeNull();
    expect(wx.current.wind_gusts_10m).toBeNull(); // not provided by this source
    expect([0, 1]).toContain(wx.current.is_day);
  });

  it("builds a contiguous hourly series for the first ~2.5 days", () => {
    const h = wx.hourly;
    expect(h.time.length).toBeGreaterThanOrEqual(60);
    expect(h.time.length).toBeLessThanOrEqual(70);
    for (let i = 1; i < h.time.length; i++) {
      const gap = (Date.parse(h.time[i] + ":00Z") - Date.parse(h.time[i - 1] + ":00Z")) / 3_600_000;
      expect(gap, `gap at ${h.time[i]}`).toBe(1);
    }
    for (const key of ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "weather_code", "uv_index", "is_day"] as const) {
      expect(h[key]!.length, key).toBe(h.time.length);
    }
    expect(h.time.every((t) => /^\d{4}-\d\d-\d\dT\d\d:00$/.test(t))).toBe(true);
    expect(h.precipitation_probability.every((p) => [0, 25, 55, 75, 90].includes(p as number))).toBe(true);
  });

  it("builds daily summaries from both the hourly and the 6-hourly parts", () => {
    const d = wx.daily;
    expect(d.time[0]).toBe("2026-11-03");
    expect(d.time.length).toBeGreaterThanOrEqual(4);
    expect([...d.time].sort()).toEqual(d.time);
    expect(new Set(d.time).size).toBe(d.time.length);
    for (const key of Object.keys(d) as (keyof typeof d)[]) expect(d[key]!.length, key).toBe(d.time.length);
    d.time.forEach((_, i) => {
      expect(d.temperature_2m_max[i]!).toBeGreaterThanOrEqual(d.temperature_2m_min[i]!);
      expect(d.temperature_2m_max[i]!).toBeGreaterThan(20);
      expect(d.temperature_2m_max[i]!).toBeLessThan(40);
      expect(d.sunrise[i].startsWith(d.time[i])).toBe(true);
      expect(d.sunset[i].startsWith(d.time[i])).toBe(true);
    });
  });

  it("lines up with the helpers the formatter relies on", () => {
    const r = asReport(wx);
    expect(dailyIndex(r)).toBe(0); // no "yesterday" from this source
    expect(hourIndex(r)).toBe(0);
    expect(trend(r)).toBeNull();
    expect(() => bestOutside(r)).not.toThrow();
  });

  it("produces complete, valid reports in every view and language", () => {
    const r = asReport(wx);
    for (const lang of ["en", "ms", "zh"] as const) {
      for (const compact of [false, true]) {
        const text = weatherMessage(r, P(lang, { compact }));
        expect(text.length).toBeGreaterThan(80);
        expect(text.length).toBeLessThan(4096);
        expect(text).not.toMatch(/undefined|NaN|null/);
      }
      for (const text of [hourlyMessage(r, P(lang)), tomorrowMessage(r, P(lang)), weekMessage(r, P(lang))]) {
        expect(text.length).toBeLessThan(4096);
        expect(text).not.toMatch(/undefined|NaN|null/);
      }
    }
    expect(weatherMessage(r, P())).toContain("MET Norway (backup source)");
  });

  it("handles half-hour timezones (the hourly labels stay on the hour so lookups work)", () => {
    const india = convertMetNo(data, { ...KL, name: "Delhi", tz: "Asia/Kolkata" });
    expect(india.current.time).toBe("2026-11-03T13:30");
    expect(india.hourly.time[0]).toBe("2026-11-03T13:00");
    const r = asReport(india, { ...KL, tz: "Asia/Kolkata" });
    expect(hourIndex(r)).toBe(0);
    expect(() => weatherMessage(r, P())).not.toThrow();
  });

  it("rejects unusable responses with a clear error", () => {
    expect(() => convertMetNo({ properties: { timeseries: [] } }, KL)).toThrow(/no data/);
    expect(() => convertMetNo({} as MetNoResponse, KL)).toThrow(/no data/);
    const broken = JSON.parse(JSON.stringify(data)) as MetNoResponse;
    delete broken.properties.timeseries[0].data.instant.details.air_temperature;
    expect(() => convertMetNo(broken, KL)).toThrow(/temperature/);
  });

  it("estimates apparent temperature when the source doesn't supply it", () => {
    const copy = JSON.parse(JSON.stringify(data)) as MetNoResponse;
    delete copy.properties.timeseries[0].data.instant.details.apparent_air_temperature;
    const c = convertMetNo(copy, KL).current;
    expect(c.apparent_temperature).toBeGreaterThan(c.temperature_2m - 8);
    expect(Number.isFinite(c.apparent_temperature)).toBe(true);
  });

  it("stays cheap enough for the free plan (≈10 ms CPU per request): a regression guard", () => {
    for (let i = 0; i < 5; i++) convertMetNo(data, KL); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) convertMetNo(data, KL);
    const perRun = (performance.now() - t0) / 20;
    // measured ≈1.3 ms; it was ≈49 ms when a new Intl.DateTimeFormat was created per data point
    expect(perRun).toBeLessThan(10);
  });
});
