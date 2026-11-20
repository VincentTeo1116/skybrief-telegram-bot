/** Unit tests for the v2.4 mini app features: settings rules, saved places, the official IPU, day details. */
import { describe, expect, it } from "vitest";
import { demoReport } from "../src/demo";
import { IPU_MAX_KM, ipuBand, nearestIpu, parseIpu, type IpuStation } from "../src/ipu";
import { MAX_PLACES, activeOf, isActivePlace, savedPlaces } from "../src/location";
import { isLang, normLang } from "../src/i18n";
import { afterAlertRow, alertKeyboard } from "../src/keyboards";
import { readLimited } from "../src/miniapp";
import { safeEqual } from "../src/util";
import { buildDashboard, hazeOf, settingsView } from "../src/miniapp";
import { parseSettingsChange, settingsPatch } from "../src/settings";
import { MODEL_AQ, P, makeReport, makeUser } from "./fixtures";

const NOW = new Date(Date.UTC(2026, 10, 3, 2, 0)); // 10:00 in Kuala Lumpur
const KL = { lat: 3.139, lon: 101.6869 };

// ------------------------------------------------------------------ FR-13
describe("settings: what the mini app may change", () => {
  it("accepts each known setting with a valid value", () => {
    expect(parseSettingsChange({ lang: "zh" })).toEqual({ lang: "zh" });
    expect(parseSettingsChange({ tempUnit: "f", windUnit: "mph", clock: "24" })).toEqual({ tempUnit: "f", windUnit: "mph", clock: "24" });
    expect(parseSettingsChange({ dailyTime: "7:05" })).toEqual({ dailyTime: "07:05" }); // normalised
    expect(parseSettingsChange({ eveningOn: true, eveningTime: "19:30" })).toEqual({ eveningOn: true, eveningTime: "19:30" });
    expect(parseSettingsChange({ rainAlerts: false, aqiAlert: 151, warningsOn: true })).toEqual({ rainAlerts: false, aqiAlert: 151, warningsOn: true });
    expect(parseSettingsChange({ aqiAlert: 0 })).toEqual({ aqiAlert: 0 });
  });

  it("refuses the whole change when any part is unknown or invalid", () => {
    const bad: unknown[] = [
      null, undefined, "tempUnit=f", 5, [], {}, [{ tempUnit: "f" }],
      { tempUnit: "k" }, { windUnit: "knots" }, { clock: "13" }, { lang: "fr" }, { lang: 1 },
      { dailyTime: "25:00" }, { dailyTime: "8:30 pm" }, { dailyTime: 830 }, { eveningTime: "" },
      { aqiAlert: 120 }, { aqiAlert: "151" }, { dailyOn: "yes" }, { rainAlerts: 1 }, { warningsOn: null },
      { status: "active" }, { chatId: 1 }, { hidden: "air" }, { tempUnit: "f", placeName: "x" }, { __proto__: { tempUnit: "f" } },
    ];
    for (const b of bad) expect(parseSettingsChange(b), JSON.stringify(b)).toBeNull();
  });

  it("units and clock are stored as they are", () => {
    expect(settingsPatch(makeUser(), { tempUnit: "f", windUnit: "ms", clock: "12" })).toEqual({ tempUnit: "f", windUnit: "ms", clock: "12" });
  });

  it("moving a report's time switches it on and never fires a late report today", () => {
    // 10:00 local: 08:00 has already passed (mark today as done), 21:00 has not (leave it due)
    expect(settingsPatch(makeUser({ dailyOn: false }), { dailyTime: "08:00" }, NOW)).toEqual({ dailyTime: "08:00", dailyOn: true, lastSent: "2026-11-03" });
    expect(settingsPatch(makeUser(), { dailyTime: "21:00" }, NOW)).toEqual({ dailyTime: "21:00", dailyOn: true, lastSent: "" });
    expect(settingsPatch(makeUser(), { eveningTime: "09:00" }, NOW)).toEqual({ eveningTime: "09:00", eveningOn: true, lastEvening: "2026-11-03" });
  });

  it("switching a report on uses its saved time; switching it off touches nothing else", () => {
    expect(settingsPatch(makeUser({ dailyOn: false, dailyTime: "08:30" }), { dailyOn: true }, NOW)).toEqual({ dailyOn: true, lastSent: "2026-11-03" });
    expect(settingsPatch(makeUser({ eveningOn: false, eveningTime: "18:00" }), { eveningOn: true }, NOW)).toEqual({ eveningOn: true, lastEvening: "" });
    expect(settingsPatch(makeUser(), { dailyOn: false }, NOW)).toEqual({ dailyOn: false });
    expect(settingsPatch(makeUser(), { eveningOn: false }, NOW)).toEqual({ eveningOn: false });
    // time and "off" together: the explicit off wins
    expect(settingsPatch(makeUser(), { dailyTime: "07:00", dailyOn: false }, NOW)).toMatchObject({ dailyTime: "07:00", dailyOn: false });
  });

  it("touching an alert resets its cooldown, so it can fire straight away", () => {
    expect(settingsPatch(makeUser({ lastRainAlert: 123 }), { rainAlerts: true })).toEqual({ rainAlerts: true, lastRainAlert: 0 });
    expect(settingsPatch(makeUser({ aqiAlertActive: true, lastAqiAlert: 9 }), { aqiAlert: 151 })).toEqual({ aqiAlert: 151, aqiAlertActive: false, lastAqiAlert: 0 });
    expect(settingsPatch(makeUser(), { aqiAlert: 0 })).toEqual({ aqiAlert: 0, aqiAlertActive: false, lastAqiAlert: 0 });
    expect(settingsPatch(makeUser(), { warningsOn: false })).toEqual({ warningsOn: false });
  });

  it("the language is never part of the plain patch (it also renames the place)", () => {
    expect(settingsPatch(makeUser(), { lang: "zh" })).toEqual({});
  });

  it("what the page is told about the settings", () => {
    expect(settingsView(makeUser({ eveningOn: true, eveningTime: "19:00", aqiAlert: 101 }))).toEqual({
      lang: "en", tempUnit: "c", windUnit: "kmh", clock: "auto", dailyOn: true, dailyTime: "08:30", eveningOn: true, eveningTime: "19:00",
      rainAlerts: false, aqiAlert: 101, warningsOn: true, warningsAvailable: true, tz: "Asia/Kuala_Lumpur",
    });
    expect(settingsView(makeUser({ region: "-" })).warningsAvailable).toBe(false); // outside Malaysia
    const d = buildDashboard(makeReport(MODEL_AQ), P(), [], { user: makeUser() });
    expect(d.settings).not.toBeNull();
    expect(buildDashboard(makeReport(MODEL_AQ), P()).settings).toBeNull(); // the demo has no account
  });
});

