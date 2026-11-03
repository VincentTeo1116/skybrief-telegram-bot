"""Data layer: forecast + air quality + place search. No Telegram code in here.

Sources
-------
* Open-Meteo forecast API  - current conditions, hourly + 4-day forecast (free, no key)
* Open-Meteo air-quality   - modelled US AQI / PM2.5 / PM10 (free, no key)
* WAQI (optional)          - real *measured* AQI from the nearest monitoring station
                             (used instead of the model when a token is set and a fresh
                             station is within MAX_STATION_KM)
* Open-Meteo geocoding     - city name -> coordinates
* OpenStreetMap Nominatim  - coordinates -> readable place name (for shared GPS locations)
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
WAQI_URL = "https://api.waqi.info/feed/geo:{lat};{lon}/"
USER_AGENT = "yyc-weather-telegram-bot/1.0 (personal use)"

MAX_STATION_KM = 40.0       # ignore monitoring stations further away than this
MAX_STATION_AGE_H = 3.0     # ignore stale station readings


class WeatherError(Exception):
    """Raised when the forecast could not be retrieved."""


@dataclass
class Place:
    name: str
    lat: float
    lon: float
    country: str = ""
    admin: str = ""
    tz: str = "UTC"

    @property
    def label(self) -> str:
        parts = [self.name]
        if self.admin and self.admin != self.name:
            parts.append(self.admin)
        if self.country and self.country not in parts:
            parts.append(self.country)
        return ", ".join(parts)


@dataclass
class Report:
    place: Place
    wx: dict                      # raw Open-Meteo forecast payload
    aq: dict | None = None        # normalised air-quality dict (see _air)
    fetched_at: float = field(default_factory=time.time)

    @property
    def tz(self) -> str:
        return self.wx.get("timezone", self.place.tz)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _as_float(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class WeatherService:
    def __init__(self, waqi_token: str = "", cache_ttl: int = 300):
        self._waqi_token = waqi_token
        self._ttl = cache_ttl
        self._cache: dict[tuple[float, float], Report] = {}
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0), headers={"User-Agent": USER_AGENT}, follow_redirects=True
        )

    async def close(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------ http
    async def _get_json(self, url: str, params: dict | None = None, tries: int = 3) -> dict:
        last: Exception | None = None
        for attempt in range(tries):
            try:
                r = await self._client.get(url, params=params)
                r.raise_for_status()
                return r.json()
            except (httpx.HTTPError, ValueError) as exc:
                last = exc
                log.warning("GET %s failed (%s/%s): %s", url, attempt + 1, tries, exc)
                await asyncio.sleep(0.7 * (attempt + 1))
        raise WeatherError(f"Request to {url} failed: {last}")

    # -------------------------------------------------------------- forecast
    async def _forecast(self, p: Place) -> dict:
        return await self._get_json(FORECAST_URL, {
            "latitude": p.lat, "longitude": p.lon, "timezone": "auto", "forecast_days": 4,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,"
                       "weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,"
                       "wind_gusts_10m,is_day",
            "hourly": "temperature_2m,precipitation_probability,weather_code",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
                     "precipitation_sum,sunrise,sunset,uv_index_max",
        })

    # ----------------------------------------------------------- air quality
    async def _air_open_meteo(self, p: Place) -> dict | None:
        data = await self._get_json(AIR_URL, {
            "latitude": p.lat, "longitude": p.lon, "timezone": "auto",
            "current": "us_aqi,pm2_5,pm10",
        })
        c = data.get("current") or {}
        aqi = _as_float(c.get("us_aqi"))
        if aqi is None:
            return None
        return {"aqi": round(aqi), "pm25": _as_float(c.get("pm2_5")), "pm10": _as_float(c.get("pm10")),
                "source": "Open-Meteo (model)", "station": None, "km": None, "dominant": None}

    async def _air_waqi(self, p: Place) -> dict | None:
        if not self._waqi_token:
            return None
        data = await self._get_json(WAQI_URL.format(lat=p.lat, lon=p.lon), {"token": self._waqi_token})
        if data.get("status") != "ok":
            return None
        d = data["data"]
        aqi = _as_float(d.get("aqi"))
        if aqi is None:
            return None
        geo = (d.get("city") or {}).get("geo") or []
        km = haversine_km(p.lat, p.lon, geo[0], geo[1]) if len(geo) == 2 else None
        if km is None or km > MAX_STATION_KM:
            return None
        try:
            ts = datetime.fromisoformat((d.get("time") or {}).get("iso", ""))
            age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
            if age_h > MAX_STATION_AGE_H:
                return None
        except ValueError:
            pass  # no timestamp: accept the reading
        dom = (d.get("dominentpol") or "").upper().replace("PM25", "PM2.5").replace("PM10", "PM10") or None
        return {"aqi": round(aqi), "pm25": None, "pm10": None, "source": "WAQI (measured)",
                "station": (d.get("city") or {}).get("name"), "km": km, "dominant": dom}

    async def _air(self, p: Place) -> dict | None:
        model, station = await asyncio.gather(
            self._air_open_meteo(p), self._air_waqi(p), return_exceptions=True
        )
        model = None if isinstance(model, Exception) else model
        station = None if isinstance(station, Exception) else station
        if station:
            # Prefer the measured station AQI; keep model µg/m³ values for context.
            if model:
                station["pm25"], station["pm10"] = model["pm25"], model["pm10"]
            return station
        return model

    # ---------------------------------------------------------------- public
    async def fetch_report(self, place: Place, force: bool = False) -> Report:
        key = (round(place.lat, 2), round(place.lon, 2))
        hit = self._cache.get(key)
        if hit and not force and time.time() - hit.fetched_at < self._ttl:
            return Report(place=place, wx=hit.wx, aq=hit.aq, fetched_at=hit.fetched_at)

        wx, aq = await asyncio.gather(self._forecast(place), self._air(place), return_exceptions=True)
        if isinstance(wx, Exception):
            raise WeatherError(str(wx)) from wx
        if isinstance(aq, Exception):
            log.warning("Air quality unavailable: %s", aq)
            aq = None
        report = Report(place=place, wx=wx, aq=aq)
        self._cache[key] = report
        return report

    async def search_places(self, query: str, limit: int = 5, lang: str = "en") -> list[Place]:
        """'Penang', 'Ipoh, Malaysia', 'Springfield Illinois' -> up to `limit` matches."""
        name, _, hint = query.partition(",")
        name, hint = name.strip(), hint.strip().lower()
        data = await self._get_json(GEO_URL, {"name": name, "count": 10, "language": lang, "format": "json"})
        results = data.get("results") or []
        if hint:
            narrowed = [r for r in results if hint in " ".join(
                str(r.get(k, "")) for k in ("country", "country_code", "admin1", "admin2")).lower()]
            results = narrowed or results
        out = []
        for r in results[:limit]:
            out.append(Place(name=r["name"], lat=r["latitude"], lon=r["longitude"],
                             country=r.get("country", ""), admin=r.get("admin1", ""),
                             tz=r.get("timezone", "UTC")))
        return out

    async def reverse_geocode(self, lat: float, lon: float, lang: str = "en") -> Place:
        """Turn shared GPS coordinates into a friendly name; fall back to the raw coordinates."""
        fallback = Place(name=f"{lat:.3f}, {lon:.3f}", lat=lat, lon=lon)
        try:
            data = await self._get_json(
                REVERSE_URL, {"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 13, "accept-language": lang},
                tries=2,
            )
        except WeatherError:
            return fallback
        a = data.get("address") or {}
        local = a.get("suburb") or a.get("city_district") or a.get("neighbourhood") or a.get("quarter")
        city = a.get("city") or a.get("town") or a.get("village") or a.get("municipality") or a.get("county")
        if local and city and local != city:
            name = f"{local}, {city}"
        else:
            name = local or city or fallback.name
        return Place(name=name, lat=lat, lon=lon, country=a.get("country", ""), admin=a.get("state", ""))
