/**
 * Turn a Report into pretty Telegram HTML. Pure functions: easy to unit-test.
 * Every public function takes the user's `Prefs` (language, hidden sections, units, clock, compact mode).
 */
import * as i18n from "./i18n";
import { t } from "./i18n";
import {
  RAIN_CODES,
  STORM_CODES,
  aqiOutlook,
  aqiPeakOn,
  bestOutside,
  dailyIndex,
  dayPeriods,
  isRainingNow,
  nextHours,
  pct,
  trend,
  type Window,
} from "./insights";
import type { Lang, Prefs, Report } from "./types";
import { deg, deltaDisplay, speed, unitLetter } from "./units";
import { escapeHtml as esc } from "./util";
import { clip, stateSegment, type State, type Warning } from "./warnings";
import { placeLabel } from "./weather";

export const SECTIONS = ["details", "sun", "air", "rain", "best", "forecast", "tips"] as const;
export type Section = (typeof SECTIONS)[number];

const DIVIDER = "┈".repeat(16);

// WMO weather code -> [day emoji, night emoji]
const WMO_EMOJI: Record<number, [string, string]> = {
  0: ["☀️", "🌙"], 1: ["🌤️", "🌙"], 2: ["⛅", "☁️"], 3: ["☁️", "☁️"],
  45: ["🌫️", "🌫️"], 48: ["🌫️", "🌫️"],
  51: ["🌦️", "🌧️"], 53: ["🌦️", "🌧️"], 55: ["🌧️", "🌧️"], 56: ["🌧️", "🌧️"], 57: ["🌧️", "🌧️"],
  61: ["🌦️", "🌧️"], 63: ["🌧️", "🌧️"], 65: ["🌧️", "🌧️"], 66: ["🌧️", "🌧️"], 67: ["🌧️", "🌧️"],
  71: ["🌨️", "🌨️"], 73: ["🌨️", "🌨️"], 75: ["❄️", "❄️"], 77: ["🌨️", "🌨️"],
  80: ["🌦️", "🌧️"], 81: ["🌧️", "🌧️"], 82: ["⛈️", "⛈️"],
  85: ["🌨️", "🌨️"], 86: ["❄️", "❄️"],
  95: ["⛈️", "⛈️"], 96: ["⛈️", "⛈️"], 99: ["⛈️", "⛈️"],
};
const AQI_LIMITS: [number, string][] = [[50, "🟢"], [100, "🟡"], [150, "🟠"], [200, "🔴"], [300, "🟣"], [1e9, "🟤"]];
const UV_LIMITS = [3, 6, 8, 11, 1e9];

// ------------------------------------------------------------------ helpers
export function wmo(code: number | null | undefined, isDay: boolean, lang: Lang): [string, string] {
  const [day, night] = (code != null && WMO_EMOJI[code]) || ["🌡️", "🌡️"];
  return [i18n.wmoText(code, lang), isDay ? day : night];
}

export function aqiLevel(aqi: number): number {
  const i = AQI_LIMITS.findIndex(([limit]) => aqi <= limit);
  return i >= 0 ? i : AQI_LIMITS.length - 1;
}

export function aqiBand(aqi: number, lang: Lang): [string, string] {
  const lvl = aqiLevel(aqi);
  return [AQI_LIMITS[lvl][1], i18n.aqiLabel(lvl, lang)];
}

export function uvLabel(uv: number, lang: Lang): string {
  const i = UV_LIMITS.findIndex((limit) => uv < limit);
  return i18n.uvText(i >= 0 ? i : UV_LIMITS.length - 1, lang);
}

const hr = (iso: string, p: Prefs) => i18n.hourLabel(iso, p.lang, p.clock);
const rangeOf = (w: Window, p: Prefs) => i18n.rangeLabel(w.start, w.end, p.lang, p.clock);

