import { describe, expect, it } from "vitest";
import { MAX_PER_TICK, dueItems, isDue, lastSentAfterChange, minutesLate } from "../src/daily";
import { SECTIONS } from "../src/format";
import { botCommands } from "../src/handlers";
import * as i18n from "../src/i18n";
import { T, t } from "../src/i18n";
import * as kb from "../src/keyboards";
import { DEFAULT_PLACE, PRESET_COUNT, matchPreset, nearestPreset, presetPlace } from "../src/presets";
import { AQI_ALERT_LEVELS, deg, deltaDisplay, speed, unitLetter } from "../src/units";
import { escapeHtml, fill, haversineKm, localParts, normaliseTime, parseIdList, safeEqual } from "../src/util";
import { placeLabel } from "../src/weather";
import { makeUser } from "./fixtures";

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

  it("translated text never leaves an English-only gap for the new features", () => {
    for (const key of ["sec_best", "aqi_rising", "best_today", "alert_rain", "alert_aqi", "evening_on_msg", "settings_alerts", "inline_hint_title"]) {
      expect(T[key][1], `${key} (ms) is just the English text`).not.toBe(T[key][0]);
      expect(T[key][2], `${key} (zh) is just the English text`).not.toBe(T[key][0]);
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
    expect(i18n.isWeekend("2026-11-07")).toBe(true);
    expect(i18n.isWeekend("2026-11-08")).toBe(true);
    expect(i18n.isWeekend("2026-11-03")).toBe(false);
    expect(i18n.clock("2026-11-03T00:05", "en")).toBe("12:05 AM");
    expect(i18n.clock("2026-11-03T13:45", "en")).toBe("1:45 PM");
    expect(i18n.clock("2026-11-03T07:01", "zh")).toBe("07:01");
    expect(i18n.hourLabel("2026-11-03T12:00", "ms")).toBe("12 PM");
  });

  it("honours the 12h / 24h clock override in every language", () => {
    expect(i18n.clock("2026-11-03T13:45", "en", "24")).toBe("13:45");
    expect(i18n.clock("2026-11-03T13:45", "ms", "24")).toBe("13:45");
    expect(i18n.clock("2026-11-03T13:45", "zh", "12")).toBe("下午1:45");
    expect(i18n.clock("2026-11-03T07:01", "zh", "12")).toBe("上午7:01");
    expect(i18n.clock("2026-11-03T13:45", "en", "auto")).toBe("1:45 PM");
    expect(i18n.hourLabel("2026-11-03T15:00", "en", "24")).toBe("15:00");
    expect(i18n.hourLabel("2026-11-03T15:00", "zh", "12")).toBe("下午3时");
  });

  it("builds readable time ranges", () => {
    const r = (a: string, b: string, lang: "en" | "ms" | "zh" = "en", mode: "auto" | "12" | "24" = "auto") =>
      i18n.rangeLabel(`2026-11-03T${a}`, b.length > 5 ? b : `2026-11-03T${b}`, lang, mode);
    expect(r("07:00", "09:00")).toBe("7–9 AM");
    expect(r("11:00", "13:00")).toBe("11 AM–1 PM");
    expect(r("17:00", "22:00")).toBe("5–10 PM");
    expect(r("12:00", "14:00")).toBe("12–2 PM");
    expect(r("23:00", "2026-11-04T00:00")).toBe("11 PM–12 AM");
    expect(r("07:00", "09:00", "ms")).toBe("7–9 AM");
    expect(r("07:00", "09:00", "en", "24")).toBe("07:00–09:00");
    expect(r("07:00", "09:00", "zh")).toBe("07:00–09:00");
    expect(r("17:00", "22:00", "zh", "12")).toBe("下午5时–下午10时");
  });

  it("uses proper compass names (not letter swaps) for ms and zh", () => {
    expect(i18n.compassDir(45, "en")).toBe("NE");
    expect(i18n.compassDir(45, "zh")).toBe("东北");
    expect(i18n.compassDir(45, "ms")).toBe("TL");
    expect(i18n.compassDir(359, "zh")).toBe("北");
    expect(i18n.compassDir(180, "ms")).toBe("S");
  });
});

