# ☀️ SkyBrief: Weather & Air-Quality Telegram Bot

SkyBrief is a multi-user Telegram bot that sends a clean **weather and air-quality (AQI) report every morning at 08:30** and answers on demand, so you never have to open a website. It runs on **Cloudflare Workers** (TypeScript) with a **D1** database: always on, no server to maintain, instant replies, and a free tier that comfortably covers personal and small-team use.

Every user has their own saved location, language, units, layout, alerts and report times. An admin controls who may use the bot.

## Features

| | |
|---|---|
| 🔔 **Daily report** | 08:30 by default, per user, in the **local time of that user's city** (a team spread over several timezones each gets their own morning). `/settime 07:45` to change, `/daily` to switch off. |
| 🌙 **Evening report** | Optional: tomorrow's outlook every evening. `/evening` to switch on or off, `/evening 19:00` to set the time. |
| 📋 **Four views** | **Today**, **Hourly** (next 12 hours), **Tomorrow** (morning / afternoon / evening, air outlook, best time, tips) and a **7-day** outlook with weekends marked. One tap to switch, one tap to refresh. |
| 🏃 **Best time outside** | "Today: 5–10 PM": the longest stretch of comfortable temperature, low UV, no rain and clean air. |
| 📈 **Trends** | "3° warmer than yesterday" and an AQI outlook ("rising: peak ~95 around 3 PM"). |
| 🌧 **Rain alerts** | Opt-in heads-up when rain is likely within the next 1–2 hours. |
| 😷 **Air-quality alerts** | Opt-in message when AQI reaches the level you choose (101 / 151 / 201). |
| 📍 **Live location** | Tap **Share my location**: GPS detection, saved automatically. Or pick one of 10 shortcuts, or just *type any city name*. |
| 📐 **Units & display** | °C / °F, km/h / m/s / mph, 12h / 24h clock, and a **compact mode** that fits a report on one screen. |
| ⚙️ **Settings** | Show or hide any of 7 report sections; **English** (default), **Bahasa Melayu**, **中文**. |
| 💬 **Inline mode** | Type `@SkyBrief_AI_bot Ipoh` in any chat to share a weather card. |
| 🛟 **Backup data source** | If Open-Meteo is down, reports automatically come from MET Norway (and say so). |
| 👥 **Multi-user** | Settings are stored per person. Access modes `approval` / `open` / `closed`; admin commands `/users`, `/allow`, `/block`. |

**Each report includes:** temperature, feels-like, high/low, yesterday comparison, humidity, wind, cloud, pressure, sunrise/sunset, UV, **AQI with PM2.5/PM10 and an outlook**, a 6-hour rain outlook, the best time outside, a 3-day forecast and practical tips (umbrella, sunscreen, mask…).

## Data sources and accuracy

