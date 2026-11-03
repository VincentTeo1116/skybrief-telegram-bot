"""One-shot daily push for GitHub Actions (no server needed, no live commands).

Reads TELEGRAM_BOT_TOKEN, TG_CHAT_ID and optionally CITY_NAME / CITY_LAT / CITY_LON / WAQI_TOKEN
from the environment, sends ONE weather report, then exits.
"""
from __future__ import annotations

import asyncio
import os

import httpx

from . import formatting as fmt
from .presets import DEFAULT_PLACE
from .weather import Place, WeatherService


async def run() -> None:
    token, chat_id = os.environ["TELEGRAM_BOT_TOKEN"], os.environ["TG_CHAT_ID"]
    place = DEFAULT_PLACE
    if os.getenv("CITY_LAT") and os.getenv("CITY_LON"):
        place = Place(name=os.getenv("CITY_NAME", "My city"), lat=float(os.environ["CITY_LAT"]),
                      lon=float(os.environ["CITY_LON"]), country=os.getenv("CITY_COUNTRY", ""))

    svc = WeatherService(os.getenv("WAQI_TOKEN", ""))
    try:
        report = await svc.fetch_report(place, force=True)
    finally:
        await svc.close()

    text = fmt.weather_message(report, "en", frozenset(), ribbon="☀️ <b>Good morning! Here's your daily report</b>")
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        )
        r.raise_for_status()
    print("Sent daily report for", place.label)


if __name__ == "__main__":
    asyncio.run(run())
