import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetNoResponse } from "../src/metno";
import type { Place } from "../src/types";
import { WeatherError, WeatherService, clearWarningsCache } from "../src/weather";
import warningsFeed from "./data/mmd-warnings.json";
import sample from "./data/metno-kl.json";
import { makeAirHourly, makeForecast } from "./fixtures";

// Each test uses a different coordinate so the module-level cache can't leak between tests.
let n = 0;
const fresh = (o: Partial<Place> = {}): Place => ({ name: "Test", lat: 10 + ++n * 0.1, lon: 100, country: "X", tz: "Asia/Kuala_Lumpur", ...o });

interface Call {
  url: string;
  headers: Record<string, string>;
}
let calls: Call[];
let handler: (url: string) => Response | Promise<Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OK_AIR = { current: { us_aqi: 62, pm2_5: 18.4, pm10: 30 }, hourly: makeAirHourly() };
const waqi = (o: Record<string, unknown> = {}, lat = 3.14, lon = 101.69) => ({
  status: "ok",
  data: { aqi: 78, city: { name: "Kuala Lumpur", geo: [lat, lon] }, time: { iso: new Date().toISOString() }, dominentpol: "pm25", ...o },
});

/** Default network: everything healthy. Individual tests override pieces. */
function healthy(url: string): Response {
  if (url.includes("//api.open-meteo.com/")) return json(makeForecast());
  if (url.includes("air-quality-api")) return json(OK_AIR);
  if (url.includes("api.waqi.info")) return json(waqi());
  if (url.includes("api.met.no")) return json(sample);
  if (url.includes("geocoding-api")) return json({ results: [] });
  if (url.includes("api.data.gov.my")) return json(warningsFeed);
  return new Response("not mocked", { status: 404 });
}

