import { describe, expect, it } from "vitest";
import { appUrlFromOrigin } from "../src/appurl";
import { DEMO_SCENES, demoReport } from "../src/demo";
import { hourlyMessage, weatherMessage, weekMessage } from "../src/format";
import { T } from "../src/i18n";
import { appKeyboard, reportKeyboard } from "../src/keyboards";
import { INIT_DATA_MAX_AGE_S, appStrings, buildDashboard, handleApi, iconOf, langHint, sceneOf, signInitData, verifyInitData } from "../src/miniapp";
import type { Env, Forecast } from "../src/types";
import type { Warning } from "../src/warnings";
import { MODEL_AQ, P, STATION_AQ, makeForecast, makeReport, makeUser } from "./fixtures";

const TOKEN = "123456:TEST-TOKEN";
const NOW = Date.UTC(2026, 10, 3, 0, 15); // 08:15 in Kuala Lumpur

async function initData(o: { id?: unknown; ageS?: number; token?: string; lang?: string } = {}): Promise<string> {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(NOW / 1000) - (o.ageS ?? 60)),
    query_id: "AAF",
    user: JSON.stringify({ id: o.id ?? 777, first_name: "Vince", language_code: o.lang ?? "en" }),
  });
  p.set("hash", await signInitData(p, o.token ?? TOKEN));
  return p.toString();
}

// ------------------------------------------------------------------ NFR-1
describe("verifyInitData: Telegram's signature", () => {
  it("accepts a correctly signed, recent session", async () => {
    expect(await verifyInitData(await initData({ lang: "zh-hans" }), TOKEN, NOW)).toEqual({ id: 777, languageCode: "zh-hans" });
  });

  it("matches Telegram's published algorithm (fixed vector, computed independently with Node's crypto)", async () => {
    // node -e: createHmac('sha256', createHmac('sha256','WebAppData').update('123456:TEST-TOKEN').digest()).update('auth_date=1\nuser={"id":1}').digest('hex')
    const p = new URLSearchParams({ user: '{"id":1}', auth_date: "1" });
    expect(await signInitData(p, TOKEN)).toBe(VECTOR);
  });

  it("refuses anything that was changed after signing", async () => {
    const good = await initData();
    expect(await verifyInitData(good.replace("%22id%22%3A777", "%22id%22%3A778"), TOKEN, NOW)).toBeNull();
    expect(await verifyInitData(good.replace("query_id=AAF", "query_id=AAG"), TOKEN, NOW)).toBeNull();
    expect(await verifyInitData(good + "&extra=1", TOKEN, NOW)).toBeNull();
    expect(await verifyInitData(good.replace(/hash=[0-9a-f]{4}/, "hash=0000"), TOKEN, NOW)).toBeNull();
  });

  it("refuses a session signed by another bot, or when our token is missing", async () => {
    expect(await verifyInitData(await initData({ token: "999:OTHER" }), TOKEN, NOW)).toBeNull();
    expect(await verifyInitData(await initData(), "", NOW)).toBeNull();
  });

  it("refuses old sessions and sessions dated in the future", async () => {
    expect(await verifyInitData(await initData({ ageS: INIT_DATA_MAX_AGE_S - 10 }), TOKEN, NOW)).not.toBeNull();
    expect(await verifyInitData(await initData({ ageS: INIT_DATA_MAX_AGE_S + 10 }), TOKEN, NOW)).toBeNull();
    expect(await verifyInitData(await initData({ ageS: -3600 }), TOKEN, NOW)).toBeNull();
  });

  it("refuses missing, malformed and oversized input without throwing", async () => {
    for (const bad of ["", "hello", "hash=abc", "user=%7B&hash=" + "a".repeat(64), "x".repeat(5000)]) {
      expect(await verifyInitData(bad, TOKEN, NOW), bad.slice(0, 20)).toBeNull();
    }
    expect(await verifyInitData(await initData({ id: "777" }), TOKEN, NOW)).toBeNull(); // id must be a number
    expect(await verifyInitData(await initData({ id: -5 }), TOKEN, NOW)).toBeNull();
  });

  it("language hint", () => {
    expect([langHint("zh-hans"), langHint("ms"), langHint("MS-my"), langHint("fr"), langHint(null)]).toEqual(["zh", "ms", "ms", "en", "en"]);
  });
});
const VECTOR = "117732add5d610ac2bfa5d0d0937bb2e7eb691da88b3b73004d6fe6efc69ae30";