// ---------------------------------------------------------------- sections
function rainOutlook(r: Report, p: Prefs): string {
  const lang = p.lang;
  const all = nextHours(r, 7);
  const rows = all.slice(1).length ? all.slice(1) : all;
  const peak = rows.reduce<(typeof rows)[number] | null>((best, x) => (best === null || x.prob > best.prob ? x : best), null);
  if (isRainingNow(r)) {
    const more = peak && peak.prob >= 40 ? t(lang, "raining_more", { p: peak.prob }) : "";
    return `🌧 <b>${t(lang, "raining_now")}</b>${more}`;
  }
  if (peak && peak.prob >= 60) return `☔ <b>${t(lang, "rain_likely", { h: hr(peak.time, p), p: peak.prob })}</b>`;
  if (peak && peak.prob >= 30) return `🌦 ${t(lang, "rain_chance", { h: hr(peak.time, p), p: peak.prob })}`;
  return `✅ ${t(lang, "rain_none")}`;
}

function airBlock(r: Report, p: Prefs): string[] {
  const lang = p.lang;
  const aq = r.aq;
  const title = `🫁 <b>${t(lang, "air_title")}</b>`;
  const lines = [title];
  if (!aq) {
    lines.push(t(lang, "air_unavail"));
  } else {
    const [emoji, label] = aqiBand(aq.aqi, lang);
    lines.push(`${emoji} <b>AQI ${aq.aqi}</b> · ${label}`);
    const extras: string[] = [];
    if (aq.pm25 != null) extras.push(`PM2.5 ${aq.pm25.toFixed(0)} µg/m³`);
    if (aq.pm10 != null) extras.push(`PM10 ${aq.pm10.toFixed(0)} µg/m³`);
    if (aq.dominant) extras.push(t(lang, "pollutant", { p: esc(aq.dominant) }));
    if (extras.length) lines.push(extras.join(" · "));
  }
  const o = aqiOutlook(r);
  // The outlook is the MODEL's. If a measured station reading disagrees a lot with the model's current value,
  // the model's numbers would contradict the headline ("AQI 160" then "steady around 70"), so leave it out.
  if (o && !(aq?.station && Math.abs(aq.aqi - o.base) > 15)) {
    const icon = o.kind === "rising" ? "📈" : o.kind === "falling" ? "📉" : "➡️";
    lines.push(`${icon} ${t(lang, `aqi_${o.kind}`, { aqi: o.aqi, h: hr(o.time, p) })}`);
  }
  return lines;
}

function bestBlock(r: Report, p: Prefs): string {
  const lang = p.lang;
  const b = bestOutside(r);
  const lines: string[] = [];
  if (b.today) lines.push(t(lang, "best_today", { r: rangeOf(b.today, p) }));
  else if (b.today === null) lines.push(t(lang, "best_none_today"));
  if (!b.today) lines.push(b.tomorrow ? t(lang, "best_tomorrow", { r: rangeOf(b.tomorrow, p) }) : t(lang, "best_none_tomorrow"));
  return `🏃 <b>${t(lang, "sec_best")}</b>\n${lines.join("\n")}\n<i>${t(lang, "best_hint")}</i>`;
}

export function tips(r: Report, lang: Lang): string[] {
  const c = r.wx.current;
  const d = r.wx.daily;
  const di = dailyIndex(r);
  const out: string[] = [];
  const upcoming = nextHours(r, 7);
  if (pct(d.precipitation_probability_max[di]) >= 50 || upcoming.some((x) => x.prob >= 50)) out.push("☂️ " + t(lang, "tip_umbrella"));
  if (upcoming.some((x) => x.code != null && STORM_CODES.has(x.code))) out.push("⚡ " + t(lang, "tip_storm"));
  const uv = d.uv_index_max[di] ?? 0;
  if (uv >= 8) out.push("🧴 " + t(lang, "tip_uv_vhigh"));
  else if (uv >= 6) out.push("🧴 " + t(lang, "tip_uv_high"));
  const feels = c.apparent_temperature;
  if (feels != null && feels >= 38) out.push("🥵 " + t(lang, "tip_heat_danger"));
  else if (feels != null && feels >= 34) out.push("💧 " + t(lang, "tip_heat_hot"));
  else if (feels != null && feels <= 10) out.push("🧥 " + t(lang, "tip_cold"));
  if ((c.wind_gusts_10m ?? 0) >= 50) out.push("💨 " + t(lang, "tip_gusts"));
  if (r.aq) {
    if (r.aq.aqi > 150) out.push("😷 " + t(lang, "tip_aqi_bad"));
    else if (r.aq.aqi > 100) out.push("😷 " + t(lang, "tip_aqi_sens"));
  }
  return out.length ? out : ["😎 " + t(lang, "tip_comfy")];
}