beforeEach(() => {
  calls = [];
  handler = healthy;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
      return handler(String(input));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const hits = (needle: string) => calls.filter((c) => c.url.includes(needle));

describe("normal operation", () => {
  it("asks for yesterday, 7 days, the hourly fields we use, and the hourly air forecast", async () => {
    const r = await new WeatherService().fetchReport(fresh());
    expect(r.source).toBe("open-meteo");
    const f = hits("//api.open-meteo.com/")[0].url;
    expect(f).toContain("past_days=1");
    expect(f).toContain("forecast_days=7");
    expect(f).toContain("uv_index");
    expect(f).toContain("apparent_temperature");
    expect(f).toContain("timezone=auto");
    expect(hits("air-quality-api")[0].url).toContain("hourly=us_aqi");
    expect(r.aq).toMatchObject({ aqi: 62, source: "Open-Meteo (model)", station: null });
    expect(r.aqHourly!.time).toHaveLength(72);
    expect(r.wx.daily.time).toHaveLength(8);
  });

  it("sends an identifying User-Agent", async () => {
    await new WeatherService().fetchReport(fresh());
    expect(calls[0].headers["User-Agent"]).toMatch(/^skybrief-telegram-bot\/.* github\.com\//);
    expect(calls[0].headers["User-Agent"]).not.toMatch(/@/); // never an email address
  });

  it("serves repeat requests from a 5-minute cache, and force bypasses it", async () => {
    const svc = new WeatherService();
    const place = fresh();
    await svc.fetchReport(place);
    const first = calls.length;
    await svc.fetchReport(place);
    expect(calls.length).toBe(first);
    await svc.fetchReport(place, true);
    expect(calls.length).toBeGreaterThan(first);
  });

  it("recovers from a single failed request by retrying", async () => {
    let attempts = 0;
    handler = (url) => (url.includes("//api.open-meteo.com/") && ++attempts === 1 ? new Response("boom", { status: 502 }) : healthy(url));
    const r = await new WeatherService().fetchReport(fresh());
    expect(r.source).toBe("open-meteo");
    expect(attempts).toBe(2);
    expect(hits("api.met.no")).toHaveLength(0); // never needed the backup
  });
});

describe("measured air quality (WAQI)", () => {
  it("prefers a nearby fresh station and keeps the model's µg/m³ values", async () => {
    const r = await new WeatherService("tok").fetchReport(fresh({ lat: 3.14, lon: 101.69 }), true);
    expect(r.aq).toMatchObject({ aqi: 78, source: "WAQI (measured)", station: "Kuala Lumpur", dominant: "PM2.5", pm25: 18.4, pm10: 30 });
    expect(r.aq!.km).toBeLessThan(1);
    expect(r.aqHourly).not.toBeNull(); // outlook still comes from the model
  });

  it("does not call WAQI without a token", async () => {
    await new WeatherService().fetchReport(fresh());
    expect(hits("api.waqi.info")).toHaveLength(0);
  });

  it.each([
    ["too far away (>40 km)", waqi({}, 3.6, 101.69)],
    ["stale (older than 3 hours)", waqi({ time: { iso: new Date(Date.now() - 4 * 3_600_000).toISOString() } })],
    ["not a number", waqi({ aqi: "-" })],
    ["an error response", { status: "error", data: "Invalid key" }],
  ])("falls back to the model when the station is %s", async (_label, body) => {
    handler = (url) => (url.includes("api.waqi.info") ? json(body) : healthy(url));
    const r = await new WeatherService("tok").fetchReport(fresh({ lat: 3.14, lon: 101.69 }), true);
    expect(r.aq).toMatchObject({ aqi: 62, source: "Open-Meteo (model)", station: null });
  });

  it("survives WAQI being down entirely", async () => {
    handler = (url) => (url.includes("api.waqi.info") ? new Response("x", { status: 500 }) : healthy(url));
    const r = await new WeatherService("tok").fetchReport(fresh(), true);
    expect(r.aq!.source).toBe("Open-Meteo (model)");
  });

  it("returns weather without air quality if the air service is down", async () => {
    handler = (url) => (url.includes("air-quality-api") ? new Response("x", { status: 500 }) : healthy(url));
    const r = await new WeatherService().fetchReport(fresh());
    expect(r.aq).toBeNull();
    expect(r.aqHourly).toBeNull();
    expect(r.wx.current.temperature_2m).toBeGreaterThan(0);
  });
});

describe("backup forecast source", () => {
  const down = (url: string) => (url.includes("//api.open-meteo.com/") ? new Response("down", { status: 503 }) : healthy(url));

  it("switches to MET Norway when Open-Meteo is down", async () => {
    handler = down;
    const place = fresh();
    const r = await new WeatherService().fetchReport(place);
    expect(r.source).toBe("met-no");
    expect(r.wx.timezone).toBe(place.tz);
    expect(r.wx.hourly.time.length).toBeGreaterThan(40);
    expect(hits("api.met.no")).toHaveLength(1);
    expect(hits("api.met.no")[0].url).toMatch(/lat=\d+\.\d{4}&lon=100\.0000/);
    expect(hits("api.met.no")[0].headers["User-Agent"]).toContain("github.com");
    expect(r.aq).not.toBeNull(); // air quality has its own sources and still works
  });

  it("also steps in when Open-Meteo answers with incomplete data", async () => {
    handler = (url) => (url.includes("//api.open-meteo.com/") ? json({ current: makeForecast().current }) : healthy(url));
    expect((await new WeatherService().fetchReport(fresh())).source).toBe("met-no");
  });

  it("is NOT used when saving a new location (it can't tell us the timezone)", async () => {
    handler = down;
    await expect(new WeatherService().fetchReport(fresh(), true, { allowFallback: false })).rejects.toBeInstanceOf(WeatherError);
    expect(hits("api.met.no")).toHaveLength(0);
  });

  it("is NOT used when the timezone is unknown", async () => {
    handler = down;
    await expect(new WeatherService().fetchReport(fresh({ tz: "UTC" }))).rejects.toBeInstanceOf(WeatherError);
    await expect(new WeatherService().fetchReport(fresh({ tz: "Not/AZone" }))).rejects.toBeInstanceOf(WeatherError);
    expect(hits("api.met.no")).toHaveLength(0);
  });

  it("reports a clear error when both sources are down", async () => {
    handler = (url) => (url.includes("//api.open-meteo.com/") || url.includes("api.met.no") ? new Response("x", { status: 500 }) : healthy(url));
    await expect(new WeatherService().fetchReport(fresh())).rejects.toThrow(/Both weather sources failed/);
  });

  it("does not let a backup report satisfy a request that must not use the backup", async () => {
    const svc = new WeatherService();
    const place = fresh();
    handler = down;
    expect((await svc.fetchReport(place)).source).toBe("met-no"); // cached
    handler = healthy;
    const strict = await svc.fetchReport(place, false, { allowFallback: false });
    expect(strict.source).toBe("open-meteo"); // refetched instead of reusing the backup data
  });
});

describe("place search", () => {
  const geo = {
    results: [
      { name: "Springfield", latitude: 39.8, longitude: -89.6, country: "United States", country_code: "US", admin1: "Illinois", timezone: "America/Chicago" },
      { name: "Springfield", latitude: 42.1, longitude: -72.6, country: "United States", country_code: "US", admin1: "Massachusetts", timezone: "America/New_York" },
      { name: "Springfield", latitude: -37.9, longitude: 145.2, country: "Australia", country_code: "AU", admin1: "Victoria", timezone: "Australia/Melbourne" },
    ],
  };

  it("maps results and passes the language", async () => {
    handler = (url) => (url.includes("geocoding-api") ? json(geo) : healthy(url));
    const res = await new WeatherService().searchPlaces("Springfield", 5, "zh");
    expect(hits("geocoding-api")[0].url).toContain("language=zh");
    expect(res).toHaveLength(3);
    expect(res[0]).toMatchObject({ name: "Springfield", admin: "Illinois", country: "United States", tz: "America/Chicago", lat: 39.8 });
  });

  it("uses the text after a comma to narrow the results", async () => {
    handler = (url) => (url.includes("geocoding-api") ? json(geo) : healthy(url));
    const res = await new WeatherService().searchPlaces("Springfield, Australia");
    expect(res.map((p) => p.admin)).toEqual(["Victoria"]);
    expect((await new WeatherService().searchPlaces("Springfield, Massachusetts"))[0].tz).toBe("America/New_York");
    expect(hits("geocoding-api")[0].url).toContain("name=Springfield");
  });

  it("keeps all results when the hint matches nothing, and respects the limit", async () => {
    handler = (url) => (url.includes("geocoding-api") ? json(geo) : healthy(url));
    expect(await new WeatherService().searchPlaces("Springfield, Narnia")).toHaveLength(3);
    expect(await new WeatherService().searchPlaces("Springfield", 2)).toHaveLength(2);
  });

  it("returns an empty list for no matches and throws WeatherError when the service is down", async () => {
    expect(await new WeatherService().searchPlaces("zzzz")).toEqual([]);
    handler = () => new Response("x", { status: 500 });
    await expect(new WeatherService().searchPlaces("Ipoh")).rejects.toBeInstanceOf(WeatherError);
  });
});

describe("reverse geocoding (shared GPS location)", () => {
  it("builds 'neighbourhood, city' names", async () => {
    handler = () => json({ address: { suburb: "Bukit Bintang", city: "Kuala Lumpur", state: "Wilayah Persekutuan", country: "Malaysia" } });
    const p = await new WeatherService().reverseGeocode(3.1478, 101.6953, "en");
    expect(p).toMatchObject({ name: "Bukit Bintang, Kuala Lumpur", country: "Malaysia", admin: "Wilayah Persekutuan", lat: 3.1478, lon: 101.6953 });
    expect(calls[0].url).toContain("accept-language=en");
  });

  it("falls back to the nearest preset city when the service is unavailable", async () => {
    handler = () => new Response("x", { status: 429 });
    const p = await new WeatherService().reverseGeocode(3.15, 101.7, "zh");
    expect(p.name).toBe("吉隆坡");
    expect(p.lat).toBe(3.15); // the exact GPS position is kept
  });

  it("falls back to raw coordinates far from any preset", async () => {
    handler = () => new Response("x", { status: 500 });
    expect(await new WeatherService().reverseGeocode(35.6762, 139.6503)).toMatchObject({ name: "35.676, 139.650", country: "" });
  });
});

describe("configurable endpoints (used by the end-to-end tests)", () => {
  it("honours overridden URLs", async () => {
    handler = () => new Response("not mocked", { status: 404 });
    const svc = new WeatherService("", { forecast: "http://mock.test/f", air: "http://mock.test/a", metno: "http://mock.test/m" });
    handler = (url) => (url.startsWith("http://mock.test/f") ? json(makeForecast()) : url.startsWith("http://mock.test/a") ? json(OK_AIR) : new Response("x", { status: 404 }));
    const r = await svc.fetchReport(fresh());
    expect(r.source).toBe("open-meteo");
    expect(calls.every((c) => c.url.startsWith("http://mock.test/"))).toBe(true);
    expect(calls[0].url).toMatch(/^http:\/\/mock\.test\/f\?/);
    void (sample as unknown as MetNoResponse);
  });
});


describe("official warnings feed", () => {
  beforeEach(() => clearWarningsCache());
  const feedDown = (url: string) => (url.includes("api.data.gov.my") ? new Response("down", { status: 503 }) : healthy(url));

  it("fetches and parses the MetMalaysia feed (note the trailing slash)", async () => {
    const items = await new WeatherService().warnings();
    expect(items.map((w) => w.kind).sort()).toEqual(["land", "none", "sea"]);
    expect(hits("api.data.gov.my")[0].url).toBe("https://api.data.gov.my/weather/warning/");
    expect(hits("api.data.gov.my")[0].headers["User-Agent"]).toContain("github.com");
  });

  it("caches for 5 minutes and force bypasses the cache", async () => {
    const svc = new WeatherService();
    await svc.warnings();
    await svc.warnings();
    expect(hits("api.data.gov.my")).toHaveLength(1);
    await svc.warnings(true);
    expect(hits("api.data.gov.my")).toHaveLength(2);
  });

  it("reuses a recent copy when the feed is briefly down", async () => {
    const svc = new WeatherService();
    const first = await svc.warnings();
    handler = feedDown;
    expect(await svc.warnings(true)).toEqual(first); // forced refresh failed: the recent copy is better than nothing
  });

  it("fails clearly when there is no copy to fall back on", async () => {
    handler = feedDown;
    await expect(new WeatherService().warnings()).rejects.toBeInstanceOf(WeatherError);
  });

  it("rejects a feed in an unexpected format and keeps the good copy", async () => {
    const svc = new WeatherService();
    const good = await svc.warnings();
    handler = (url) => (url.includes("api.data.gov.my") ? json({ message: "maintenance" }) : healthy(url));
    expect(await svc.warnings(true)).toEqual(good);
    clearWarningsCache();
    await expect(svc.warnings()).rejects.toBeInstanceOf(WeatherError);
  });
});

describe("health probe", () => {
  beforeEach(() => clearWarningsCache());
  const place = () => fresh();

  it("healthy: only the primary and the warnings feed are touched (the backup is left alone)", async () => {
    const r = await new WeatherService().healthCheck(place());
    expect(r).toEqual({ primary: null, backup: undefined, warnings: null });
    expect(hits("api.met.no")).toHaveLength(0);
  });

  it("primary down, backup fine: reports the primary error and that the backup works", async () => {
    handler = (url) => (url.includes("//api.open-meteo.com/") ? new Response("x", { status: 503 }) : healthy(url));
    const r = await new WeatherService().healthCheck(place());
    expect(r.primary).toMatch(/open-meteo/i);
    expect(r.backup).toBeNull();
    expect(r.warnings).toBeNull();
  });

  it("both down: reports both", async () => {
    handler = (url) => (url.includes("//api.open-meteo.com/") || url.includes("api.met.no") ? new Response("x", { status: 500 }) : healthy(url));
    const r = await new WeatherService().healthCheck(place());
    expect(r.primary).toBeTruthy();
    expect(r.backup).toBeTruthy();
  });

  it("the warnings feed is judged on its own", async () => {
    handler = (url) => (url.includes("api.data.gov.my") ? new Response("x", { status: 500 }) : healthy(url));
    const r = await new WeatherService().healthCheck(place());
    expect(r.primary).toBeNull();
    expect(r.warnings).toBeTruthy();
  });
});