// ------------------------------------------------------------------ FR-12
describe("saved places", () => {
  const place = (name: string, lat: number, lon: number) => ({ name, lat, lon, country: "Malaysia", tz: "Asia/Kuala_Lumpur", region: "Perak", district: "" });
  const ipoh = place("Ipoh", 4.5975, 101.0901);
  const penang = place("George Town", 5.4141, 100.3288);

  it("someone who never used the feature sees just their current place", () => {
    const u = makeUser();
    expect(savedPlaces(u)).toEqual([activeOf(u)]);
    expect(isActivePlace(u, savedPlaces(u)[0])).toBe(true);
  });

  it("the active place is always in the list, first if it was never stored", () => {
    const u = makeUser({ placesJson: JSON.stringify([ipoh, penang]) });
    expect(savedPlaces(u).map((p) => p.name)).toEqual(["Kuala Lumpur", "Ipoh", "George Town"]);
    const stored = makeUser({ placesJson: JSON.stringify([ipoh, activeOf(makeUser()), penang]) });
    expect(savedPlaces(stored).map((p) => p.name)).toEqual(["Ipoh", "Kuala Lumpur", "George Town"]); // stored order kept
  });

  it("never more than the limit, and no duplicates", () => {
    const many = Array.from({ length: 9 }, (_, i) => place(`P${i}`, 1 + i, 100 + i));
    expect(savedPlaces(makeUser({ placesJson: JSON.stringify(many) }))).toHaveLength(MAX_PLACES);
    expect(savedPlaces(makeUser({ placesJson: JSON.stringify([ipoh, { ...ipoh, name: "Ipoh again" }, ipoh]) })).map((p) => p.name)).toEqual(["Kuala Lumpur", "Ipoh"]);
  });

  it("a damaged row never breaks the page", () => {
    for (const bad of ["", "not json", "{}", "null", "[1,2]", '[{"name":"x"}]', '[{"name":"x","lat":"3","lon":101,"tz":"Asia/Kuala_Lumpur"}]', '[{"name":"","lat":3,"lon":101,"tz":"Asia/Kuala_Lumpur"}]', '[{"name":"x","lat":3,"lon":101}]']) {
      expect(savedPlaces(makeUser({ placesJson: bad })).map((p) => p.name), bad).toEqual(["Kuala Lumpur"]);
    }
    const mixed = JSON.stringify([null, ipoh, { name: "x" }, penang]);
    expect(savedPlaces(makeUser({ placesJson: mixed })).map((p) => p.name)).toEqual(["Kuala Lumpur", "Ipoh", "George Town"]);
  });

  it("the dashboard lists them with the active one marked", () => {
    const u = makeUser({ placesJson: JSON.stringify([ipoh]) });
    const d = buildDashboard(makeReport(MODEL_AQ), P(), [], { user: u });
    expect(d.places).toEqual([
      { name: "Kuala Lumpur", label: "Kuala Lumpur, Malaysia", active: true, home: false },
      { name: "Ipoh", label: "Ipoh, Malaysia", active: false, home: false },
    ]);
    expect(buildDashboard(makeReport(MODEL_AQ), P()).places).toEqual([]);
  });
});

