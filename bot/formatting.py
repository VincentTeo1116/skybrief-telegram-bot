"""Turn a Report into pretty Telegram HTML. Pure functions: easy to unit-test.

Every public function takes `lang` ("en" | "ms" | "zh") and, for the main report, `hidden`:
the set of section ids the user switched off in Settings.
"""
from __future__ import annotations

from datetime import datetime
from html import escape

from . import i18n
from .i18n import t
from .weather import Report

DIVIDER = "┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈"

# Sections the user can show/hide (order = order in the Settings screen).
SECTIONS = ("details", "sun", "air", "rain", "forecast", "tips")

# WMO weather code -> (day emoji, night emoji)
WMO_EMOJI = {
    0: ("☀️", "🌙"), 1: ("🌤️", "🌙"), 2: ("⛅", "☁️"), 3: ("☁️", "☁️"),
    45: ("🌫️", "🌫️"), 48: ("🌫️", "🌫️"),
    51: ("🌦️", "🌧️"), 53: ("🌦️", "🌧️"), 55: ("🌧️", "🌧️"), 56: ("🌧️", "🌧️"), 57: ("🌧️", "🌧️"),
    61: ("🌦️", "🌧️"), 63: ("🌧️", "🌧️"), 65: ("🌧️", "🌧️"), 66: ("🌧️", "🌧️"), 67: ("🌧️", "🌧️"),
    71: ("🌨️", "🌨️"), 73: ("🌨️", "🌨️"), 75: ("❄️", "❄️"), 77: ("🌨️", "🌨️"),
    80: ("🌦️", "🌧️"), 81: ("🌧️", "🌧️"), 82: ("⛈️", "⛈️"),
    85: ("🌨️", "🌨️"), 86: ("❄️", "❄️"),
    95: ("⛈️", "⛈️"), 96: ("⛈️", "⛈️"), 99: ("⛈️", "⛈️"),
}
RAIN_CODES = {51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99}
STORM_CODES = {95, 96, 99}

AQI_LIMITS = [(50, "🟢"), (100, "🟡"), (150, "🟠"), (200, "🔴"), (300, "🟣"), (10**9, "🟤")]
UV_LIMITS = [3, 6, 8, 11, 10**9]


# ------------------------------------------------------------------ helpers
def wmo(code, is_day: bool = True, lang: str = "en") -> tuple[str, str]:
    day, night = WMO_EMOJI.get(int(code) if code is not None else -1, ("🌡️", "🌡️"))
    return i18n.wmo_text(code, lang), (day if is_day else night)


def aqi_level(aqi: float) -> int:
    for i, (limit, _) in enumerate(AQI_LIMITS):
        if aqi <= limit:
            return i
    return len(AQI_LIMITS) - 1


def aqi_band(aqi: float, lang: str = "en") -> tuple[str, str]:
    lvl = aqi_level(aqi)
    return AQI_LIMITS[lvl][1], i18n.aqi_label(lvl, lang)


def uv_label(uv: float, lang: str = "en") -> str:
    for i, limit in enumerate(UV_LIMITS):
        if uv < limit:
            return i18n.uv_text(i, lang)
    return i18n.uv_text(len(UV_LIMITS) - 1, lang)


def compass(deg_, lang: str = "en") -> str:
    return "" if deg_ is None else i18n.compass_dir(deg_, lang)


def deg(v) -> str:
    return "–" if v is None else f"{round(v)}°"


def _prob(v) -> int:
    return int(v) if v is not None else 0


def hour_index(report: Report) -> int:
    """Index in the hourly arrays of the current hour (local time)."""
    times = report.wx["hourly"]["time"]
    cur = report.wx["current"]["time"][:13] + ":00"
    return times.index(cur) if cur in times else 0


def next_hours(report: Report, n: int) -> list[dict]:
    h = report.wx["hourly"]
    i = hour_index(report)
    rows = []
    for k in range(i, min(i + n, len(h["time"]))):
        rows.append({
            "time": datetime.fromisoformat(h["time"][k]),
            "temp": h["temperature_2m"][k],
            "prob": _prob(h["precipitation_probability"][k]),
            "code": h["weather_code"][k],
        })
    return rows


