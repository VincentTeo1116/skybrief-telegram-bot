# Verification record (20 Nov 2026)

All of this was run on the developer machine (Windows 11, Node 24, installed Chrome). Nothing was deployed.

## What was run

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | Pass |
| Unit tests | `npm test` | 294 passed, 6 skipped (the live-internet tests). 252 existed before; 42 are new (`test/miniapp.test.ts`) |
| Bot integration (real Worker in workerd, mock services) | `npm run test:integration` | 177 passed, 0 failed. 168 existed before; 9 are new mini app entry-point checks |
| Browser tests (real Worker, Chrome) | `npm run test:e2e` | 74 passed |
| Dependency audit | `npm audit` | 0 vulnerabilities |
| Deploy dry run | `npx wrangler deploy --dry-run` | Bundles; assets directory and `ASSETS` binding recognised |
| Size | `wc -c public/app/*` | 75.7 KB uncompressed (budget 100 KB) |

## Requirements

| ID | Status | Evidence |
|---|---|---|
| FR-1 | Verified locally | Integration: button URL, last row, `/app`, command menu, `/setup?menu=app|commands`. Not exercised in a real Telegram client |
| FR-2 | Verified | E2E through the real Worker: place, 28°, condition, feels-like, high/low, trend |
| FR-3 | Verified | Six scenes: correct sky, two canvas frames differ; still frame under reduce-motion. Looked at by eye (see below) |
| FR-4 | Verified | AQI 62 / Moderate / PM2.5 / outlook / IPU note in E2E; station and "unavailable" cases in unit tests |
| FR-5 | Verified | 24 hours, rain sentence |
| FR-6 | Verified | 3 ↔ 7 days, remembered across reload |
| FR-7 | Verified | All tiles, best time, tips |
| FR-8 | Verified | Warning from the mock MetMalaysia feed reaches the page through the real pipeline |
| FR-9 | Verified | Search, pick, saved on the server, shortcut back; hostile and out-of-range requests refused |
| FR-10 | Partly | Units, clock and language verified in unit tests; language also in the browser via the demo. A real user switching language in the chat and then opening the app was not run end to end |
| FR-11 | Verified | Six scenes, labelled, unknown scene refused |
| NFR-1 | Verified | Tampered / foreign / expired / missing signatures → 401; stranger and pending → 403; saved copy removed on refusal |
| NFR-2 | Verified, except F7 and F13 "no canvas" | F1–F5, F8–F12 in the browser; F6, F7 (builder side) and F14 in unit tests. F7 was not broken end to end; "browser without canvas" was not simulated |
| NFR-3 | Verified | 28 size tests (320, 375, 667×375, 768, 1024, 1440, 1920 × storm, sunny, gate, 404): no sideways scroll, targets ≥ 44 px, blocks ≤ 960 px wide; 200% text |
| NFR-4 | Verified (automated + keyboard) | axe clean on every scene, the real dashboard, the sheet, 404 and gate, light and dark; keyboard walk. No screen-reader session was done |
| NFR-5 | Verified | Dark scans; Telegram's theme overrides the system |
| NFR-6 | Verified | CSP and headers; no secret strings in anything the browser receives; injected markup rendered as text |
| NFR-7 | Verified | 404 page with status 404 and `noindex`; JSON 404 and 405 under `/api/` |
| NFR-8 | Verified | 75.7 KB; a dashboard load makes at most 4 outgoing requests by construction (forecast, air model, WAQI, warnings), usually 0 when cached. Not measured on the deployed Worker |
| NFR-9 | Verified | All earlier tests pass unchanged apart from one command list in `i18n-coverage.test.ts` |

## Bugs the tests found (all fixed)

1. **Page scrolled sideways on every screen.** The visually hidden labels inside the hourly strip were positioned against the page, not the strip. Fixed with `position: relative` on the strip and cards.
2. **200% text overflowed.** Forecast rows, the 3/7-day switch, detail tiles and the warning header now wrap.
3. **The place name changed between saving and the next visit** ("Ipoh, Perak, Malaysia" then "Ipoh, Malaysia"). The save answer now uses the stored label.
4. **An unrounded number** (`0.23199999999999998`) in the scene data.
5. An empty slot in the Details grid (5 tiles in 2 columns) seen in a screenshot; the sunrise/sunset tile is now a normal tile.

## Mutation checks (do the tests really fail?)

| Rule broken on purpose | Tests that failed | Restored |
|---|---|---|
| Signature comparison removed | "refuses anything that was changed after signing", "refuses a session signed by another bot" | Yes, green |
| Pending users let in | E2E "F3 people who are not approved users…" | Yes, green |
| Session age check removed | "refuses old sessions and sessions dated in the future" | Yes, green |

## Screenshots looked at by eye

