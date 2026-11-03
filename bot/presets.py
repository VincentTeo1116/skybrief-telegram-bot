"""One-tap city shortcuts. Edit freely.

Each entry: (English, Bahasa Melayu, 中文, lat, lon, IANA timezone, country code)
"""
from __future__ import annotations

from dataclasses import dataclass

from .i18n import IDX, norm
from .weather import Place

COUNTRIES = {
    "MY": ("Malaysia", "Malaysia", "马来西亚"),
    "SG": ("Singapore", "Singapura", "新加坡"),
}

_DATA = [
    ("Kuala Lumpur", "Kuala Lumpur", "吉隆坡", 3.1390, 101.6869, "Asia/Kuala_Lumpur", "MY"),
    ("Petaling Jaya", "Petaling Jaya", "八打灵再也", 3.1073, 101.6067, "Asia/Kuala_Lumpur", "MY"),
    ("Shah Alam", "Shah Alam", "沙阿南", 3.0733, 101.5185, "Asia/Kuala_Lumpur", "MY"),
    ("George Town (Penang)", "George Town (Pulau Pinang)", "乔治市（槟城）", 5.4141, 100.3288, "Asia/Kuala_Lumpur", "MY"),
    ("Johor Bahru", "Johor Bahru", "新山", 1.4927, 103.7414, "Asia/Kuala_Lumpur", "MY"),
    ("Ipoh", "Ipoh", "怡保", 4.5975, 101.0901, "Asia/Kuala_Lumpur", "MY"),
    ("Melaka", "Melaka", "马六甲", 2.1896, 102.2501, "Asia/Kuala_Lumpur", "MY"),
    ("Kota Kinabalu", "Kota Kinabalu", "亚庇", 5.9804, 116.0735, "Asia/Kuching", "MY"),
    ("Kuching", "Kuching", "古晋", 1.5535, 110.3593, "Asia/Kuching", "MY"),
    ("Singapore", "Singapura", "新加坡", 1.3521, 103.8198, "Asia/Singapore", "SG"),
]


@dataclass(frozen=True)
class Preset:
    names: tuple[str, str, str]
    lat: float
    lon: float
    tz: str
    country: str

    def name(self, lang: str) -> str:
        return self.names[IDX[norm(lang)]]

    def place(self, lang: str = "en") -> Place:
        return Place(name=self.name(lang), lat=self.lat, lon=self.lon,
                     country=COUNTRIES[self.country][IDX[norm(lang)]], tz=self.tz)


PRESETS: list[Preset] = [Preset((en, ms, zh), la, lo, tz, c) for en, ms, zh, la, lo, tz, c in _DATA]


def preset_place(index: int, lang: str = "en") -> Place:
    return PRESETS[index].place(lang)


def match_preset(lat: float, lon: float) -> int | None:
    for i, p in enumerate(PRESETS):
        if abs(p.lat - lat) < 0.0005 and abs(p.lon - lon) < 0.0005:
            return i
    return None


DEFAULT_PLACE = preset_place(0, "en")
