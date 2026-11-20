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
| 📱 **Mini app dashboard** | A weather dashboard that opens **inside Telegram**: animated sky (sunny, cloudy, rainy, windy, storm, night), current weather, air quality, hourly outlook, 3-day / 7-day forecast, official warnings, and a location picker. Tap **📱 Open dashboard** under any report or send `/app`. |
| 💬 **Inline mode** | Type `@SkyBrief_AI_bot Ipoh` in any chat to share a weather card. |
| 🛟 **Backup data source** | If Open-Meteo is down, reports automatically come from MET Norway (and say so). |
| ⚠️ **Official warnings** | MetMalaysia thunderstorm, heavy-rain and hot-weather warnings for **your state and district**: shown at the top of your report and pushed once when issued (silently at night). `/warnings` shows what is active. Malaysia only. |
| 🛠 **Admin tools** | `/status` health dashboard, `/broadcast` to message everyone (preview + confirm), and automatic alerts to admins when a weather source or the warnings feed keeps failing. |
| 👥 **Multi-user** | Settings are stored per person. Access modes `approval` / `open` / `closed`; admin commands `/users`, `/allow`, `/block`. |

**Each report includes:** temperature, feels-like, high/low, yesterday comparison, humidity, wind, cloud, pressure, sunrise/sunset, UV, **AQI with PM2.5/PM10 and an outlook**, a 6-hour rain outlook, the best time outside, a 3-day forecast and practical tips (umbrella, sunscreen, mask…).

## Data sources and accuracy

* **Weather:** [Open-Meteo](https://open-meteo.com): model-based; "current" values refresh about every 15 minutes. Each report shows the observation time and source.
* **Official warnings:** the Malaysian Meteorological Department's open data (`api.data.gov.my/weather/warning/`). The feed is free text naming states and districts, with **no coordinates**, so matching is by the state saved with your location. When a warning lists specific districts and your district is known and not listed, it is skipped (e.g. a storm warning for Selangor's *Sabak Bernam* is not sent to Shah Alam). When the district is unknown the warning is shown: a missed flood warning is worse than an extra message. **Sea warnings are never shown to people on land.** MetMalaysia publishes English and Malay only; Chinese users get the English text.
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
  Cron trigger (every    │   every minute  → morning / evening reports that are due, then broadcast batches
  minute) ───────────────┘   every 5 min   → health probe (alerts the admin)
                             every 15 min  → rain / air-quality alerts, and official warnings (offset minutes)
```

* Telegram calls `POST /webhook` (protected by a secret header). The Worker acknowledges instantly and processes in the background.
* Each minute, every user is served when their own local time reaches their chosen time. A claim in the database prevents duplicates, and a 2-hour catch-up window covers any outage.
* Alerts are checked every 15 minutes, once per city, and each alert has a cooldown (3 hours), so a hovering value can never flood a chat. They are paused during quiet hours (22:00–06:30 local by default).

## Mini app (dashboard inside Telegram)

The same Worker serves a small web page at `/app/` that Telegram opens as a **Mini App**. It shows what the chat report
shows, as a dashboard, using the same data, the same rules and each person's own language, units and clock.

* **Open it:** the **📱 Open dashboard** button under every report, or `/app`. To also put it on the button next to the
  message box, open `https://<your-worker>/setup?key=<WEBHOOK_SECRET>&menu=app` once (`&menu=commands` puts the command list back).
