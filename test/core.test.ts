import { describe, expect, it } from "vitest";
import { MAX_PER_TICK, isDue, lastSentAfterChange, minutesLate } from "../src/daily";
import { SECTIONS, aqiBand, hourlyMessage, tips, uvLabel, weatherMessage } from "../src/format";
import { botCommands } from "../src/handlers";
import * as i18n from "../src/i18n";
import { T, t } from "../src/i18n";
import * as kb from "../src/keyboards";
import { DEFAULT_PLACE, PRESET_COUNT, matchPreset, nearestPreset, presetPlace } from "../src/presets";
import { fill, haversineKm, localParts, normaliseTime, parseIdList, safeEqual, escapeHtml } from "../src/util";
import { placeLabel } from "../src/weather";
import { MODEL_AQ, STATION_AQ, makeReport, makeUser } from "./fixtures";

describe("i18n", () => {
  it("every key has all 3 translations with identical placeholders", () => {
    const fields = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [key, row] of Object.entries(T)) {
      expect(row, key).toHaveLength(3);
      row.forEach((s) => expect(s.length, `${key} is empty`).toBeGreaterThan(0));
      expect(fields(row[1]), `${key} (ms)`).toBe(fields(row[0]));
      expect(fields(row[2]), `${key} (zh)`).toBe(fields(row[0]));
    }
  });

  it("falls back to English for an unknown language and throws on unknown keys", () => {
    expect(i18n.normLang("fr")).toBe("en");
    expect(t("fr" as never, "b_back")).toBe("⬅ Back");
    expect(() => t("en", "nope")).toThrow();
  });

  it("formats dates and clocks without touching the server timezone", () => {
    expect(i18n.dateLong("2026-11-03T08:15", "en")).toBe("Tuesday, 3 November");
    expect(i18n.dateLong("2026-11-03T08:15", "ms")).toBe("Selasa, 3 November");
    expect(i18n.dateLong("2026-11-03T08:15", "zh")).toBe("11月3日 星期二");
    expect(i18n.weekday("2026-11-08", "en", true)).toBe("Sun");
    expect(i18n.clock("2026-11-03T00:05", "en")).toBe("12:05 AM");
    expect(i18n.clock("2026-11-03T13:45", "en")).toBe("1:45 PM");
    expect(i18n.clock("2026-11-03T07:01", "zh")).toBe("07:01");
    expect(i18n.hourLabel("2026-11-03T12:00", "ms")).toBe("12 PM");
  });

  it("uses proper compass names (not letter swaps) for ms and zh", () => {
    expect(i18n.compassDir(45, "en")).toBe("NE");
    expect(i18n.compassDir(45, "zh")).toBe("东北");
    expect(i18n.compassDir(45, "ms")).toBe("TL");
    expect(i18n.compassDir(359, "zh")).toBe("北");
    expect(i18n.compassDir(180, "ms")).toBe("S");
  });
});

