# SkyBrief Mini App: design note

## 1. Parts and responsibilities

| Part | Responsibility | Owns | Depends on |
|---|---|---|---|
| **Front end** `public/app/` (plain HTML, CSS, JS modules) | Draws the dashboard and the animated sky, the location sheet, all loading / error / stale states. Holds no business rules and formats no numbers. | FR-3 (drawing), FR-6, FR-11 (labelling), NFR-3, NFR-4, NFR-5 | Mini App API, Telegram's `telegram-web-app.js` |
| **Mini App API** `src/miniapp.ts` | Checks the Telegram signature and the person's status, then turns the bot's `Report` into one ready-to-draw JSON "dashboard" (already translated and in the person's units). Chooses the scene. | FR-2, FR-3 (scene rule), FR-4, FR-5, FR-7, FR-8, FR-10, NFR-1 | Bot core, D1 |
| **Bot core** (existing `weather.ts`, `insights.ts`, `format.ts`, `warnings.ts`, `i18n.ts`, `units.ts`) | Fetching, caching, backup source, analysis, wording. Unchanged in behaviour; a few private helpers are now exported so the app reuses them instead of copying them. | NFR-9 | External services |
| **Bot chat** (`handlers.ts`, `keyboards.ts`, `daily.ts`, `index.ts`) | The entry points into the app: button, `/app`, optional menu button; routing, 404. | FR-1, NFR-7 | `appurl.ts` |
| **Location** `src/location.ts` | The one way to save a location (validate by fetching, store timezone/state/district, avoid a late report). Used by the chat and by the app. | FR-9 | Bot core, D1 |
| **Demo** `src/demo.ts` | Synthetic reports for the preview. | FR-11 (data) | none |
| **Static hosting** (Workers Static Assets, `public/_headers`) | Serves the files and the security headers. | NFR-6 (headers), NFR-8 | none |
| **Data** D1 `users`, `meta` | Existing tables. One new `meta` row: `app_url`. | n/a | none |
| **External** | Telegram, Open-Meteo, MET Norway, WAQI, MetMalaysia feed | n/a | n/a |

Stack choice: **plain HTML/CSS/JS, no framework, no build step.** It is one screen with one sheet; a framework would
add a build pipeline and weight for nothing. The sky is a `<canvas>` because rain needs hundreds of moving streaks.

## 2. How data moves

1. The person taps "📱 Open dashboard" in the chat. Telegram opens `https://<worker>/app/` in its web view and gives
   the page a signed string, `initData` (who they are, when it was signed).
2. Static Assets return `index.html`, `app.css`, `app.js`, `scene.js`, `boot-strings.js` (the Worker is not invoked).
3. `app.js` paints the last dashboard saved on this device, if any (marked as saved data), then calls
   `GET /api/app/dashboard` with the header `Authorization: tma <initData>`.
4. The Worker verifies the HMAC-SHA256 signature with the bot token and the age of `auth_date`, loads the user row,
   and refuses anyone who is not *active* (401 / 403, plain message, nothing else revealed).
5. The Worker asks the bot core for the cached `Report` of the saved place (Open-Meteo, backup MET Norway; air model
   + WAQI) and the person's current warnings, and builds the dashboard JSON. At most 4 outgoing requests, usually 0
   because of the 5-minute cache.
6. `app.js` checks the shape of the answer, draws it with `textContent` only, starts the matching sky scene and
   stores the JSON on the device for step 3 next time.
7. Changing location: `GET /api/app/places?q=` stores the result list in the user's row (as the chat does) and
   returns labels only; `POST /api/app/place {pick|preset: n}` sends back an **index**, never coordinates, so the
   client cannot store an arbitrary place. The Worker saves it through `location.ts` and returns the new dashboard.

## 3. Data inventory

| Item | Where it lives | Why | Requirement | Retention |
|---|---|---|---|---|
| `initData` | Request header, memory only | Prove who is asking | NFR-1 | None; never logged |
| Last dashboard JSON (weather for the saved place, no identifiers) | `localStorage` on the device, key `skybrief.dash.v1` | Instant paint and a fallback when offline | NFR-2 | Overwritten on every load |
| Forecast length choice (3 or 7) | `localStorage`, key `skybrief.days` | FR-6 | FR-6 | Until changed |
| Search results | `users.search_json` (existing column) | Pick by index | FR-9 | Overwritten by the next search |
| Saved location | `users` (existing columns) | FR-9 | FR-9 | Existing behaviour |
| Mini app address | `meta.app_url` | Build the button | FR-1 | Overwritten by `/setup` |
| Saved places (name, coordinates, timezone, state) | `users.places_json` (new column, migration 0004) | Switch between places | FR-12 | At most 5; removed by the person |
| GPS position | Request body, memory only; the resulting place is saved like any other | Find the place | FR-17 | Not stored as such |
| Picture card | Drawn on the device, uploaded once, forwarded to Telegram, never stored by us | Share | FR-18 | None on our side; it lives in the person's Telegram chat |

Sent to third parties in v2.4: the picture card to Telegram (at the person's request). The IPU request carries no personal data (it downloads the whole station list).

Nothing new is sent to third parties. No analytics, no cookies.

## 4. Logic checks

- [x] No circular dependencies. `appurl.ts` is separate from `miniapp.ts` precisely so `daily.ts → appurl` does not loop through `location.ts → daily.ts`.
- [x] Every requirement has exactly one owner (table above). FR-3 was split: the *rule* (which scene) is the API's, the *drawing* is the front end's. FR-11 likewise: data in `demo.ts`, the "Demo data" label in the front end.
- [x] Nothing stored or sent beyond the requirements (section 3).
- [x] Every external service has a fallback (`docs/FALLBACKS.md`).
- [x] No secrets in the client or the repository. The bot token is only used inside the Worker to check signatures.
- [x] All wording lives in `src/i18n.ts` (`app_*` rows), delivered with the dashboard. The only client-side text is `boot-strings.js`: the four messages needed before or without a server answer.
- [x] Every user-facing failure has a defined message.

## 5. Design brief

* **Who:** bot users in Malaysia, on a phone inside Telegram, glancing for a few seconds before leaving the house; sometimes worried (storm warning, haze).
* **The one task:** "What is it like now, and do I need an umbrella or a mask?" Zero steps: the answer is the first screen.
* **Tone:** calm, clear. Playful only in the sky.
* **Hierarchy:** 1) temperature and condition over the animated sky, 2) official warning if any, 3) rain in the next hours, 4) air quality, 5) the coming days, 6) details and tips.
* **States:** loading (skeleton), fresh, saved-data (stale banner), demo (banner), air unavailable, backup source (footer says so), no warnings (section absent), refused (full-screen message), location sheet: idle / searching / no results / error / saving.
* **Delight budget:** the sky animation and small press feedback. Warnings, errors and the refused screen do not animate.
* **Contrast rule for the sky:** every sky gradient is dark enough for white text at 4.5:1 at its lightest stop; bright things (sun, moon, lightning) live in the top-right corner away from the text; the two buttons on the sky sit on dark glass.

