"""Runtime settings, read from environment variables (or a local .env file)."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

_TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def normalise_time(value: str) -> str | None:
    """'8:30' -> '08:30'. Returns None if the text is not a valid HH:MM."""
    m = _TIME_RE.match(value.strip())
    if not m:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


@dataclass(frozen=True)
class Settings:
    token: str
    allowed_users: frozenset[int]
    db_path: str
    waqi_token: str
    default_daily_time: str
    log_level: str


def load_settings() -> Settings:
    from dotenv import load_dotenv   # lazy: the GitHub Actions sender doesn't install python-dotenv

    load_dotenv()
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.")

    allowed = frozenset(
        int(x) for x in re.split(r"[,\s]+", os.getenv("ALLOWED_USER_IDS", "").strip()) if x.strip().lstrip("-").isdigit()
    )
    daily = normalise_time(os.getenv("DEFAULT_DAILY_TIME", "08:30")) or "08:30"

    return Settings(
        token=token,
        allowed_users=allowed,
        db_path=os.getenv("DB_PATH", "data/bot.db").strip(),
        waqi_token=os.getenv("WAQI_TOKEN", "").strip(),
        default_daily_time=daily,
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
    )
