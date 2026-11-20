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
| F16 | Location permission (FR-17) | Refused, switched off, timed out (15 s), or not offered by this Telegram | Telegram's service first, then the browser's; both rejected | Nothing is saved; the sheet stays open | "I couldn't get your location. Allow location access for Telegram, or search for your city instead." Search still works | e2e `F16 GPS refused` |
| F17 | Department of Environment IPU feed (FR-14) | Down, slow (5 s), format changed, reading over 3 h old, no station within 40 km, place outside Malaysia | `officialIpu` returns null; failures are remembered for 3 minutes so a broken feed is not asked on every load | The air card without the IPU block. Never an old or estimated "official" number | Nothing extra; the US AQI card is unchanged | unit `official IPU` (6 tests), e2e `F17` |
| F18 | Telegram share picker (FR-18) | Older Telegram, or Telegram refuses to prepare the message | No `shareMessage`, or `savePreparedInlineMessage` fails | The picture has already been sent to the person's own chat | "Sent to your SkyBrief chat. Forward it to share." | e2e `F18` (two cases) |
| F19 | Sending the picture (FR-18) | Telegram rejects it, the person blocked the bot, two shares within 10 s, picture not a JPEG or too large | 502 / 429 / 400 / 413 | Nothing is sent; the sheet stays open and the button works again | "I couldn't send the picture. Please try again in a moment." | e2e `F19`, `only a JPEG of a sensible size` |
| F20 | Saving a setting (FR-13) | Server error, offline, invalid value | 4xx / 5xx / no answer | Nothing half-applies; every control is redrawn from what is really saved | The reason, in the sheet. If the setting saved but the weather could not be redrawn, it says "Saved" and marks the data as saved data | e2e `a failed save says so`, `only known settings` |
| F21 | Switching to a saved place (FR-12) | Weather can't be loaded | 503 | The location is not changed | A short message; the old place stays on screen and the chips work again | e2e `when the weather can't be loaded` |
| F22 | Hourly chart (FR-16) / day details (FR-15) | Temperatures unknown, or a day has no hourly data | Fewer than 2 known points / empty lists | No chart is drawn; the hour list still shows. Detail lines without data are left out; a day with no hourly data makes no "best time" claim | Nothing extra | e2e `no chart is drawn`, unit `lines without data` |
| F15 | Unknown URL | Typo / old link | Router | Custom 404 (HTML 404, JSON 404 under `/api/`) | "We couldn't find that page" | e2e `404` |
