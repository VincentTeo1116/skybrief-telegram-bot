/** Telegram keyboards: the persistent bottom bar + the inline buttons under messages. */
import { SECTIONS } from "./format";
import { LANGS, allVariants, t } from "./i18n";
import { PRESET_COUNT, presetName } from "./presets";
import { AQI_ALERT_LEVELS } from "./units";
import { placeLabel } from "./weather";
import type { Markup } from "./telegram";
import type { Lang, Place, User } from "./types";

const btn = (text: string, data: string) => ({ text, callback_data: data });
const mark = (on: boolean, label: string) => (on ? "● " : "") + label;

/** True if `text` is that bottom-bar button in ANY language (so switching language never breaks it). */
export const isButton = (text: string, key: string) => allVariants(key).has(text);

export function mainReplyKeyboard(lang: Lang): Markup {
  return {
    keyboard: [
      [{ text: t(lang, "btn_now") }, { text: t(lang, "btn_city") }],
      [{ text: t(lang, "btn_loc"), request_location: true }, { text: t(lang, "btn_settings") }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: t(lang, "placeholder"),
  };
}

export type View = "now" | "hourly" | "tomorrow" | "week";
export const VIEWS: readonly View[] = ["now", "hourly", "tomorrow", "week"];
export const asView = (s: string): View => (VIEWS.includes(s as View) ? (s as View) : "now");

export function reportKeyboard(u: User, view: View = "now"): Markup {
  const lang = u.lang;
  const nav = (v: View, key: string) => btn(mark(v === view, t(lang, key)), `v:${v}`);
  const daily = u.dailyOn ? t(lang, "b_daily_on", { time: u.dailyTime }) : t(lang, "b_daily_off");
  return {
    inline_keyboard: [
      [nav("now", "b_today"), nav("hourly", "b_hourly")],
      [nav("tomorrow", "b_tomorrow"), nav("week", "b_week")],
      [btn(t(lang, "b_refresh"), `r:${view}`), btn(t(lang, "b_change"), "chg")],
      [btn(t(lang, "btn_settings"), "set"), btn(daily, `daily:${view}`)],
    ],
  };
}

export function locationMenu(lang: Lang): Markup {
  const rows: ReturnType<typeof btn>[][] = [];
  for (let i = 0; i < PRESET_COUNT; i += 2) {
    const row = [btn(presetName(i, lang), `pre:${i}`)];
    if (i + 1 < PRESET_COUNT) row.push(btn(presetName(i + 1, lang), `pre:${i + 1}`));
    rows.push(row);
  }
  rows.push([btn(t(lang, "b_back"), "v:now")]);
  return { inline_keyboard: rows };
}

// ------------------------------------------------------------------ settings
export type SettingsPage = "menu" | "sec" | "lang" | "units" | "alerts";
export const SETTINGS_PAGES: readonly SettingsPage[] = ["menu", "sec", "lang", "units", "alerts"];

/** One Settings page: its text and buttons. Sub-pages go back to the menu; the menu goes back to the report. */
export function settingsView(u: User, page: SettingsPage): { text: string; markup: Markup } {
  const lang = u.lang;
  const back = (to: string) => [btn(t(lang, "b_back"), to)];

  switch (page) {
    case "sec": {
      const rows = SECTIONS.map((s) => [btn((u.hidden.has(s) ? "⬜ " : "✅ ") + t(lang, `sec_${s}`), `tg:${s}`)]);
      return { text: t(lang, "settings_text"), markup: { inline_keyboard: [...rows, back("set")] } };
    }
    case "lang": {
      const row = (Object.entries(LANGS) as [Lang, string][]).map(([code, label]) => btn(mark(code === u.lang, label), `lang:${code}`));
      return { text: t(lang, "settings_lang"), markup: { inline_keyboard: [row, back("set")] } };
    }
    case "units": {
      return {
        text: t(lang, "settings_units"),
        markup: {
          inline_keyboard: [
            [btn(mark(u.tempUnit === "c", "🌡 °C"), "u:t:c"), btn(mark(u.tempUnit === "f", "🌡 °F"), "u:t:f")],
            [
              btn(mark(u.windUnit === "kmh", "💨 km/h"), "u:w:kmh"),
              btn(mark(u.windUnit === "ms", "💨 m/s"), "u:w:ms"),
              btn(mark(u.windUnit === "mph", "💨 mph"), "u:w:mph"),
            ],
            [
              btn(mark(u.clock === "auto", t(lang, "clock_auto")), "u:c:auto"),
              btn(mark(u.clock === "12", t(lang, "clock_12")), "u:c:12"),
              btn(mark(u.clock === "24", t(lang, "clock_24")), "u:c:24"),
            ],
            [btn(t(lang, u.compact ? "compact_on" : "compact_off"), "u:k")],
            back("set"),
          ],
        },
      };
    }
    case "alerts": {
      return {
        text: t(lang, "settings_alerts"),
        markup: {
          inline_keyboard: [
            [btn(t(lang, u.rainAlerts ? "a_rain_on" : "a_rain_off"), "al:rain")],
            AQI_ALERT_LEVELS.map((n) =>
              btn(mark(u.aqiAlert === n, n === 0 ? t(lang, "a_aqi_off") : t(lang, "a_aqi_at", { n })), `al:aqi:${n}`),
            ),
            [btn(u.eveningOn ? t(lang, "a_eve_on", { time: u.eveningTime }) : t(lang, "a_eve_off"), "al:eve")],
            back("set"),
          ],
        },
      };
    }
    default:
      return {
        text: t(lang, "settings_menu"),
        markup: {
          inline_keyboard: [
            [btn(t(lang, "m_sections"), "set:sec")],
            [btn(t(lang, "m_lang"), "set:lang")],
            [btn(t(lang, "m_units"), "set:units")],
            [btn(t(lang, "m_alerts"), "set:alerts")],
            back("v:now"),
          ],
        },
      };
  }
}

// --------------------------------------------------------------------- misc
export function resultsKeyboard(results: Place[], lang: Lang): Markup {
  const rows = results.map((p, i) => [btn(("📍 " + placeLabel(p)).slice(0, 60), `pick:${i}`)]);
  rows.push([btn(t(lang, "b_shortcuts"), "chg")]);
  return { inline_keyboard: rows };
}

export function retryKeyboard(view: View, lang: Lang): Markup {
  return { inline_keyboard: [[btn(t(lang, "b_retry"), `r:${view}`)]] };
}

export function approvalKeyboard(chatId: number): Markup {
  return { inline_keyboard: [[btn("✅ Approve", `adm:ok:${chatId}`), btn("⛔ Deny", `adm:no:${chatId}`)]] };
}

/** Buttons under a proactive alert: mute that kind of alert, or open the full report. */
export function alertKeyboard(kind: "rain" | "aqi", lang: Lang): Markup {
  return { inline_keyboard: [[btn(t(lang, "b_mute"), `mute:${kind}`)], [btn(t(lang, "b_report"), "v:now")]] };
}