describe("units", () => {
  it("converts temperatures", () => {
    expect(deg(28.4, { tempUnit: "c" })).toBe("28°");
    expect(deg(28.4, { tempUnit: "f" })).toBe("83°");
    expect(deg(0, { tempUnit: "f" })).toBe("32°");
    expect(deg(-0.4, { tempUnit: "c" })).toBe("0°"); // never "-0°"
    expect(deg(null, { tempUnit: "c" })).toBe("–");
    expect(unitLetter({ tempUnit: "f" })).toBe("F");
  });

  it("converts temperature DIFFERENCES without the +32 offset", () => {
    expect(deltaDisplay(3, { tempUnit: "c" })).toBe(3);
    expect(deltaDisplay(3, { tempUnit: "f" })).toBe(5);
    expect(deltaDisplay(-2.6, { tempUnit: "c" })).toBe(3);
  });

  it("converts wind speed", () => {
    expect(speed(11.6, { windUnit: "kmh" })).toBe("12 km/h");
    expect(speed(11.6, { windUnit: "ms" })).toBe("3.2 m/s");
    expect(speed(40, { windUnit: "ms" })).toBe("11 m/s");
    expect(speed(11.6, { windUnit: "mph" })).toBe("7 mph");
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
    expect(escapeHtml("a<b&c>")).toBe("a&lt;b&amp;c&gt;");
    expect(Math.round(haversineKm(3.139, 101.687, 1.352, 103.82))).toBeGreaterThan(300);
  });

  it("converts instants to local date/time in any timezone", () => {
    const at = new Date("2026-11-03T00:30:00Z");
    expect(localParts("Asia/Kuala_Lumpur", at)).toEqual({ date: "2026-11-03", time: "08:30" });
    expect(localParts("Asia/Tokyo", at)).toEqual({ date: "2026-11-03", time: "09:30" });
    expect(localParts("America/New_York", at)).toEqual({ date: "2026-11-02", time: "19:30" });
    expect(() => localParts("Not/AZone", at)).toThrow();
  });

  it("formats midnight as 00:xx (never 24:xx) and handles date rollover and half-hour zones", () => {
    expect(localParts("Asia/Kuala_Lumpur", new Date("2026-11-02T16:05:00Z"))).toEqual({ date: "2026-11-03", time: "00:05" });
    expect(localParts("Europe/London", new Date("2026-11-03T00:00:00Z"))).toEqual({ date: "2026-11-03", time: "00:00" });
    expect(localParts("Asia/Kolkata", new Date("2026-11-03T08:00:00Z"))).toEqual({ date: "2026-11-03", time: "13:30" });
    expect(localParts("Pacific/Auckland", new Date("2026-11-02T20:00:00Z"))).toEqual({ date: "2026-11-03", time: "09:00" });
  });

  it("keeps working after a timezone has been used many times (formatters are cached) and after a bad one", () => {
    const at = new Date("2026-11-03T00:30:00Z");
    for (let i = 0; i < 50; i++) expect(localParts("Asia/Tokyo", at).time).toBe("09:30");
    expect(() => localParts("Bad/Zone", at)).toThrow();
    expect(() => localParts("Bad/Zone", at)).toThrow(); // a failure is not cached as "valid"
    expect(localParts("Asia/Tokyo", at).time).toBe("09:30");
  });
});