* **After deploying this version, open `/setup` once.** That is how the bot learns its own public address; until then
  no dashboard button is shown. (Or set the `APP_URL` variable to the Worker's `https://…` origin.)
* **Who can see it:** only approved bot users. The page sends Telegram's signed session with every request; the Worker
  checks the signature with the bot token and then the person's status. Opened in a normal browser it only says "open me in Telegram".
* **Changing location in the app** saves it for the bot as well (same code as the chat). The last 5 places are remembered and appear as one-tap chips; **Use my current location** takes the position from Telegram or the browser.
* **Settings in the app:** language, units, clock, morning and evening report times, rain / air-quality alerts and official warnings, with the same rules as the chat. (Report sections and compact mode stay in the chat: they only affect chat messages.)
* **Official API (IPU):** for places in Malaysia the air card also shows the Department of Environment's reading from the nearest station (within 40 km, under 3 hours old). It comes from the service behind the Department's public map, which is not a documented API, so it is optional: if it is unavailable the block is simply absent. Set `IPU_URL` to `off` to disable it.
* **Tap a day** in the forecast for its morning / afternoon / evening, the whole day hour by hour, rain, wind, UV, sun, air and tips. The next 24 hours have a temperature line.
* **Home place:** in the location sheet, mark one saved place as home (always first, never pushed out) and move the others up or down.
* **Haze:** when the air is unhealthy (US AQI 101+ or official IPU above 100) the sky gets a dusty veil.
* **First visit:** a short four-tip guide appears once; it can be reopened from Settings.
* **Alerts** (rain, air quality, official warnings) carry the dashboard button too.
* **"Open App" on the bot's profile (optional, no code):** in @BotFather send `/mybots`, choose the bot, then *Bot Settings → Configure Mini App → Enable Mini App*, and enter `https://<your-worker>/app/`. Telegram then shows an **Open App** button on the bot's profile.
* **Share:** the share button draws a picture card of today's weather and sends it to your own chat with the bot; on Telegram 8.0 or newer it then opens Telegram's "share to a chat" picker.
* **Preview in a normal browser:** `https://<your-worker>/app/?demo=sunny` (also `cloudy`, `rainy`, `windy`, `storm`, `night`, `haze`;
  add `&lang=ms` or `&lang=zh`). It is clearly labelled as demo data and reads nothing from the database.
* **Air quality** is the same US AQI as in the chat report (alerts are based on it); the official IPU is shown beside it when available.
* No framework and no build step: `public/app/` is plain HTML, CSS and JavaScript (about 123 KB before compression).

Design notes, requirements, fallbacks and test evidence are in `docs/`.

## Alerts in detail

| | Rain alert | Air-quality alert |
|---|---|---|
| **Turn on** | ⚙️ Settings → 🔔 Alerts & reports | same page; pick `AQI ≥101`, `≥151` or `≥201` |
| **Fires when** | rain is likely (≥60%) within the next 1–2 hours and it is not already raining | AQI (measured if available) reaches your level |
| **Won't repeat** | for 3 hours | until AQI falls 10 points below your level, and not within 3 hours |
| **Mute** | 🔕 button on the alert itself | 🔕 button on the alert itself |

Alerts are **off for everyone by default**.

## Official warnings in detail

* **Where you see them:** at the top of *Today's* report, and as a message when a **new** warning is issued for your area (each warning is sent once; an updated warning counts as new). Pushes are **silent during quiet hours** so a night-time warning never wakes anyone but is there in the morning.
* **Who gets them:** everyone in Malaysia, **on by default**; switch off under ⚙️ Settings → Alerts, or with the 🔕 button on a warning. People you approve with `/allow` start receiving them after their first `/start`.
* **Your state** is saved with your location (city shortcuts, search results and GPS all provide it). If an older saved location has none, the bot works it out once on its own.
* If the MetMalaysia service is briefly unreachable, a copy up to 30 minutes old is used; the admin is alerted if it stays down for 30 minutes.

## Admin tools in detail

* **`/status`** is the one-screen dashboard: is the cron running (it should tick every minute), how many users, how many reports and alerts went out today, whether Open-Meteo / the backup / the warnings feed are healthy, and the last broadcast.
* **Automatic alerts to every admin**, once per problem and once on recovery, so there is no noise: Open-Meteo failing for 15 minutes (reports are using the backup); the backup failing as well (**critical**: nothing works); the warnings feed down for 30 minutes.
* **`/broadcast`** sends plain text (any `<` or `&` is escaped), up to 1,000 characters, **in batches of 20 per minute** so it works within the free plan's limits. You are told when it finishes and how many could not be reached (people who blocked the bot). Only one broadcast runs at a time.

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
| `/status` | Cron heartbeat, user counts, today's counters, health of Open-Meteo / the backup / the warnings feed, last broadcast |
| `/broadcast your message` | Send a message to every active user. You get a **preview with Send / Cancel**; nothing goes out until you confirm. `/broadcast stop` cancels a running one |

Users can find their ID by messaging [@userinfobot](https://t.me/userinfobot). Inline mode follows the same rules: unapproved people only get a button into the bot.

## User commands

| Command | What it does |
|---|---|
| `/start` | Welcome message and first report |
| `/weather` | Current weather & air quality |
| `/hourly` | Next 12 hours with rain-chance bars |
| `/tomorrow` | Tomorrow's forecast |
| `/week` | 7-day outlook |
| `/app` | Open the weather dashboard (mini app) |
| `/warnings` | Official MetMalaysia warnings active for your state |
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
| `SETUP_KEY` | secret, optional, recommended | A separate key for `/setup`. When set, `/setup` accepts only this, so the webhook secret never has to appear in a browser address bar or a request log |
| `ADMIN_IDS` | secret, required | Comma-separated admin Telegram IDs |
| `WAQI_TOKEN` | secret, optional | Enables measured AQI from the nearest station |
| `ACCESS_MODE` | var in `wrangler.jsonc` | `approval` (default), `open` or `closed` |
| `DEFAULT_DAILY_TIME` | var in `wrangler.jsonc` | Default morning time for new users, 24h. Default `08:30` |
| `IPU_URL` | var, optional | `off` stops the mini app from asking the Department of Environment for the official API (IPU) |
| `APP_URL` | var, optional | The Worker's public `https://…` origin, for the dashboard button. Normally not needed: `/setup` remembers it |
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
npm run test:e2e          # mini app in a real browser (Playwright + your installed Chrome), ~3 minutes, no internet needed
```

* `test:integration` runs the real Worker in Cloudflare's runtime with a local database, a mock Telegram and a **controllable mock of every weather service**, then plays a full multi-user scenario: approval, all four views, every settings page, units, languages, GPS, rain and AQI alerts, outages and the backup source, inline mode, and morning + evening reports delivered across two timezones.
* `test:live` compares the backup source and the sunrise/sunset maths against Open-Meteo in nine cities (including half-hour and date-line timezones), renders every view from real data, and parses the real MetMalaysia feed.

* `test:e2e` starts the real Worker with the same mocks and drives the mini app in Chrome: sign-in and refusals, every card, changing location, each failure in `docs/FALLBACKS.md`, accessibility scans in light and dark, and seven screen sizes. Screenshots land in `test-results/shots/`. To look at the page yourself: `node scripts/e2e-server.mjs`, then open `http://127.0.0.1:18790/app/?demo=rainy`.

To chat with the bot from your computer: copy `.dev.vars.example` to `.dev.vars`, fill it in, run `npm run db:migrate:local` and `npm run dev`, then expose the local port with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`) and call `/setup` against the tunnel URL. For normal use, deploying is simpler.

## Limits and notes

* **Free plan:** check Cloudflare's current Workers and D1 limits. The code is built to stay small: the cron handles at most **8 reports per minute** and **6 cities per alert pass** (anyone left over is served on the following minutes), to respect the per-invocation request cap; and CPU-heavy work is kept to about a millisecond (a regression test guards this). Larger groups need the paid Workers plan.
* **Cron every minute** uses about 1,440 invocations a day.
* Inline mode answers with up to 3 cities per query.
* **Warnings pass:** at most 12 messages and 3 state look-ups per 15-minute pass; **broadcast:** 20 recipients per minute.
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
| No **📱 Open dashboard** button | Open `/setup` once after deploying (the bot learns its HTTPS address there), or set `APP_URL` |
| Dashboard says "session has expired" | Close it and open it again from the bot (a session is accepted for 24 hours). After rotating the bot token, old sessions stop working by design |
| Inline mode shows nothing | Run `/setinline` in @BotFather, and open `/setup` again after deploying |
| No official warnings arrive | Is the person in Malaysia, with warnings ON (Settings → Alerts)? `/warnings` shows what is active for their state. A warning that lists only other districts of their state is skipped on purpose. `npx wrangler tail` shows `warnings_done` lines |
| `/status` says the cron stalled | The Worker's cron trigger stopped: check the Workers dashboard and redeploy |
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
  warnings.ts    MetMalaysia feed: parsing, sea-warning exclusion, state + district matching
  health.ts      health probes and the alert-once state machine
  broadcast.ts   admin broadcast (preview, confirm, batched delivery)
  stats.ts       counters, cron heartbeat and the /status page
  telegram.ts    Bot API client
  miniapp.ts     mini app API: Telegram signature check, dashboard view-model, scene rule
  location.ts    saving a location and the list of saved places (shared by the chat and the mini app)
  settings.ts    the rules for changing settings (shared by the chat and the mini app)
  ipu.ts         Malaysia's official API (IPU) from the Department of Environment (optional)
  appurl.ts      where the mini app lives (remembered by /setup)
  demo.ts        synthetic data for the mini app preview
public/          the mini app itself (app/), the custom 404 page, security headers (_headers)
docs/            requirements, design note, fallbacks, traceability, verification
tests/e2e/       browser tests (Playwright)
migrations/      D1 schema (0001 users, 0002 preferences + alerts, 0003 warnings + admin store, 0004 saved places)
test/            unit tests + a recorded real MET Norway response
scripts/         end-to-end test, mock weather services, live checks
wrangler.jsonc   Worker configuration
```

## Security notes

* Never commit `secrets.json`, `.dev.vars` or `.env` (all git-ignored). Keep real tokens only in Cloudflare secrets.
* A security assessment (design review plus automated attack tests) is in `docs/SECURITY-ASSESSMENT.md`, with the actions left for the owner. Re-run its tests with `npm run test:e2e`.
* Set `SETUP_KEY` so the webhook secret is not used in the `/setup` URL: whoever holds the webhook secret can send the bot fake Telegram updates.
* If a token is exposed, revoke it: `/revoke` in @BotFather, then update the secret.
* The mini app's API only answers requests carrying a valid Telegram-signed session of an approved user. The page is served with a strict Content-Security-Policy (no inline scripts or styles).
* The webhook only accepts requests carrying `WEBHOOK_SECRET`. Keep `ACCESS_MODE` on `approval` or `closed` unless you want a public bot.
