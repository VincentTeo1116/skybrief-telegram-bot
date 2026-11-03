import { describe, expect, it } from "vitest";
import {
  COMFORT,
  addDays,
  addHours,
  aqiOutlook,
  aqiPeakOn,
  bestOutside,
  bestWindow,
  dailyIndex,
  dayPeriods,
  hourIndex,
  hourPoints,
  hoursBetween,
  isComfortable,
  nextHours,
  rainAlert,
  trend,
  type HourPoint,
} from "../src/insights";
import { MODEL_AQ, NOW_INDEX, makeAirHourly, makeReport } from "./fixtures";

const at = (r: ReturnType<typeof makeReport>, iso: string) => {
  r.wx.current.time = iso;
  return r;
};
const pt = (hour: number, o: Partial<HourPoint> = {}): HourPoint => ({
  time: `2026-11-03T${String(hour).padStart(2, "0")}:00`,
  feels: 25,
  uv: 1,
  prob: 0,
  precip: 0,
  aqi: null,
  ...o,
});

describe("time helpers", () => {
  it("does calendar arithmetic on local strings, with no timezone involved", () => {
    expect(addHours("2026-11-03T23:00", 1)).toBe("2026-11-04T00:00");
    expect(addHours("2026-12-31T23:00", 2)).toBe("2027-01-01T01:00");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(hoursBetween("2026-11-03T08:00", "2026-11-03T11:00")).toBe(3);
  });

  it("finds today and the current hour even though the data starts yesterday", () => {
    const r = makeReport();
    expect(r.wx.daily.time[dailyIndex(r)]).toBe("2026-11-03");
    expect(r.wx.hourly.time[hourIndex(r)]).toBe("2026-11-03T08:00");
    expect(hourIndex(r)).toBe(NOW_INDEX);
    const rows = nextHours(r, 3);
    expect(rows.map((x) => x.time)).toEqual(["2026-11-03T08:00", "2026-11-03T09:00", "2026-11-03T10:00"]);
  });

  it("falls back to index 0 when the date isn't in the data", () => {
    const r = makeReport();
    r.wx.current.time = "2030-01-01T08:15";
    expect(dailyIndex(r)).toBe(0);
    expect(hourIndex(r)).toBe(0);
  });
});

describe("is this hour comfortable outside?", () => {
  it("accepts the boundaries and rejects just beyond them", () => {
    expect(isComfortable(pt(12, { feels: COMFORT.feelsMax }))).toBe(true);
    expect(isComfortable(pt(12, { feels: COMFORT.feelsMax + 0.1 }))).toBe(false);
    expect(isComfortable(pt(12, { feels: COMFORT.feelsMin }))).toBe(true);
    expect(isComfortable(pt(12, { feels: COMFORT.feelsMin - 0.1 }))).toBe(false);
    expect(isComfortable(pt(12, { uv: 5 }))).toBe(true);
    expect(isComfortable(pt(12, { uv: 5.1 }))).toBe(false);
    expect(isComfortable(pt(12, { prob: 39 }))).toBe(true);
    expect(isComfortable(pt(12, { prob: 40 }))).toBe(false);
    expect(isComfortable(pt(12, { precip: 0.29 }))).toBe(true);
    expect(isComfortable(pt(12, { precip: 0.3 }))).toBe(false);
    expect(isComfortable(pt(12, { aqi: 100 }))).toBe(true);
    expect(isComfortable(pt(12, { aqi: 101 }))).toBe(false);
  });

  it("only counts daytime-to-evening hours", () => {
    expect(isComfortable(pt(5))).toBe(false);
    expect(isComfortable(pt(6))).toBe(true);
    expect(isComfortable(pt(21))).toBe(true);
    expect(isComfortable(pt(22))).toBe(false);
  });

  it("treats unknown values (no UV, no AQI, no feels-like) as fine", () => {
    expect(isComfortable(pt(12, { feels: null, uv: null, aqi: null }))).toBe(true);
  });
});

