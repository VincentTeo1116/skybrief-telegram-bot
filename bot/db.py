"""Tiny SQLite store: one row per Telegram user (their saved location + daily-push preference)."""
from __future__ import annotations

import os
import sqlite3
import threading
from dataclasses import dataclass

from .weather import Place


@dataclass
class User:
    chat_id: int
    first_name: str
    place_name: str
    lat: float
    lon: float
    country: str
    tz: str
    daily_on: bool
    daily_time: str  # "HH:MM", interpreted in the location's own timezone
    lang: str = "en"
    hidden: frozenset = frozenset()  # report sections the user switched off

    def place(self) -> Place:
        return Place(name=self.place_name, lat=self.lat, lon=self.lon, country=self.country, tz=self.tz)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    chat_id    INTEGER PRIMARY KEY,
    first_name TEXT    NOT NULL DEFAULT '',
    place_name TEXT    NOT NULL,
    lat        REAL    NOT NULL,
    lon        REAL    NOT NULL,
    country    TEXT    NOT NULL DEFAULT '',
    tz         TEXT    NOT NULL DEFAULT 'UTC',
    daily_on   INTEGER NOT NULL DEFAULT 1,
    daily_time TEXT    NOT NULL DEFAULT '08:30'
);
"""


class Database:
    def __init__(self, path: str):
        folder = os.path.dirname(os.path.abspath(path))
        os.makedirs(folder, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(_SCHEMA)
            cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(users)")}
            if "lang" not in cols:
                self._conn.execute("ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'")
            if "hidden" not in cols:
                self._conn.execute("ALTER TABLE users ADD COLUMN hidden TEXT NOT NULL DEFAULT ''")
            self._conn.commit()

    @staticmethod
    def _row(r: sqlite3.Row | None) -> User | None:
        if r is None:
            return None
        return User(
            chat_id=r["chat_id"], first_name=r["first_name"], place_name=r["place_name"],
            lat=r["lat"], lon=r["lon"], country=r["country"], tz=r["tz"],
            daily_on=bool(r["daily_on"]), daily_time=r["daily_time"],
            lang=r["lang"], hidden=frozenset(x for x in r["hidden"].split(",") if x),
        )

    def get_user(self, chat_id: int) -> User | None:
        with self._lock:
            return self._row(self._conn.execute("SELECT * FROM users WHERE chat_id=?", (chat_id,)).fetchone())

    def ensure_user(self, chat_id: int, first_name: str, default: Place, daily_time: str) -> User:
        """Return the user, creating them with the default city on first contact."""
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO users (chat_id, first_name, place_name, lat, lon, country, tz, daily_time) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (chat_id, first_name, default.name, default.lat, default.lon, default.country, default.tz, daily_time),
            )
            self._conn.commit()
        return self.get_user(chat_id)  # type: ignore[return-value]

    def set_location(self, chat_id: int, place: Place) -> User:
        with self._lock:
            self._conn.execute(
                "UPDATE users SET place_name=?, lat=?, lon=?, country=?, tz=? WHERE chat_id=?",
                (place.name, place.lat, place.lon, place.country, place.tz, chat_id),
            )
            self._conn.commit()
        return self.get_user(chat_id)  # type: ignore[return-value]

    def set_daily(self, chat_id: int, on: bool) -> User:
        with self._lock:
            self._conn.execute("UPDATE users SET daily_on=? WHERE chat_id=?", (int(on), chat_id))
            self._conn.commit()
        return self.get_user(chat_id)  # type: ignore[return-value]

    def set_daily_time(self, chat_id: int, hhmm: str) -> User:
        with self._lock:
            self._conn.execute("UPDATE users SET daily_time=?, daily_on=1 WHERE chat_id=?", (hhmm, chat_id))
            self._conn.commit()
        return self.get_user(chat_id)  # type: ignore[return-value]

    def set_lang(self, chat_id: int, lang: str) -> User:
        with self._lock:
            self._conn.execute("UPDATE users SET lang=? WHERE chat_id=?", (lang, chat_id))
            self._conn.commit()
        return self.get_user(chat_id)  # type: ignore[return-value]

    def toggle_section(self, chat_id: int, section: str) -> User:
        user = self.get_user(chat_id)
        hidden = set(user.hidden)  # type: ignore[union-attr]
        hidden.symmetric_difference_update({section})
        with self._lock:
            self._conn.execute("UPDATE users SET hidden=? WHERE chat_id=?", (",".join(sorted(hidden)), chat_id))
            self._conn.commit()
        return self.get_user(chat_id)  # type: ignore[return-value]

    def daily_users(self) -> list[User]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM users WHERE daily_on=1").fetchall()
        return [self._row(r) for r in rows]  # type: ignore[misc]

    def close(self) -> None:
        with self._lock:
            self._conn.close()