/** Tips for a whole future day, from its daily values. */
function tomorrowTips(r: Report, di: number, lang: Lang): string[] {
  const d = r.wx.daily;
  const out: string[] = [];
  if (pct(d.precipitation_probability_max[di]) >= 50) out.push("☂️ " + t(lang, "tip_umbrella"));
  const code = d.weather_code[di];
  if (code != null && STORM_CODES.has(code)) out.push("⚡ " + t(lang, "tip_storm"));
  const uv = d.uv_index_max[di] ?? 0;
  if (uv >= 8) out.push("🧴 " + t(lang, "tip_uv_vhigh"));
  else if (uv >= 6) out.push("🧴 " + t(lang, "tip_uv_high"));
  const feels = d.apparent_temperature_max?.[di] ?? d.temperature_2m_max[di];
  if (feels != null && feels >= 38) out.push("🥵 " + t(lang, "tip_heat_danger"));
  else if (feels != null && feels >= 34) out.push("💧 " + t(lang, "tip_heat_hot"));
  const low = d.temperature_2m_min[di];
  if (low != null && low <= 10) out.push("🧥 " + t(lang, "tip_cold"));
  const peak = aqiPeakOn(r, d.time[di]);
  if (peak && peak.aqi > 150) out.push("😷 " + t(lang, "tip_aqi_bad"));
  else if (peak && peak.aqi > 100) out.push("😷 " + t(lang, "tip_aqi_sens"));
  return out.length ? out : ["😎 " + t(lang, "tip_comfy")];
}

function forecastLines(r: Report, p: Prefs): string[] {
  const d = r.wx.daily;
  const di = dailyIndex(r);
  const lines: string[] = [];
  for (let i = di + 1; i < Math.min(di + 4, d.time.length); i++) {
    const [, emoji] = wmo(d.weather_code[i], true, p.lang);
    lines.push(
      `<b>${i18n.weekday(d.time[i], p.lang, true)}</b> ${emoji} ${deg(d.temperature_2m_min[i], p)}–${deg(d.temperature_2m_max[i], p)}` +
        ` · 💧${pct(d.precipitation_probability_max[i])}%`,
    );
  }
  return lines;
}

function trendLine(r: Report, p: Prefs): string | null {
  const delta = trend(r);
  if (delta == null || Math.abs(delta) < 2) return null;
  return (delta > 0 ? "📈 " : "📉 ") + t(p.lang, delta > 0 ? "trend_warmer" : "trend_cooler", { d: deltaDisplay(delta, p) });
}

function sourceText(r: Report, p: Prefs): string {
  let src = t(p.lang, r.source === "met-no" ? "src_weather_backup" : "src_weather");
  const aq = r.aq;
  if (aq) {
    src +=
      " · " +
      (aq.station
        ? t(p.lang, "src_air_station", { name: esc(aq.station), km: (aq.km ?? 0).toFixed(0) })
        : t(p.lang, "src_air_model"));
  }
  return src;
}

function footer(r: Report, p: Prefs): string {
  return `<i>🕒 ${t(p.lang, "observed", { t: i18n.clock(r.wx.current.time, p.lang, p.clock) })}\n${sourceText(r, p)}</i>`;
}

// ------------------------------------------------------------------ views
/** `warnings` = official warnings that apply to this user's state (already filtered); shown at the top. */
export function weatherMessage(r: Report, p: Prefs, ribbon?: string, warnings: Warning[] = []): string {
  return p.compact ? compactMessage(r, p, ribbon, warnings) : fullMessage(r, p, ribbon, warnings);
}

