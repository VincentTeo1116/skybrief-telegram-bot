/**
 * Turn a Report into pretty Telegram HTML. Pure functions: easy to unit-test.
 * Every public function takes `lang`; the main report also takes `hidden` (sections the user switched off).
 */
import * as i18n from "./i18n";
import { t } from "./i18n";
import { placeLabel } from "./weather";
import type { Lang, Report } from "./types";
import { escapeHtml as esc } from "./util";

export const SECTIONS = ["details", "sun", "air", "rain", "forecast", "tips"] as const;
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
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const STORM_CODES = new Set([95, 96, 99]);
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

const deg = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v)}°`);
const prob = (v: number | null | undefined) => (v == null ? 0 : Math.round(v));

interface HourRow {
  time: string;
  temp: number | null;
  prob: number;
  code: number | null;
}

function hourIndex(r: Report): number {
  const cur = r.wx.current.time.slice(0, 13) + ":00";
  const i = r.wx.hourly.time.indexOf(cur);
  return i >= 0 ? i : 0;
}

export function nextHours(r: Report, n: number): HourRow[] {
  const h = r.wx.hourly;
  const start = hourIndex(r);
  const rows: HourRow[] = [];
  for (let k = start; k < Math.min(start + n, h.time.length); k++) {
    rows.push({ time: h.time[k], temp: h.temperature_2m[k], prob: prob(h.precipitation_probability[k]), code: h.weather_code[k] });
  }
  return rows;
}

// ---------------------------------------------------------------- sections
function rainOutlook(r: Report, lang: Lang): string {
  const c = r.wx.current;
  const all = nextHours(r, 7);
  const rows = all.slice(1).length ? all.slice(1) : all;
  const peak = rows.reduce<HourRow | null>((best, x) => (best === null || x.prob > best.prob ? x : best), null);
  const rainingNow = (c.precipitation ?? 0) >= 0.1 || (c.weather_code != null && RAIN_CODES.has(c.weather_code));
  if (rainingNow) {
    const more = peak && peak.prob >= 40 ? t(lang, "raining_more", { p: peak.prob }) : "";
    return `🌧 <b>${t(lang, "raining_now")}</b>${more}`;
  }
  if (peak && peak.prob >= 60) return `☔ <b>${t(lang, "rain_likely", { h: i18n.hourLabel(peak.time, lang), p: peak.prob })}</b>`;
  if (peak && peak.prob >= 30) return `🌦 ${t(lang, "rain_chance", { h: i18n.hourLabel(peak.time, lang), p: peak.prob })}`;
  return `✅ ${t(lang, "rain_none")}`;
}

function airBlock(r: Report, lang: Lang): string[] {
  const aq = r.aq;
  const title = `🫁 <b>${t(lang, "air_title")}</b>`;
  if (!aq) return [title, t(lang, "air_unavail")];
  const [emoji, label] = aqiBand(aq.aqi, lang);
  const lines = [title, `${emoji} <b>AQI ${aq.aqi}</b> · ${label}`];
  const extras: string[] = [];
  if (aq.pm25 != null) extras.push(`PM2.5 ${aq.pm25.toFixed(0)} µg/m³`);
  if (aq.pm10 != null) extras.push(`PM10 ${aq.pm10.toFixed(0)} µg/m³`);
  if (aq.dominant) extras.push(t(lang, "pollutant", { p: esc(aq.dominant) }));
  if (extras.length) lines.push(extras.join(" · "));
  return lines;
}

export function tips(r: Report, lang: Lang): string[] {
  const c = r.wx.current;
  const d = r.wx.daily;
  const out: string[] = [];
  const upcoming = nextHours(r, 7);
  if (prob(d.precipitation_probability_max[0]) >= 50 || upcoming.some((x) => x.prob >= 50)) out.push("☂️ " + t(lang, "tip_umbrella"));
  if (upcoming.some((x) => x.code != null && STORM_CODES.has(x.code))) out.push("⚡ " + t(lang, "tip_storm"));
  const uv = d.uv_index_max[0] ?? 0;
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

function forecastLines(r: Report, lang: Lang): string[] {
  const d = r.wx.daily;
  const lines: string[] = [];
  for (let i = 1; i < Math.min(4, d.time.length); i++) {
    const [, emoji] = wmo(d.weather_code[i], true, lang);
    lines.push(
      `<b>${i18n.weekday(d.time[i], lang, true)}</b> ${emoji} ${deg(d.temperature_2m_min[i])}–${deg(d.temperature_2m_max[i])}` +
        ` · 💧${prob(d.precipitation_probability_max[i])}%`,
    );
  }
  return lines;
}

function footer(r: Report, lang: Lang): string {
  let src = t(lang, "src_weather");
  const aq = r.aq;
  if (aq) {
    src +=
      " · " +
      (aq.station
        ? t(lang, "src_air_station", { name: esc(aq.station), km: (aq.km ?? 0).toFixed(0) })
        : t(lang, "src_air_model"));
  }
  return `<i>🕒 ${t(lang, "observed", { t: i18n.clock(r.wx.current.time, lang) })}\n${src}</i>`;
}

// ------------------------------------------------------------------ views
export function weatherMessage(r: Report, lang: Lang = "en", hidden: ReadonlySet<string> = new Set(), ribbon?: string): string {
  const c = r.wx.current;
  const d = r.wx.daily;
  const [desc, emoji] = wmo(c.weather_code, (c.is_day ?? 1) === 1, lang);

  const head: string[] = [];
  if (ribbon) head.push(ribbon, "");
  head.push(
    `📍 <b>${esc(placeLabel(r.place))}</b>`,
    `<i>${i18n.dateLong(c.time, lang)}</i>`,
    "",
    `${emoji} <b>${deg(c.temperature_2m)}C</b> · ${desc}`,
    `${t(lang, "feels")} ${deg(c.apparent_temperature)} · ▲ ${deg(d.temperature_2m_max[0])} ▼ ${deg(d.temperature_2m_min[0])}`,
  );
  const blocks: string[] = [head.join("\n")];

  const facts: string[] = [];
  if (!hidden.has("details")) {
    const dir = c.wind_direction_10m != null ? i18n.compassDir(c.wind_direction_10m, lang) : "";
    facts.push(
      `💧 ${t(lang, "humidity")} <b>${Math.round(c.relative_humidity_2m)}%</b>    ` +
        `💨 ${t(lang, "wind")} <b>${Math.round(c.wind_speed_10m)} km/h ${dir}</b>`,
      `☁️ ${t(lang, "cloud")} <b>${Math.round(c.cloud_cover)}%</b>    🧭 <b>${Math.round(c.pressure_msl)} hPa</b>`,
    );
  }
  if (!hidden.has("sun")) {
    const uv = d.uv_index_max[0];
    facts.push(
      `🌅 ${i18n.clock(d.sunrise[0], lang)}    🌇 ${i18n.clock(d.sunset[0], lang)}` +
        (uv != null ? `    🕶 ${t(lang, "uv")} <b>${uv.toFixed(0)}</b> ${uvLabel(uv, lang)}` : ""),
    );
  }
  if (facts.length) blocks.push(facts.join("\n"));
  if (!hidden.has("air")) blocks.push(airBlock(r, lang).join("\n"));
  if (!hidden.has("rain")) blocks.push(`🌂 <b>${t(lang, "rain_title")}</b>\n${rainOutlook(r, lang)}`);
  if (!hidden.has("forecast")) blocks.push([`📅 <b>${t(lang, "forecast_title")}</b>`, ...forecastLines(r, lang)].join("\n"));
  if (!hidden.has("tips")) blocks.push([`💡 <b>${t(lang, "tips_title")}</b>`, ...tips(r, lang).map((x) => `• ${x}`)].join("\n"));

  return blocks.join(`\n${DIVIDER}\n`) + "\n\n" + footer(r, lang);
}

export function hourlyMessage(r: Report, lang: Lang = "en"): string {
  const out = [`⏱ <b>${t(lang, "hourly_title")}</b> · ${esc(placeLabel(r.place))}`, ""];
  for (const row of nextHours(r, 12)) {
    const hour = Number(row.time.slice(11, 13));
    const [, emoji] = wmo(row.code, hour >= 6 && hour < 19, lang);
    const filled = Math.round(row.prob / 20);
    const bar = "▰".repeat(filled) + "▱".repeat(5 - filled);
    out.push(`<code>${i18n.hourLabel(row.time, lang).padStart(5)}</code> ${emoji} <b>${deg(row.temp)}</b>  ${bar} ${row.prob}%`);
  }
  out.push("", `<i>${t(lang, "bars_note")}</i>`, "", footer(r, lang));
  return out.join("\n");
}

export function welcomeMessage(lang: Lang, firstName: string, placeLabelText: string, dailyTime: string): string {
  const fallback = { en: "there", ms: "kawan", zh: "朋友" }[lang];
  return t(lang, "welcome", { name: firstName ? esc(firstName) : fallback, place: esc(placeLabelText), time: dailyTime });
}
