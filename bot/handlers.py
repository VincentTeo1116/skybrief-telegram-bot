"""Telegram handlers: commands, buttons, settings, location sharing, city search, daily push."""
from __future__ import annotations

import logging
from datetime import time as dtime
from html import escape
from zoneinfo import ZoneInfo

from telegram import BotCommand, BotCommandScopeChat, Update
from telegram.constants import ChatAction, ParseMode
from telegram.error import BadRequest, Forbidden, TelegramError
from telegram.ext import Application, ApplicationHandlerStop, ContextTypes

from . import formatting as fmt
from . import keyboards as kb
from .config import Settings, normalise_time
from .db import Database, User
from .i18n import LANGS, t
from .presets import DEFAULT_PLACE, PRESETS, match_preset, preset_place
from .weather import Place, WeatherError, WeatherService, haversine_km

log = logging.getLogger(__name__)
HTML = ParseMode.HTML


# ------------------------------------------------------------------ plumbing
def _db(ctx: ContextTypes.DEFAULT_TYPE) -> Database:
    return ctx.application.bot_data["db"]


def _wx(ctx: ContextTypes.DEFAULT_TYPE) -> WeatherService:
    return ctx.application.bot_data["wx"]


def _settings(ctx: ContextTypes.DEFAULT_TYPE) -> Settings:
    return ctx.application.bot_data["settings"]


def _user(ctx: ContextTypes.DEFAULT_TYPE, update: Update) -> User:
    tg = update.effective_user
    return _db(ctx).ensure_user(
        update.effective_chat.id, tg.first_name if tg else "", DEFAULT_PLACE, _settings(ctx).default_daily_time
    )


def bot_commands(lang: str) -> list[BotCommand]:
    return [BotCommand(c, t(lang, f"cmd_{c}")) for c in
            ("weather", "hourly", "city", "daily", "settime", "settings", "help")]


async def _set_chat_commands(bot, chat_id: int, lang: str) -> None:
    try:
        await bot.set_my_commands(bot_commands(lang), scope=BotCommandScopeChat(chat_id))
    except TelegramError as exc:
        log.warning("Could not set commands for %s: %s", chat_id, exc)


