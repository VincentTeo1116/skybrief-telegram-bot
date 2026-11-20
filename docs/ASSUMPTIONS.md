# Assumptions

The brief said "use your own research and your own design", so these choices were made without asking. Each one is
cheap to change; say so if any is wrong.

| # | Assumption | Why | How to change it |
|---|---|---|---|
| A1 | The mini app is hosted by the **same Cloudflare Worker** as the bot (static files in `public/`, API under `/api/app/*`). | No new hosting, no new secrets, free plan; static files are served without invoking the Worker. | Could move to any static host; the API would need CORS. |
| A2 | "AQI/API" means the air-quality index. The app shows the bot's existing **US AQI** and says it can differ from Malaysia's official **API (IPU)**. | The bot has no IPU data source; inventing a conversion would be wrong. | Add an official IPU source (e.g. data.gov.my) as a new requirement. |
| A3 | The dashboard always shows every section. The bot's "hide sections" and "compact" settings apply to chat messages only. | A dashboard with missing cards looks broken; the settings were designed for message length. | Honour `hidden` in `buildDashboard`. |
| A4 | Settings (language, units, alerts, report times) stay in the bot chat. The app only reads them. Changing **location** is the one exception (FR-9). | "Easy to use, not complicated." | Add a settings sheet later. |
| A5 | "3-day" and "7-day" both start with **today**, like the bot's 7-day view. | Matches common weather sites. | One constant in `app.js`. |
| A6 | "Windy" means sustained wind ≥ 25 km/h or gusts ≥ 40 km/h when it is not raining. Rain and storms take priority over wind (wind then slants the rain). | Malaysian wind is usually light; a higher threshold would never trigger. | `WINDY_KMH` / `WINDY_GUST_KMH` in `src/miniapp.ts`. |
| A7 | The menu button next to the message box is **not** changed by default; it is opt-in via `/setup?key=…&menu=app`. | It would replace the command-list button people already use. | Open that URL once (or `menu=commands` to undo). |
| A8 | Malay and Chinese texts for the app were written by the developer, like the bot's existing ones, and have **not** been reviewed by a native speaker. | No reviewer available. | Edit the `app_*` rows in `src/i18n.ts`. |
| A9 | A signed Telegram session is accepted for 24 hours. | Telegram's own guidance is to check `auth_date`; a day covers an app left open. | `INIT_DATA_MAX_AGE_S` in `src/miniapp.ts`. |
| A10 | The demo endpoint (FR-11) is public. It returns synthetic data only, makes no outgoing requests and reads nothing from the database. | Lets the owner review the design in a normal browser. | Remove the `/api/app/demo` route. |
