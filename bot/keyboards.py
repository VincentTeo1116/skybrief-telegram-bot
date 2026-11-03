"""Telegram keyboards (the persistent bottom bar + the inline buttons under messages)."""
from __future__ import annotations

from telegram import InlineKeyboardButton as Btn
from telegram import InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup

from .db import User
from .formatting import SECTIONS
from .i18n import LANGS, all_variants, t
from .presets import PRESETS
from .weather import Place


def is_button(text: str, key: str) -> bool:
    """True if `text` is that bottom-bar button in ANY language (so switching language never breaks it)."""
    return text in all_variants(key)


def main_reply_keyboard(lang: str = "en") -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [[KeyboardButton(t(lang, "btn_now")), KeyboardButton(t(lang, "btn_city"))],
         [KeyboardButton(t(lang, "btn_loc"), request_location=True), KeyboardButton(t(lang, "btn_settings"))]],
        resize_keyboard=True, is_persistent=True, input_field_placeholder=t(lang, "placeholder"),
    )


def report_keyboard(user: User, view: str = "now") -> InlineKeyboardMarkup:
    lang = user.lang
    other = (t(lang, "b_hourly"), "v:hourly") if view == "now" else (t(lang, "b_overview"), "v:now")
    daily = t(lang, "b_daily_on", time=user.daily_time) if user.daily_on else t(lang, "b_daily_off")
    return InlineKeyboardMarkup([
        [Btn(t(lang, "b_refresh"), callback_data=f"r:{view}"), Btn(other[0], callback_data=other[1])],
        [Btn(t(lang, "b_change"), callback_data="chg"), Btn(t(lang, "btn_settings"), callback_data="set")],
        [Btn(daily, callback_data=f"daily:{view}")],
    ])


def location_menu(lang: str = "en") -> InlineKeyboardMarkup:
    rows, row = [], []
    for i, p in enumerate(PRESETS):
        row.append(Btn(p.name(lang), callback_data=f"pre:{i}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([Btn(t(lang, "b_back"), callback_data="v:now")])
    return InlineKeyboardMarkup(rows)


def settings_keyboard(user: User) -> InlineKeyboardMarkup:
    lang = user.lang
    rows = [[Btn(("⬜ " if s in user.hidden else "✅ ") + t(lang, f"sec_{s}"), callback_data=f"tg:{s}")]
            for s in SECTIONS]
    rows.append([Btn(("● " if code == lang else "") + label, callback_data=f"lang:{code}")
                 for code, label in LANGS.items()])
    rows.append([Btn(t(lang, "b_back"), callback_data="v:now")])
    return InlineKeyboardMarkup(rows)


def results_keyboard(results: list[Place], lang: str = "en") -> InlineKeyboardMarkup:
    rows = [[Btn(("📍 " + p.label)[:60], callback_data=f"pick:{i}")] for i, p in enumerate(results)]
    rows.append([Btn(t(lang, "b_shortcuts"), callback_data="chg")])
    return InlineKeyboardMarkup(rows)


def retry_keyboard(view: str = "now", lang: str = "en") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[Btn(t(lang, "b_retry"), callback_data=f"r:{view}")]])
