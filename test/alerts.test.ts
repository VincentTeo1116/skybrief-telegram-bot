import { describe, expect, it } from "vitest";
import {
  AQI_COOLDOWN_MS,
  AQI_RECOVERY_MARGIN,
  DEFAULT_QUIET_HOURS,
  RAIN_COOLDOWN_MS,
  decideAqi,
  decideRain,
  inQuietHours,
  parseQuietHours,
} from "../src/alerts";
import { STATION_AQ, makeReport, makeUser } from "./fixtures";

const NOW = Date.UTC(2026, 10, 3, 3, 0); // 11:00 in Kuala Lumpur
const HOUR = 3_600_000;
const aqiReport = (aqi: number) => makeReport({ ...STATION_AQ, aqi });

describe("quiet hours", () => {
  it("defaults to 22:00-06:30 and understands custom windows", () => {
    expect(parseQuietHours(undefined)).toEqual({ start: 22 * 60, end: 6 * 60 + 30 });
    expect(parseQuietHours(DEFAULT_QUIET_HOURS)).toEqual({ start: 1320, end: 390 });
    expect(parseQuietHours("23:30-05:00")).toEqual({ start: 23 * 60 + 30, end: 5 * 60 });
    expect(parseQuietHours(" 9:00 - 17:30 ")).toEqual({ start: 540, end: 1050 });
  });

  it("can be switched off, and falls back to the default for nonsense", () => {
    expect(parseQuietHours("off")).toBeNull();
    expect(parseQuietHours("NONE")).toBeNull();
    expect(parseQuietHours("late at night")).toEqual({ start: 1320, end: 390 });
    expect(parseQuietHours("25:00-06:00")).toEqual({ start: 1320, end: 390 });
  });

  it("is quiet overnight in the user's own timezone", () => {
    const q = parseQuietHours(undefined);
    const klAt = (h: number, m: number) => new Date(Date.UTC(2026, 10, 3, h - 8, m)); // build a KL wall-clock time
    expect(inQuietHours("Asia/Kuala_Lumpur", klAt(21, 59), q)).toBe(false);
    expect(inQuietHours("Asia/Kuala_Lumpur", klAt(22, 0), q)).toBe(true);
    expect(inQuietHours("Asia/Kuala_Lumpur", klAt(23, 30), q)).toBe(true);
    expect(inQuietHours("Asia/Kuala_Lumpur", klAt(3, 0), q)).toBe(true);
    expect(inQuietHours("Asia/Kuala_Lumpur", klAt(6, 29), q)).toBe(true);
    expect(inQuietHours("Asia/Kuala_Lumpur", klAt(6, 30), q)).toBe(false);
    // the same instant is daytime in London but night in Tokyo
    const instant = new Date(Date.UTC(2026, 10, 3, 14, 0));
    expect(inQuietHours("Europe/London", instant, q)).toBe(false);
    expect(inQuietHours("Asia/Tokyo", instant, q)).toBe(true); // 23:00 JST
  });

  it("supports a same-day window and 'off'", () => {
    const lunch = parseQuietHours("12:00-13:00");
    expect(inQuietHours("UTC", new Date(Date.UTC(2026, 10, 3, 12, 30)), lunch)).toBe(true);
    expect(inQuietHours("UTC", new Date(Date.UTC(2026, 10, 3, 13, 0)), lunch)).toBe(false);
    expect(inQuietHours("Asia/Kuala_Lumpur", new Date(Date.UTC(2026, 10, 3, 18, 0)), null)).toBe(false);
  });

  it("treats an unknown timezone as quiet (better silent than wrong)", () => {
    expect(inQuietHours("Nope/Zone", new Date(), parseQuietHours(undefined))).toBe(true);
  });
});

describe("rain alert decision", () => {
  const wet = makeReport(null, { rainAt: 1 });

  it("alerts a user who opted in when rain is imminent", () => {
    expect(decideRain(makeUser({ rainAlerts: true }), wet, NOW)).toEqual({ time: "2026-11-03T09:00", prob: 85, mm: 1.5 });
  });

  it("never alerts users who haven't opted in", () => {
    expect(decideRain(makeUser({ rainAlerts: false }), wet, NOW)).toBeNull();
  });

  it("stays quiet during the 3-hour cooldown, then speaks again", () => {
    const u = (ago: number) => makeUser({ rainAlerts: true, lastRainAlert: NOW - ago });
    expect(decideRain(u(RAIN_COOLDOWN_MS - 1), wet, NOW)).toBeNull();
    expect(decideRain(u(RAIN_COOLDOWN_MS), wet, NOW)).not.toBeNull();
    expect(decideRain(u(10 * HOUR), wet, NOW)).not.toBeNull();
  });

  it("says nothing on dry days or when rain is already falling", () => {
    expect(decideRain(makeUser({ rainAlerts: true }), makeReport(null), NOW)).toBeNull();
    expect(decideRain(makeUser({ rainAlerts: true }), makeReport(null, { rainAt: 1, precip: 2 }), NOW)).toBeNull();
  });
});

describe("air-quality alert decision", () => {
  const u = (o = {}) => makeUser({ aqiAlert: 101, ...o });

  it("is off by default and when the reading is unknown", () => {
    expect(decideAqi(makeUser({ aqiAlert: 0 }), aqiReport(300), NOW)).toEqual({ send: false, patch: {} });
    expect(decideAqi(u(), makeReport(null), NOW)).toEqual({ send: false, patch: {} });
  });

  it("alerts when AQI reaches the chosen level, and remembers it", () => {
    expect(decideAqi(u(), aqiReport(100), NOW)).toEqual({ send: false, patch: {} });
    expect(decideAqi(u(), aqiReport(101), NOW)).toEqual({ send: true, patch: { aqiAlertActive: true, lastAqiAlert: NOW } });
    expect(decideAqi(u({ aqiAlert: 151 }), aqiReport(120), NOW).send).toBe(false);
    expect(decideAqi(u({ aqiAlert: 151 }), aqiReport(155), NOW).send).toBe(true);
  });

  it("does not repeat while the air stays bad", () => {
    expect(decideAqi(u({ aqiAlertActive: true, lastAqiAlert: NOW - 10 * HOUR }), aqiReport(180), NOW)).toEqual({ send: false, patch: {} });
  });

  it("re-arms only after AQI has clearly recovered (10 points below the level)", () => {
    const active = u({ aqiAlertActive: true, lastAqiAlert: NOW - 10 * HOUR });
    const threshold = 101 - AQI_RECOVERY_MARGIN; // 91
    expect(decideAqi(active, aqiReport(threshold), NOW).patch).toEqual({}); // 91 isn't recovered yet
    expect(decideAqi(active, aqiReport(threshold - 1), NOW).patch).toEqual({ aqiAlertActive: false });
  });

  it("a value hovering around the level can't cause a flood: cooldown applies even after recovery", () => {
    const recovered = u({ aqiAlertActive: false, lastAqiAlert: NOW - AQI_COOLDOWN_MS + 1 });
    expect(decideAqi(recovered, aqiReport(150), NOW).send).toBe(false);
    expect(decideAqi({ ...recovered, lastAqiAlert: NOW - AQI_COOLDOWN_MS }, aqiReport(150), NOW).send).toBe(true);
  });
});
