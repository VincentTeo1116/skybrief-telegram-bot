# Assumptions

The brief said "use your own research and your own design", so these choices were made without asking. Each one is
cheap to change; say so if any is wrong.

| # | Assumption | Why | How to change it |
|---|---|---|---|
| A1 | The mini app is hosted by the **same Cloudflare Worker** as the bot (static files in `public/`, API under `/api/app/*`). | No new hosting, no new secrets, free plan; static files are served without invoking the Worker. | Could move to any static host; the API would need CORS. |
| A2 | *(Extended in v2.4.)* The app shows the bot's **US AQI** and, when available, Malaysia's official **API (IPU)** next to it (FR-14). Alerts are still based on the US AQI. | Both numbers are useful; they use different scales and must not be mixed. | To base alerts on IPU, change `decideAqi`. |
| A3 | The dashboard always shows every section. The bot's "hide sections" and "compact" settings apply to chat messages only. | A dashboard with missing cards looks broken; the settings were designed for message length. | Honour `hidden` in `buildDashboard`. |
| A4 | *(Replaced in v2.4.)* The app now has its own settings sheet (FR-13). "Which report sections to show" and "compact report" stay in the chat, because they only affect chat messages. | Owner's request. | n/a |
| A5 | "3-day" and "7-day" both start with **today**, like the bot's 7-day view. | Matches common weather sites. | One constant in `app.js`. |
| A6 | "Windy" means sustained wind ≥ 25 km/h or gusts ≥ 40 km/h when it is not raining. Rain and storms take priority over wind (wind then slants the rain). | Malaysian wind is usually light; a higher threshold would never trigger. | `WINDY_KMH` / `WINDY_GUST_KMH` in `src/miniapp.ts`. |
| A7 | The menu button next to the message box is **not** changed by default; it is opt-in via `/setup?key=…&menu=app`. | It would replace the command-list button people already use. | Open that URL once (or `menu=commands` to undo). |
| A8 | Malay and Chinese texts for the app were written by the developer, like the bot's existing ones, and have **not** been reviewed by a native speaker. | No reviewer available. | Edit the `app_*` rows in `src/i18n.ts`. |
| A9 | A signed Telegram session is accepted for 24 hours. | Telegram's own guidance is to check `auth_date`; a day covers an app left open. | `INIT_DATA_MAX_AGE_S` in `src/miniapp.ts`. |
| A11 | The official IPU comes from the service behind the Department of Environment's public APIMS map (`eqms.doe.gov.my`). It is **not a documented public API**: there are no published terms and it may change or stop without notice. | No documented air-quality API was found on data.gov.my (two likely addresses returned 404 on 20 Nov 2026; this was not an exhaustive search). This feed is the Department's own data. | It is optional by design (F17). Set the `IPU_URL` variable to `off` to stop using it. |
| A12 | Places are remembered automatically (the last 5), rather than with a separate "save" step. | One step fewer; removal is one tap. | `MAX_PLACES` in `src/location.ts`. |
| A13 | Sharing first sends the picture to the person's own chat with the bot. | It is the only way to give Telegram the picture without storing it on our side, and it is also the fallback when the share picker is unavailable. | Would need image storage (e.g. R2) and a public image address. |
| A14 | A person can share one picture every 10 seconds. The limit is kept in memory per Worker instance, so it is approximate. | Stops a stuck button or a script from flooding; no extra database writes. | `SHARE_INTERVAL_MS` in `src/miniapp.ts`. |
| A15 | GPS coordinates are rounded to 4 decimals (about 11 m) before use, and the place name always comes from the server's own lookup, never from the page. | The same trust rule as the chat's shared location. | n/a |
| A10 | The demo endpoint (FR-11) is public. It returns synthetic data only, makes no outgoing requests and reads nothing from the database. | Lets the owner review the design in a normal browser. | Remove the `/api/app/demo` route. |
