"""Offline tests: formatting, helpers and the database. No network, no Telegram."""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from bot import formatting as fmt  # noqa: E402
from bot.config import normalise_time  # noqa: E402
from bot.db import Database  # noqa: E402
from bot import i18n  # noqa: E402
from bot.presets import DEFAULT_PLACE, match_preset, preset_place  # noqa: E402
import sqlite3  # noqa: E402
from bot.weather import Place, Report, haversine_km  # noqa: E402


def make_payload(prob=10, code=2, precip=0.0, feels=33.0, uv=9.0, gusts=20.0):
    start = datetime(2026, 11, 3, 0, 0)
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(96)]
    days = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(4)]
    return {
        "timezone": "Asia/Kuala_Lumpur",
        "current": {"time": "2026-11-03T08:15", "temperature_2m": 28.4, "relative_humidity_2m": 78,
                    "apparent_temperature": feels, "precipitation": precip, "weather_code": code,
                    "cloud_cover": 60, "pressure_msl": 1009.2, "wind_speed_10m": 11.6,
                    "wind_direction_10m": 45, "wind_gusts_10m": gusts, "is_day": 1},
        "hourly": {"time": times, "temperature_2m": [27.0] * 96, "precipitation_probability": [prob] * 96,
                   "weather_code": [code] * 96},
        "daily": {"time": days, "weather_code": [code] * 4, "temperature_2m_max": [33.1] * 4,
                  "temperature_2m_min": [25.0] * 4, "precipitation_probability_max": [prob] * 4,
                  "precipitation_sum": [0] * 4, "uv_index_max": [uv] * 4,
                  "sunrise": [f"{d}T07:01" for d in days], "sunset": [f"{d}T19:12" for d in days]},
    }


def make_report(aq=None, **kw):
    return Report(place=Place("Kuala Lumpur", 3.139, 101.687, "Malaysia", tz="Asia/Kuala_Lumpur"),
                  wx=make_payload(**kw), aq=aq)


MODEL_AQ = {"aqi": 62, "pm25": 18.4, "pm10": 30.0, "source": "Open-Meteo (model)", "station": None, "km": None, "dominant": None}
STATION_AQ = {"aqi": 112, "pm25": 40.0, "pm10": 55.0, "source": "WAQI (measured)", "station": "Cheras, Kuala Lumpur",
              "km": 4.2, "dominant": "PM2.5"}


def test_weather_message_core_fields():
    text = fmt.weather_message(make_report(aq=MODEL_AQ))
    assert "Kuala Lumpur" in text and "Tuesday, 3 November" in text
    assert "28°C" in text and "Humidity" in text and "78%" in text
    assert "NE" in text                     # 45 degrees
    assert "AQI 62" in text and "Moderate" in text
    assert "7:01 AM" in text and "7:12 PM" in text
    assert len(text) < 4096


def test_station_air_quality_and_tips():
    text = fmt.weather_message(make_report(aq=STATION_AQ))
    assert "AQI 112" in text and "Unhealthy for sensitive groups" in text
    assert "Cheras" in text and "4 km" in text
    assert "limit outdoor activity" in text


def test_rain_outlook_variants():
    assert "No rain expected" in fmt.weather_message(make_report(prob=5))
    assert "Rain likely" in fmt.weather_message(make_report(prob=80))
    assert "Raining now" in fmt.weather_message(make_report(prob=80, code=63, precip=1.2))
    assert "umbrella" in fmt.weather_message(make_report(prob=80)).lower()


def test_missing_air_and_none_probabilities():
    rep = make_report(aq=None)
    rep.wx["hourly"]["precipitation_probability"] = [None] * 96
    text = fmt.weather_message(rep)
    assert "Unavailable" in text


def test_hourly_view():
    text = fmt.hourly_message(make_report(aq=MODEL_AQ, prob=40))
    assert text.count("▰") > 0 and "8 AM" in text and "Next 12 hours" in text


def test_html_escaping():
    rep = make_report()
    rep.place = Place("<b>Evil</b> & Co", 1, 1)
    assert "&lt;b&gt;Evil" in fmt.weather_message(rep)


def test_aqi_and_uv_bands():
    assert fmt.aqi_band(50)[1] == "Good"
    assert fmt.aqi_band(51)[1] == "Moderate"
    assert fmt.aqi_band(301)[1] == "Hazardous"
    assert fmt.uv_label(2.9) == "Low" and fmt.uv_label(11) == "Extreme"
    assert fmt.compass(0) == "N" and fmt.compass(359) == "N" and fmt.compass(180) == "S"


def test_normalise_time():
    assert normalise_time("8:30") == "08:30"
    assert normalise_time("07:45") == "07:45"
    assert normalise_time("24:00") is None and normalise_time("abc") is None


def test_haversine():
    assert abs(haversine_km(3.139, 101.687, 1.352, 103.82) - 316) < 10  # KL <-> Singapore


def test_database_roundtrip(tmp_path):
    db = Database(str(tmp_path / "t.db"))
    u = db.ensure_user(1, "Vince", DEFAULT_PLACE, "08:30")
    assert u.place_name == "Kuala Lumpur" and u.daily_on and u.daily_time == "08:30"
    db.set_location(1, preset_place(3))
    assert db.get_user(1).place_name.startswith("George Town")
    # ensure_user must NOT overwrite an existing user's saved location
    assert db.ensure_user(1, "Vince", DEFAULT_PLACE, "08:30").place_name.startswith("George Town")
    db.set_daily_time(1, "07:45")
    assert db.get_user(1).daily_time == "07:45"
    db.set_daily(1, False)
    assert db.daily_users() == []
    db.close()
    # persistence across restarts
    db2 = Database(str(tmp_path / "t.db"))
    assert db2.get_user(1).place_name.startswith("George Town")
    db2.close()