`test-results/shots/`: storm light 390, sunny dark 390, windy light 390, storm 320, sunny 1440, text at 200%, the
location sheet. Checked: hierarchy, clipping, overlap, contrast of text over the sky. Not viewed individually: the
remaining generated screenshots (about 40).

## v2.4 (settings, saved places, GPS, official IPU, day details, hourly chart, share card)

Run on the same machine on 20 Nov 2026 after the v2.4 changes. Nothing was deployed.

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | 319 passed, 7 skipped (live). 25 new in `test/features.test.ts` |
| `npm run test:integration` | 177 passed, 0 failed (the chat's settings and language code now go through `settings.ts`) |
| `npm run test:e2e` | 96 passed. 21 new in `tests/e2e/features.e2e.ts` |
| Live IPU feed (`LIVE=1 npx vitest run test/live.test.ts -t IPU`) | Passed: more than 40 stations parsed, a fresh reading within 40 km of Kuala Lumpur, none for Singapore |
| Size | 116 KB uncompressed, over the original 100 KB budget; the budget was raised to 130 KB and the reason recorded in NFR-8 |

| ID | Status | Evidence |
|---|---|---|
| FR-12 | Verified | Chips switch places, order stays put, five at most, removal, active place protected, failure leaves everything as it was |
| FR-13 | Verified locally | Every control exercised in the browser; values confirmed through the API; the chat is messaged on a language change; invalid changes refused whole. Not checked: a real daily report arriving at a time set in the app |
| FR-14 | Verified | Mock feed end to end (Cheras 63, Tasek Ipoh 44 after switching place); real feed parsed in the live test |
| FR-15 | Verified | Open, close, one at a time, keyboard, stays open when the list grows |
| FR-16 | Verified | 24 points, aligned with the first column, no chart when temperatures are unknown. Looked at in screenshots |
| FR-17 | Partly | Telegram's location service and the browser's were both simulated, as was a refusal. **No real device GPS, and no real Telegram permission prompt** |
| FR-18 | Partly | The card is drawn (viewed: sunny, storm, real data), a real JPEG of 30-700 KB reaches the mock Telegram as a file upload, the prepared-message request has the right shape, and each fallback works. **Never sent to the real Telegram**: `sendPhoto` and `savePreparedInlineMessage` are untested against the real Bot API |

Mutation checks (rule broken on purpose → test that failed → restored green):

| Rule | Failed test |
|---|---|
| Unknown settings keys allowed | unit "refuses the whole change when any part is unknown or invalid" |
| Stale IPU readings accepted | unit "no station within reach, a stale reading…" |
| GPS coordinate range not checked | E2E "the server names the place itself and refuses impossible coordinates" |
| JPEG check removed | E2E "only a JPEG of a sensible size is accepted" |
| Active place may be removed | E2E "at most five; bad indexes and removing the active place are refused" |

Bugs found and fixed in v2.4: the header overflowed at 200% text once it had three buttons (they now drop to their own row); the share card's degree sign was drawn at full size, the low/high numbers touched, and clouds reduced the contrast of the place name; one test of mine expected 89°F where the correct afternoon mean is 87°F (the code was right).

Screenshots viewed: storm dashboard 390 px, settings sheet, day detail, share cards (sunny, storm, real data).

Additional items **not verified** in v2.4:

* Sharing, GPS and the language message against the **real Telegram** (see FR-17, FR-18 above). `Telegram.WebApp.shareMessage`, `LocationManager` and `savePreparedInlineMessage` were used as documented by Telegram, from memory; none was run against the real thing.
* The IPU source is undocumented (A11). It works today; that says nothing about tomorrow.
* The 10-second share limit is per Worker instance, so on Cloudflare (many instances) it is weaker than in the test.
* The migration `0004_places.sql` was applied to local databases only.

## Not verified

* **Inside a real Telegram client.** The page was driven with a stand-in for Telegram's script. Real `initData`, the back
  button, haptics, the header colour, Telegram's theme events and the Telegram Web frame (`frame-ancestors`) have not been
  tried on Android, iOS or desktop.
* **A signature produced by Telegram itself.** The check follows Telegram's published algorithm and agrees with a second
  implementation written with Node's crypto, but no real Telegram-signed sample was available.
* **Production.** Not deployed; `_headers` and asset serving were verified in `wrangler dev` only.
* **Real phones.** Animation smoothness and battery use on low-end devices were not measured. No Lighthouse run.
* **Windy and fog on live data.** The scene rule is unit-tested and the drawing was checked with demo data.
* **Malay and Chinese wording** for the new `app_*` texts has not been reviewed by a native speaker.
* **CI** still runs type check and unit tests only; the browser tests need Chrome and are run locally.

## Independence of the evidence

Most tests were written by the same person who wrote the code, while looking at the fixture data, so they prove
consistency rather than independent correctness. The exceptions: the fixed signature vector (computed separately with
Node's crypto), the E2E signer (a second implementation), and the pre-existing bot tests.
