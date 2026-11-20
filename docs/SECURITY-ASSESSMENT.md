# SkyBrief security assessment

**Date:** 20 Nov 2026 · **Version assessed:** commit `5d643d4` plus the sheet-closing fix · **Assessor:** the developer (with AI assistance), not an independent party.

This is a design review plus automated attack tests against a **local copy** of the system. It is a practical check, not a
certified penetration test. For anything stronger (a formal audit, compliance evidence), have an independent tester repeat it.

## 1. Scope

| In scope | Out of scope (not tested) |
|---|---|
| The Cloudflare Worker: `/webhook`, `/setup`, `/api/app/*`, static files, cron code | The **production** deployment: its real secrets, Cloudflare account settings, logs |
| The mini app page (HTML / CSS / JS) and its Content-Security-Policy | Telegram itself, Open-Meteo, MET Norway, WAQI, Nominatim, the DOE feed, data.gov.my |
| The D1 data model and every query | Load and denial-of-service testing |
| Secrets handling, git history, dependencies, CI / deploy workflows | GitHub and Cloudflare account security (2-factor, who has access, branch protection) |
| Logging and what is sent to third parties | Real phones and real Telegram clients |

Nothing was aimed at production or at any third-party service.

## 2. What is worth protecting

| Asset | Why it matters |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Full control of the bot: read and send as the bot to every user |
| `WEBHOOK_SECRET` | Lets its holder speak **as Telegram**: impersonate any user, including an admin (approve users, broadcast to everyone) |
| `ADMIN_IDS`, `WAQI_TOKEN` | Who the admins are; a third-party quota |
| User records (Telegram id, first name, username, saved places, settings) | Personal data. A saved place can reveal where someone lives |
| A signed Mini App session (`initData`) | Acts as that one user for up to 24 hours |
| Availability of the bot | People rely on the morning report and on official warnings |
| The bot's voice | A message or picture "from SkyBrief" is trusted by its users |

## 3. Trust boundaries and how each is defended

```
 Internet ──▶ static files (public/)            no secrets; strict CSP
 Internet ──▶ /api/app/demo                     public, synthetic data, reads nothing
 Mini app ──▶ /api/app/*    ── signed initData (HMAC-SHA256 with the bot token) + status check on every request
 Telegram ──▶ /webhook      ── shared secret header
 Owner    ──▶ /setup        ── key in the URL
 Worker   ──▶ D1            ── bound parameters, fixed column list
 Worker   ──▶ weather / air / warnings / geocoding services (fixed addresses, numbers only)
```

## 4. Threats considered

| # | Threat | Where it is tested |
|---|---|---|
| T1 | Pretending to be a user (forged or replayed session) | SEC-A1, SEC-A2, unit `verifyInitData` |
| T2 | Pretending to be Telegram | SEC-D1, SEC-D2 |
| T3 | Using the app after being blocked; reaching admin functions | SEC-B1, SEC-B3 |
| T4 | Reading or changing someone else's data | SEC-B2, SEC-E2 |
| T5 | Injection: SQL, script, header, prototype keys | SEC-C1, SEC-C2, SEC-F2, code review R1 |
| T6 | Crashing or exhausting the Worker with bad or huge input | SEC-C1, SEC-C3, SEC-C4 |
| T7 | Reading files or internals that should be private | SEC-E1, SEC-E2 |
| T8 | A hostile website acting through the user's browser (CSRF, framing, script injection) | SEC-E4, SEC-F1, SEC-E3 |
| T9 | Leaking data from the device or to third parties | SEC-F3, code review R4 |
| T10 | Leaked secrets (repository, history, bundle, logs) | Recon R2, R3, SEC-E2 |
| T11 | Compromised dependency or build pipeline | Recon R5, R6 |
| T12 | Abuse of the bot's voice or of shared quotas | Code review R7 |

## 5. Tests run

Automated: `tests/e2e/security.e2e.ts` (19 tests, about 700 individual requests) against the real Worker in workerd, plus unit tests in `test/features.test.ts`. Run with `npm run test:e2e`.

