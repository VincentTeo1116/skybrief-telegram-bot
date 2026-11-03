"""Wire everything together and run the bot."""
from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import (Application, CallbackQueryHandler, CommandHandler, MessageHandler, TypeHandler, filters)

from . import handlers as h
from .config import Settings, load_settings
from .db import Database
from .weather import WeatherService

log = logging.getLogger("bot")



async def _post_init(app: Application) -> None:
    await app.bot.set_my_commands(h.bot_commands("en"))
    await app.bot.set_my_commands(h.bot_commands("ms"), language_code="ms")
    await app.bot.set_my_commands(h.bot_commands("zh"), language_code="zh")
    users = app.bot_data["db"].daily_users()
    for u in users:
        h.schedule_daily(app, u)
    log.info("Bot started. Daily reports scheduled for %d user(s).", len(users))


async def _post_shutdown(app: Application) -> None:
    await app.bot_data["wx"].close()
    app.bot_data["db"].close()


def build_app(settings: Settings) -> Application:
    app = Application.builder().token(settings.token).post_init(_post_init).post_shutdown(_post_shutdown).build()
    app.bot_data.update(
        settings=settings,
        db=Database(settings.db_path),
        wx=WeatherService(settings.waqi_token),
    )

    private = filters.ChatType.PRIVATE
    app.add_handler(TypeHandler(Update, h.gate), group=-1)
    app.add_handler(CommandHandler("start", h.cmd_start, filters=private))
    app.add_handler(CommandHandler("help", h.cmd_help, filters=private))
    app.add_handler(CommandHandler("weather", h.cmd_weather, filters=private))
    app.add_handler(CommandHandler("hourly", h.cmd_hourly, filters=private))
    app.add_handler(CommandHandler("city", h.cmd_city, filters=private))
    app.add_handler(CommandHandler("daily", h.cmd_daily, filters=private))
    app.add_handler(CommandHandler("settime", h.cmd_settime, filters=private))
    app.add_handler(CommandHandler("settings", h.cmd_settings, filters=private))
    app.add_handler(MessageHandler(filters.LOCATION & filters.UpdateType.MESSAGE & private, h.on_location))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND & private, h.on_text))
    app.add_handler(CallbackQueryHandler(h.on_button))
    app.add_error_handler(h.on_error)
    return app


def main() -> None:
    settings = load_settings()
    logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=settings.log_level)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # httpx logs full URLs (incl. bot token) at INFO
    if not settings.allowed_users:
        log.warning("ALLOWED_USER_IDS is empty: anyone who finds the bot can use it.")
    build_app(settings).run_polling(drop_pending_updates=True, allowed_updates=Update.ALL_TYPES)
