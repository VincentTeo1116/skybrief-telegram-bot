import { describe, expect, it } from "vitest";
import {
  SECTIONS,
  aqiAlertMessage,
  aqiBand,
  hourlyMessage,
  inlineCard,
  rainAlertMessage,
  tips,
  tomorrowMessage,
  uvLabel,
  weatherMessage,
  weekMessage,
  welcomeMessage,
} from "../src/format";
import { rainAlert } from "../src/insights";
import { MODEL_AQ, STATION_AQ, P, makeAirHourly, makeReport } from "./fixtures";

const full = (lang: "en" | "ms" | "zh" = "en", o = {}, report = makeReport(MODEL_AQ)) => weatherMessage(report, P(lang, o));

describe("today's report (English, metric)", () => {
  it("renders the core fields", () => {
    const text = full();
    for (const s of [
      "Kuala Lumpur, Malaysia",
      "Tuesday, 3 November",
      "28°C",
      "78%",
      "12 km/h NE",
      "AQI 62",
      "Moderate",
      "7:01 AM",
      "7:12 PM",
      "▲ 33° ▼ 25°",
    ]) {
      expect(text, s).toContain(s);
    }
    expect(text.length).toBeLessThan(4096);
  });

  it("shows the measured station and adds a health tip for AQI > 100", () => {
    const text = weatherMessage(makeReport(STATION_AQ), P());
    expect(text).toContain("AQI 112");
    expect(text).toContain("Unhealthy for sensitive groups");
    expect(text).toContain("Cheras, Kuala Lumpur station (4 km)");
    expect(text).toContain("limit outdoor activity");
  });

  it("describes rain correctly", () => {
    expect(weatherMessage(makeReport(MODEL_AQ, { prob: 5 }), P())).toContain("No rain expected");
    expect(weatherMessage(makeReport(MODEL_AQ, { prob: 80 }), P())).toContain("Rain likely");
    expect(weatherMessage(makeReport(MODEL_AQ, { prob: 80, code: 63, precip: 1.2 }), P())).toContain("Raining now");
    expect(weatherMessage(makeReport(MODEL_AQ, { prob: 80 }), P()).toLowerCase()).toContain("umbrella");
  });

  it("copes with missing air quality and null rain probabilities", () => {
    const rep = makeReport(null);
    rep.wx.hourly.precipitation_probability = rep.wx.hourly.precipitation_probability.map(() => null);
    expect(weatherMessage(rep, P())).toContain("Unavailable");
  });

  it("escapes HTML in place names", () => {
    const rep = makeReport();
    rep.place = { name: "<b>Evil</b> & Co", lat: 1, lon: 1, country: "", tz: "UTC" };
    expect(weatherMessage(rep, P())).toContain("&lt;b&gt;Evil&lt;/b&gt; &amp; Co");
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

describe("trend versus yesterday", () => {
  it("says warmer / cooler when the difference is at least 2°", () => {
    expect(full()).toContain("📈 3° warmer than yesterday");
    expect(weatherMessage(makeReport(MODEL_AQ, { yesterdayMax: 36 }), P())).toContain("📉 3° cooler than yesterday");
  });

  it("stays quiet for small differences", () => {
    const text = weatherMessage(makeReport(MODEL_AQ, { yesterdayMax: 32.5 }), P());
    expect(text).not.toContain("than yesterday");
  });

  it("shows the difference in °F when the user prefers Fahrenheit", () => {
    expect(full("en", { tempUnit: "f" })).toContain("📈 5° warmer than yesterday");
  });

  it("is translated", () => {
    expect(full("zh")).toContain("比昨天热 3°");
    expect(full("ms")).toContain("3° lebih panas daripada semalam");
  });
});

describe("air-quality outlook and best time outside", () => {
  it("shows where air quality is heading", () => {
    expect(full()).toContain("📈 Rising: peak ~95 around 3 PM (model)");
    expect(full("zh")).toContain("将上升：15:00 前后达到约 95（模型）");
    expect(full("ms")).toContain("Meningkat: puncak ~95 sekitar 3 PM (model)");
  });

  it("leaves out the model outlook when a measured reading disagrees with it (no contradictions)", () => {
    // model says ~60 right now (and rising), the measured station says 160: "AQI 160" then "Rising: peak ~95" would be nonsense
    const text = weatherMessage(makeReport({ ...STATION_AQ, aqi: 160 }), P());
    expect(text).toContain("AQI 160");
    expect(text).not.toContain("(model)");
    // …but when they roughly agree, the outlook is shown
    expect(weatherMessage(makeReport({ ...STATION_AQ, aqi: 66 }), P())).toContain("Rising: peak ~95");
    // …and with no station involved the outlook always shows
    expect(weatherMessage(makeReport(MODEL_AQ), P())).toContain("Rising: peak ~95");
  });

  it("recommends the best time to go outside", () => {
    const text = full();
    expect(text).toContain("🏃 <b>Best time outside</b>");
    expect(text).toContain("Today: 5–10 PM");
    expect(text).toContain("comfortable temperature, low UV, dry, clean air");
    expect(text).not.toContain("Tomorrow: ");
  });

  it("switches to tomorrow once today's outdoor hours are over", () => {
    const r = makeReport(MODEL_AQ);
    r.wx.current.time = "2026-11-03T22:10";
    const text = weatherMessage(r, P());
    expect(text).toContain("Tomorrow: 5–10 PM");
    expect(text).not.toContain("Today: ");
  });

  it("says so when there is no comfortable window", () => {
    const text = weatherMessage(makeReport(MODEL_AQ, { aqHourly: makeAirHourly(2) }), P());
    expect(text).toContain("No comfortable window left today");
    expect(text).toContain("Tomorrow: no comfortable window");
  });

  it("follows the 12h / 24h clock preference", () => {
    expect(full("en", { clock: "24" })).toContain("Today: 17:00–22:00");
    expect(full("zh")).toContain("今天：17:00–22:00");
    expect(full("zh", { clock: "12" })).toContain("今天：下午5时–下午10时");
  });
});

describe("display preferences", () => {
  it("converts to Fahrenheit everywhere", () => {
    const text = full("en", { tempUnit: "f" });
    expect(text).toContain("83°F");
    expect(text).not.toContain("28°C");
    expect(text).toContain("▲ 92° ▼ 77°");
    expect(text).toContain("Wed</b> ⛅ 77°–92°");
  });

  it("converts wind speed", () => {
    expect(full("en", { windUnit: "ms" })).toContain("3.2 m/s NE");
    expect(full("en", { windUnit: "mph" })).toContain("7 mph NE");
    expect(full("en")).toContain("12 km/h NE");
  });

  it("uses 24-hour times when asked", () => {
    const text = full("en", { clock: "24" });
    expect(text).toContain("07:01");
    expect(text).toContain("19:12");
    expect(text).not.toContain("AM");
    expect(text).toContain("Observed 08:15 local");
  });
});

describe("compact mode", () => {
  it("is much shorter but keeps the essentials", () => {
    const compact = full("en", { compact: true }, makeReport(MODEL_AQ, { prob: 80 }));
    const regular = full("en", {}, makeReport(MODEL_AQ, { prob: 80 }));
    expect(compact.length).toBeLessThan(regular.length / 2);
    for (const s of ["Kuala Lumpur, Malaysia", "28°C", "Partly cloudy", "💧 78%", "AQI 62", "Rain likely", "umbrella", "🕒 8:15 AM"]) {
      expect(compact, s).toContain(s);
    }
    expect(compact).not.toContain("┈");
    expect(compact).not.toContain("Next days");
    expect(compact.split("\n").length).toBeLessThanOrEqual(9);
  });

  it("keeps at most two tips", () => {
    const tipsLine = full("en", { compact: true }).split("\n").find((l) => l.includes("UV") || l.includes("umbrella"))!;
    expect(tipsLine.split(" · ").length).toBeLessThanOrEqual(2);
  });

  it("still honours hidden sections", () => {
    const text = full("en", { compact: true, hidden: new Set(["air", "details", "rain", "tips"]) });
    for (const s of ["AQI", "💧 78%", "Rain", "Tips"]) expect(text, s).not.toContain(s);
    expect(text).toContain("28°C");
  });

  it("respects units and language", () => {
    expect(full("en", { compact: true, tempUnit: "f", windUnit: "mph" })).toContain("83°F");
    expect(full("en", { compact: true, tempUnit: "f", windUnit: "mph" })).toContain("7 mph");
    expect(full("zh", { compact: true })).toContain("局部多云");
  });

  it("names the backup source", () => {
    expect(weatherMessage(makeReport(MODEL_AQ, { source: "met-no" }), P("en", { compact: true }))).toContain("MET Norway");
  });
});

describe("hidden sections", () => {
  const markers: Record<string, string> = { air: "Air quality", rain: "Rain outlook", best: "Best time outside", forecast: "Next days", tips: "Tips", details: "Humidity", sun: "🌅" };

  it("hides each section on its own but always keeps the header and footer", () => {
    const base = full("en", {}, makeReport(MODEL_AQ, { prob: 80 }));
    for (const s of SECTIONS) {
      expect(base, s).toContain(markers[s]);
      const text = weatherMessage(makeReport(MODEL_AQ, { prob: 80 }), P("en", { hidden: new Set([s]) }));
      expect(text, s).not.toContain(markers[s]);
      expect(text).toContain("28°C");
      expect(text).toContain("Observed");
    }
  });

  it("can hide everything", () => {
    const bare = weatherMessage(makeReport(MODEL_AQ), P("en", { hidden: new Set(SECTIONS) }));
    expect(bare).toContain("Kuala Lumpur");
    expect(bare).toContain("Observed");
    expect(bare).not.toContain("┈");
  });
});

describe("languages", () => {
  it("renders Chinese and Malay with no English leftovers in the labels", () => {
    const zh = full("zh", {}, makeReport(MODEL_AQ, { prob: 80 }));
    for (const s of ["11月3日 星期二", "湿度", "空气质量", "记得带伞", "东北", "局部多云", "07:01", "户外最佳时段"]) expect(zh, s).toContain(s);
    expect(zh).not.toContain("Humidity");
    const ms = full("ms", {}, makeReport(MODEL_AQ, { prob: 80 }));
    for (const s of ["Selasa, 3 November", "Kelembapan", "Bawa payung", "Sederhana", "Separa mendung", "Rab", "Waktu terbaik di luar"]) expect(ms, s).toContain(s);
    expect(ms).not.toContain("Humidity");
  });

  it("falls back to English for an unknown language code", () => {
    expect(weatherMessage(makeReport(MODEL_AQ), P("fr" as never))).toContain("Humidity");
  });
});

describe("hourly view", () => {
  it("renders in every language, unit and clock mode", () => {
    expect(hourlyMessage(makeReport(MODEL_AQ, { prob: 40 }), P())).toContain("Next 12 hours");
    expect(hourlyMessage(makeReport(MODEL_AQ, { prob: 40 }), P())).toContain("▰");
    expect(hourlyMessage(makeReport(MODEL_AQ), P("zh"))).toContain("未来12小时");
    expect(hourlyMessage(makeReport(MODEL_AQ), P("ms"))).toContain("12 jam akan datang");
    expect(hourlyMessage(makeReport(MODEL_AQ), P("en", { clock: "24" }))).toContain("08:00");
    expect(hourlyMessage(makeReport(MODEL_AQ), P("en", { clock: "12" }))).toContain("8 AM");
    expect(hourlyMessage(makeReport(MODEL_AQ), P("en", { tempUnit: "f" }))).toMatch(/\d+°<\/b>/);
    expect(hourlyMessage(makeReport(MODEL_AQ), P()).split("\n").filter((l) => l.startsWith("<code>"))).toHaveLength(12);
  });
});

describe("tomorrow view", () => {
  const msg = (o = {}, report = makeReport(MODEL_AQ)) => tomorrowMessage(report, P("en", o));

  it("summarises tomorrow", () => {
    const text = msg();
    for (const s of [
      "🌅 <b>Tomorrow</b>",
      "Wednesday, 4 November",
      "Kuala Lumpur, Malaysia",
      "25°–33°C",
      "Partly cloudy",
      "Rain chance 10%",
      "Wind up to 18 km/h",
      "7:01 AM",
      "UV <b>9</b> Very high",
    ]) {
      expect(text, s).toContain(s);
    }
    expect(text.length).toBeLessThan(4096);
  });

  it("shows morning / afternoon / evening", () => {
    const text = msg();
    for (const s of ["<b>Morning</b>", "<b>Afternoon</b>", "<b>Evening</b>"]) expect(text, s).toContain(s);
    expect(text).toMatch(/Morning<\/b> .* 29° · 💧10%/);
    expect(text).toMatch(/Afternoon<\/b> .* 30° · 💧10%/);
  });

  it("includes the air outlook, best time and tips for tomorrow", () => {
    const text = msg();
    expect(text).toContain("Expected peak ~95 around 3 PM (model)");
    expect(text).toContain("Tomorrow: 5–10 PM");
    expect(text).toContain("Very high UV");
    expect(text).toContain("Dangerously hot feel");
  });

  it("warns about rain and thunderstorms for tomorrow", () => {
    expect(msg({}, makeReport(MODEL_AQ, { prob: 80 }))).toContain("Bring an umbrella");
    expect(msg({}, makeReport(MODEL_AQ, { code: 95 }))).toContain("Thunderstorm risk");
  });

  it("honours units, clock, language and hidden sections", () => {
    expect(msg({ tempUnit: "f" })).toContain("77°–92°F");
    expect(msg({ windUnit: "mph" })).toContain("Wind up to 11 mph");
    expect(msg({ clock: "24" })).toContain("07:01");
    expect(msg({ hidden: new Set(["forecast"]) })).not.toContain("Morning");
    expect(msg({ hidden: new Set(["air"]) })).not.toContain("Expected peak");
    expect(msg({ hidden: new Set(["best"]) })).not.toContain("Best time");
    expect(msg({ hidden: new Set(["tips"]) })).not.toContain("💡");
    expect(msg({ hidden: new Set(["sun"]) })).not.toContain("🌅 7:01");
    const zh = tomorrowMessage(makeReport(MODEL_AQ), P("zh"));
    for (const s of ["明天", "11月4日 星期三", "上午", "下午", "傍晚"]) expect(zh, s).toContain(s);
  });

  it("can carry a ribbon (the evening report)", () => {
    expect(tomorrowMessage(makeReport(MODEL_AQ), P(), "🌙 <b>Good evening!</b>")).toMatch(/^🌙 <b>Good evening!<\/b>\n\n🌅/);
  });

  it("degrades safely when tomorrow isn't in the data", () => {
    const r = makeReport(MODEL_AQ);
    for (const k of Object.keys(r.wx.daily) as (keyof typeof r.wx.daily)[]) (r.wx.daily[k] as unknown[]).length = 2; // yesterday + today only
    expect(tomorrowMessage(r, P())).toContain("couldn't reach");
  });
});

describe("7-day view", () => {
  it("lists seven days starting today and marks the weekend", () => {
    const text = weekMessage(makeReport(MODEL_AQ), P());
    expect(text).toContain("7-day outlook");
    expect(text).toContain("<b>Today</b>");
    for (const d of ["Wed", "Thu", "Fri", "Mon"]) expect(text, d).toContain(`<b>${d}</b>`);
    expect(text).toContain("<b>Sat</b> 🎉");
    expect(text).toContain("<b>Sun</b> 🎉");
    expect(text).not.toContain("<b>Tue</b>"); // today is labelled "Today"
    expect(text.match(/💧/g)).toHaveLength(7);
  });

  it("points out the rainiest day, only when it is really wet", () => {
    expect(weekMessage(makeReport(MODEL_AQ, { prob: 70 }), P())).toContain("Rainiest day: Tuesday (70%)");
    expect(weekMessage(makeReport(MODEL_AQ, { prob: 20 }), P())).not.toContain("Rainiest");
  });

  it("is translated and uses the chosen units", () => {
    expect(weekMessage(makeReport(MODEL_AQ), P("zh"))).toContain("7天预报");
    expect(weekMessage(makeReport(MODEL_AQ), P("zh"))).toContain("今天");
    expect(weekMessage(makeReport(MODEL_AQ), P("ms"))).toContain("Hari ini");
    expect(weekMessage(makeReport(MODEL_AQ), P("en", { tempUnit: "f" }))).toContain("77°–92°");
  });

  it("shows rainfall for wet days", () => {
    const r = makeReport(MODEL_AQ, { prob: 70 });
    r.wx.daily.precipitation_sum![2] = 12.4;
    expect(weekMessage(r, P())).toContain("12 mm");
  });
});

describe("backup source", () => {
  it("names MET Norway in the footer of the full report", () => {
    const text = weatherMessage(makeReport(MODEL_AQ, { source: "met-no" }), P());
    expect(text).toContain("Weather: MET Norway (backup source)");
    expect(weatherMessage(makeReport(MODEL_AQ, { source: "open-meteo" }), P())).toContain("Weather: Open-Meteo");
    expect(weatherMessage(makeReport(MODEL_AQ, { source: "met-no" }), P("zh"))).toContain("备用数据源");
  });
});

describe("alert and inline messages", () => {
  it("writes the rain alert", () => {
    const r = makeReport(null, { rainAt: 1 });
    const a = rainAlert(r)!;
    const text = rainAlertMessage(r, P(), a);
    expect(text).toContain("<b>Rain alert</b> · Kuala Lumpur, Malaysia");
    expect(text).toContain("Rain likely around 9 AM (85%)");
    expect(rainAlertMessage(r, P("zh"), a)).toContain("09:00 前后可能下雨（85%）");
    expect(rainAlertMessage(r, P("ms"), a)).toContain("Hujan berkemungkinan sekitar 9 AM (85%)");
    expect(rainAlertMessage(r, P("en", { clock: "24" }), a)).toContain("around 09:00");
  });

  it("writes the air-quality alert with advice that fits the level", () => {
    const moderate = aqiAlertMessage(makeReport(STATION_AQ), P());
    expect(moderate).toContain("AQI is now <b>112</b> (Unhealthy for sensitive groups)");
    expect(moderate).toContain("limit outdoor activity");
    const bad = aqiAlertMessage(makeReport({ ...STATION_AQ, aqi: 165 }), P());
    expect(bad).toContain("(Unhealthy)");
    expect(bad).toContain("N95");
    expect(aqiAlertMessage(makeReport(STATION_AQ), P("zh"))).toContain("当前 AQI 为 <b>112</b>");
  });

  it("builds an inline card (always compact)", () => {
    const card = inlineCard(makeReport(MODEL_AQ), P("en", { tempUnit: "f" }));
    expect(card.title).toBe("Kuala Lumpur, Malaysia");
    expect(card.description).toBe("⛅ 83°F · Partly cloudy · AQI 62");
    expect(card.text.split("\n").length).toBeLessThanOrEqual(9);
    expect(inlineCard(makeReport(null), P()).description).toBe("⛅ 28°C · Partly cloudy");
  });

  it("greets in each language", () => {
    expect(welcomeMessage("en", "Vince", "Ipoh", "08:30")).toContain("Hi Vince!");
    expect(welcomeMessage("ms", "", "Ipoh", "08:30")).toContain("Hai kawan!");
    expect(welcomeMessage("zh", "小明", "怡保", "08:30")).toContain("你好，小明！");
    expect(welcomeMessage("en", "<x>", "Ipoh", "08:30")).toContain("&lt;x&gt;");
  });
});