// ------------------------------------------------------------------ FR-14
describe("official IPU (Department of Environment)", () => {
  const stamp = (iso: string) => Date.parse(iso + ":00Z"); // the feed stores local wall-clock time as if it were UTC
  const feature = (name: string, lat: number, lon: number, api: unknown, time = "2026-11-03T10:00") => ({ attributes: { STATION_ID: "X", DATETIME: stamp(time), API: api, STATION_LOCATION: name, LATITUDE: lat, LONGITUDE: lon } });
  const feed = { features: [feature("Cheras, W.P. KUALA LUMPUR", 3.10626, 101.717931, 63), feature("Batu Muda, W.P. KUALA LUMPUR", 3.212429, 101.682218, 51), feature("Tasek Ipoh, PERAK", 4.629444, 101.116667, 44)] };

  it("reads the feed: station name without the state, value, local time", () => {
    expect(parseIpu(feed)[0]).toEqual({ name: "Cheras", lat: 3.10626, lon: 101.717931, value: 63, time: "2026-11-03T10:00" });
    expect(parseIpu(feed)).toHaveLength(3);
  });

  it("skips anything unusable instead of failing", () => {
    for (const bad of [null, undefined, "x", 5, {}, { features: "no" }, { error: { code: 500 } }]) expect(parseIpu(bad), JSON.stringify(bad)).toEqual([]);
    const messy = { features: [null, {}, { attributes: null }, feature("A, X", 3, 101, null), feature("B, X", 3, 101, "63"), feature("C, X", 3, 101, -5), feature("D, X", 3, 101, 5000), feature("", 3, 101, 40), feature("E, X", NaN, 101, 40), { attributes: { API: 40, LATITUDE: 3, LONGITUDE: 101, STATION_LOCATION: "F, X" } }, feature("Good, X", 3, 101, 40.4)] };
    expect(parseIpu(messy)).toEqual([{ name: "Good", lat: 3, lon: 101, value: 40, time: "2026-11-03T10:00" }]);
  });

  it("picks the nearest station", () => {
    const list = parseIpu(feed);
    expect(nearestIpu(list, KL, "2026-11-03T10:40")).toMatchObject({ name: "Cheras", value: 63 });
    expect(nearestIpu(list, { lat: 3.21, lon: 101.68 }, "2026-11-03T10:40")).toMatchObject({ name: "Batu Muda", value: 51 });
    expect(nearestIpu(list, { lat: 4.5975, lon: 101.0901 }, "2026-11-03T10:40")).toMatchObject({ name: "Tasek Ipoh", value: 44 });
    expect(nearestIpu(list, KL, "2026-11-03T10:40")!.km).toBeLessThan(6);
  });

  it("no station within reach, a stale reading, or one dated in the future: no reading at all", () => {
    const list = parseIpu(feed);
    expect(nearestIpu(list, { lat: 1.3521, lon: 103.8198 }, "2026-11-03T10:40")).toBeNull(); // Singapore: hundreds of km away
    expect(IPU_MAX_KM).toBe(40);
    expect(nearestIpu(list, KL, "2026-11-03T12:59")).not.toBeNull(); // just under 3 hours old
    expect(nearestIpu(list, KL, "2026-11-03T13:30")).toBeNull(); // over 3 hours old
    expect(nearestIpu(list, KL, "2026-11-03T07:00")).toBeNull(); // the reading claims to be from the future
    expect(nearestIpu([], KL, "2026-11-03T10:40")).toBeNull();
    const bad: IpuStation[] = [{ name: "X", lat: 3.1, lon: 101.7, value: 50, time: "garbage" }];
    expect(nearestIpu(bad, KL, "2026-11-03T10:40")).toBeNull();
  });

  it("uses Malaysia's own bands, which differ from the US AQI bands", () => {
    expect([0, 50, 51, 100, 101, 200, 201, 300, 301, 500].map(ipuBand)).toEqual([0, 0, 1, 1, 3, 3, 4, 4, 5, 5]);
  });

  it("is shown on the dashboard with station, time and source; absent when there is none", () => {
    const reading = { ...parseIpu(feed)[0], km: 4.9 };
    const d = buildDashboard(makeReport(MODEL_AQ), P(), [], { ipu: reading });
    expect(d.ipu).toEqual({ value: 63, level: 1, label: "Moderate", station: "Cheras station · 10:00 AM", source: "Official reading, Department of Environment Malaysia" });
    expect(buildDashboard(makeReport(MODEL_AQ), P("ms"), [], { ipu: { ...reading, value: 150 } }).ipu).toMatchObject({ level: 3, label: "Tidak sihat", station: "Stesen Cheras · 10:00 AM" });
    expect(buildDashboard(makeReport(MODEL_AQ), P()).ipu).toBeNull();
    expect(buildDashboard(makeReport(null), P(), [], { ipu: reading }).ipu).not.toBeNull(); // independent of the AQI source
    expect(buildDashboard(makeReport(MODEL_AQ), P(), [], { ipu: null }).ipu).toBeNull();
  });
});