* **Weather:** [Open-Meteo](https://open-meteo.com): model-based; "current" values refresh about every 15 minutes. Each report shows the observation time and source.
* **Backup weather:** [MET Norway](https://api.met.no/) is used automatically when Open-Meteo can't be reached, only for places whose timezone is already known. It has no rain *probability*, so that is estimated from the forecast rainfall (the footer says "backup source"), and it has no "yesterday", so the comparison line is omitted. It is never used when *saving* a new location.
* **Air quality:** with a free [WAQI token](https://aqicn.org/data-platform/token/) the bot uses **real measured AQI from the nearest monitoring station** (within 40 km, under 3 hours old) and names the station. Otherwise it uses Open-Meteo's modelled estimate and says so. The AQI **outlook** and the best-time hint always come from the model (labelled "model").
* **Rain alerts use hourly forecast data.** Outside Europe and North America, finer-grained data is only interpolated from hourly values, so "soon" means *within the next 1–2 hours*, not minutes.
* AQI uses the **US EPA scale**, which can differ from Malaysia's official IPU readings.
* Place search: Open-Meteo geocoding. GPS names: OpenStreetMap Nominatim (falls back to the nearest preset city, then raw coordinates).
* MET Norway and Nominatim ask for an identifying `User-Agent`; the bot sends its name and this project's GitHub address (never an email).
* SkyBrief does **not** replace official severe-weather warnings (MetMalaysia, NEA, etc.).

## How it works

```
Telegram ──webhook──▶ Cloudflare Worker ──▶ D1 (users, settings)
 (messages, taps,        │   ▲
  inline queries)        │   └── Open-Meteo ─(down?)→ MET Norway · WAQI · Nominatim
                         │
  Cron trigger (every    │   every minute  → morning / evening reports that are due
  minute) ───────────────┘   every 15 min  → rain and air-quality alerts
```

* Telegram calls `POST /webhook` (protected by a secret header). The Worker acknowledges instantly and processes in the background.
* Each minute, every user is served when their own local time reaches their chosen time. A claim in the database prevents duplicates, and a 2-hour catch-up window covers any outage.
* Alerts are checked every 15 minutes, once per city, and each alert has a cooldown (3 hours), so a hovering value can never flood a chat. They are paused during quiet hours (22:00–06:30 local by default).

## Alerts in detail

| | Rain alert | Air-quality alert |
|---|---|---|
| **Turn on** | ⚙️ Settings → 🔔 Alerts & reports | same page; pick `AQI ≥101`, `≥151` or `≥201` |
| **Fires when** | rain is likely (≥60%) within the next 1–2 hours and it is not already raining | AQI (measured if available) reaches your level |
| **Won't repeat** | for 3 hours | until AQI falls 10 points below your level, and not within 3 hours |
| **Mute** | 🔕 button on the alert itself | 🔕 button on the alert itself |

Alerts are **off for everyone by default**.

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
| `/users` | List users with status, city, language, daily/evening times and alert flags |
| `/allow 123456789` | Approve a user by Telegram ID (they are notified) |
| `/block 123456789` | Block a user. They get no replies |

Users can find their ID by messaging [@userinfobot](https://t.me/userinfobot). Inline mode follows the same rules: unapproved people only get a button into the bot.

## User commands

| Command | What it does |
|---|---|
| `/start` | Welcome message and first report |
| `/weather` | Current weather & air quality |
| `/hourly` | Next 12 hours with rain-chance bars |
| `/tomorrow` | Tomorrow's forecast |
| `/week` | 7-day outlook |
| `/city` | Change location (or just type a city name) |
| `/daily` | Turn the morning report on or off |
| `/settime 07:45` | Change the morning report time (24h, in your city's timezone) |
| `/evening` · `/evening 19:00` | Turn the evening report on/off · set its time |
| `/settings` | Sections, language, units & display, alerts |
| `/help` | Show help |

## Configuration

| Name | Type | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | secret, required | Token from [@BotFather](https://t.me/BotFather) |
| `WEBHOOK_SECRET` | secret, required | Random string (letters, digits, `_`, `-`). Telegram sends it with every update; it also protects `/setup` |
| `ADMIN_IDS` | secret, required | Comma-separated admin Telegram IDs |
| `WAQI_TOKEN` | secret, optional | Enables measured AQI from the nearest station |
| `ACCESS_MODE` | var in `wrangler.jsonc` | `approval` (default), `open` or `closed` |
| `DEFAULT_DAILY_TIME` | var in `wrangler.jsonc` | Default morning time for new users, 24h. Default `08:30` |
| `QUIET_HOURS` | var in `wrangler.jsonc` | Alerts are paused between these local hours, `"22:00-06:30"` by default, or `"off"` |

## Deploy to Cloudflare (step by step)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node.js 20+.

```bash
npm install

# 1. Log in (opens the browser)
npx wrangler login

# 2. Create the database, then paste the printed database_id into wrangler.jsonc
#    (keep "binding": "DB": the code reads env.DB)
npx wrangler d1 create skybrief

# 3. Create the tables (applies every file in migrations/)
npm run db:migrate:remote

# 4. Deploy: applies any new migrations first, then uploads the code. Prints your URL,
#    e.g. https://skybrief.<you>.workers.dev
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

You should see `{"ok": true, ...}`. This registers the webhook (including **inline queries**) and the command menus (English, Malay, Chinese). **Open it again after upgrading from an older version**, so Telegram starts sending inline queries.

**7. Turn on inline mode (once, optional).** In Telegram, message [@BotFather](https://t.me/BotFather): `/setinline` → choose your bot → enter a placeholder such as `City name…`. Then `@YourBot Ipoh` works in any chat.

**8. Try it.** Open your bot in Telegram and send `/start`.

**Updating later (automatic):** every push to the `main` branch is deployed by `.github/workflows/deploy.yml` (type-check, tests, database migrations, then deploy; a failing step means nothing is deployed). Set it up once by adding two repo secrets, `CLOUDFLARE_API_TOKEN` (permissions: Account > Workers Scripts > Edit and Account > D1 > Edit) and `CLOUDFLARE_ACCOUNT_ID`. Your bot's own secrets stay in Cloudflare and are never touched by a deploy. You can still deploy by hand with `npm run deploy`.

**Database changes:** add a new numbered file in `migrations/` (never edit an applied one). The deploy workflow applies it automatically; by hand: `npm run db:migrate:remote`. Existing users keep their data; new settings start at safe defaults (metric units, full report, all alerts off).

**Configuration lives in `wrangler.jsonc`.** Changes made by hand in the Cloudflare dashboard are overwritten by the next deploy.

## Run and test locally

```bash
npm test                  # ~170 unit tests (formatting, translations, schedule, alerts, backup source…)
npm run typecheck
npm run test:integration  # end-to-end, ~2 minutes, no internet needed
npm run test:live         # checks against the REAL weather services (needs internet)
```

* `test:integration` runs the real Worker in Cloudflare's runtime with a local database, a mock Telegram and a **controllable mock of every weather service**, then plays a full multi-user scenario: approval, all four views, every settings page, units, languages, GPS, rain and AQI alerts, outages and the backup source, inline mode, and morning + evening reports delivered across two timezones.
* `test:live` compares the backup source and the sunrise/sunset maths against Open-Meteo in nine cities (including half-hour and date-line timezones) and renders every view from real data.

To chat with the bot from your computer: copy `.dev.vars.example` to `.dev.vars`, fill it in, run `npm run db:migrate:local` and `npm run dev`, then expose the local port with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`) and call `/setup` against the tunnel URL. For normal use, deploying is simpler.

## Limits and notes

* **Free plan:** check Cloudflare's current Workers and D1 limits. The code is built to stay small: the cron handles at most **8 reports per minute** and **6 cities per alert pass** (anyone left over is served on the following minutes), to respect the per-invocation request cap; and CPU-heavy work is kept to about a millisecond (a regression test guards this). Larger groups need the paid Workers plan.
* **Cron every minute** uses about 1,440 invocations a day.
* Inline mode answers with up to 3 cities per query.
* One Worker serves one Telegram bot. Rotating the bot token means updating the `TELEGRAM_BOT_TOKEN` secret and opening `/setup` again.
* The previous Python implementation is preserved in git history (tag `python-final`).

## Troubleshooting

| Symptom | Check |
|---|---|
| `/setup` says `forbidden` | The `key` in the URL must equal the `WEBHOOK_SECRET` secret exactly |
| Bot doesn't answer | `npx wrangler tail` shows live logs. Re-open `/setup` to re-register the webhook |
| Every message fails after a deploy | `wrangler.jsonc` must have `"binding": "DB"` for the database |
| New users never get approved | Is your Telegram ID in `ADMIN_IDS`? Admins receive the Approve/Deny message |
| Daily report missing | `/settings` → Alerts & reports, or `/daily`, should show 🔔 ON; check the user's city timezone. `npx wrangler tail` shows `daily_done` lines each run |
| No alerts arriving | They are off by default; turn them on in Settings. They also pause 22:00–06:30 (`QUIET_HOURS`) and have a 3-hour cooldown |
| Inline mode shows nothing | Run `/setinline` in @BotFather, and open `/setup` again after deploying |
| AQI says "modelled estimate" | No `WAQI_TOKEN`, or no fresh station within 40 km |
| Footer says "backup source" | Open-Meteo was unreachable; it switches back by itself |

## Project structure

```
src/
  index.ts       Worker entry: /webhook, /setup, cron (reports every minute, alerts every 15)
  handlers.ts    commands, buttons, settings pages, GPS, city search, inline mode, access control, admin
  daily.ts       per-user, per-timezone morning + evening delivery
  alerts.ts      rain and air-quality alerts (state machine, quiet hours, cooldowns)
  insights.ts    pure analysis: best time outside, AQI outlook, yesterday trend, rain detection
  weather.ts     Open-Meteo / WAQI / geocoding clients, caching, automatic backup source
  metno.ts       MET Norway backup adapter + sunrise/sunset calculator
  format.ts      the report layouts (today, compact, hourly, tomorrow, 7-day, alerts, inline cards)
  units.ts       °C/°F, km/h|m/s|mph, display preferences
  i18n.ts        ALL translations (en / ms / zh) and date/time helpers: add a language here
  keyboards.ts   bottom bar, view navigation, settings pages
  presets.ts     one-tap city list (edit me)
  db.ts          D1 access
  telegram.ts    Bot API client
migrations/      D1 schema (0001 users, 0002 preferences + alerts)
test/            unit tests + a recorded real MET Norway response
scripts/         end-to-end test, mock weather services, live checks
wrangler.jsonc   Worker configuration
```

## Security notes

* Never commit `secrets.json`, `.dev.vars` or `.env` (all git-ignored). Keep real tokens only in Cloudflare secrets.
* If a token is exposed, revoke it: `/revoke` in @BotFather, then update the secret.
* The webhook only accepts requests carrying `WEBHOOK_SECRET`. Keep `ACCESS_MODE` on `approval` or `closed` unless you want a public bot.