# ------------------------------------------------------------- languages / settings
def test_every_key_is_translated_and_formats():
    for key, row in i18n.T.items():
        assert len(row) == 3 and all(row), f"{key} is missing a translation"
        # placeholders must match across languages, or .format() would crash for one of them
        import string
        fields = [{f for _, f, _, _ in string.Formatter().parse(x) if f} for x in row]
        assert fields[0] == fields[1] == fields[2], f"{key}: placeholder mismatch {fields}"
    for code, row in i18n.WMO_TEXT.items():
        assert len(row) == 3 and all(row), code


def test_chinese_and_malay_reports():
    zh = fmt.weather_message(make_report(aq=MODEL_AQ, prob=80), "zh")
    assert "11月3日 星期二" in zh and "湿度" in zh and "空气质量" in zh and "记得带伞" in zh and "东北" in zh
    assert "局部多云" in zh and "07:01" in zh and "AM" not in zh      # 24h clock for zh
    ms = fmt.weather_message(make_report(aq=MODEL_AQ, prob=80), "ms")
    assert "Selasa, 3 November" in ms and "Kelembapan" in ms and "Bawa payung" in ms and "Sederhana" in ms
    assert "TL" in ms and "Rab" in ms and "Separa mendung" in ms
    assert "Humidity" not in ms and "Humidity" not in zh


def test_unknown_language_falls_back_to_english():
    assert "Humidity" in fmt.weather_message(make_report(aq=MODEL_AQ), "fr")


def test_hidden_sections():
    full = fmt.weather_message(make_report(aq=MODEL_AQ, prob=80))
    for section, marker in [("air", "Air quality"), ("rain", "Rain outlook"), ("forecast", "Next days"),
                            ("tips", "Tips"), ("details", "Humidity"), ("sun", "🌅")]:
        assert marker in full
        text = fmt.weather_message(make_report(aq=MODEL_AQ, prob=80), "en", frozenset({section}))
        assert marker not in text, section
        assert "Kuala Lumpur" in text and "28°C" in text          # header always stays
    everything = fmt.weather_message(make_report(aq=MODEL_AQ), "en", frozenset(fmt.SECTIONS))
    assert "Kuala Lumpur" in everything and "Observed" in everything and "┈" not in everything


def test_hourly_localised():
    assert "未来12小时" in fmt.hourly_message(make_report(aq=MODEL_AQ), "zh")
    assert "12 jam akan datang" in fmt.hourly_message(make_report(aq=MODEL_AQ), "ms")


def test_singapore_label_not_duplicated():
    assert preset_place(9, "en").label == "Singapore"
    assert preset_place(9, "zh").label == "新加坡"
    assert preset_place(3, "zh").label == "乔治市（槟城）, 马来西亚"


def test_match_preset():
    assert match_preset(3.1390, 101.6869) == 0
    assert match_preset(3.2, 101.7) is None


def test_db_language_sections_and_migration(tmp_path):
    path = str(tmp_path / "old.db")
    # an "old" database created before language/sections existed
    con = sqlite3.connect(path)
    con.execute("""CREATE TABLE users (chat_id INTEGER PRIMARY KEY, first_name TEXT NOT NULL DEFAULT '',
        place_name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, country TEXT NOT NULL DEFAULT '',
        tz TEXT NOT NULL DEFAULT 'UTC', daily_on INTEGER NOT NULL DEFAULT 1, daily_time TEXT NOT NULL DEFAULT '08:30')""")
    con.execute("INSERT INTO users (chat_id, place_name, lat, lon) VALUES (7, 'Ipoh', 4.59, 101.09)")
    con.commit(); con.close()

    db = Database(path)
    u = db.get_user(7)
    assert u.place_name == "Ipoh" and u.lang == "en" and u.hidden == frozenset()   # data kept, defaults added
    assert db.set_lang(7, "zh").lang == "zh"
    assert db.toggle_section(7, "air").hidden == frozenset({"air"})
    assert db.toggle_section(7, "tips").hidden == frozenset({"air", "tips"})
    assert db.toggle_section(7, "air").hidden == frozenset({"tips"})                # toggles back on
    db.close()
    db2 = Database(path)
    assert db2.get_user(7).lang == "zh" and db2.get_user(7).hidden == frozenset({"tips"})
    db2.close()


# ------------------------------------------------------------- GitHub Actions sender
def test_seconds_until_send_time():
    from datetime import timezone
    from bot.cron_push import seconds_until
    kl = "Asia/Kuala_Lumpur"
    at = lambda h, m, s=0: datetime(2026, 11, 3, h, m, s, tzinfo=timezone.utc)   # UTC clock
    assert seconds_until("08:30", kl, now=at(0, 15)) == 900          # 08:15 local -> wait 15 min
    assert seconds_until("08:30", kl, now=at(0, 30)) == 0            # exactly on time
    assert seconds_until("08:30", kl, now=at(0, 41)) == 0            # GitHub was late -> send now
    assert seconds_until("08:30", kl, now=at(23, 0)) == 0            # far from target: never idle for hours
    assert seconds_until("08:30", kl, now=at(0, 0)) == 0            # 08:00 local is >25 min away: don't wait
    assert seconds_until("garbage", kl, now=at(0, 15)) == 0