// ------------------------------------------------------------------ FR-15, FR-16
describe("day details and the hourly chart's numbers", () => {
  const d = buildDashboard(makeReport(MODEL_AQ), P());

  it("every day carries its details", () => {
    expect(d.daily).toHaveLength(7);
    const tomorrow = d.daily[1].detail;
    expect(tomorrow.periods.map((p) => p.label)).toEqual(["Morning", "Afternoon", "Evening"]);
    expect(tomorrow.periods[0]).toMatchObject({ icon: "partly-day", cond: "Partly cloudy", prob: 10 });
    expect(tomorrow.periods[2].icon).toBe("partly-night"); // the evening gets the night icon
    expect(tomorrow).toMatchObject({ rain: "Rain chance 10%", wind: "Wind up to 18 km/h", uv: "UV 9 · Very high", sun: "Sunrise 7:01 AM · Sunset 7:12 PM", best: "Best time outside: 5–10 PM" });
    expect(tomorrow.air).toBe("Expected peak ~95 around 3 PM (model) · Moderate");
    expect(tomorrow.tips.length).toBeGreaterThan(0);
  });

  it("today's details leave the best time and tips to their own card", () => {
    expect(d.daily[0].detail).toMatchObject({ best: null, tips: [] });
    expect(d.daily[0].detail.periods).toHaveLength(3);
  });

  it("lines without data are left out, not invented", () => {
    const far = d.daily[5].detail; // beyond the 3-day air forecast
    expect(far.air).toBeNull();
    expect(far.best).toBe("Best time outside: 5–10 PM");
    const rainy = buildDashboard(makeReport(null, { prob: 80 }), P()).daily[2].detail;
    expect(rainy.rain).toBe("Rain chance 80%");
    expect(rainy.best).toBe("No comfortable window outside");
    expect(rainy.air).toBeNull();
  });

  it("follows units, clock and language", () => {
    const f = buildDashboard(makeReport(MODEL_AQ), P("zh", { tempUnit: "f", windUnit: "ms", clock: "24" })).daily[1].detail;
    expect(f.periods.map((p) => p.label)).toEqual(["上午", "下午", "傍晚"]);
    expect(f.wind).toBe("风速最高 5.0 m/s");
    expect(f.sun).toBe("日出 07:01 · 日落 19:12");
    expect(f.periods[1].temp).toBe("87°"); // mean of 12:00-17:00, 30.6 °C
  });

  it("the chart gets a plain number per hour, in the person's unit", () => {
    expect(d.hourly.map((h) => h.t).every((t) => typeof t === "number")).toBe(true);
    expect(d.hourly[0].t).toBe(29);
    expect(buildDashboard(makeReport(MODEL_AQ), P("en", { tempUnit: "f" })).hourly[0].t).toBe(84.2);
    const r = makeReport(MODEL_AQ);
    r.wx.hourly.temperature_2m[34] = null; // one unknown hour
    expect(buildDashboard(r, P()).hourly[2]).toMatchObject({ t: null, temp: "–" });
  });

  it("the demo carries a made-up official reading so the block can be reviewed", () => {
    const demo = demoReport("storm", "en", NOW);
    expect(demo.ipu).toMatchObject({ name: "Cheras", value: 95 });
    expect(buildDashboard(demo.report, P(), demo.warnings, { demo: true, ipu: demo.ipu })).toMatchObject({ demo: true, ipu: { value: 95, level: 1 } });
  });
});