function fullMessage(r: Report, p: Prefs, ribbon: string | undefined, warnings: Warning[]): string {
  const lang = p.lang;
  const hidden = p.hidden;
  const c = r.wx.current;
  const d = r.wx.daily;
  const di = dailyIndex(r);
  const [desc, emoji] = wmo(c.weather_code, (c.is_day ?? 1) === 1, lang);

  const head: string[] = [];
  if (ribbon) head.push(ribbon, "");
  head.push(
    `📍 <b>${esc(placeLabel(r.place))}</b>`,
    `<i>${i18n.dateLong(c.time, lang)}</i>`,
    "",
    `${emoji} <b>${deg(c.temperature_2m, p)}${unitLetter(p)}</b> · ${desc}`,
    `${t(lang, "feels")} ${deg(c.apparent_temperature, p)} · ▲ ${deg(d.temperature_2m_max[di], p)} ▼ ${deg(d.temperature_2m_min[di], p)}`,
  );
  const tr = trendLine(r, p);
  if (tr) head.push(tr);
  const blocks: string[] = [head.join("\n")];
  const wblock = warningBlock(warnings, p, c.time);
  if (wblock) blocks.push(wblock);

  const facts: string[] = [];
  if (!hidden.has("details")) {
    const dir = c.wind_direction_10m != null ? i18n.compassDir(c.wind_direction_10m, lang) : "";
    facts.push(
      `💧 ${t(lang, "humidity")} <b>${Math.round(c.relative_humidity_2m)}%</b>    ` +
        `💨 ${t(lang, "wind")} <b>${speed(c.wind_speed_10m, p)} ${dir}</b>`,
      `☁️ ${t(lang, "cloud")} <b>${Math.round(c.cloud_cover)}%</b>    🧭 <b>${Math.round(c.pressure_msl)} hPa</b>`,
    );
  }
  if (!hidden.has("sun")) {
    const uv = d.uv_index_max[di];
    facts.push(
      `🌅 ${i18n.clock(d.sunrise[di], lang, p.clock)}    🌇 ${i18n.clock(d.sunset[di], lang, p.clock)}` +
        (uv != null ? `    🕶 ${t(lang, "uv")} <b>${uv.toFixed(0)}</b> ${uvLabel(uv, lang)}` : ""),
    );
  }
  if (facts.length) blocks.push(facts.join("\n"));
  if (!hidden.has("air")) blocks.push(airBlock(r, p).join("\n"));
  if (!hidden.has("rain")) blocks.push(`🌂 <b>${t(lang, "rain_title")}</b>\n${rainOutlook(r, p)}`);
  if (!hidden.has("best")) blocks.push(bestBlock(r, p));
  if (!hidden.has("forecast")) blocks.push([`📅 <b>${t(lang, "forecast_title")}</b>`, ...forecastLines(r, p)].join("\n"));
  if (!hidden.has("tips")) blocks.push([`💡 <b>${t(lang, "tips_title")}</b>`, ...tips(r, lang).map((x) => `• ${x}`)].join("\n"));

  return blocks.join(`\n${DIVIDER}\n`) + "\n\n" + footer(r, p);
}

/** The short version: a handful of lines that fit on one phone screen. Still honours hidden sections. */
function compactMessage(r: Report, p: Prefs, ribbon: string | undefined, warnings: Warning[]): string {
  const lang = p.lang;
  const hidden = p.hidden;
  const c = r.wx.current;
  const d = r.wx.daily;
  const di = dailyIndex(r);
  const [desc, emoji] = wmo(c.weather_code, (c.is_day ?? 1) === 1, lang);

  const lines: string[] = [];
  if (ribbon) lines.push(ribbon, "");
  lines.push(
    `📍 <b>${esc(placeLabel(r.place))}</b> · <i>${i18n.dateLong(c.time, lang)}</i>`,
    `${emoji} <b>${deg(c.temperature_2m, p)}${unitLetter(p)}</b> · ${desc}`,
    `${t(lang, "feels")} ${deg(c.apparent_temperature, p)} · ▲ ${deg(d.temperature_2m_max[di], p)} ▼ ${deg(d.temperature_2m_min[di], p)}`,
  );
  if (warnings.length) {
    const first = `⚠️ <b>${esc(wTitle(warnings[0], lang))}</b> (${t(lang, "warn_until", { t: wLabel(warnings[0].to!, p, c.time) })})`;
    lines.push(first + (warnings.length > 1 ? ` +${warnings.length - 1}` : ""));
  }
  const parts: string[] = [];
  if (!hidden.has("details")) {
    const dir = c.wind_direction_10m != null ? i18n.compassDir(c.wind_direction_10m, lang) : "";
    parts.push(`💧 ${Math.round(c.relative_humidity_2m)}%`, `💨 ${speed(c.wind_speed_10m, p)} ${dir}`.trim());
  }
  if (!hidden.has("air") && r.aq) {
    const [e] = aqiBand(r.aq.aqi, lang);
    parts.push(`${e} AQI ${r.aq.aqi}`);
  }
  if (parts.length) lines.push(parts.join(" · "));
  if (!hidden.has("rain")) lines.push(rainOutlook(r, p));
  if (!hidden.has("tips")) lines.push(tips(r, lang).slice(0, 2).join(" · "));
  lines.push(`<i>🕒 ${i18n.clock(c.time, lang, p.clock)}${r.source === "met-no" ? " · MET Norway" : ""}</i>`);
  return lines.join("\n");
}