# ---------------------------------------------------------------- sections
def _rain_outlook(report: Report, lang: str) -> str:
    c = report.wx["current"]
    rows = next_hours(report, 7)[1:] or next_hours(report, 7)
    peak = max(rows, key=lambda r: r["prob"]) if rows else None
    raining_now = (c.get("precipitation") or 0) >= 0.1 or c.get("weather_code") in RAIN_CODES
    if raining_now:
        more = t(lang, "raining_more", p=peak["prob"]) if peak and peak["prob"] >= 40 else ""
        return f"🌧 <b>{t(lang, 'raining_now')}</b>{more}"
    if peak and peak["prob"] >= 60:
        return "☔ <b>" + t(lang, "rain_likely", h=i18n.hour_label(peak["time"], lang), p=peak["prob"]) + "</b>"
    if peak and peak["prob"] >= 30:
        return "🌦 " + t(lang, "rain_chance", h=i18n.hour_label(peak["time"], lang), p=peak["prob"])
    return "✅ " + t(lang, "rain_none")


def _air_block(report: Report, lang: str) -> list[str]:
    aq = report.aq
    title = f"🫁 <b>{t(lang, 'air_title')}</b>"
    if not aq:
        return [title, t(lang, "air_unavail")]
    emoji, label = aqi_band(aq["aqi"], lang)
    lines = [title, f"{emoji} <b>AQI {aq['aqi']}</b> · {label}"]
    extras = []
    if aq.get("pm25") is not None:
        extras.append(f"PM2.5 {aq['pm25']:.0f} µg/m³")
    if aq.get("pm10") is not None:
        extras.append(f"PM10 {aq['pm10']:.0f} µg/m³")
    if aq.get("dominant"):
        extras.append(t(lang, "pollutant", p=escape(aq["dominant"])))
    if extras:
        lines.append(" · ".join(extras))
    return lines


def _tips(report: Report, lang: str) -> list[str]:
    c, d = report.wx["current"], report.wx["daily"]
    tips = []
    upcoming = next_hours(report, 7)
    rain_today = _prob(d["precipitation_probability_max"][0])
    if rain_today >= 50 or any(r["prob"] >= 50 for r in upcoming):
        tips.append("☂️ " + t(lang, "tip_umbrella"))
    if any(r["code"] in STORM_CODES for r in upcoming):
        tips.append("⚡ " + t(lang, "tip_storm"))
    uv = d["uv_index_max"][0] or 0
    if uv >= 8:
        tips.append("🧴 " + t(lang, "tip_uv_vhigh"))
    elif uv >= 6:
        tips.append("🧴 " + t(lang, "tip_uv_high"))
    feels = c.get("apparent_temperature")
    if feels is not None and feels >= 38:
        tips.append("🥵 " + t(lang, "tip_heat_danger"))
    elif feels is not None and feels >= 34:
        tips.append("💧 " + t(lang, "tip_heat_hot"))
    elif feels is not None and feels <= 10:
        tips.append("🧥 " + t(lang, "tip_cold"))
    if (c.get("wind_gusts_10m") or 0) >= 50:
        tips.append("💨 " + t(lang, "tip_gusts"))
    if report.aq:
        if report.aq["aqi"] > 150:
            tips.append("😷 " + t(lang, "tip_aqi_bad"))
        elif report.aq["aqi"] > 100:
            tips.append("😷 " + t(lang, "tip_aqi_sens"))
    return tips or ["😎 " + t(lang, "tip_comfy")]


def _forecast_lines(report: Report, lang: str) -> list[str]:
    d = report.wx["daily"]
    lines = []
    for i in range(1, min(4, len(d["time"]))):
        day = datetime.fromisoformat(d["time"][i])
        _, emoji = wmo(d["weather_code"][i], True, lang)
        lines.append(
            f"<b>{i18n.weekday(day, lang, short=True)}</b> {emoji} "
            f"{deg(d['temperature_2m_min'][i])}–{deg(d['temperature_2m_max'][i])}"
            f" · 💧{_prob(d['precipitation_probability_max'][i])}%"
        )
    return lines


