# ☀️ SkyBrief: Weather & Air-Quality Telegram Bot

SkyBrief is a personal Telegram bot that sends a clean **weather and air-quality (AQI) report every morning at 08:30** and answers on demand, so you never have to open a website. Every user gets their own saved location, language and layout.

## Features

| | |
|---|---|
| 🔔 **Daily report** | 08:30 by default, per user, in the **local time of the saved city**. Change with `/settime 07:45`, switch off with `/daily`. |
| 🌦 **On demand** | Tap **Weather now** or send `/weather`. Tap **Hourly** for the next 12 hours. |
| 📍 **Live location** | Tap **Share my location**: the bot detects your place by GPS, saves it and shows the weather. |
| 🏙 **One-tap city change** | 10 city shortcuts, or just *type any city name* and pick a result. |
| ⚙️ **Settings** | Show or hide sections (details, sun & UV, air quality, rain outlook, forecast, tips). |
| 🌐 **Languages** | **English** (default), **Bahasa Melayu**, **中文**. Easy to add more in `bot/i18n.py`. |
| 🧠 **Memory** | Location, language, hidden sections and daily time are stored in SQLite and survive restarts. |
| 🔒 **Private** | Set `ALLOWED_USER_IDS` and only those Telegram accounts can use the bot. |

**Each report includes:** temperature, feels-like, high/low, humidity, wind, cloud, pressure, sunrise/sunset, UV index, **AQI with PM2.5/PM10**, a rain outlook for the next 6 hours, a 3-day forecast and practical tips (umbrella, sunscreen, mask…).

## Data sources and accuracy