export function hourlyMessage(r: Report, p: Prefs): string {
  const lang = p.lang;
  const out = [`⏱ <b>${t(lang, "hourly_title")}</b> · ${esc(placeLabel(r.place))}`, ""];
  for (const row of nextHours(r, 12)) {
    const hour = Number(row.time.slice(11, 13));
    const [, emoji] = wmo(row.code, hour >= 6 && hour < 19, lang);
    const filled = Math.round(row.prob / 20);
    const bar = "▰".repeat(filled) + "▱".repeat(5 - filled);
    out.push(`<code>${hr(row.time, p).padStart(5)}</code> ${emoji} <b>${deg(row.temp, p)}</b>  ${bar} ${row.prob}%`);
  }
  out.push("", `<i>${t(lang, "bars_note")}</i>`, "", footer(r, p));
  return out.join("\n");
}

/** Tomorrow: summary, morning/afternoon/evening, air outlook, best time outside, tips. */
export function tomorrowMessage(r: Report, p: Prefs, ribbon?: string): string {
  const lang = p.lang;
  const hidden = p.hidden;
  const d = r.wx.daily;
  const di = dailyIndex(r) + 1;
  if (di >= d.time.length) return t(lang, "err_wx");
  const date = d.time[di];
  const [desc, emoji] = wmo(d.weather_code[di], true, lang);

  const head: string[] = [];
  if (ribbon) head.push(ribbon, "");
  head.push(
    `🌅 <b>${t(lang, "tomorrow")}</b> · <i>${i18n.dateLong(date, lang)}</i>`,
    `📍 ${esc(placeLabel(r.place))}`,
    "",
    `${emoji} <b>${deg(d.temperature_2m_min[di], p)}–${deg(d.temperature_2m_max[di], p)}${unitLetter(p)}</b> · ${desc}`,
  );
  const blocks: string[] = [head.join("\n")];

  const facts: string[] = [];
  if (!hidden.has("rain")) {
    const mm = d.precipitation_sum?.[di];
    facts.push(
      `💧 ${t(lang, "rain_chance_day", { p: pct(d.precipitation_probability_max[di]) })}` +
        (mm != null && mm >= 1 ? t(lang, "rain_total", { mm: mm.toFixed(0) }) : ""),
    );
  }
  if (!hidden.has("details")) {
    const w = d.wind_speed_10m_max?.[di];
    if (w != null) facts.push(`💨 ${t(lang, "wind_up_to", { w: speed(w, p) })}`);
  }
  if (!hidden.has("sun")) {
    const uv = d.uv_index_max[di];
    facts.push(
      `🌅 ${i18n.clock(d.sunrise[di], lang, p.clock)}    🌇 ${i18n.clock(d.sunset[di], lang, p.clock)}` +
        (uv != null ? `    🕶 ${t(lang, "uv")} <b>${uv.toFixed(0)}</b> ${uvLabel(uv, lang)}` : ""),
    );
  }
  if (facts.length) blocks.push(facts.join("\n"));

  if (!hidden.has("forecast")) {
    const per = dayPeriods(r, date);
    if (per.length) {
      blocks.push(
        per
          .map((x) => {
            const [, e] = wmo(x.code, x.key !== "evening", lang); // evening gets the night icon (moon) when clear
            return `<b>${t(lang, `p_${x.key}`)}</b> ${e} ${Number.isNaN(x.temp) ? "–" : deg(x.temp, p)} · 💧${x.prob}%`;
          })
          .join("\n"),
      );
    }
  }
  if (!hidden.has("air")) {
    const peak = aqiPeakOn(r, date);
    if (peak) {
      const [e, label] = aqiBand(peak.aqi, lang);
      blocks.push(
        `🫁 <b>${t(lang, "air_title")}</b>\n${e} ${t(lang, "aqi_tomorrow", { aqi: peak.aqi, h: hr(peak.time, p) })} · ${label}`,
      );
    }
  }
  if (!hidden.has("best")) {
    const b = bestOutside(r).tomorrow;
    blocks.push(
      `🏃 <b>${t(lang, "sec_best")}</b>\n${b ? t(lang, "best_tomorrow", { r: rangeOf(b, p) }) : t(lang, "best_none_tomorrow")}\n<i>${t(lang, "best_hint")}</i>`,
    );
  }
  if (!hidden.has("tips")) {
    blocks.push([`💡 <b>${t(lang, "tips_title")}</b>`, ...tomorrowTips(r, di, lang).map((x) => `• ${x}`)].join("\n"));
  }
  return blocks.join(`\n${DIVIDER}\n`) + "\n\n" + footer(r, p);
}