describe("report formatting", () => {
  it("renders the core fields in English", () => {
    const text = weatherMessage(makeReport(MODEL_AQ));
    expect(text).toContain("Kuala Lumpur, Malaysia");
    expect(text).toContain("Tuesday, 3 November");
    expect(text).toContain("28°C");
    expect(text).toContain("78%");
    expect(text).toContain("NE");
    expect(text).toContain("AQI 62");
    expect(text).toContain("Moderate");
    expect(text).toContain("7:01 AM");
    expect(text).toContain("7:12 PM");
    expect(text.length).toBeLessThan(4096);
  });

  it("shows the measured station and adds a health tip for AQI > 100", () => {
    const text = weatherMessage(makeReport(STATION_AQ));
    expect(text).toContain("AQI 112");
    expect(text).toContain("Unhealthy for sensitive groups");
    expect(text).toContain("Cheras, Kuala Lumpur station (4 km)");
    expect(text).toContain("limit outdoor activity");
  });

  it("describes rain correctly", () => {
    expect(weatherMessage(makeReport(MODEL_AQ, { prob: 5 }))).toContain("No rain expected");
    expect(weatherMessage(makeReport(MODEL_AQ, { prob: 80 }))).toContain("Rain likely");
    expect(weatherMessage(makeReport(MODEL_AQ, { prob: 80, code: 63, precip: 1.2 }))).toContain("Raining now");
    expect(weatherMessage(makeReport(MODEL_AQ, { prob: 80 })).toLowerCase()).toContain("umbrella");
  });

  it("copes with missing air quality and null rain probabilities", () => {
    const rep = makeReport(null);
    rep.wx.hourly.precipitation_probability = rep.wx.hourly.precipitation_probability.map(() => null);
    expect(weatherMessage(rep)).toContain("Unavailable");
  });

  it("renders Malay and Chinese with no English leftovers", () => {
    const zh = weatherMessage(makeReport(MODEL_AQ, { prob: 80 }), "zh");
    for (const s of ["11月3日 星期二", "湿度", "空气质量", "记得带伞", "东北", "局部多云", "07:01"]) expect(zh).toContain(s);
    expect(zh).not.toContain("Humidity");
    const ms = weatherMessage(makeReport(MODEL_AQ, { prob: 80 }), "ms");
    for (const s of ["Selasa, 3 November", "Kelembapan", "Bawa payung", "Sederhana", "Separa mendung", "Rab"]) expect(ms).toContain(s);
    expect(ms).not.toContain("Humidity");
  });

  it("hides sections but always keeps the header and footer", () => {
    const full = weatherMessage(makeReport(MODEL_AQ, { prob: 80 }));
    const markers: Record<string, string> = { air: "Air quality", rain: "Rain outlook", forecast: "Next days", tips: "Tips", details: "Humidity", sun: "🌅" };
    for (const s of SECTIONS) {
      expect(full).toContain(markers[s]);
      const text = weatherMessage(makeReport(MODEL_AQ, { prob: 80 }), "en", new Set([s]));
      expect(text, s).not.toContain(markers[s]);
      expect(text).toContain("28°C");
    }
    const bare = weatherMessage(makeReport(MODEL_AQ), "en", new Set(SECTIONS));
    expect(bare).toContain("Kuala Lumpur");
    expect(bare).toContain("Observed");
    expect(bare).not.toContain("┈");
  });

  it("escapes HTML in place names", () => {
    const rep = makeReport();
    rep.place = { name: "<b>Evil</b> & Co", lat: 1, lon: 1, country: "", tz: "UTC" };
    expect(weatherMessage(rep)).toContain("&lt;b&gt;Evil&lt;/b&gt; &amp; Co");
    expect(escapeHtml("a<b&c>")).toBe("a&lt;b&amp;c&gt;");
  });

  it("renders the hourly view in every language", () => {
    expect(hourlyMessage(makeReport(MODEL_AQ, { prob: 40 }))).toContain("Next 12 hours");
    expect(hourlyMessage(makeReport(MODEL_AQ), "zh")).toContain("未来12小时");
    expect(hourlyMessage(makeReport(MODEL_AQ), "ms")).toContain("12 jam akan datang");
    expect(hourlyMessage(makeReport(MODEL_AQ, { prob: 40 }))).toContain("▰");
  });

  it("classifies AQI / UV / tips", () => {
    expect(aqiBand(50, "en")[1]).toBe("Good");
    expect(aqiBand(51, "en")[1]).toBe("Moderate");
    expect(aqiBand(301, "en")[1]).toBe("Hazardous");
    expect(uvLabel(2.9, "en")).toBe("Low");
    expect(uvLabel(11, "en")).toBe("Extreme");
    expect(tips(makeReport(null, { prob: 0, uv: 1, feels: 25 }), "en")).toEqual(["😎 Conditions look comfortable"]);
  });
});

describe("places & utilities", () => {
  it("labels places without duplicating the country", () => {
    expect(placeLabel(presetPlace(9, "en"))).toBe("Singapore");
    expect(placeLabel(presetPlace(9, "zh"))).toBe("新加坡");
    expect(placeLabel(presetPlace(3, "zh"))).toBe("乔治市（槟城）, 马来西亚");
    expect(placeLabel(DEFAULT_PLACE)).toBe("Kuala Lumpur, Malaysia");
  });

  it("matches presets by coordinates", () => {
    expect(matchPreset(3.139, 101.6869)).toBe(0);
    expect(matchPreset(3.2, 101.7)).toBeNull();
    expect(nearestPreset(3.15, 101.7, 25, haversineKm)).toBe(0);
    expect(nearestPreset(35, 139, 25, haversineKm)).toBeNull();
  });

  it("parses times and id lists", () => {
    expect(normaliseTime("8:30")).toBe("08:30");
    expect(normaliseTime("24:00")).toBeNull();
    expect(normaliseTime("abc")).toBeNull();
    expect(parseIdList("1, 2 3,x,-4")).toEqual([1, 2, 3, -4]);
    expect(parseIdList(undefined)).toEqual([]);
    expect(fill("a {x} {y}", { x: 1 })).toBe("a 1 {y}");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(Math.round(haversineKm(3.139, 101.687, 1.352, 103.82))).toBeGreaterThan(300);
  });

  it("converts instants to local date/time in any timezone", () => {
    const at = new Date("2026-11-03T00:30:00Z");
    expect(localParts("Asia/Kuala_Lumpur", at)).toEqual({ date: "2026-11-03", time: "08:30" });
    expect(localParts("Asia/Tokyo", at)).toEqual({ date: "2026-11-03", time: "09:30" });
    expect(localParts("America/New_York", at)).toEqual({ date: "2026-11-02", time: "19:30" });
    expect(() => localParts("Not/AZone", at)).toThrow();
  });
});

