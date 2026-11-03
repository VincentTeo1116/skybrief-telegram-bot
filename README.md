# ☀️ SkyBrief: Weather & Air-Quality Telegram Bot

SkyBrief is a multi-user Telegram bot that sends a clean **weather and air-quality (AQI) report every morning at 08:30** and answers on demand. It runs on **Cloudflare Workers** (TypeScript) with a **D1** database: always on, no server to maintain, instant replies, and a free tier that comfortably covers personal and small-team use.

Every user has their own saved location, language, layout and daily time. An admin controls who may use the bot.

## Features

| | |
|---|---|
| 🔔 **Daily report** | 08:30 by default, per user, in the **local time of that user's city** (a team spread over several timezones each gets their own morning). `/settime 07:45` to change, `/daily` to switch off. |
| 🌦 **On demand** | Tap **Weather now** or send `/weather`. **Hourly** shows the next 12 hours. |
| 📍 **Live location** | Tap **Share my location**: the bot detects where you are by GPS, saves it and shows the weather. |
| 🏙 **One-tap city change** | 10 shortcuts, or *type any city name* and pick a result. |
| ⚙️ **Settings** | Show or hide sections (details, sun & UV, air quality, rain outlook, forecast, tips) and choose the language: **English** (default), **Bahasa Melayu**, **中文**. |
| 👥 **Multi-user** | Each person's settings are stored separately. Access modes: `approval` (admin taps Approve/Deny), `open`, or `closed`. Admin commands `/users`, `/allow`, `/block`. |
| 🧠 **Memory** | Everything is stored in Cloudflare D1 and survives redeploys. |

**Each report includes:** temperature, feels-like, high/low, humidity, wind, cloud, pressure, sunrise/sunset, UV, **AQI with PM2.5/PM10**, a 6-hour rain outlook, a 3-day forecast and practical tips (umbrella, sunscreen, mask…).

## Data sources and accuracy