def _footer(report: Report, lang: str) -> str:
    updated = datetime.fromisoformat(report.wx["current"]["time"])
    src = t(lang, "src_weather")
    aq = report.aq
    if aq:
        if aq.get("station"):
            src += " · " + t(lang, "src_air_station", name=escape(aq["station"]), km=f"{aq['km']:.0f}")
        else:
            src += " · " + t(lang, "src_air_model")
    return f"<i>🕒 {t(lang, 'observed', t=i18n.clock(updated, lang))}\n{src}</i>"


# ------------------------------------------------------------------ views
def weather_message(report: Report, lang: str = "en", hidden=frozenset(), ribbon: str | None = None) -> str:
    c, d = report.wx["current"], report.wx["daily"]
    now = datetime.fromisoformat(c["time"])
    desc, emoji = wmo(c.get("weather_code"), bool(c.get("is_day", 1)), lang)

    head = []
    if ribbon:
        head += [ribbon, ""]
    head += [
        f"📍 <b>{escape(report.place.label)}</b>",
        f"<i>{i18n.date_long(now, lang)}</i>",
        "",
        f"{emoji} <b>{deg(c['temperature_2m'])}C</b> · {desc}",
        f"{t(lang, 'feels')} {deg(c.get('apparent_temperature'))} · ▲ {deg(d['temperature_2m_max'][0])} ▼ {deg(d['temperature_2m_min'][0])}",
    ]
    blocks = ["\n".join(head)]

    facts = []
    if "details" not in hidden:
        facts += [
            f"💧 {t(lang, 'humidity')} <b>{round(c['relative_humidity_2m'])}%</b>    "
            f"💨 {t(lang, 'wind')} <b>{round(c['wind_speed_10m'])} km/h {compass(c.get('wind_direction_10m'), lang)}</b>",
            f"☁️ {t(lang, 'cloud')} <b>{round(c['cloud_cover'])}%</b>    🧭 <b>{round(c['pressure_msl'])} hPa</b>",
        ]
    if "sun" not in hidden:
        uv = d["uv_index_max"][0]
        facts.append(
            f"🌅 {i18n.clock(datetime.fromisoformat(d['sunrise'][0]), lang)}    "
            f"🌇 {i18n.clock(datetime.fromisoformat(d['sunset'][0]), lang)}"
            + (f"    🕶 {t(lang, 'uv')} <b>{uv:.0f}</b> {uv_label(uv, lang)}" if uv is not None else "")
        )
    if facts:
        blocks.append("\n".join(facts))
    if "air" not in hidden:
        blocks.append("\n".join(_air_block(report, lang)))
    if "rain" not in hidden:
        blocks.append(f"🌂 <b>{t(lang, 'rain_title')}</b>\n{_rain_outlook(report, lang)}")
    if "forecast" not in hidden:
        blocks.append("\n".join([f"📅 <b>{t(lang, 'forecast_title')}</b>", *_forecast_lines(report, lang)]))
    if "tips" not in hidden:
        blocks.append("\n".join([f"💡 <b>{t(lang, 'tips_title')}</b>", *[f"• {x}" for x in _tips(report, lang)]]))

    return ("\n" + DIVIDER + "\n").join(blocks) + "\n\n" + _footer(report, lang)


def hourly_message(report: Report, lang: str = "en") -> str:
    rows = next_hours(report, 12)
    out = [f"⏱ <b>{t(lang, 'hourly_title')}</b> · {escape(report.place.label)}", ""]
    for r in rows:
        is_day = 6 <= r["time"].hour < 19
        _, emoji = wmo(r["code"], is_day, lang)
        bar = "▰" * round(r["prob"] / 20) + "▱" * (5 - round(r["prob"] / 20))
        out.append(f"<code>{i18n.hour_label(r['time'], lang):>5}</code> {emoji} <b>{deg(r['temp'])}</b>  {bar} {r['prob']}%")
    out += ["", f"<i>{t(lang, 'bars_note')}</i>", "", _footer(report, lang)]
    return "\n".join(out)


def welcome_message(lang: str, first_name: str, place_label: str, daily_time: str) -> str:
    fallback = {"en": "there", "ms": "kawan", "zh": "朋友"}.get(lang, "there")
    name = escape(first_name) if first_name else fallback
    return t(lang, "welcome", name=name, place=escape(place_label), time=daily_time)


def help_text(lang: str) -> str:
    return t(lang, "help")