| ID | What was attempted | Result |
|---|---|---|
| SEC-A1 | 15 kinds of forged session (no header, wrong scheme, changed hash, extra `user`, another bot's signature, swapped key and message, expired, oversized, null bytes) on all 7 protected endpoints | **Pass**: 401 every time, nothing changed |
| SEC-A2 | Passing the session in the URL, a cookie or the body | **Pass**: only the header counts |
| SEC-B1 | Approve a person, capture their session, block them, replay the same session | **Pass**: 403 on every endpoint at once |
| SEC-B2 | Extra user ids in the query, body and headers | **Pass**: ignored or refused |
| SEC-B3 | Guessing admin addresses; admin chat commands and admin buttons from a non-admin | **Pass**: 404, and no admin answer |
| SEC-C1 | 50 hostile JSON bodies on 4 endpoints (wrong types, `1e309`, NoSQL-style objects, SQL text, script tags, `__proto__`, `constructor`, oversized) | **Failed before the fix** (finding S-01), **pass after** |
| SEC-C2 | SQL, script, path, template and header-injection text in the city search; markup typed into the page | **Pass** |
| SEC-C3 | 2 MB JSON bodies, a 5 MB "picture" | **Pass** (and see S-03) |
| SEC-C4 | A 3 MB picture streamed with no declared length | **Pass** |
| SEC-D1 | Webhook with no / wrong / near-miss secret, secret in the URL, non-JSON, and 10 malformed updates with the right secret | **Pass** |
| SEC-D2 | A non-admin "approving" themselves through a forged button press; a language button whose value is `constructor` | **Failed before the fix** (S-01), **pass after** |
| SEC-D3 | `/setup` with no, empty, wrong or near-miss key | **Pass** |
| SEC-E1 | 24 addresses for private files (`/secrets.json`, `/.dev.vars`, `/.git/config`, `/src/…`, `/wrangler.jsonc`, path-traversal variants) | **Pass**: none served |
| SEC-E2 | Error answers checked for tokens, stack traces, file paths, reflected input; the dashboard checked for fields it should not carry | **Pass** |
| SEC-E3 | Security headers on pages, scripts, fonts, API answers and plain answers | **Failed before the fix** (S-05), **pass after** |
| SEC-E4 | Cross-origin preflight; other HTTP methods | **Pass**: no CORS permission, 404 / 405 |
| SEC-F1 | In the real page: inline script, inline event handler, `eval`, request to another site, image from another site, inline style | **Pass**: the browser blocked all six |
| SEC-F2 | Every text field of the dashboard replaced with a script payload, then every card and sheet opened | **Pass**: shown as text, nothing ran |
| SEC-F3 | What the page stores and which addresses it contacts | **Pass**: no session, token or cookie stored; only its own server and Telegram's script |

Recon and review (by hand):

| ID | Check | Result |
|---|---|---|
| R1 | Every SQL statement | All use bound parameters; column names come from a fixed list, never from input |
| R2 | Git history for secrets (file names, Telegram-token shapes, hard-coded credentials) | None found in any commit |
| R3 | `.gitignore` covers `secrets.json`, `.dev.vars`, `.env*` | Yes |
| R4 | Data sent to third parties | Coordinates and city names to the weather, air and geocoding services; the picture card to Telegram on request. No analytics, no cookies |
| R5 | Dependencies | 0 runtime dependencies; `npm audit`: 0 vulnerabilities in the 6 development packages |
| R6 | CI and deploy workflows | See S-06 |
| R7 | Abuse of shared resources | See S-07, S-08 |
| R8 | Logging | Telegram chat ids and error text are logged; message text, tokens and sessions are not |

One mutation check: removing the session check from a single endpoint made SEC-A1 and SEC-A2 fail; restored, they pass.

## 6. Findings

Severity: **High** = other people's data or the bot can be taken over by an outsider. **Medium** = needs some access or luck, real impact. **Low** = limited impact or self-inflicted. **Info** = worth knowing.

No High findings. No finding lets one user see or change another user's data.

| ID | Severity | Finding | Status |
|---|---|---|---|
| S-01 | Low | **A non-language was accepted as a language.** The check used `in`, which is also true for names every JavaScript object inherits (`constructor`, `toString`). Through the app's settings API or a crafted chat button value, a person could store `constructor` as their own language. Effect: only their own account, which fell back to English with a broken language label. No effect on others. | **Fixed** (`isLang`), tests added |
| S-02 | Medium | **The `/setup` key is the webhook secret, and it travels in a URL.** URLs end up in browser history and in Cloudflare's request logs (logging is switched on in `wrangler.jsonc`). Whoever reads it can send fake Telegram updates: act as any user, or as an admin, and broadcast to everyone. It needs access to the owner's browser or Cloudflare account, hence Medium. | **Mitigated**: optional `SETUP_KEY`. Owner action needed, see section 7 |
| S-03 | Low | **Request bodies were read in full before their size was checked.** A signed-in user could make the Worker hold a very large body in memory. The Worker now stops reading at the limit, even when no length is declared. | **Fixed**, tests added |
| S-04 | Info | **The secret comparison returned early when lengths differed**, revealing the length of the secret through timing. Not practically exploitable over the internet. | **Fixed** |
| S-05 | Low | **No HSTS header; plain-text answers had no `nosniff`.** Now: HSTS (1 year), `Cross-Origin-Resource-Policy`, and `nosniff` / `no-store` on every answer the Worker writes. | **Fixed** |
| S-06 | Low | **CI jobs ran with the repository's default token permissions**, and third-party actions are pinned by tag (`@v5`, `@v3`), not by commit. A compromised action could do more than it needs. | **Partly fixed**: `permissions: contents: read` added. Pinning by commit is left to the owner |
| S-07 | Medium | **No rate limiting in front of the Worker.** Anyone can send requests until the free plan's daily quota is used up, which would stop the bot (reports, warnings) until the next day. An approved user can also repeat city searches to spend the geocoding service's goodwill. The app's own limits (refresh once a minute, share once per 10 s, 5-minute cache) do not protect the quota. | **Open**: needs a Cloudflare setting, see section 7 |
| S-08 | Low | **The share feature sends whatever JPEG the page uploads.** An approved user can bypass the page and make the bot post any picture to their own chat, and get it prepared for sharing "via SkyBrief" with the bot's caption. They could equally forward any picture themselves, but not with the bot's name on it. | **Open, accepted for now**. Options in section 7 |
| S-09 | Low | **A captured session works for up to 24 hours** and cannot be cancelled individually (blocking the user does stop it at once). It is never put in a URL, a cookie or storage, so capturing one needs access to the person's device or to the traffic. | **Accepted**. Can be shortened: `INIT_DATA_MAX_AGE_S` |
| S-10 | Info | **`secrets.json` is on the developer's disk inside a OneDrive-synced folder.** It is ignored by git, but OneDrive copies it to the company cloud. The README says to delete it after uploading the secrets. | **Owner action** |
| S-11 | Info | **Logs contain Telegram chat ids** (a personal identifier) and error text, kept by Cloudflare. No message text, tokens or sessions are logged. | Noted |
| S-12 | Info | **The page must run Telegram's script from `telegram.org`**, without a pinned hash (Telegram updates it in place). If that host were compromised, the page would be too. This is inherent to Telegram Mini Apps. | Noted |
| S-13 | Info | **GPS positions go to OpenStreetMap's Nominatim** to find the place name (rounded to about 11 m), as the chat's "share my location" already did. | Noted; say so in a privacy note if you publish one |

## 7. What the owner should do

In order of value:

1. **Set a separate setup key and rotate the webhook secret (S-02).** The current webhook secret has already been typed into browser address bars.
   ```bash
   npx wrangler secret put SETUP_KEY        # a new random value, used only for /setup
   npx wrangler secret put WEBHOOK_SECRET   # a NEW random value
   ```
   Then open `https://<worker>/setup?key=<SETUP_KEY>` straight away (the bot ignores messages between the two steps).
2. **Add a rate limiting rule in Cloudflare (S-07).** Dashboard → the Worker's zone or `workers.dev` route → Security → WAF → Rate limiting rules. A sensible start: at most 60 requests per minute per IP to `/api/*`, and 300 per minute overall per IP. Availability and pricing of rate limiting depend on your Cloudflare plan; check before relying on it.
3. **Delete `secrets.json`** from the project folder (S-10), and remove it from OneDrive's recycle bin.
4. **Protect the accounts.** Two-factor on GitHub and Cloudflare; a Cloudflare API token limited to this Worker and D1; branch protection on `main`, because every push deploys.
5. **Optional:** pin the GitHub Actions to commit hashes (S-06); decide about S-08.

Options for S-08, if the bot's voice matters to you: (a) leave as is, (b) send the picture without a caption so it carries no bot text, (c) drop the "prepared share" step so the picture only ever goes to the person's own chat, (d) draw the picture on the server (needs the paid plan, see the earlier discussion about image reports).

## 8. What this assessment does not tell you

* Whether the **production** secrets are strong, or who else can read them.
* Whether the real Telegram accepts and rejects sessions exactly as the stand-in used in the tests does.
* How the system behaves under attack traffic or heavy load.
* Anything about the security of Telegram, Cloudflare or the data providers.
* It was done by the same party that wrote the code. Two of my own test expectations were wrong on the first run and looked like vulnerabilities until checked (an approval I had sent as the admin; a valid request I expected to be refused). An independent tester would bring a different set of blind spots.
