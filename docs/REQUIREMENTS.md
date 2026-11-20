# SkyBrief Mini App: requirements register

Source: the owner's brief (20 Nov 2026): "a mini app inside Telegram for the daily weather bot; animations for sunny,
cloudy, rainy and windy days; easy to use; a proper dashboard with current weather and temperature, AQI/API, then the
next 3/7-day prediction; own design."

Status values: Verified, Partly, Not verified, Not built. See `docs/VERIFICATION.md` for the evidence.

## Functional

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-1 | The dashboard opens inside Telegram from the bot | Must | A "📱 Open dashboard" button under every report and a `/app` command open the page as a Telegram Mini App. `/setup?key=…&menu=app` can also put it on the chat's menu button. No button is shown while the public HTTPS address is unknown. |
| FR-2 | Current weather for the person's saved location | Must | First screen shows place, date, temperature, condition in words, feels-like, today's high/low, and the "warmer/cooler than yesterday" line when it applies. Same numbers as the bot's report. |
| FR-3 | Animated sky that matches the weather | Must | Distinct animated scenes for **sunny, cloudy, rainy and windy** (plus thunderstorm, fog and night variants). The scene is chosen from live data by one tested rule. Animation stops under "reduce motion" and when the page is hidden. |
| FR-4 | Air quality (AQI) | Must | AQI number, band in words, position on a 0–500 scale, PM2.5/PM10, the outlook line, and whether it is measured or modelled. States plainly that this is the US AQI scale and can differ from Malaysia's official API (IPU). "Unavailable" state when there is no reading. |
| FR-5 | Hourly outlook | Must | Next 24 hours: time, icon, temperature, chance of rain; plus the bot's 6-hour rain sentence. |
| FR-6 | 3-day and 7-day forecast | Must | One control switches between 3 and 7 days (both start today). Each day: name, icon and words, chance of rain, low and high with a range bar. Weekends marked. The choice is remembered on the device. |
| FR-7 | Details, best time outside, tips | Should | Humidity, wind (direction and gusts), UV, pressure, cloud, sunrise/sunset; the bot's "best time outside" and tips. |
| FR-8 | Official MetMalaysia warnings | Must | Active warnings for the person's state/district appear at the top, with validity, area, text and source. Hidden when there are none, when warnings are switched off, or outside Malaysia (same rule as the bot). |
| FR-9 | Change location | Should | A sheet with city search and the bot's one-tap shortcuts. Choosing a place saves it for the bot too (same code path as the chat) and reloads the dashboard. |
| FR-10 | Personal preferences are honoured | Must | Language (en / ms / zh), °C/°F, wind unit and 12h/24h clock come from the person's bot settings. |
| FR-11 | Preview without Telegram | Should | `/app/?demo=sunny|cloudy|rainy|windy|storm|night` shows clearly labelled demo data so the design and each animation can be reviewed in a normal browser. |

### Added in v2.4 (owner's request, 20 Nov 2026: "do 1-4 with a proper fallback, 5 and 6 as well, and share as a picture card")

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| FR-12 | Several saved places | Should | Up to 5 places are remembered automatically (newest first). With 2 or more, they appear as chips on the sky; one tap switches. A place can be removed from the location sheet; the active one cannot. Switching is saved for the bot too. |
| FR-13 | Settings inside the app | Must | A sheet changes language, °C/°F, wind unit, clock, morning and evening report (on/off and time), rain alerts, AQI alert level and official warnings. Each change is saved at once with the same rules as the chat, the dashboard redraws, and the chat's keyboard follows a language change. Only known settings with valid values are accepted. |
| FR-14 | Official Malaysian API (IPU) | Must | When the Department of Environment has a reading under 3 hours old from a station within 40 km, the air card shows it with band, station, time and source, next to the US AQI. For places outside Malaysia, or when there is no such reading, the block is absent. |
| FR-15 | Tap a day for details | Must | Each forecast row opens to show morning / afternoon / evening, rain chance and total, wind, UV, sunrise and sunset, the air-quality peak, the best time outside and tips. One row open at a time. Lines without data are left out. |
| FR-16 | Hourly chart | Should | A temperature line across the next 24 hours, aligned with the hour columns, and a rain-chance meter per hour. One measure per scale. Absent when temperatures are unknown. |
| FR-17 | Use my current location | Must | A button in the location sheet takes the position from Telegram's location service, or else from the browser, and saves the place named by the server's own lookup. |
| FR-18 | Share a picture card | Must | A share button shows a 1080 × 1350 picture of today's weather (sky scene, temperature, condition, AQI / IPU, rain line, 3-day outlook). Sending puts it in the person's own chat with the bot and, on Telegram 8.0+, opens Telegram's "share to a chat" picker. |

## Non-functional

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| NFR-1 | Only approved bot users see real data | Must | Every data request carries Telegram's signed `initData`; the Worker checks the HMAC signature and its age (24 h), then that the person is an *active* user. Anything else is refused (401/403) with a plain message. Fail closed. |
| NFR-2 | Every failure has a designed fallback | Must | See `docs/FALLBACKS.md`; each row is tested. |
| NFR-3 | Works on every screen | Must | No horizontal scroll or clipped content at 320, 375, 768, 1024, 1440 and 1920 px; touch targets ≥ 44 px; works at 200% text size. |
| NFR-4 | Accessible | Must | WCAG 2.2 AA: semantic structure, keyboard use, visible focus, status never by colour alone, automated scan clean in light and dark. |
| NFR-5 | Light and dark themes | Must | Follows Telegram's theme (falls back to the system setting). |
| NFR-6 | Security baseline | Must | Strict CSP and security headers; no secrets in the client; all input validated on the server; JSON errors leak nothing. |
| NFR-7 | Error pages | Must | Unknown page → custom 404 page with HTTP 404; unknown API path → JSON 404. |
| NFR-8 | Small and cheap | Must | No framework, no build step. Budget: app shell (HTML + CSS + JS) under 130 KB uncompressed (raised from 100 KB in v2.4: settings, the share card and the chart added about 40 KB; it is 116 KB, about 30 KB compressed). A dashboard load costs at most 5 outgoing requests (the fifth is the optional IPU feed), so it fits Cloudflare's free plan. |
| NFR-9 | The bot keeps working exactly as before | Must | All existing unit and integration tests still pass. |

## Sample data used by the tests

* Unit tests: the deterministic Kuala Lumpur forecast in `test/fixtures.ts` (Tuesday 3 Nov 2026, 08:15).
* Browser tests: the real Worker with the controllable mock weather services in `scripts/mock-weather.mjs`, and the demo scenes of FR-11.