/** Seven days starting today. Weekends are marked. */
export function weekMessage(r: Report, p: Prefs): string {
  const lang = p.lang;
  const d = r.wx.daily;
  const di = dailyIndex(r);
  const lines = [`🗓 <b>${t(lang, "week_title")}</b> · ${esc(placeLabel(r.place))}`, ""];
  let rainiest = { i: -1, prob: -1 };
  for (let i = di; i < Math.min(di + 7, d.time.length); i++) {
    const date = d.time[i];
    const label = i === di ? t(lang, "today") : i18n.weekday(date, lang, true);
    const [, emoji] = wmo(d.weather_code[i], true, lang);
    const prob = pct(d.precipitation_probability_max[i]);
    const mm = d.precipitation_sum?.[i];
    if (prob > rainiest.prob) rainiest = { i, prob };
    lines.push(
      `<b>${label}</b>${i18n.isWeekend(date) ? " 🎉" : ""} ${emoji} ${deg(d.temperature_2m_min[i], p)}–${deg(d.temperature_2m_max[i], p)}` +
        ` · 💧${prob}%${mm != null && mm >= 1 ? ` · ${mm.toFixed(0)} mm` : ""}`,
    );
  }
  if (rainiest.i >= 0 && rainiest.prob >= 50) {
    lines.push("", `🌂 ${t(lang, "week_rainiest", { d: i18n.weekday(d.time[rainiest.i], lang), p: rainiest.prob })}`);
  }
  lines.push("", footer(r, p));
  return lines.join("\n");
}

// ----------------------------------------------------------------- alerts & inline
export function rainAlertMessage(r: Report, p: Prefs, a: { time: string; prob: number }): string {
  return t(p.lang, "alert_rain", { place: esc(placeLabel(r.place)), h: hr(a.time, p), p: a.prob });
}

export function aqiAlertMessage(r: Report, p: Prefs): string {
  const aq = r.aq!;
  const [, label] = aqiBand(aq.aqi, p.lang);
  const advice = "😷 " + t(p.lang, aq.aqi > 150 ? "tip_aqi_bad" : "tip_aqi_sens");
  return t(p.lang, "alert_aqi", { place: esc(placeLabel(r.place)), aqi: aq.aqi, label, advice });
}

/** A weather card for Telegram inline mode (always the compact layout). */
export function inlineCard(r: Report, p: Prefs): { title: string; description: string; text: string } {
  const c = r.wx.current;
  const [desc, emoji] = wmo(c.weather_code, (c.is_day ?? 1) === 1, p.lang);
  return {
    title: placeLabel(r.place),
    description: `${emoji} ${deg(c.temperature_2m, p)}${unitLetter(p)} · ${desc}${r.aq ? ` · AQI ${r.aq.aqi}` : ""}`,
    text: compactMessage(r, { ...p, compact: true }, undefined, []),
  };
}

