/** Telegram keyboards: the persistent bottom bar + the inline buttons under messages. */
import { SECTIONS } from "./format";
import { LANGS, allVariants, t } from "./i18n";
import { PRESET_COUNT, presetName } from "./presets";
import { placeLabel } from "./weather";
import type { Markup } from "./telegram";
import type { Lang, Place, User } from "./types";

const btn = (text: string, data: string) => ({ text, callback_data: data });

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

export type View = "now" | "hourly";

export function reportKeyboard(u: User, view: View = "now"): Markup {
  const lang = u.lang;
  const other = view === "now" ? btn(t(lang, "b_hourly"), "v:hourly") : btn(t(lang, "b_overview"), "v:now");
  const daily = u.dailyOn ? t(lang, "b_daily_on", { time: u.dailyTime }) : t(lang, "b_daily_off");
  return {
    inline_keyboard: [
      [btn(t(lang, "b_refresh"), `r:${view}`), other],
      [btn(t(lang, "b_change"), "chg"), btn(t(lang, "btn_settings"), "set")],
      [btn(daily, `daily:${view}`)],
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

export function settingsKeyboard(u: User): Markup {
  const rows = SECTIONS.map((s) => [btn((u.hidden.has(s) ? "⬜ " : "✅ ") + t(u.lang, `sec_${s}`), `tg:${s}`)]);
  rows.push((Object.entries(LANGS) as [Lang, string][]).map(([code, label]) => btn((code === u.lang ? "● " : "") + label, `lang:${code}`)));
  rows.push([btn(t(u.lang, "b_back"), "v:now")]);
  return { inline_keyboard: rows };
}

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