// ------------------------------------------------------------------ FR-3
describe("sceneOf: which sky to draw", () => {
  const cur = (o: Partial<Forecast["current"]>) => ({ ...makeForecast().current, weather_code: 0, precipitation: 0, wind_speed_10m: 8, wind_gusts_10m: 14, cloud_cover: 10, is_day: 1, ...o });

  it("sunny, cloudy, rainy and windy each get their own scene", () => {
    expect(sceneOf(cur({ weather_code: 0 })).kind).toBe("clear");
    expect(sceneOf(cur({ weather_code: 2 })).kind).toBe("partly");
    expect(sceneOf(cur({ weather_code: 3 })).kind).toBe("cloudy");
    expect(sceneOf(cur({ weather_code: 63 })).kind).toBe("rain");
    expect(sceneOf(cur({ weather_code: 2, wind_speed_10m: 30 })).kind).toBe("windy");
    expect(sceneOf(cur({ weather_code: 0, wind_speed_10m: 12, wind_gusts_10m: 45 })).kind).toBe("windy");
    expect(sceneOf(cur({ weather_code: 95 })).kind).toBe("storm");
    expect(sceneOf(cur({ weather_code: 45 })).kind).toBe("fog");
  });

  it("rain and storms win over wind; the wind then only slants the rain", () => {
    const s = sceneOf(cur({ weather_code: 65, wind_speed_10m: 40 }));
    expect(s).toMatchObject({ kind: "rain", rain: 3, wind: 0.8 });
    expect(sceneOf(cur({ weather_code: 96, wind_speed_10m: 60 }))).toMatchObject({ kind: "storm", wind: 1 });
  });

  it("just under the wind thresholds is not windy", () => {
    expect(sceneOf(cur({ weather_code: 1, wind_speed_10m: 24.9, wind_gusts_10m: 39.9 })).kind).toBe("partly");
  });

  it("measured rain counts even when the code hasn't caught up", () => {
    expect(sceneOf(cur({ weather_code: 3, precipitation: 0.4 }))).toMatchObject({ kind: "rain", rain: 1 });
    expect(sceneOf(cur({ weather_code: 2, precipitation: 4 }))).toMatchObject({ kind: "rain", rain: 2 });
  });

  it("rain intensity follows the weather code", () => {
    expect([51, 61, 80].map((c) => sceneOf(cur({ weather_code: c })).rain)).toEqual([1, 1, 1]);
    expect([55, 63, 81].map((c) => sceneOf(cur({ weather_code: c })).rain)).toEqual([2, 2, 2]);
    expect([65, 82, 95].map((c) => sceneOf(cur({ weather_code: c })).rain)).toEqual([3, 3, 3]);
  });

  it("night, and an unknown code falls back to cloud cover", () => {
    expect(sceneOf(cur({ is_day: 0 })).night).toBe(true);
    expect(sceneOf(cur({})).night).toBe(false);
    expect(sceneOf(cur({ weather_code: null, cloud_cover: 90 })).kind).toBe("cloudy");
    expect(sceneOf(cur({ weather_code: null, cloud_cover: 50 })).kind).toBe("partly");
    expect(sceneOf(cur({ weather_code: null, cloud_cover: 5 })).kind).toBe("clear");
  });

  it("every icon name exists in the page's sprite", async () => {
    const html = (await import("../public/app/index.html?raw")).default as string;
    const codes = [null, 0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99, 1234];
    for (const code of codes) for (const day of [true, false]) expect(html, `${code}`).toContain(`id="i-${iconOf(code, day)}"`);
    expect([iconOf(0, true), iconOf(0, false), iconOf(2, false), iconOf(63, true), iconOf(95, true)]).toEqual(["clear-day", "clear-night", "partly-night", "rain", "storm"]);
  });
});

