# Fallbacks

Rule: a failure never makes the page look more certain than it is. Old data is always labelled as old.

| # | Dependency / operation | Failure | Detected by | Fallback | What the person sees | Test |
|---|---|---|---|---|---|---|
| F1 | Telegram script (`telegram.org`) | Blocked, or the page is opened in a normal browser | No `initData` | No API call is made | Full-screen "This dashboard opens inside Telegram" | e2e `outside Telegram` |
| F2 | Signature | Missing, tampered, wrong bot, older than 24 h | HMAC / `auth_date` check | 401, no data | "Your session has expired. Close the dashboard and open it again from the bot." | unit `verifyInitData`, e2e `tampered` |
| F3 | Access | Unknown, pending or blocked person | User row | 403, no data | Plain reason (send /start, waiting for approval, no access) | unit + e2e `stranger` |
| F4 | Open-Meteo forecast | Down / incomplete | Existing check in `weather.ts` | MET Norway backup | Normal dashboard; footer says "backup source" | e2e `backup source` |
| F5 | Both forecast sources | Down | `WeatherError` | 503 JSON. Client keeps the saved dashboard if it has one | With saved data: banner "Showing saved data from … Couldn't update." Without: error screen with **Try again** | e2e `weather down` (both cases) |
| F6 | Air quality (model and station) | Down / no reading | `aq === null` | Rest of the dashboard still renders | Air card says "Unavailable right now" | unit `air unavailable` |
| F7 | MetMalaysia feed | Down | Existing `userWarnings` catch (30-min stale copy first) | No warnings block | Nothing claims "no warnings"; the block is simply absent | unit `warnings` |
| F8 | API / network from the phone | Offline, timeout (12 s), 5xx, malformed JSON | fetch error / shape check, one retry | Same as F5 | Same as F5 | e2e `offline`, `malformed` |
| F9 | City search | Geocoder down / nothing found | 503 / empty list | Sheet stays open, typed text kept | "City search is unavailable right now" / "No place found" | e2e `search` |
| F10 | Saving a location | Weather check fails | 503 | Nothing is saved | Message in the sheet; old location stays | e2e `save fails` |
| F11 | `localStorage` | Blocked / full | try/catch wrapper | Works without the saved copy | Nothing | e2e `storage blocked` |
| F12 | JavaScript | Disabled / module fails | `<noscript>`, render `try/catch` | Static message | "This dashboard needs JavaScript" / error screen | e2e `noscript` |
| F13 | Canvas / reduced motion | No 2D context, or "reduce motion" is on | Feature check / media query | Sky gradient only, or one still frame | Static sky; all information is in text | e2e `reduced motion` |
| F14 | Mini app address unknown | `/setup` not opened since this version | `getAppUrl` returns null | No button; `/app` explains | "The dashboard isn't set up yet…" | unit `keyboard` |
| F15 | Unknown URL | Typo / old link | Router | Custom 404 (HTML 404, JSON 404 under `/api/`) | "We couldn't find that page" | e2e `404` |