Tokens (colour, spacing, radius, shadow, motion) are CSS variables at the top of `app.css`, with a separate dark set.

## 6. Folder structure

```
public/
  _headers            security headers + CSP for every static file
  404.html, error.css custom 404 (no JavaScript)
  app/
    index.html        markup + SVG icon sprite
    app.css           tokens, layout (mobile-first), themes
    app.js            boot, API calls, rendering, location sheet
    scene.js          the animated sky (canvas); `makePainter` is reused for the share card
    card.js           the picture card for sharing (canvas)
    boot-strings.js   the four pre-server messages (en / ms / zh)
    icon.svg
src/
  miniapp.ts          signature check, dashboard view-model, scene rule, /api/app/* routes
  settings.ts         the rules for changing settings (shared by the chat and the app)
  ipu.ts              Malaysia's official API (IPU) from the Department of Environment (optional)
  demo.ts             synthetic reports for the preview
  location.ts         save a location (shared by chat and app)
  appurl.ts           where the mini app lives (env or meta)
test/miniapp.test.ts  unit tests
tests/e2e/            Playwright: real Worker + mock services
scripts/e2e-server.mjs
```

## 7. Configuration and secrets

No new secrets. Optional var `APP_URL` (the Worker's public origin) overrides the address remembered by `/setup`.