describe("bestWindow", () => {
  it("returns the longest run of comfortable hours", () => {
    const pts = [7, 8, 9, 10, 11, 12].map((h) => pt(h, { prob: h >= 10 && h <= 10 ? 90 : 0 }));
    // 7,8,9 good; 10 bad; 11,12 good -> longest is 7-10
    expect(bestWindow(pts)).toEqual({ start: "2026-11-03T07:00", end: "2026-11-03T10:00" });
  });

  it("prefers the earlier window on a tie", () => {
    const pts = [7, 8, 9, 10, 11].map((h) => pt(h, { prob: h === 9 ? 90 : 0 }));
    expect(bestWindow(pts)).toEqual({ start: "2026-11-03T07:00", end: "2026-11-03T09:00" });
  });

  it("does not join hours across a gap in the data", () => {
    expect(bestWindow([pt(7), pt(8), pt(10), pt(11), pt(12)])).toEqual({ start: "2026-11-03T10:00", end: "2026-11-03T13:00" });
  });

  it("returns null when nothing is comfortable or there is no data", () => {
    expect(bestWindow([pt(8, { prob: 90 }), pt(9, { prob: 90 })])).toBeNull();
    expect(bestWindow([])).toBeNull();
  });

  it("can end at midnight (the end boundary rolls into the next day)", () => {
    // 21:00 is the last comfortable hour -> window ends at 22:00, never later
    expect(bestWindow([pt(20), pt(21), pt(22)])).toEqual({ start: "2026-11-03T20:00", end: "2026-11-03T22:00" });
  });
});

describe("best time outside, from a realistic day", () => {
  it("finds the cool evening (5-10 PM) and tomorrow's matching evening", () => {
    const b = bestOutside(makeReport(MODEL_AQ));
    expect(b.today).toEqual({ start: "2026-11-03T17:00", end: "2026-11-03T22:00" });
    expect(b.tomorrow).toEqual({ start: "2026-11-04T17:00", end: "2026-11-04T22:00" });
  });

  it("works without an air-quality forecast", () => {
    const b = bestOutside(makeReport(null));
    expect(b.today).toEqual({ start: "2026-11-03T17:00", end: "2026-11-03T22:00" });
  });

  it("moves the window around a rain spell", () => {
    // rain 17:00-20:00 -> only 20:00 and 21:00 are left
    const b = bestOutside(makeReport(null, { rainAt: 9, rainFor: 3 }));
    expect(b.today).toEqual({ start: "2026-11-03T20:00", end: "2026-11-03T22:00" });
  });

  it("starts from the next hour once the current hour is half over", () => {
    const b = bestOutside(at(makeReport(null), "2026-11-03T17:40"));
    expect(b.today).toEqual({ start: "2026-11-03T18:00", end: "2026-11-03T22:00" });
  });

  it("only looks at the hours that are still ahead of you today", () => {
    const b = bestOutside(at(makeReport(null), "2026-11-03T20:10"));
    expect(b.today).toEqual({ start: "2026-11-03T20:00", end: "2026-11-03T22:00" });
  });

  it("says 'no outdoor hours left today' (undefined) late at night, and still gives tomorrow", () => {
    const b = bestOutside(at(makeReport(null), "2026-11-03T22:10"));
    expect(b.today).toBeUndefined();
    expect(b.tomorrow).not.toBeNull();
  });

  it("reports 'none comfortable' (null) when the air is bad all day", () => {
    const b = bestOutside(makeReport(MODEL_AQ, { aqHourly: makeAirHourly(2) })); // AQI 120-190
    expect(b.today).toBeNull();
    expect(b.tomorrow).toBeNull();
  });

  it("merges hourly AQI into the points", () => {
    const pts = hourPoints(makeReport(MODEL_AQ), "2026-11-03");
    expect(pts).toHaveLength(24);
    expect(pts.find((p) => p.time.endsWith("T15:00"))!.aqi).toBe(95);
    expect(hourPoints(makeReport(null), "2026-11-03")[0].aqi).toBeNull();
    expect(hourPoints(makeReport(null), "2099-01-01")).toEqual([]);
  });
});