// ------------------------------------------------------------------ FR-2, FR-4 .. FR-8, FR-10
describe("buildDashboard: the same numbers and words as the chat report", () => {
  const report = makeReport(MODEL_AQ);
  const d = buildDashboard(report, P());

  it("current weather (FR-2)", () => {
    expect(d.place).toBe("Kuala Lumpur, Malaysia");
    expect(d.title).toBe("Weather in Kuala Lumpur, Malaysia");
    expect(d.now).toMatchObject({ temp: "28°", unit: "C", cond: "Partly cloudy", icon: "partly-day", feels: "Feels like 33°", hi: "33°", lo: "25°", date: "Tuesday, 3 November", clock: "8:15 AM" });
    expect(d.now.trend).toEqual({ warmer: true, text: "3° warmer than yesterday" });
    expect(d.scene).toEqual({ kind: "partly", night: false, wind: 0.23, rain: 0 });
    const chat = weatherMessage(report, P());
    for (const piece of ["28°C", "Partly cloudy", "Feels like 33°", "3° warmer than yesterday", "AQI 62", "Moderate", "Today: 5–10 PM"]) expect(chat).toContain(piece);
  });

  it("hourly: 24 hours from now (FR-5)", () => {
    expect(d.hourly).toHaveLength(24);
    expect(d.hourly[0]).toEqual({ label: "Now", icon: "partly-day", cond: "Partly cloudy", temp: "29°", prob: 10 });
    expect(d.hourly[1].label).toBe("9 AM");
    expect(d.hourly[12]).toMatchObject({ label: "8 PM", icon: "partly-night" }); // night icon after dark
    expect(hourlyMessage(report, P())).toContain("29°"); // same first value as the chat's hourly view
    expect(d.rain).toEqual({ level: "none", text: "No rain expected in the next 6 hours" });
  });

  it("rain outlook levels", () => {
    expect(buildDashboard(makeReport(null, { rainAt: 2 }), P()).rain).toEqual({ level: "likely", text: "Rain likely around 10 AM (85%)" });
    expect(buildDashboard(makeReport(null, { prob: 40 }), P()).rain.level).toBe("chance");
    expect(buildDashboard(makeReport(null, { precip: 1.2, code: 63, prob: 70 }), P()).rain).toEqual({ level: "now", text: "Raining now · chance stays up to 70% over the next 6h" });
  });

  it("air quality: model reading, with the outlook (FR-4)", () => {
    expect(d.air).toEqual({ aqi: 62, level: 1, label: "Moderate", pm25: "18 µg/m³", pm10: "30 µg/m³", dominant: null, outlook: { kind: "rising", text: "Rising: peak ~95 around 3 PM (model)" }, measured: false });
    expect(d.footer.source).toBe("Weather: Open-Meteo · Air: modelled estimate");
  });

  it("air quality: measured station; the model's outlook is dropped when it disagrees", () => {
    const s = buildDashboard(makeReport(STATION_AQ), P());
    expect(s.air).toMatchObject({ aqi: 112, level: 2, label: "Unhealthy for sensitive groups", dominant: "main pollutant PM2.5", measured: true, outlook: null });
    expect(s.footer.source).toBe("Weather: Open-Meteo · Air: Cheras, Kuala Lumpur station (4 km)");
    expect(buildDashboard(makeReport({ ...STATION_AQ, station: "A & B <Road>" }), P()).footer.source).toContain("A & B <Road> station"); // plain text, not HTML entities
  });

  it("air quality unavailable: the rest still builds (F6)", () => {
    const none = buildDashboard(makeReport(null), P());
    expect(none.air).toBeNull();
    expect(none.daily).toHaveLength(7);
    expect(none.footer.source).toBe("Weather: Open-Meteo");
  });

  it("seven days starting today (FR-6)", () => {
    expect(d.daily).toHaveLength(7);
    expect(d.daily.map((x) => x.label)).toEqual(["Today", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"]);
    expect(d.daily.map((x) => x.weekend)).toEqual([false, false, false, false, true, true, false]);
    expect(d.daily[0]).toMatchObject({ date: "3/11", icon: "partly-day", cond: "Partly cloudy", lo: "25°", hi: "33°", loN: 25, hiN: 33.1, prob: 10, mm: null });
    const week = weekMessage(report, P());
    expect((week.match(/25°–33°/g) ?? []).length).toBe(7); // the chat's 7-day view shows the same range
  });

  it("details (FR-7)", () => {
    expect(d.details).toEqual({
      humidity: "78%",
      wind: { speed: "12 km/h", dir: "NE", deg: 45, gust: "Gusts 20 km/h" },
      uv: { value: "9", label: "Very high" },
      pressure: "1009 hPa",
      cloud: "60%",
      sunrise: "7:01 AM",
      sunset: "7:12 PM",
      sunPos: 0.1,
    });
    expect(d.best).toEqual(["Today: 5–10 PM"]);
    expect(d.tips.length).toBeGreaterThan(0);
    expect(d.footer).toMatchObject({ observed: "Observed 8:15 AM local", backup: false });
    expect(d.presets).toHaveLength(10);
    expect(d.presets[0]).toBe("Kuala Lumpur");
  });

  it("the backup source is named (F4)", () => {
    const b = buildDashboard(makeReport(MODEL_AQ, { source: "met-no" }), P());
    expect(b.footer.backup).toBe(true);
    expect(b.footer.source).toContain("MET Norway (backup source)");
  });

  it("units, clock and language follow the person's settings (FR-10)", () => {
    const f = buildDashboard(report, P("en", { tempUnit: "f", windUnit: "mph", clock: "24" }));
    expect(f.now).toMatchObject({ temp: "83°", unit: "F", hi: "92°", clock: "08:15" });
    expect(f.details.wind.speed).toBe("7 mph");
    expect(f.details.sunrise).toBe("07:01");
    expect(f.hourly[1].label).toBe("09:00");
    expect(f.daily[0]).toMatchObject({ loN: 77, hi: "92°" });
    expect(f.now.trend?.text).toBe("5° warmer than yesterday");

    const zh = buildDashboard(report, P("zh"));
    expect(zh).toMatchObject({ lang: "zh", place: "Kuala Lumpur, Malaysia" });
    expect(zh.now.cond).toBe("局部多云");
    expect(zh.daily[0].label).toBe("今天");
    expect(zh.strings.app_forecast).toBe("天气预报");
    const ms = buildDashboard(report, P("ms"));
    expect(ms.now.cond).toBe("Separa mendung");
    expect(ms.air?.label).toBe("Sederhana");
    expect(ms.details.wind.dir).toBe("TL");
  });

  it("official warnings (FR-8)", () => {
    const w: Warning = {
      id: "w1", issued: "2026-11-03T07:30", from: "2026-11-03T07:00", to: "2026-11-03T11:00", kind: "land",
      titleEn: "Thunderstorms Warning", titleBm: "Amaran Ribut Petir",
      textEn: "Thunderstorms are expected over the states of Perak (Kinta) • Kuala Lumpur until 11:00 AM.",
      textBm: "Ribut petir dijangka di negeri Perak (Kinta) • Kuala Lumpur sehingga 11:00 pagi.",
      instructionEn: "Stay indoors.", instructionBm: "Kekal di dalam.",
    };
    const en = buildDashboard(report, P(), [w], { state: "Kuala Lumpur" });
    expect(en.warnings).toEqual([{ title: "Thunderstorms Warning", until: "until 11:00 AM", valid: "Valid 7:00 AM – 11:00 AM", area: "Kuala Lumpur", text: w.textEn, instruction: "Stay indoors." }]);
    expect(buildDashboard(report, P("ms"), [w], { state: "Kuala Lumpur" }).warnings[0]).toMatchObject({ title: "Amaran Ribut Petir", instruction: "Kekal di dalam." });
    expect(buildDashboard(report, P(), [w, w, w, w]).warnings).toHaveLength(3);
    expect(d.warnings).toEqual([]);
  });

  it("never lets 'undefined', 'NaN' or 'null' reach the screen", () => {
    for (const lang of ["en", "ms", "zh"] as const) {
      for (const r of [report, makeReport(null), makeReport(STATION_AQ, { source: "met-no" }), ...DEMO_SCENES.map((s) => demoReport(s, lang).report)]) {
        const texts: string[] = [];
        JSON.stringify(buildDashboard(r, P(lang)), (_k, v) => (typeof v === "string" && texts.push(v), v));
        expect(texts.filter((s) => /undefined|NaN|\bnull\b/.test(s))).toEqual([]);
      }
    }
  });

  it("stays small enough for a quick load", () => {
    expect(JSON.stringify(d).length).toBeLessThan(16_000);
  });
});

// ------------------------------------------------------------------ FR-11
describe("demo scenes", () => {
  const expected = { sunny: "clear", cloudy: "cloudy", rainy: "rain", windy: "windy", storm: "storm", night: "clear" } as const;
  for (const scene of DEMO_SCENES) {
    it(`${scene} draws the ${expected[scene]} sky and is marked as a demo`, () => {
      const demo = demoReport(scene, "en", new Date(NOW));
      const d = buildDashboard(demo.report, P(), demo.warnings, { state: demo.state, demo: true });
      expect(d.demo).toBe(true);
      expect(d.scene.kind).toBe(expected[scene]);
      expect(d.scene.night).toBe(scene === "night");
      expect(d.hourly).toHaveLength(24);
      expect(d.daily).toHaveLength(7);
      expect(d.warnings).toHaveLength(scene === "storm" ? 1 : 0);
    });
  }
  it("a real dashboard is never marked as a demo", () => {
    expect(buildDashboard(makeReport(MODEL_AQ), P()).demo).toBe(false);
  });
});

// ------------------------------------------------------------------ texts
describe("mini app texts", () => {
  const client = Object.values(import.meta.glob("../public/app/*.js", { query: "?raw", import: "default", eager: true }) as Record<string, string>).join("\n");
  const server = Object.values(import.meta.glob("../src/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>).join("\n").replace(/app_[a-z0-9_]+: \[/g, "");
  const appKeys = Object.keys(T).filter((k) => k.startsWith("app_"));

  it("every text the page asks for is sent, in all three languages", () => {
    const used = [...new Set([...client.matchAll(/\bS\.([a-z0-9_]+)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(25);
    for (const lang of ["en", "ms", "zh"] as const) {
      const strings = appStrings(lang);
      expect(used.filter((k) => !strings[k]), lang).toEqual([]);
    }
  });

  it("no mini app text is dead, and every one is translated", () => {
    expect(appKeys.filter((k) => !client.includes(`S.${k}`) && !server.includes(`"${k}"`))).toEqual([]);
    expect(appKeys.filter((k) => T[k].some((s) => !s))).toEqual([]);
    expect(appKeys.filter((k) => T[k][0] === T[k][2])).toEqual([]); // Chinese is not a copy of the English
  });

  it("placeholders survive translation", () => {
    for (const k of appKeys) {
      const marks = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect([marks(T[k][1]), marks(T[k][2])], k).toEqual([marks(T[k][0]), marks(T[k][0])]);
    }
  });
});

// ------------------------------------------------------------------ FR-1, F14
describe("the way in from the chat", () => {
  it("only an HTTPS origin becomes a mini app address", () => {
    expect(appUrlFromOrigin("https://skybrief.example.workers.dev")).toBe("https://skybrief.example.workers.dev/app/");
    expect(appUrlFromOrigin("https://x.dev/some/path?q=1")).toBe("https://x.dev/app/");
    expect([appUrlFromOrigin("http://127.0.0.1:8787"), appUrlFromOrigin(""), appUrlFromOrigin(null), appUrlFromOrigin("not a url")]).toEqual([null, null, null, null]);
  });

  it("the report keyboard gets an 'Open dashboard' button only when the address is known", () => {
    const rows = (m: any) => m.inline_keyboard as any[][];
    const without = rows(reportKeyboard(makeUser(), "now"));
    const withApp = rows(reportKeyboard(makeUser(), "now", "https://x.dev/app/"));
    expect(without.flat().some((b) => b.web_app)).toBe(false);
    expect(rows(reportKeyboard(makeUser(), "now", null))).toEqual(without);
    expect(withApp.slice(0, -1)).toEqual(without); // nothing else moved
    expect(withApp.at(-1)).toEqual([{ text: "📱 Open dashboard", web_app: { url: "https://x.dev/app/" } }]);
    expect(rows(appKeyboard("zh", "https://x.dev/app/"))[0][0].text).toBe("📱 打开天气面板");
  });
});

// ------------------------------------------------------------------ routing without a database (NFR-7, FR-11)
describe("handleApi", () => {
  const env = { TELEGRAM_BOT_TOKEN: TOKEN } as Env;
  const call = (path: string, init?: RequestInit) => handleApi(new Request(`https://x.dev${path}`, init), env, new URL(`https://x.dev${path}`));

  it("unknown paths and wrong methods answer in JSON", async () => {
    const missing = await call("/api/app/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
    const wrong = await call("/api/app/place");
    expect([wrong.status, wrong.headers.get("allow")]).toEqual([405, "POST"]);
  });

  it("no session, no data: 401 before the database is ever touched", async () => {
    for (const path of ["/api/app/dashboard", "/api/app/places?q=ipoh"]) {
      const res = await call(path, { headers: { authorization: "tma forged" } });
      expect(res.status).toBe(401);
      expect((await res.json() as any).error.code).toBe("unauthorized");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect((await call("/api/app/place", { method: "POST", body: '{"preset":0}' })).status).toBe(401);
  });

  it("the demo needs no session and is labelled", async () => {
    const res = await call("/api/app/demo?scene=windy&lang=ms");
    expect(res.status).toBe(200);
    const d = (await res.json()) as any;
    expect(d).toMatchObject({ v: 1, demo: true, lang: "ms", scene: { kind: "windy" } });
    expect((await call("/api/app/demo?scene=snow")).status).toBe(400);
  });
});