* **Weather:** [Open-Meteo](https://open-meteo.com): model-based; "current" values refresh about every 15 minutes. The report shows the observation time.
* **Air quality:** with a free [WAQI token](https://aqicn.org/data-platform/token/) the bot uses **real measured AQI from the nearest monitoring station** (within 40 km, under 3 hours old) and names the station. Otherwise it falls back to Open-Meteo's modelled estimate and says so.
* AQI uses the **US EPA scale**, which can differ from Malaysia's official IPU readings.
* Place search: Open-Meteo geocoding. GPS names: OpenStreetMap Nominatim (falls back to the nearest preset city, then raw coordinates).
* SkyBrief does **not** replace official severe-weather warnings (MetMalaysia, NEA, etc.).

## How it works

```
Telegram ──webhook──▶ Cloudflare Worker ──▶ D1 (users, settings)
                         │   ▲                 
   Cron trigger (every   │   └── Open-Meteo / WAQI / Nominatim
   minute) ──────────────┘
```

* Telegram calls `POST /webhook` (protected by a secret header). The Worker acknowledges instantly and processes in the background.
* A **cron trigger runs every minute**; each user is served when their own local time reaches their chosen time. A claim in the database prevents duplicates, and a 2-hour catch-up window covers any outage.

## Access control (multi-user)

Set with the `ACCESS_MODE` variable in `wrangler.jsonc`:

| Mode | Behaviour |
|---|---|
| `approval` (default) | A new user's first message creates a *pending* request. Every admin gets a message with **✅ Approve / ⛔ Deny** buttons. |
| `open` | Anyone who finds the bot can use it. |
| `closed` | Only people an admin adds with `/allow <id>`. Everyone else sees "private bot". |

Admins are the Telegram IDs in `ADMIN_IDS` (comma-separated). They are always active and see extra commands:

| Command | What it does |
|---|---|
| `/users` | List users with status, city, language and daily time |
| `/allow 123456789` | Approve a user by Telegram ID (they are notified) |
| `/block 123456789` | Block a user. They get no replies |

Users can find their ID by messaging [@userinfobot](https://t.me/userinfobot).

## User commands

| Command | What it does |
|---|---|
| `/start` | Welcome message and first report |
| `/weather` | Current weather & air quality |
| `/hourly` | Next 12 hours with rain-chance bars |
| `/city` | Change location (or just type a city name) |
| `/settings` | Choose sections to show and the language |
| `/daily` | Turn the daily report on or off |
| `/settime 07:45` | Change the daily report time (24h, in your city's timezone) |
| `/help` | Show help |

## Configuration

| Name | Type | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret, required | Token from [@BotFather](https://t.me/BotFather) |
| `WEBHOOK_SECRET` | secret, required | Random string (letters, digits, `_`, `-`). Telegram sends it with every update; it also protects `/setup` |
| `ADMIN_IDS` | secret, required | Comma-separated admin Telegram IDs |
| `WAQI_TOKEN` | secret, optional | Enables measured AQI from the nearest station |
| `ACCESS_MODE` | var in `wrangler.jsonc` | `approval` (default), `open` or `closed` |
| `DEFAULT_DAILY_TIME` | var in `wrangler.jsonc` | Default for new users, 24h. Default `08:30` |

## Deploy to Cloudflare (step by step)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node.js 20+.

```bash
npm install

# 1. Log in (opens the browser)
npx wrangler login

# 2. Create the database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create skybrief

# 3. Create the tables
npm run db:migrate:remote

# 4. Deploy: prints your URL, e.g. https://skybrief.<you>.workers.dev
npm run deploy

# 5. Store the secrets (create secrets.json from the template below first)
npx wrangler secret bulk secrets.json
```

`secrets.json` (git-ignored; delete it after step 5):

```json
{
  "TELEGRAM_BOT_TOKEN": "123456:ABC...",
  "WEBHOOK_SECRET": "a-long-random-string",
  "ADMIN_IDS": "123456789",
  "WAQI_TOKEN": "optional"
}
```

**6. Connect Telegram.** Open this URL once in a browser (use your own URL and your `WEBHOOK_SECRET`):

```
https://skybrief.<you>.workers.dev/setup?key=<WEBHOOK_SECRET>
```

You should see `{"ok": true, ...}`. This registers the webhook and the command menus (English, Malay, Chinese).

**7. Try it.** Open your bot in Telegram and send `/start`.

**Updating later:** `git pull && npm run deploy`. Database migrations: add a new file in `migrations/` and run `npm run db:migrate:remote`.

**Deploying from GitHub (optional):** `.github/workflows/deploy.yml` can deploy for you. Add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and run the workflow manually.

## Run and test locally

```bash
npm test                  # unit tests (formatting, translations, schedule logic, keyboards…)
npm run typecheck
npm run test:integration  # end-to-end: real Workers runtime + local D1 + mock Telegram (needs internet)
```

`test:integration` plays a full multi-user scenario: approval flow, settings, language switching, GPS, blocking, and the cron sending to several users in different languages.

To chat with the bot from your computer: copy `.dev.vars.example` to `.dev.vars`, fill it in, run `npm run db:migrate:local` and `npm run dev`, then expose the local port with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`) and call `/setup` against the tunnel URL. For normal use, deploying is simpler.

## Limits and notes

* **Free plan:** I have not verified Cloudflare's current free-tier numbers; check the Workers and D1 pricing pages. The code is built to stay small: the cron handles at most 8 users per minute (the rest are served on the following minutes) to respect the per-invocation request cap. For larger groups, the paid Workers plan lifts these limits.
* **Cron every minute** uses about 1,440 invocations a day, well inside typical free limits.
* One Worker serves one Telegram bot. Rotating the bot token means updating the `TELEGRAM_BOT_TOKEN` secret and opening `/setup` again.
* The previous Python implementation is preserved in git history (tag `python-final`).

## Troubleshooting

| Symptom | Check |
|---|---|
| `/setup` says `forbidden` | The `key` in the URL must equal the `WEBHOOK_SECRET` secret exactly |
| Bot doesn't answer | `npx wrangler tail` shows live logs. Re-open `/setup` to re-register the webhook |
| New users never get approved | Is your Telegram ID in `ADMIN_IDS`? Admins receive the Approve/Deny message |
| Daily report missing | Check `/settings`/`/daily` shows 🔔 ON, and the user's city timezone. `npx wrangler tail` shows `daily_done` lines each run |
| AQI says "modelled estimate" | No `WAQI_TOKEN`, or no fresh station within 40 km |

## Project structure

```
src/
  index.ts       Worker entry: /webhook, /setup, cron
  handlers.ts    commands, buttons, settings, GPS, city search, access control, admin
  daily.ts       per-user, per-timezone daily delivery
  weather.ts     Open-Meteo / WAQI / geocoding clients
  format.ts      the report layouts (language + section aware)
  i18n.ts        ALL translations (en / ms / zh): add a language here
  keyboards.ts   bottom bar + inline buttons
  presets.ts     one-tap city list (edit me)
  db.ts          D1 access
  telegram.ts    Bot API client
migrations/      D1 schema
test/            unit tests
scripts/         end-to-end test
wrangler.jsonc   Worker configuration
```

## Security notes

* Never commit `secrets.json`, `.dev.vars` or `.env` (all git-ignored). Keep real tokens only in Cloudflare secrets.
* If a token is exposed, revoke it: `/revoke` in @BotFather, then update the secret.
* The webhook only accepts requests carrying `WEBHOOK_SECRET`. Keep `ACCESS_MODE` on `approval` or `closed` unless you want a public bot.