* **Weather:** [Open-Meteo](https://open-meteo.com): model-based, "current" values refresh about every 15 minutes. The report shows the observation time.
* **Air quality:** with a free [WAQI token](https://aqicn.org/data-platform/token/) the bot uses **real measured AQI from the nearest monitoring station** (within 40 km and under 3 hours old) and names the station. Otherwise it falls back to Open-Meteo's modelled estimate and says so.
* AQI uses the **US EPA scale**, which can differ from Malaysia's official IPU readings.
* Place search uses Open-Meteo geocoding; GPS names come from OpenStreetMap Nominatim.
* SkyBrief does **not** replace official severe-weather warnings (MetMalaysia, NEA, etc.).

## Quick start (run on your computer)

**1. Create the bot.** In Telegram open [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.

**2. Find your Telegram ID.** Message [@userinfobot](https://t.me/userinfobot) and copy the number.

**3. Install and configure** (Windows PowerShell shown; use `python3` / `source .venv/bin/activate` on macOS/Linux):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env        # then open .env and fill in the values
```

**4. Run.**

```powershell
.\.venv\Scripts\python.exe -m bot
```

Open your bot in Telegram and send `/start`.

## Configuration

Set these in `.env` locally, or as environment variables on your host.

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token from @BotFather. |
| `ALLOWED_USER_IDS` | Strongly recommended | Comma-separated Telegram user IDs. Empty means **anyone** can use your bot. |
| `WAQI_TOKEN` | Optional | Enables measured AQI from the nearest station. |
| `DB_PATH` | Optional | SQLite file path. Default `data/bot.db` (the Docker image uses `/data/bot.db`). |
| `DEFAULT_DAILY_TIME` | Optional | Default daily time for new users, 24h. Default `08:30`. |
| `LOG_LEVEL` | Optional | `INFO` (default), `DEBUG`, … |

## Using the bot

| Command | What it does |
|---|---|
| `/start` | Welcome message and first report |
| `/weather` | Current weather & air quality |
| `/hourly` | Next 12 hours with rain-chance bars |
| `/city` | Change location (or just type a city name) |
| `/settings` | Choose sections to show and the language |
| `/daily` | Turn the daily report on or off |
| `/settime 07:45` | Change the daily report time (24h) |
| `/help` | Show help |

## Deployment

The bot must be **running at 08:30**, so it needs an always-on host. GitHub stores the code; it can't run a bot continuously.

> The bot uses long polling: it only makes outgoing connections, so no domain, SSL or open ports are needed.

### Option A: Any Linux VPS or Oracle Cloud Always Free (recommended)

```bash
# 1. Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh

# 2. Get the code (a private repo needs a deploy key or a personal access token)
git clone https://github.com/<you>/skybrief-telegram-bot.git
cd skybrief-telegram-bot

# 3. Configure and start
cp .env.example .env && nano .env
docker compose up -d --build

# 4. Check it
docker compose logs -f          # look for "Application started"
```

Docker restarts the bot automatically after crashes and server reboots (`restart: unless-stopped`). Saved data lives in the `bot-data` Docker volume.
**Update later:** `git pull && docker compose up -d --build`.

### Option B: Any container host (Railway, Fly.io, …)

Deploy from the `Dockerfile`, set the environment variables above, and **mount a persistent volume at `/data`**: without it, saved locations reset on every redeploy. Check each provider's current pricing and free-tier terms.

### Option C: GitHub Actions only (free, daily report only)

`.github/workflows/daily-push.yml` sends **one report a day with no server**. It is scheduled for 08:15 Malaysia time and then **waits until exactly 08:30** before sending, which absorbs GitHub's usual 5-20 minute scheduling delay. If GitHub runs later than 08:30 it sends immediately.

Limits: no on-demand replies, no Settings screen (use repo Variables instead), and GitHub may disable scheduled workflows on **public** repos after 60 days without activity.

1. **Settings > Secrets and variables > Actions > Secrets:** add `TELEGRAM_BOT_TOKEN`, `TG_CHAT_ID` (your Telegram ID) and optionally `WAQI_TOKEN`.
2. **Same page > Variables** (all optional): `CITY_NAME`, `CITY_LAT`, `CITY_LON`, `CITY_COUNTRY`, `CITY_TZ` (default Kuala Lumpur), `LANGUAGE` (`en`/`ms`/`zh`), `HIDDEN_SECTIONS` (e.g. `forecast,tips`).
3. **Actions tab > Daily weather push > Run workflow** to test. It sends immediately.
4. The `schedule:` is already enabled. **Don't run it together with Option A/B** (duplicate messages).

### Verify the daily push

Send `/settime` with a time 2–3 minutes from now (in the city's local time), wait for the report, then set it back with `/settime 08:30`.

### Only one copy at a time

Never run two instances with the same token (for example your laptop plus a server). Telegram will report `Conflict: terminated by other getUpdates request`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Conflict: terminated by other getUpdates` | Another instance is running. Stop it. |
| `Unauthorized` at startup | Wrong or revoked token. |
| Bot replies "This is a private bot" | Your ID isn't in `ALLOWED_USER_IDS`. |
| Settings reset after redeploy | No persistent volume mounted at `/data`. |
| AQI footer says "modelled estimate" | No `WAQI_TOKEN`, or no fresh station within 40 km. |

## Project structure

```
bot/
  app.py          wiring + startup (schedules every saved user's daily job)
  handlers.py     commands, buttons, settings, GPS, city search, daily job
  weather.py      Open-Meteo / WAQI / geocoding clients, caching, retries
  formatting.py   the report layouts (language + section aware)
  i18n.py         ALL translations (en / ms / zh): add a language here
  keyboards.py    bottom bar + inline buttons
  presets.py      one-tap city list (edit me)
  db.py           SQLite storage + automatic migrations
  config.py       environment settings
  cron_push.py    one-shot sender for GitHub Actions (Option C)
tests/            offline unit tests
Dockerfile, docker-compose.yml, .github/workflows/
```

## Development

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

* **Add or edit city shortcuts:** `bot/presets.py`
* **Change wording or add a language:** `bot/i18n.py`
* **Change the report layout:** `bot/formatting.py`

## Security notes

* Never commit `.env`; it is git-ignored. Keep the repository **private** if it contains anything specific to you.
* If a token is exposed, revoke it: `/revoke` in @BotFather (bot token) or regenerate it on the WAQI site.
* Set `ALLOWED_USER_IDS` so strangers can't use (or run up requests on) your bot.
