# Traceability: requirement → code → test

Unit = `test/miniapp.test.ts` (Vitest). E2E = `tests/e2e/*.e2e.ts` (Playwright, real Worker). Integ = `scripts/integration.mjs`.

| ID | Code | Tests |
|---|---|---|
| FR-1 open from the bot | `src/appurl.ts`, `keyboards.ts` (`reportKeyboard`, `appKeyboard`), `handlers.ts` (`/app`), `index.ts` (`/setup`, `menu=`) | Unit "the way in from the chat"; Integ "Mini app: the ways in from the chat" (9 checks) |
| FR-2 current weather | `miniapp.ts` `buildDashboard` → `app.js` `renderHero` | Unit "current weather (FR-2)"; E2E "FR-2..8 an approved user sees…" |
| FR-3 animated sky | rule: `miniapp.ts` `sceneOf`; drawing: `public/app/scene.js`; colours: `app.css` `.hero[data-sky]` | Unit "sceneOf" (7 tests); E2E "FR-3 <scene>: the sky matches the weather and really moves" ×6, "under 'reduce motion'…" |
| FR-4 air quality | `buildDashboard` (air) → `app.js` `airCard` | Unit "air quality…" ×3; E2E "FR-2..8" |
| FR-5 hourly | `buildDashboard` (hourly, rain) → `hourlyCard` | Unit "hourly", "rain outlook levels"; E2E "FR-2..8" |
| FR-6 3 / 7 days | `buildDashboard` (daily) → `forecastCard`, `renderDays` | Unit "seven days starting today"; E2E "FR-2..8" (toggle, remembered after reload) |
| FR-7 details, best time, tips | `buildDashboard` (details, best, tips) → `detailsCard`, `bestCard` | Unit "details (FR-7)"; E2E "FR-2..8" |
| FR-8 official warnings | `views.ts` `userWarnings` → `buildDashboard` (warnings) → `warningsCard` | Unit "official warnings (FR-8)"; E2E "FR-2..8" (real feed pipeline) |
| FR-9 change location | `miniapp.ts` `onPlaces`, `onSavePlace`; `location.ts` `savePlace`; `app.js` sheet | E2E "FR-9 search for a city…", "FR-9 the page can only choose from the list", "F9", "F10" |
| FR-10 preferences | `buildDashboard` uses `Prefs` | Unit "units, clock and language…"; E2E "FR-10/11 the demo follows the language" |
| FR-11 demo | `src/demo.ts`, `miniapp.ts` `onDemo`, `app.js` demo banner | Unit "demo scenes" ×7, "the demo needs no session and is labelled"; E2E scene tests, "an unknown demo scene is refused" |
| FR-12 saved places | `location.ts` (`savedPlaces`, `savePlace`, `activatePlace`, `forgetPlace`), `miniapp.ts` `onSavePlace` / `onRemovePlace`, `app.js` chips + `renderSavedPlaces`, migration 0004 | Unit "saved places" ×5; E2E "FR-12/14 saved places", "at most five", "when the weather can't be loaded" |
| FR-13 settings | `settings.ts` (`parseSettingsChange`, `settingsPatch`, `setLanguage`), `miniapp.ts` `onSettings`, `handlers.ts` (now uses the same rules), `app.js` `renderSettings` / `saveSettings` | Unit "settings" ×8; E2E "FR-13" ×4; Integ (chat settings unchanged) |
| FR-14 official IPU | `ipu.ts`, `miniapp.ts` (`ipu` in the dashboard), `app.js` `ipuBlock` | Unit "official IPU" ×6; E2E "FR-12/14", "F17"; Live "Department of Environment feed" |
| FR-15 day details | `miniapp.ts` `dayDetail`, `app.js` `dayDetail` / `renderDays` | Unit "every day carries its details" ×4; E2E "FR-15" |
| FR-16 hourly chart | `miniapp.ts` (`hourly[].t`), `app.js` `hourChart` | Unit "the chart gets a plain number"; E2E "FR-16" ×2 |
| FR-17 GPS | `miniapp.ts` `onSavePlace` (lat/lon), `app.js` `useMyLocation` | E2E "FR-17" ×3, "F16" |
| FR-18 share card | `public/app/card.js`, `scene.js` `makePainter`, `miniapp.ts` `onShare`, `telegram.ts` `sendPhoto` / `savePreparedPhoto` | E2E "FR-18" ×3, "F18" ×2, "F19" |
| NFR-1 access | `miniapp.ts` `verifyInitData`, `authorise` | Unit "verifyInitData" ×7, "no session, no data"; E2E "F1", "F2", "F3", "NFR-1 someone who loses access…" |
| NFR-2 fallbacks | see `docs/FALLBACKS.md` | E2E "F1" … "F12" |
| NFR-3 responsive | `app.css` | E2E "NFR-3 <width>px <page>" ×28, "text at 200%" |
| NFR-4 accessible | `index.html`, `app.css`, `app.js` | E2E axe scans ×16, "NFR-4 keyboard…" |
| NFR-5 themes | `app.css` dark tokens, `app.js` `applyTheme` | E2E axe scans in dark, "NFR-5 Telegram's dark theme wins" |
| NFR-6 security | `public/_headers`, `miniapp.ts` validation, `app.js` (`textContent` only) | E2E "NFR-6/7 headers…", "NFR-6 text from the server is never run as HTML", "FR-9 … bad requests are refused" |
| NFR-7 error pages | `index.ts` `notFound`, `public/404.html`, `miniapp.ts` `apiError` | E2E "NFR-4/7 404 page" ×2, "NFR-6/7"; Unit "unknown paths and wrong methods answer in JSON" |
| NFR-8 small and cheap | no dependencies in `public/` | E2E size check in "NFR-6/7"; Unit "stays small enough" |
| NFR-9 bot unchanged | `format.ts` refactor is output-identical | The existing 252 unit tests and 168 integration checks still pass |