// ------------------------------------------------------------------ v2.5: FR-19 .. FR-23
describe("v2.5: a day hour by hour, home place, haze, alerts", () => {
  const d = buildDashboard(makeReport(MODEL_AQ), P());

  it("FR-19 every future day carries its 24 hours; today leaves that to the 'next 24 hours' strip", () => {
    expect(d.daily[0].detail.hours).toEqual([]);
    for (const day of d.daily.slice(1)) expect(day.detail.hours).toHaveLength(24);
    const tomorrow = d.daily[1].detail.hours;
    expect(tomorrow[0]).toEqual({ label: "12 AM", icon: "partly-night", cond: "Partly cloudy", temp: "26°", t: 26, prob: 10 });
    expect(tomorrow[12]).toMatchObject({ label: "12 PM", icon: "partly-day", temp: "32°", t: 32 });
    expect(tomorrow[23].label).toBe("11 PM");
    const f = buildDashboard(makeReport(MODEL_AQ), P("zh", { tempUnit: "f", clock: "24" })).daily[1].detail.hours;
    expect(f[12]).toMatchObject({ label: "12:00", temp: "90°", t: 89.6, cond: "局部多云" });
  });

  it("FR-19 a day with no hourly data simply has no strip", () => {
    const r = makeReport(MODEL_AQ);
    const cut = r.wx.hourly.time.findIndex((x) => x.startsWith(r.wx.daily.time[3]));
    for (const key of Object.keys(r.wx.hourly) as (keyof typeof r.wx.hourly)[]) (r.wx.hourly[key] as unknown[]).length = cut; // the backup source can be shorter
    const short = buildDashboard(r, P());
    expect(short.daily[1].detail.hours).toHaveLength(24);
    expect(short.daily[2].detail.hours).toEqual([]);
    expect(short.daily[2].detail.best).toBeNull();
    expect(short.daily).toHaveLength(7); // the daily rows themselves are unaffected
  });

  it("FR-20 the home place is listed first, kept when the list is full, and there is only one", () => {
    const place = (name: string, i: number, home?: boolean) => ({ name, lat: 1 + i, lon: 100 + i, country: "Malaysia", tz: "Asia/Kuala_Lumpur", region: "", district: "", ...(home ? { home: true } : {}) });
    const list = [place("A", 1), place("B", 2), place("Home", 3, true), place("C", 4), place("Second home", 5, true)];
    const u = makeUser({ lat: 2, lon: 101, placeName: "A", placesJson: JSON.stringify(list) });
    const seen = savedPlaces(u);
    expect(seen.map((p) => p.name)).toEqual(["Home", "A", "B", "C", "Second home"]);
    expect(seen.filter((p) => p.home).map((p) => p.name)).toEqual(["Home"]);
    // seven stored: the cut drops from the end, never the home
    const many = [...Array.from({ length: 6 }, (_, i) => place(`P${i}`, 10 + i)), place("Home", 3, true)];
    const full = savedPlaces(makeUser({ lat: 11, lon: 110, placeName: "P0", placesJson: JSON.stringify(many) }));
    expect(full).toHaveLength(MAX_PLACES);
    expect(full[0]).toMatchObject({ name: "Home", home: true });
    const dash = buildDashboard(makeReport(MODEL_AQ), P(), [], { user: u });
    expect(dash.places[0]).toEqual({ name: "Home", label: "Home, Malaysia", active: false, home: true });
    expect(dash.places[1]).toMatchObject({ name: "A", active: true, home: false });
  });

  it("FR-21 haze follows the air: light from 101, heavy from 151 or an official IPU above 100", () => {
    expect([0, 50, 100, 101, 150, 151, 300].map((aqi) => hazeOf(aqi, null))).toEqual([0, 0, 0, 1, 1, 2, 2]);
    expect(hazeOf(60, 100)).toBe(0);
    expect(hazeOf(60, 101)).toBe(2);
    expect(hazeOf(null, 150)).toBe(2);
    expect([hazeOf(null, null), hazeOf(undefined, undefined)]).toEqual([0, 0]); // no reading: no haze is claimed
    expect(buildDashboard(makeReport(MODEL_AQ), P()).scene.haze).toBe(0);
    expect(buildDashboard(makeReport({ ...MODEL_AQ, aqi: 120 }), P()).scene.haze).toBe(1);
    expect(buildDashboard(makeReport({ ...MODEL_AQ, aqi: 170 }), P()).scene).toMatchObject({ kind: "partly", haze: 2 }); // the weather scene itself is unchanged
    expect(buildDashboard(makeReport(null), P()).scene.haze).toBe(0);
    const demo = demoReport("haze", "en", NOW);
    expect(buildDashboard(demo.report, P(), [], { demo: true, ipu: demo.ipu }).scene).toMatchObject({ kind: "partly", haze: 2 });
  });

  it("FR-23 alerts carry the dashboard button when its address is known, and keep it after muting", () => {
    const rows = (m: any) => m.inline_keyboard as any[][];
    for (const kind of ["rain", "aqi", "warn"] as const) {
      const plain = rows(alertKeyboard(kind, "en"));
      expect(plain).toEqual([[{ text: "🔕 Mute these alerts", callback_data: `mute:${kind}` }], [{ text: "📋 Full report", callback_data: "v:now" }]]);
      expect(rows(alertKeyboard(kind, "en", null))).toEqual(plain);
      const withApp = rows(alertKeyboard(kind, "en", "https://x.dev/app/"));
      expect(withApp[0]).toEqual(plain[0]);
      expect(withApp[1]).toEqual([{ text: "📋 Full report", callback_data: "v:now" }, { text: "📱 Open dashboard", web_app: { url: "https://x.dev/app/" } }]);
    }
    expect(afterAlertRow("ms", "https://x.dev/app/")[1]).toEqual({ text: "📱 Buka papan pemuka", web_app: { url: "https://x.dev/app/" } });
    expect(afterAlertRow("en")).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ security assessment: regression tests for the fixes
describe("security fixes (docs/SECURITY-ASSESSMENT.md)", () => {
  it("S-01 only real language codes are languages, not names every object inherits", () => {
    for (const bad of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "", "EN", "en ", "fr", null, undefined, 1, {}, ["en"]]) {
      expect(isLang(bad), String(bad)).toBe(false);
      expect(normLang(bad as string), String(bad)).toBe("en");
      expect(parseSettingsChange({ lang: bad }), String(bad)).toBeNull();
    }
    expect([isLang("en"), isLang("ms"), isLang("zh")]).toEqual([true, true, true]);
    expect([normLang("ms"), normLang("zh")]).toEqual(["ms", "zh"]);
  });

  it("S-04 secrets compare equal only when identical, whatever their lengths", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    for (const [a, b] of [["abc123", "abc124"], ["abc123", "abc12"], ["abc12", "abc123"], ["", "a"], ["a", ""], ["abc", "ABC"], ["a\u0000", "a"], ["aa", "a"]]) expect(safeEqual(a, b), `${a} / ${b}`).toBe(false);
    expect(safeEqual("", "")).toBe(true); // callers refuse an empty expected secret before comparing
  });

  it("S-03 a body is read only up to the limit, declared or streamed", async () => {
    const req = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("https://x.dev/api", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);
    expect(await readLimited(req("12345"), 10)).toEqual(new TextEncoder().encode("12345"));
    expect(await readLimited(req("x".repeat(11)), 10)).toBeNull();
    expect(await readLimited(req("x".repeat(10)), 10)).toHaveLength(10);
    expect(await readLimited(req("ok", { "content-length": "999999" }), 10), "a declared length over the limit is refused unread").toBeNull();
    expect(await readLimited(req(null), 10)).toHaveLength(0);
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1024));
      },
    });
    expect(await readLimited(req(endless), 5000), "a stream with no declared length").toBeNull();
    expect(pulled, "reading stopped soon after the limit, not at the end of the stream").toBeLessThan(20);
  });
});

