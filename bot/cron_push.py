"""One-shot daily push for GitHub Actions (no server needed, no live commands).

Environment
-----------
Required : TELEGRAM_BOT_TOKEN, TG_CHAT_ID
Optional : WAQI_TOKEN                      measured AQI from the nearest station
           CITY_NAME CITY_LAT CITY_LON    location (default: Kuala Lumpur)
           CITY_COUNTRY CITY_TZ            default country "" / timezone Asia/Kuala_Lumpur
           LANGUAGE                        en (default) | ms | zh
           HIDDEN_SECTIONS                 comma list of: details,sun,air,rain,forecast,tips
           SEND_AT                         "08:30": wait until exactly this local time before sending
           WAIT_FOR_SEND_TIME              "true" to enable that wait (the workflow sets it for scheduled runs only)
           DRY_RUN                         "1" prints the message instead of sending it
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from . import formatting as fmt
from . import i18n
from .config import normalise_time
from .presets import DEFAULT_PLACE
from .weather import Place, WeatherService

MAX_WAIT_SECONDS = 25 * 60   # never idle longer than this (protects your Actions minutes)


def env(name: str, default: str = "") -> str:
    """Like os.getenv, but treats an empty value (unset GitHub variable) as missing."""
    return os.getenv(name, "").strip() or default


def seconds_until(send_at: str, tz_name: str, now: datetime | None = None, max_wait: int = MAX_WAIT_SECONDS) -> float:
    """Seconds to wait until `send_at` (HH:MM) local time. 0 if it already passed or is too far away."""
    hhmm = normalise_time(send_at)
    if not hhmm:
        return 0.0
    tz = ZoneInfo(tz_name)
    now = (now or datetime.now(tz)).astimezone(tz)
    hh, mm = (int(x) for x in hhmm.split(":"))
    delta = (now.replace(hour=hh, minute=mm, second=0, microsecond=0) - now).total_seconds()
    return delta if 0 < delta <= max_wait else 0.0


def parse_place() -> Place:
    if env("CITY_LAT") and env("CITY_LON"):
        return Place(name=env("CITY_NAME", "My city"), lat=float(env("CITY_LAT")), lon=float(env("CITY_LON")),
                     country=env("CITY_COUNTRY"), tz=env("CITY_TZ", "Asia/Kuala_Lumpur"))
    return DEFAULT_PLACE


async def run() -> int:
    token, chat_id = env("TELEGRAM_BOT_TOKEN"), env("TG_CHAT_ID")
    dry = env("DRY_RUN") == "1"
    if not dry and not (token and chat_id):
        print("ERROR: TELEGRAM_BOT_TOKEN and TG_CHAT_ID must be set (repo Settings > Secrets).", file=sys.stderr)
        return 2

    place = parse_place()
    lang = i18n.norm(env("LANGUAGE", "en"))
    hidden = frozenset(s.strip() for s in env("HIDDEN_SECTIONS").split(",") if s.strip() in fmt.SECTIONS)

    # Start early, send exactly on time: GitHub's scheduler often fires a few minutes late.
    if env("SEND_AT") and env("WAIT_FOR_SEND_TIME").lower() == "true":
        wait = seconds_until(env("SEND_AT"), place.tz)
        if wait:
            print(f"Waiting {wait:.0f}s until {env('SEND_AT')} ({place.tz})…")
            await asyncio.sleep(wait)

    svc = WeatherService(env("WAQI_TOKEN"))
    try:
        report = await svc.fetch_report(place, force=True)
    finally:
        await svc.close()

    ribbon = f"☀️ <b>{i18n.t(lang, 'ribbon_daily')}</b>"
    text = fmt.weather_message(report, lang, hidden, ribbon)
    if dry:
        print(text)
        return 0

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        )
    if r.status_code != 200:   # don't print the request URL: it contains the bot token
        print(f"ERROR: Telegram returned {r.status_code}: {r.text}", file=sys.stderr)
        return 1
    print(f"Sent daily report for {place.label} ({lang})")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