describe("scheduled reports (multi-user, per-timezone, two slots)", () => {
  const utc = (h: number, m: number) => new Date(Date.UTC(2026, 10, 3, h, m));

  it("sends the morning report at the user's own local time, in any timezone", () => {
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

  it("handles the evening slot independently of the morning slot", () => {
    const u = makeUser({ dailyOn: false, eveningOn: true, eveningTime: "18:00" });
    expect(isDue(u, utc(10, 0), "evening")).toBe(true); // 18:00 in KL
    expect(isDue(u, utc(9, 59), "evening")).toBe(false);
    expect(isDue(u, utc(10, 0), "morning")).toBe(false); // morning is off
    expect(isDue({ ...u, lastEvening: "2026-11-03" }, utc(10, 0), "evening")).toBe(false);
    expect(isDue(makeUser({ eveningOn: false }), utc(10, 0), "evening")).toBe(false);
  });

  it("morning and evening for the same person can both be due, as separate items", () => {
    const u = makeUser({ dailyTime: "18:00", eveningOn: true, eveningTime: "18:00" });
    const items = dueItems([u], utc(10, 0));
    expect(items.map((i) => i.slot).sort()).toEqual(["evening", "morning"]);
  });

  it("serves the freshest first (so stuck sends can't starve everyone) and caps work per tick", () => {
    const users = Array.from({ length: 12 }, (_, i) => makeUser({ chatId: i + 1, dailyTime: `08:${String(30 - i).padStart(2, "0")}` }));
    const items = dueItems(users, utc(0, 30)); // user 12 is 11 minutes late, user 1 exactly on time
    expect(items).toHaveLength(MAX_PER_TICK);
    expect(items[0].user.chatId).toBe(1); // on time
    expect(items.at(-1)!.user.chatId).toBe(8); // the 8 least-late are served; 9-12 wait for the next minute
    expect(items.map((i) => i.late)).toEqual([...items.map((i) => i.late)].sort((a, b) => a - b));
    expect(MAX_PER_TICK).toBeLessThanOrEqual(10);
  });
});

describe("telegram payload limits", () => {
  const byteLen = (s: string) => new TextEncoder().encode(s).length;
  const callbacks = (markup: any): string[] => (markup.inline_keyboard ?? []).flat().map((b: any) => b.callback_data);

  it("keeps every callback_data within Telegram's 64-byte limit", () => {
    const u = makeUser();
    const results = Array.from({ length: 5 }, (_, i) => ({ name: `City ${i}`, lat: 1, lon: 1, country: "X", tz: "UTC" }));
    const all = [
      ...kb.VIEWS.flatMap((v) => callbacks(kb.reportKeyboard(u, v))),
      ...callbacks(kb.locationMenu("zh")),
      ...kb.SETTINGS_PAGES.flatMap((p) => callbacks(kb.settingsView(u, p).markup)),
      ...callbacks(kb.resultsKeyboard(results, "en")),
      ...callbacks(kb.approvalKeyboard(9_999_999_999)),
      ...callbacks(kb.retryKeyboard("week", "en")),
      ...callbacks(kb.alertKeyboard("rain", "zh")),
      ...callbacks(kb.alertKeyboard("aqi", "ms")),
    ];
    expect(all.length).toBeGreaterThan(50);
    all.forEach((d) => expect(byteLen(d), d).toBeLessThanOrEqual(64));
    expect(PRESET_COUNT).toBe(10);
  });

  it("marks the current view in the navigation", () => {
    const text = (view: kb.View, cb: string) =>
      (kb.reportKeyboard(makeUser(), view) as any).inline_keyboard.flat().find((b: any) => b.callback_data === cb).text as string;
    expect(text("tomorrow", "v:tomorrow")).toMatch(/^● /);
    expect(text("tomorrow", "v:now")).not.toMatch(/^● /);
    expect(text("week", "v:week")).toMatch(/^● /);
    expect(kb.asView("bogus")).toBe("now");
    expect(kb.asView("week")).toBe("week");
  });

  it("settings menu leads to four pages and every page has a way back", () => {
    const u = makeUser();
    const menu = callbacks(kb.settingsView(u, "menu").markup);
    expect(menu).toEqual(["set:sec", "set:lang", "set:units", "set:alerts", "v:now"]);
    for (const page of ["sec", "lang", "units", "alerts"] as const) {
      expect(callbacks(kb.settingsView(u, page).markup).at(-1), page).toBe("set");
    }
  });

  it("sections page reflects hidden sections (7 of them, including best time)", () => {
    expect(SECTIONS).toHaveLength(7);
    const rows = (kb.settingsView(makeUser({ hidden: new Set(["air", "best"]) }), "sec").markup as any).inline_keyboard.flat();
    expect(rows.find((b: any) => b.callback_data === "tg:air").text).toMatch(/^⬜/);
    expect(rows.find((b: any) => b.callback_data === "tg:best").text).toMatch(/^⬜/);
    expect(rows.find((b: any) => b.callback_data === "tg:tips").text).toMatch(/^✅/);
    expect(rows.filter((b: any) => b.callback_data.startsWith("tg:"))).toHaveLength(7);
  });

  it("language page marks the current language", () => {
    const rows = (kb.settingsView(makeUser({ lang: "zh" }), "lang").markup as any).inline_keyboard.flat();
    expect(rows.find((b: any) => b.callback_data === "lang:zh").text).toMatch(/^●/);
    expect(rows.find((b: any) => b.callback_data === "lang:en").text).not.toMatch(/^●/);
  });

  it("units page reflects the saved units", () => {
    const rows = (kb.settingsView(makeUser({ tempUnit: "f", windUnit: "ms", clock: "24", compact: true }), "units").markup as any).inline_keyboard.flat();
    const label = (cb: string) => rows.find((b: any) => b.callback_data === cb).text as string;
    expect(label("u:t:f")).toMatch(/^●/);
    expect(label("u:t:c")).not.toMatch(/^●/);
    expect(label("u:w:ms")).toMatch(/^●/);
    expect(label("u:c:24")).toMatch(/^●/);
    expect(label("u:k")).toMatch(/^✅/);
    expect(kb.settingsView(makeUser({ compact: false }), "units").markup).toBeTruthy();
  });

  it("alerts page reflects alert and evening-report state", () => {
    const rows = (kb.settingsView(makeUser({ rainAlerts: true, aqiAlert: 151, eveningOn: true, eveningTime: "19:30" }), "alerts").markup as any).inline_keyboard.flat();
    const label = (cb: string) => rows.find((b: any) => b.callback_data === cb).text as string;
    expect(label("al:rain")).toMatch(/^✅/);
    expect(label("al:aqi:151")).toMatch(/^●/);
    expect(label("al:aqi:0")).not.toMatch(/^●/);
    expect(label("al:eve")).toContain("19:30");
    expect(rows.filter((b: any) => b.callback_data.startsWith("al:aqi:")).map((b: any) => b.callback_data)).toEqual(AQI_ALERT_LEVELS.map((n) => `al:aqi:${n}`));
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
    const names = botCommands("en").map((c) => c.command);
    for (const c of ["weather", "hourly", "tomorrow", "week", "evening", "settings"]) expect(names).toContain(c);
    expect(botCommands("en", true).map((c) => c.command)).toContain("allow");
    expect(names).not.toContain("allow");
  });
});