describe("S-02 /setup can have its own key", () => {
  const call = async (env: Record<string, string>, key: string) => {
    const worker = (await import("../src/index")).default;
    // Telegram is unreachable here on purpose: getting PAST the key check shows up as a 500 from the failed call, not a 403
    const res = await worker.fetch(new Request(`https://x.dev/setup?key=${key}`), { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_API_BASE: "http://127.0.0.1:1", ...env } as never, {} as never);
    return res.status;
  };

  it("without SETUP_KEY the webhook secret opens /setup, as before", async () => {
    expect(await call({ WEBHOOK_SECRET: "hook" }, "hook")).toBe(500);
    expect(await call({ WEBHOOK_SECRET: "hook" }, "nope")).toBe(403);
    expect(await call({ WEBHOOK_SECRET: "hook" }, "")).toBe(403);
  });

  it("with SETUP_KEY only that key works: the webhook secret no longer does", async () => {
    expect(await call({ WEBHOOK_SECRET: "hook", SETUP_KEY: "setup" }, "setup")).toBe(500);
    expect(await call({ WEBHOOK_SECRET: "hook", SETUP_KEY: "setup" }, "hook")).toBe(403);
    expect(await call({ WEBHOOK_SECRET: "", SETUP_KEY: "setup" }, "setup"), "no webhook secret configured: refuse").toBe(403);
    expect(await call({ WEBHOOK_SECRET: "", SETUP_KEY: "" }, ""), "nothing configured: an empty key must not match").toBe(403);
  });

  it("plain answers carry nosniff and are never cached", async () => {
    const worker = (await import("../src/index")).default;
    const res = await worker.fetch(new Request("https://x.dev/"), { WEBHOOK_SECRET: "hook" } as never, {} as never);
    expect([res.headers.get("x-content-type-options"), res.headers.get("cache-control")]).toEqual(["nosniff", "no-store"]);
  });
});