describe("air-quality outlook", () => {
  it("sees a rise coming and names the peak hour", () => {
    expect(aqiOutlook(makeReport(MODEL_AQ))).toEqual({ kind: "rising", aqi: 95, time: "2026-11-03T15:00", base: 60 });
  });

  it("sees air improving after the peak", () => {
    expect(aqiOutlook(at(makeReport(MODEL_AQ), "2026-11-03T15:20"))).toEqual({ kind: "falling", aqi: 60, time: "2026-11-03T22:00", base: 95 });
  });

  it("calls small changes 'steady'", () => {
    const r = makeReport(MODEL_AQ);
    r.aqHourly = { time: r.aqHourly!.time, us_aqi: r.aqHourly!.time.map(() => 80) };
    expect(aqiOutlook(r)).toEqual({ kind: "steady", aqi: 80, time: "2026-11-03T08:00", base: 80 });
    r.aqHourly.us_aqi[12] = 89; // +9 is still under the 10-point threshold
    expect(aqiOutlook(r)!.kind).toBe("steady");
    r.aqHourly.us_aqi[12] = 90; // +10 counts
    expect(aqiOutlook(r)!.kind).toBe("rising");
  });

  it("returns null without hourly data, or when the current hour is unknown", () => {
    expect(aqiOutlook(makeReport(null))).toBeNull();
    const r = makeReport(MODEL_AQ);
    r.wx.current.time = "2026-11-10T08:15";
    expect(aqiOutlook(r)).toBeNull();
  });

  it("skips missing hours instead of failing", () => {
    const r = makeReport(MODEL_AQ);
    r.aqHourly!.us_aqi[15] = null;
    const o = aqiOutlook(r)!;
    expect(o.kind).toBe("rising");
    expect(o.time).not.toBe("2026-11-03T15:00");
  });

  it("finds a day's peak for tomorrow's outlook", () => {
    expect(aqiPeakOn(makeReport(MODEL_AQ), "2026-11-04")).toEqual({ aqi: 95, time: "2026-11-04T15:00" });
    expect(aqiPeakOn(makeReport(null), "2026-11-04")).toBeNull();
    expect(aqiPeakOn(makeReport(MODEL_AQ), "2026-12-25")).toBeNull();
  });
});

describe("trend versus yesterday", () => {
  it("is today's high minus yesterday's high", () => {
    expect(trend(makeReport())).toBeCloseTo(2.6, 5);
    expect(trend(makeReport(null, { yesterdayMax: 35, todayMax: 33 }))).toBeCloseTo(-2, 5);
  });

  it("is null when yesterday isn't available (backup source)", () => {
    const r = makeReport();
    for (const k of Object.keys(r.wx.daily) as (keyof typeof r.wx.daily)[]) (r.wx.daily[k] as unknown[]).shift();
    expect(trend(r)).toBeNull();
  });
});

describe("rain alert detection", () => {
  it("fires when rain is likely within the next two hours", () => {
    expect(rainAlert(makeReport(null, { rainAt: 1 }))).toEqual({ time: "2026-11-03T09:00", prob: 85, mm: 1.5 });
    expect(rainAlert(makeReport(null, { rainAt: 2 }))).toEqual({ time: "2026-11-03T10:00", prob: 85, mm: 1.5 });
  });

  it("ignores rain that is further away, and dry days", () => {
    expect(rainAlert(makeReport(null, { rainAt: 3 }))).toBeNull();
    expect(rainAlert(makeReport(null))).toBeNull();
  });

  it("does not announce rain that has already started", () => {
    expect(rainAlert(makeReport(null, { rainAt: 1, precip: 1.2 }))).toBeNull();
    expect(rainAlert(makeReport(null, { rainAt: 1, code: 63 }))).toBeNull();
  });

  it("uses a 60% threshold", () => {
    const r = makeReport(null);
    r.wx.hourly.precipitation_probability[NOW_INDEX + 1] = 59;
    expect(rainAlert(r)).toBeNull();
    r.wx.hourly.precipitation_probability[NOW_INDEX + 1] = 60;
    expect(rainAlert(r)).toMatchObject({ prob: 60 });
  });
});

describe("morning / afternoon / evening summary", () => {
  it("averages the temperature of each part of the day", () => {
    const [m, a, e] = dayPeriods(makeReport(), "2026-11-04");
    expect([m.key, a.key, e.key]).toEqual(["morning", "afternoon", "evening"]);
    expect(m.temp).toBeCloseTo(29.3, 1);
    expect(a.temp).toBeCloseTo(30.3, 1);
    expect(e.temp).toBeCloseTo(26, 1);
    expect(m.prob).toBe(10);
    expect(m.code).toBe(2);
  });

  it("shows the wettest hour's weather when rain is likely", () => {
    const [, , evening] = dayPeriods(makeReport(null, { rainAt: 34, rainFor: 2 }), "2026-11-04");
    expect(evening.prob).toBe(85);
    expect(evening.code).toBe(63);
  });

  it("returns nothing for a date outside the data", () => {
    expect(dayPeriods(makeReport(), "2030-01-01")).toEqual([]);
  });
});
