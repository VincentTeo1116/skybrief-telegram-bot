import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRegion } from "../src/alerts";
import { WeatherService, clearWarningsCache } from "../src/weather";
import warningsFeed from "./data/mmd-warnings.json";
import { makeUser } from "./fixtures";

/** A tiny stand-in for D1 that records the UPDATE statements, so we can see what was saved. */
function fakeDb() {
  const writes: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          writes.push({ sql, values });
          return { meta: { changes: 1 } };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    }),
  } as unknown as D1Database;
  return { db, writes };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let searches: string[];
let geo: (name: string) => unknown;

beforeEach(() => {
  searches = [];
  geo = () => ({ results: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(String(input));
      if (url.host.startsWith("geocoding-api")) {
        searches.push(url.searchParams.get("name") ?? "");
        return json(geo(url.searchParams.get("name") ?? ""));
      }
      return new Response("not mocked", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const place = (name: string, lat: number, lon: number, admin1: string, admin2 = "") => ({
  name, latitude: lat, longitude: lon, country: "Malaysia", country_code: "MY", admin1, admin2, timezone: "Asia/Kuala_Lumpur",
});

describe("working out which state someone is in (for official warnings)", () => {
  it("returns a known state straight away, without touching the network or the database", async () => {
    const { db, writes } = fakeDb();
    expect(await resolveRegion(new WeatherService(), db, makeUser({ region: "Perak" }))).toBe("Perak");
    expect(writes).toHaveLength(0);
    expect(searches).toHaveLength(0);
  });

  it("marks places outside Malaysia as not applicable", async () => {
    const { db, writes } = fakeDb();
    expect(await resolveRegion(new WeatherService(), db, makeUser({ region: "", country: "Japan", placeName: "Tokyo" }))).toBe("-");
    expect(writes[0].values[0]).toBe("-");
    expect(searches).toHaveLength(0);
  });

  it("reads the state from the place name when it contains it (free)", async () => {
    const { db, writes } = fakeDb();
    const u = makeUser({ region: "", placeName: "Bukit Bintang, Kuala Lumpur" });
    expect(await resolveRegion(new WeatherService(), db, u)).toBe("Kuala Lumpur");
    expect(writes[0].values[0]).toBe("Kuala Lumpur");
    expect(searches).toHaveLength(0);
  });

  it("otherwise asks the geocoder once, and accepts a nearby match", async () => {
    geo = () => ({ results: [place("Ipoh", 4.5975, 101.09, "Perak", "Kinta")] });
    const { db, writes } = fakeDb();
    const u = makeUser({ region: "", placeName: "Ipoh", lat: 4.5975, lon: 101.0901 });
    expect(await resolveRegion(new WeatherService(), db, u)).toBe("Perak");
    expect(writes).toHaveLength(1);
    expect(writes[0].values[0]).toBe("Perak");
  });

  it("tries the city part of a GPS-style name too", async () => {
    geo = (name) => (name === "Taiping" ? { results: [place("Taiping", 4.85, 100.74, "Perak")] } : { results: [] });
    const { db } = fakeDb();
    const u = makeUser({ region: "", placeName: "Kamunting, Taiping", lat: 4.9, lon: 100.7 });
    expect(await resolveRegion(new WeatherService(), db, u)).toBe("Perak");
    expect(searches).toContain("Taiping"); // the whole name found nothing, so it fell back to the city part
  });

  it("ignores a same-named place on the other side of the country", async () => {
    geo = () => ({ results: [place("Kampung Baru", 6.1, 102.2, "Kelantan")] });
    const { db, writes } = fakeDb();
    const u = makeUser({ region: "", placeName: "Kampung Baru", lat: 3.17, lon: 101.7 }); // KL's Kampung Baru
    expect(await resolveRegion(new WeatherService(), db, u)).toBe("-");
    expect(writes[0].values[0]).toBe("-"); // unknown: never guess a state
  });

  it("does NOT give up for good when the network is down (so it is retried later)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 503 })));
    const { db, writes } = fakeDb();
    expect(await resolveRegion(new WeatherService(), db, makeUser({ region: "", placeName: "Ipoh" }))).toBe("");
    expect(writes).toHaveLength(0);
  });
});

describe("a health probe is not fooled by a cached copy of the warnings feed", () => {
  beforeEach(() => clearWarningsCache());

  it("reports the feed as down even though users are still served the recent copy", async () => {
    let feedUp = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes("api.data.gov.my")) return feedUp ? json(warningsFeed) : new Response("down", { status: 503 });
        return new Response("not mocked", { status: 404 }); // the forecast fails too: irrelevant here
      }),
    );
    const svc = new WeatherService();
    expect((await svc.warnings()).length).toBe(3); // cached
    feedUp = false;
    expect((await svc.warnings(true)).length).toBe(3); // users: the recent copy keeps working
    const health = await svc.healthCheck({ name: "KL", lat: 3.1, lon: 101.6, country: "MY", tz: "Asia/Kuala_Lumpur" });
    expect(health.warnings).toBeTruthy(); // the probe: the truth
  });
});