export function welcomeMessage(lang: Lang, firstName: string, placeLabelText: string, dailyTime: string): string {
  const fallback = { en: "there", ms: "kawan", zh: "朋友" }[lang];
  return t(lang, "welcome", { name: firstName ? esc(firstName) : fallback, place: esc(placeLabelText), time: dailyTime });
}

// re-exported for tests / callers that need them
export { RAIN_CODES, STORM_CODES };

// ------------------------------------------------------------ official warnings
const wTitle = (w: Warning, lang: Lang) => (lang === "ms" ? w.titleBm : w.titleEn);
const wText = (w: Warning, lang: Lang) => (lang === "ms" ? w.textBm : w.textEn);
const wInstruction = (w: Warning, lang: Lang) => (lang === "ms" ? w.instructionBm : w.instructionEn);

/** "10:00 AM", or "Thu 10:00 AM" when it isn't today. `nowLocal` is the local "YYYY-MM-DDTHH:MM". */
function wLabel(iso: string, p: Prefs, nowLocal: string): string {
  const time = i18n.clock(iso, p.lang, p.clock);
  return iso.slice(0, 10) === nowLocal.slice(0, 10) ? time : `${i18n.weekday(iso, p.lang, true)} ${time}`;
}

/** The short block at the top of a report. Null when nothing applies. */
export function warningBlock(items: Warning[], p: Prefs, nowLocal: string): string | null {
  if (!items.length) return null;
  const lines = items.slice(0, 3).map((w) => `• <b>${esc(wTitle(w, p.lang))}</b> · ${t(p.lang, "warn_until", { t: wLabel(w.to!, p, nowLocal) })}`);
  if (items.length > 3) lines.push(`• +${items.length - 3}`);
  return [`⚠️ <b>${t(p.lang, "warn_block_title")}</b>`, ...lines, `<i>${t(p.lang, "warn_more")}</i>`].join("\n");
}

/** One warning in full, for a push message or the /warnings list. */
export function warningMessage(w: Warning, state: State, p: Prefs, nowLocal: string, header = true): string {
  const lang = p.lang;
  const lines: string[] = [];
  if (header) lines.push(`⚠️ <b>${t(lang, "warn_alert_title")}</b> · MetMalaysia`);
  lines.push(`<b>${esc(wTitle(w, lang))}</b>`, `🕒 ${t(lang, "warn_valid", { a: wLabel(w.from!, p, nowLocal), b: wLabel(w.to!, p, nowLocal) })}`);
  const seg = stateSegment(w, state, lang === "ms");
  if (seg) lines.push(`📍 ${esc(seg)}`);
  const body = clip(wText(w, lang), seg ? 380 : 560);
  if (body && body !== seg) lines.push("", esc(body));
  const ins = wInstruction(w, lang);
  if (ins) lines.push("", `<i>${esc(clip(ins, 240))}</i>`);
  lines.push("", `<i>${t(lang, "warn_source")}${lang === "zh" ? " " + t(lang, "warn_orig") : ""}</i>`);
  return lines.join("\n");
}

/** The /warnings answer. `elsewhere` = warnings active in other states (mentioned in a single line). */
export function warningsListMessage(items: Warning[], state: State, elsewhere: number, p: Prefs, nowLocal: string): string {
  const lang = p.lang;
  const stateLabel = esc(state);
  const parts: string[] = [];
  if (!items.length) parts.push(t(lang, "warn_none", { s: stateLabel }));
  else {
    items.slice(0, 3).forEach((w, i) => parts.push(warningMessage(w, state, p, nowLocal, i === 0)));
    if (items.length > 3) parts.push(`+${items.length - 3}`);
  }
  if (elsewhere > 0) parts.push(`<i>${t(lang, "warn_elsewhere", { n: elsewhere })}</i>`);
  return parts.join(`\n${DIVIDER}\n`);
}