async def gate(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """If ALLOWED_USER_IDS is set, ignore everybody else."""
    allowed = _settings(ctx).allowed_users
    if not allowed:
        return
    user = update.effective_user
    if user is None or user.id not in allowed:
        if update.effective_message:
            await update.effective_message.reply_text(
                f"🔒 This is a private bot.\nYour Telegram ID is <code>{user.id if user else '?'}</code>.", parse_mode=HTML
            )
        raise ApplicationHandlerStop


async def build_view(ctx: ContextTypes.DEFAULT_TYPE, user: User, view: str = "now",
                     force: bool = False, ribbon: str | None = None):
    report = await _wx(ctx).fetch_report(user.place(), force=force)
    if view == "hourly":
        text = fmt.hourly_message(report, user.lang)
    else:
        text = fmt.weather_message(report, user.lang, user.hidden, ribbon)
    return text, kb.report_keyboard(user, view)


async def _reply_report(update: Update, ctx: ContextTypes.DEFAULT_TYPE, view: str = "now") -> None:
    msg = update.effective_message
    await msg.chat.send_action(ChatAction.TYPING)
    user = _user(ctx, update)
    try:
        text, markup = await build_view(ctx, user, view)
    except WeatherError:
        await msg.reply_text(t(user.lang, "err_wx"), reply_markup=kb.retry_keyboard(view, user.lang))
        return
    await msg.reply_text(text, parse_mode=HTML, reply_markup=markup)


async def _edit(q, text: str, markup, lang: str = "en") -> bool:
    """Edit the message. Returns True if edited (caller may still answer the query);
    False if the content was identical (we already answered with a toast)."""
    try:
        await q.edit_message_text(text, parse_mode=HTML, reply_markup=markup)
        return True
    except BadRequest as exc:
        if "not modified" in str(exc).lower():
            try:
                await q.answer(t(lang, "toast_uptodate"))
            except BadRequest:
                pass  # already answered
            return False
        raise


# --------------------------------------------------------------- daily push
def schedule_daily(app: Application, user: User) -> None:
    name = f"daily_{user.chat_id}"
    for job in app.job_queue.get_jobs_by_name(name):
        job.schedule_removal()
    if not user.daily_on:
        return
    hh, mm = (int(x) for x in user.daily_time.split(":"))
    try:
        tz = ZoneInfo(user.tz)
    except Exception:  # unknown tz name -> fall back to UTC rather than crash
        log.warning("Unknown timezone %r for %s, using UTC", user.tz, user.chat_id)
        tz = ZoneInfo("UTC")
    app.job_queue.run_daily(daily_job, time=dtime(hh, mm, tzinfo=tz), name=name, chat_id=user.chat_id)
    log.info("Scheduled daily report for %s at %s %s", user.chat_id, user.daily_time, tz.key)


async def daily_job(ctx: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = ctx.job.chat_id
    user = _db(ctx).get_user(chat_id)
    if not user or not user.daily_on:
        return
    try:
        text, markup = await build_view(ctx, user, "now", force=True,
                                        ribbon=f"☀️ <b>{t(user.lang, 'ribbon_daily')}</b>")
        await ctx.bot.send_message(chat_id, text, parse_mode=HTML, reply_markup=markup)
    except Forbidden:
        log.info("User %s blocked the bot; disabling daily report", chat_id)
        schedule_daily(ctx.application, _db(ctx).set_daily(chat_id, False))
    except (WeatherError, TelegramError) as exc:
        log.error("Daily report for %s failed: %s", chat_id, exc)


# ------------------------------------------------------------------ commands
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    user = _user(ctx, update)
    schedule_daily(ctx.application, user)
    await _set_chat_commands(ctx.bot, user.chat_id, user.lang)
    await update.effective_message.reply_text(
        fmt.welcome_message(user.lang, user.first_name, user.place().label, user.daily_time),
        parse_mode=HTML, reply_markup=kb.main_reply_keyboard(user.lang),
    )
    await _reply_report(update, ctx)


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    user = _user(ctx, update)
    await update.effective_message.reply_text(fmt.help_text(user.lang), parse_mode=HTML,
                                              reply_markup=kb.main_reply_keyboard(user.lang))


async def cmd_weather(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await _reply_report(update, ctx, "now")


async def cmd_hourly(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await _reply_report(update, ctx, "hourly")


async def cmd_city(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    user = _user(ctx, update)
    await update.effective_message.reply_text(
        t(user.lang, "city_menu", p=escape(user.place().label)), parse_mode=HTML,
        reply_markup=kb.location_menu(user.lang),
    )


async def cmd_settings(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    user = _user(ctx, update)
    await update.effective_message.reply_text(
        t(user.lang, "settings_text"), parse_mode=HTML, reply_markup=kb.settings_keyboard(user))


async def cmd_daily(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    user = _user(ctx, update)
    user = _db(ctx).set_daily(user.chat_id, not user.daily_on)
    schedule_daily(ctx.application, user)
    msg = (t(user.lang, "daily_on_msg", time=user.daily_time, tz=user.tz) if user.daily_on
           else t(user.lang, "daily_off_msg"))
    await update.effective_message.reply_text(msg, parse_mode=HTML)


async def cmd_settime(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    user = _user(ctx, update)
    hhmm = normalise_time(ctx.args[0]) if ctx.args else None
    if not hhmm:
        await update.effective_message.reply_text(t(user.lang, "settime_usage"), parse_mode=HTML)
        return
    user = _db(ctx).set_daily_time(user.chat_id, hhmm)
    schedule_daily(ctx.application, user)
    await update.effective_message.reply_text(
        t(user.lang, "settime_ok", time=hhmm, tz=user.tz), parse_mode=HTML)


# -------------------------------------------------------------- location flow
async def _apply_place(ctx: ContextTypes.DEFAULT_TYPE, user: User, place: Place):
    """Validate the place by fetching its weather, persist it, reschedule the daily push."""
    report = await _wx(ctx).fetch_report(place, force=True)
    place.tz = report.tz
    user = _db(ctx).set_location(user.chat_id, place)
    schedule_daily(ctx.application, user)
    ribbon = f"✅ <b>{t(user.lang, 'ribbon_saved')}</b> {escape(place.label)}"
    return fmt.weather_message(report, user.lang, user.hidden, ribbon), kb.report_keyboard(user, "now")


async def _localised_place(ctx: ContextTypes.DEFAULT_TYPE, user: User, lang: str) -> Place:
    """The user's saved place, renamed into `lang` when we can do so reliably."""
    p = user.place()
    idx = match_preset(p.lat, p.lon)
    if idx is not None:
        return preset_place(idx, lang)
    try:
        for cand in await _wx(ctx).search_places(p.name, limit=5, lang=lang):
            if haversine_km(p.lat, p.lon, cand.lat, cand.lon) < 15:
                cand.lat, cand.lon, cand.tz = p.lat, p.lon, p.tz   # keep the exact saved coordinates
                return cand
    except WeatherError:
        pass
    return p


async def on_location(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """User tapped '📍 Share my location' (live GPS detection)."""
    msg = update.effective_message
    user = _user(ctx, update)
    await msg.chat.send_action(ChatAction.TYPING)
    loc = msg.location
    try:
        place = await _wx(ctx).reverse_geocode(loc.latitude, loc.longitude, user.lang)
        text, markup = await _apply_place(ctx, user, place)
    except WeatherError:
        await msg.reply_text(t(user.lang, "err_loc"))
        return
    await msg.reply_text(text, parse_mode=HTML, reply_markup=markup)


async def on_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.effective_message
    text = (msg.text or "").strip()
    user = _user(ctx, update)
    if kb.is_button(text, "btn_now"):
        return await _reply_report(update, ctx, "now")
    if kb.is_button(text, "btn_city"):
        return await cmd_city(update, ctx)
    if kb.is_button(text, "btn_settings"):
        return await cmd_settings(update, ctx)

    # Anything else is treated as a city search.
    if not 2 <= len(text) <= 60:
        await msg.reply_text(t(user.lang, "type_city"), parse_mode=HTML)
        return
    await msg.chat.send_action(ChatAction.TYPING)
    try:
        results = await _wx(ctx).search_places(text, lang=user.lang)
    except WeatherError:
        await msg.reply_text(t(user.lang, "err_search"))
        return
    if not results:
        await msg.reply_text(t(user.lang, "not_found", q=escape(text)), parse_mode=HTML)
        return
    ctx.user_data["results"] = results
    await msg.reply_text(t(user.lang, "which_one"), reply_markup=kb.results_keyboard(results, user.lang))


# ------------------------------------------------------------ inline buttons
async def on_button(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    data = q.data or ""
    user = _user(ctx, update)
    lang = user.lang
    # Telegram accepts ONE answer per button press, so each branch answers exactly once.
    try:
        if data.startswith(("v:", "r:")):                      # view / refresh
            kind, view = data.split(":", 1)
            text, markup = await build_view(ctx, user, view, force=(kind == "r"))
            if await _edit(q, text, markup, lang):
                await q.answer(t(lang, "toast_updated") if kind == "r" else None)

        elif data == "chg":                                    # open the location menu
            await q.answer()
            await _edit(q, t(lang, "city_menu", p=escape(user.place().label)), kb.location_menu(lang), lang)

        elif data == "set":                                    # open settings
            await q.answer()
            await _edit(q, t(lang, "settings_text"), kb.settings_keyboard(user), lang)

        elif data.startswith("tg:"):                           # show/hide a report section
            section = data[3:]
            if section in fmt.SECTIONS:
                user = _db(ctx).toggle_section(user.chat_id, section)
            await _edit(q, t(lang, "settings_text"), kb.settings_keyboard(user), lang)
            await q.answer()

        elif data.startswith("lang:"):                         # change language
            code = data[5:]
            if code not in LANGS:
                await q.answer()
                return
            user = _db(ctx).set_lang(user.chat_id, code)
            new_place = await _localised_place(ctx, user, code)
            if new_place.label != user.place().label:
                user = _db(ctx).set_location(user.chat_id, new_place)
            changed = await _edit(q, t(code, "settings_text"), kb.settings_keyboard(user), code)
            if changed:
                await q.answer()
            # The bottom keyboard and command menu can only be replaced by sending a message.
            await ctx.bot.send_message(user.chat_id, t(code, "lang_changed"),
                                       reply_markup=kb.main_reply_keyboard(code))
            await _set_chat_commands(ctx.bot, user.chat_id, code)

        elif data.startswith("pre:"):                          # preset city
            await q.answer(t(lang, "toast_switch"))
            place = preset_place(int(data[4:]), lang)
            text, markup = await _apply_place(ctx, user, place)
            await _edit(q, text, markup, lang)

        elif data.startswith("pick:"):                         # search result
            await q.answer(t(lang, "toast_switch"))
            results = ctx.user_data.get("results") or []
            idx = int(data[5:])
            if idx >= len(results):
                await _edit(q, t(lang, "list_expired"), None, lang)
                return
            text, markup = await _apply_place(ctx, user, results[idx])
            await _edit(q, text, markup, lang)

        elif data.startswith("daily:"):                        # toggle daily push
            view = data.split(":", 1)[1]
            user = _db(ctx).set_daily(user.chat_id, not user.daily_on)
            schedule_daily(ctx.application, user)
            await q.edit_message_reply_markup(kb.report_keyboard(user, view))
            await q.answer(t(lang, "toast_daily_on" if user.daily_on else "toast_daily_off"))

        else:
            await q.answer()

    except WeatherError:
        try:
            await q.answer(t(lang, "err_toast"), show_alert=True)
        except BadRequest:
            pass  # already answered above; nothing more we can show


async def on_error(update: object, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    log.exception("Unhandled error", exc_info=ctx.error)
    if isinstance(update, Update) and update.effective_message:
        try:
            user = _db(ctx).get_user(update.effective_chat.id)
            await update.effective_message.reply_text(t(user.lang if user else "en", "err_generic"))
        except TelegramError:
            pass