describe("daily schedule (multi-user, per-timezone)", () => {
  const utc = (h: number, m: number) => new Date(Date.UTC(2026, 10, 3, h, m));

  it("sends at the user's own local time, in any timezone", () => {
    const kl = makeUser({ tz: "Asia/Kuala_Lumpur", dailyTime: "08:30" });
    const tokyo = makeUser({ tz: "Asia/Tokyo", dailyTime: "08:30" });
    expect(isDue(kl, utc(0, 30))).toBe(true); // 08:30 in KL
    expect(isDue(tokyo, utc(22, 0))).toBe(false); // only 07:00 in Tokyo: not yet
    expect(isDue(tokyo, utc(23, 30))).toBe(true); // 08:30 in Tokyo
    expect(isDue(kl, utc(0, 29))).toBe(false); // one minute early
  });

  it("catches up after an outage, but only inside the window", () => {
    const u = makeUser();
    expect(isDue(u, utc(0, 31))).toBe(true);
    expect(isDue(u, utc(2, 30))).toBe(true); // exactly 120 min late
    expect(isDue(u, utc(2, 31))).toBe(false); // too late: wait for tomorrow
  });

  it("never sends twice on the same local day", () => {
    expect(isDue(makeUser({ lastSent: "2026-11-03" }), utc(0, 30))).toBe(false);
    expect(isDue(makeUser({ lastSent: "2026-11-02" }), utc(0, 30))).toBe(true);
  });

  it("skips users with an invalid timezone instead of crashing", () => {
    expect(minutesLate(makeUser({ tz: "Nope/Zone" }), utc(0, 30))).toBeNull();
    expect(isDue(makeUser({ tz: "Nope/Zone" }), utc(0, 30))).toBe(false);
  });

  it("doesn't fire a late report right after a setting change", () => {
    expect(lastSentAfterChange("Asia/Kuala_Lumpur", "08:30", utc(6, 0))).toBe("2026-11-03"); // 14:00 local: 08:30 already passed
    expect(lastSentAfterChange("Asia/Kuala_Lumpur", "08:30", utc(0, 0))).toBe(""); // 08:00 local: still upcoming
    expect(lastSentAfterChange("Nope/Zone", "08:30")).toBe("");
  });

  it("caps work per tick to stay within the free plan's request limit", () => {
    expect(MAX_PER_TICK).toBeLessThanOrEqual(10);
  });
});

describe("telegram payload limits", () => {
  const byteLen = (s: string) => new TextEncoder().encode(s).length;
  const allCallbacks = (markup: any): string[] => (markup.inline_keyboard ?? []).flat().map((b: any) => b.callback_data);

  it("keeps every callback_data within Telegram's 64-byte limit", () => {
    const u = makeUser();
    const results = Array.from({ length: 5 }, (_, i) => ({ name: `City ${i}`, lat: 1, lon: 1, country: "X", tz: "UTC" }));
    const all = [
      ...allCallbacks(kb.reportKeyboard(u, "now")),
      ...allCallbacks(kb.reportKeyboard(u, "hourly")),
      ...allCallbacks(kb.locationMenu("zh")),
      ...allCallbacks(kb.settingsKeyboard(u)),
      ...allCallbacks(kb.resultsKeyboard(results, "en")),
      ...allCallbacks(kb.approvalKeyboard(9_999_999_999)),
      ...allCallbacks(kb.retryKeyboard("hourly", "en")),
    ];
    expect(all.length).toBeGreaterThan(20);
    all.forEach((d) => expect(byteLen(d)).toBeLessThanOrEqual(64));
    expect(PRESET_COUNT).toBe(10);
  });

  it("reflects hidden sections and the current language in Settings", () => {
    const rows = (kb.settingsKeyboard(makeUser({ hidden: new Set(["air"]), lang: "zh" })) as any).inline_keyboard.flat();
    expect(rows.find((b: any) => b.callback_data === "tg:air").text).toMatch(/^⬜/);
    expect(rows.find((b: any) => b.callback_data === "tg:tips").text).toMatch(/^✅/);
    expect(rows.find((b: any) => b.callback_data === "lang:zh").text).toMatch(/^●/);
    expect(rows.find((b: any) => b.callback_data === "lang:en").text).not.toMatch(/^●/);
  });

  it("recognises the bottom-bar buttons in every language", () => {
    for (const lang of ["en", "ms", "zh"] as const) {
      expect(kb.isButton(t(lang, "btn_now"), "btn_now")).toBe(true);
      expect(kb.isButton(t(lang, "btn_settings"), "btn_settings")).toBe(true);
    }
    expect(kb.isButton("Ipoh", "btn_city")).toBe(false);
  });

  it("builds valid command menus (names 1-32 chars, descriptions 3-256)", () => {
    for (const lang of ["en", "ms", "zh"] as const) {
      for (const admin of [false, true]) {
        for (const c of botCommands(lang, admin)) {
          expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
          expect(c.description.length).toBeGreaterThanOrEqual(3);
          expect(c.description.length).toBeLessThanOrEqual(256);
        }
      }
    }
    expect(botCommands("en", true).map((c) => c.command)).toContain("allow");
    expect(botCommands("en", false).map((c) => c.command)).not.toContain("allow");
  });
});
