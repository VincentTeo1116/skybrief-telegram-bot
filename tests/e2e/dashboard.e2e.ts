/**
 * The mini app end to end against the REAL Worker: sign-in, the dashboard's content, changing location, and every
 * fallback in docs/FALLBACKS.md. The mock weather reports: Kuala Lumpur, 28°, partly cloudy, AQI 62, and an active
 * MetMalaysia thunderstorm warning that names Kuala Lumpur.
 */
import { expect, test } from "@playwright/test";
import { ACTIVE, PENDING, STRANGER, axe, healthyMock, openApp, ready, setMock, signInitData, SHOTS } from "./helpers";

// Start from a known state whatever an earlier run left behind: healthy services, the test user in Kuala Lumpur.
test.beforeAll(async ({ request }) => {
  await healthyMock();
  const res = await request.post("/api/app/place", { headers: { authorization: `tma ${signInitData(ACTIVE)}` }, data: { preset: 0 } });
  expect(res.status()).toBe(200);
});
test.beforeEach(async () => {
  await healthyMock();
});
test.afterAll(async () => {
  await healthyMock();
});

// ------------------------------------------------------------------ who gets in (NFR-1, F1-F3)
test("F1 outside Telegram: a plain explanation, and the API is never called", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => r.url().includes("/api/") && calls.push(r.url()));
  await openApp(page);
  await expect(page.locator("#gate-title")).toHaveText("This dashboard opens inside Telegram.");
  await expect(page.locator("#gate-hint")).toContainText("/app");
  await expect(page.locator("#app")).toBeHidden();
  expect(calls).toEqual([]);
});

test("F2 a tampered or foreign signature is refused", async ({ page, request }) => {
  const good = signInitData(ACTIVE);
  const cases = {
    "changed user id": good.replace(`%22id%22%3A${ACTIVE}`, `%22id%22%3A${ACTIVE + 1}`),
    "signed with another bot's token": signInitData(ACTIVE, { token: "another-bot" }),
    "two days old": signInitData(ACTIVE, { ageSeconds: 2 * 86400 }),
    "no hash": good.replace(/&hash=[0-9a-f]+/, ""),
    garbage: "hello",
  };
  for (const [name, initData] of Object.entries(cases)) {
    const res = await request.get("/api/app/dashboard", { headers: { authorization: `tma ${initData}` } });
    expect(res.status(), name).toBe(401);
    expect((await res.json()).error.code, name).toBe("unauthorized");
  }
  expect((await request.get("/api/app/dashboard", { headers: { authorization: `tma ${good}` } })).status(), "the untouched one works").toBe(200);

  await openApp(page, { initData: cases["changed user id"], userId: ACTIVE });
  await expect(page.locator("#gate-title")).toContainText("session has expired");
  await expect(page.locator("#app")).toBeHidden();
});

test("F3 people who are not approved users get a reason and no data", async ({ page, request }) => {
  const stranger = await request.get("/api/app/dashboard", { headers: { authorization: `tma ${signInitData(STRANGER)}` } });
  expect(stranger.status()).toBe(403);
  expect(await stranger.json()).toEqual({ error: { code: "not_registered", message: expect.stringContaining("/start") } });
  const pending = await request.get("/api/app/dashboard", { headers: { authorization: `tma ${signInitData(PENDING)}` } });
  expect(pending.status()).toBe(403);
  expect((await pending.json()).error.code).toBe("pending");
  // the other endpoints are closed too
  expect((await request.get("/api/app/places?q=ipoh", { headers: { authorization: `tma ${signInitData(PENDING)}` } })).status()).toBe(403);
  expect((await request.post("/api/app/place", { headers: { authorization: `tma ${signInitData(STRANGER)}` }, data: { preset: 1 } })).status()).toBe(403);

  await openApp(page, { userId: PENDING });
  await expect(page.locator("#gate-title")).toContainText("waiting for the admin");
  await expect(page.locator("#gate-retry")).toBeHidden();
});

// ------------------------------------------------------------------ the dashboard (FR-2 .. FR-8)
test("FR-2..8 an approved user sees their weather, air quality, forecast and warnings", async ({ page }) => {
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);

  // FR-2 current weather
  await expect(page.locator("#place-name")).toHaveText("Kuala Lumpur, Malaysia");
  await expect(page.locator("h1")).toHaveText("Weather in Kuala Lumpur, Malaysia");
  await expect(page.locator("#now-temp")).toHaveText("28°");
  await expect(page.locator("#now-unit")).toHaveText("C");
  await expect(page.locator("#now-cond")).toHaveText("Partly cloudy");
  await expect(page.locator("#now-sub")).toContainText("Feels like 33°");
  await expect(page.locator("#now-sub")).toContainText("↑ 33°");
  await expect(page.locator("#now-sub")).toContainText("↓ 25°");
  await expect(page.locator("#now-trend")).toHaveText("3° warmer than yesterday");

  // FR-3 the sky follows the data (day or night depends on the real clock)
  await expect(page.locator("#sky")).toHaveAttribute("data-scene", /^partly-(day|night)$/);

  // FR-8 official warning, through the real MetMalaysia pipeline
  await expect(page.locator("#warnings")).toContainText("Official warnings");
  await expect(page.locator("#warnings .warn-name")).toHaveText("Thunderstorms Warning");
  await expect(page.locator("#warnings")).toContainText("Kuala Lumpur");
  await expect(page.locator("#warnings")).toContainText("MetMalaysia");

  // FR-5 hourly
  await expect(page.locator("#rainline")).toHaveText("No rain expected in the next 6 hours");
  await expect(page.locator("#hours .hour")).toHaveCount(24);
  await expect(page.locator("#hours .hour").first()).toContainText("Now");

  // FR-4 air quality
  await expect(page.locator("#aqi-value")).toContainText("62");
  await expect(page.locator("#aqi-label")).toHaveText("Moderate");
  await expect(page.locator("#air")).toContainText("PM2.5 20 µg/m³");
  await expect(page.locator("#air")).toContainText("Rising: peak ~92");
  await expect(page.locator("#aqi-note")).toContainText("official API (IPU)");

  // FR-6 forecast: 3 days first, 7 on request, remembered
  await expect(page.locator("#days .day")).toHaveCount(3);
  await expect(page.locator("#days .day").first()).toContainText("Today");
  await page.locator("#days-7").click();
  await expect(page.locator("#days .day")).toHaveCount(7);
  await expect(page.locator("#days-7")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await ready(page);
  await expect(page.locator("#days .day")).toHaveCount(7);
  await page.locator("#days-3").click();
  await expect(page.locator("#days .day")).toHaveCount(3);

  // FR-7 details, best time, tips
  for (const text of ["Humidity", "78%", "12 km/h NE", "Gusts 20 km/h", "UV index", "Very high", "1009 hPa", "7:01 AM", "7:12 PM"]) {
    await expect(page.locator("#details")).toContainText(text);
  }
  await expect(page.locator("#best")).toContainText("Best time outside");
  await expect(page.locator("#best .tips li").first()).toBeVisible();
  await expect(page.locator("#source")).toContainText("Weather: Open-Meteo");

  expect(await page.evaluate(() => (window as any).__tg.header), "Telegram's header takes the sky colour").toMatch(/^#[0-9a-f]{6}$/);
  expect(await axe(page)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/real-dashboard-390.png`, fullPage: true });
});

test("NFR-5 Telegram's dark theme wins over the system setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page, { userId: ACTIVE, scheme: "dark" });
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(11, 17, 32)");
  expect(await axe(page)).toEqual([]);
});

// ------------------------------------------------------------------ change location (FR-9, F9, F10)
test("FR-9 search for a city, save it, and switch back with a shortcut", async ({ page }) => {
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#place-btn").click();
  const sheet = page.locator("#sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("#sheet-title")).toHaveText("Change location");
  await expect(sheet.locator("#shortcuts .choice")).toHaveCount(10);
  expect(await page.evaluate(() => (window as any).__tg.back), "Telegram's back button is shown").toBe(true);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/sheet-390.png` });

  // too short: told how to fix it, nothing sent
  await sheet.locator("#search-input").fill("i");
  await sheet.locator("#search-btn").click();
  await expect(sheet.locator("#sheet-status")).toHaveText("Type at least 2 letters.");

  // nothing found
  await sheet.locator("#search-input").fill("zzzzzz");
  await sheet.locator("#search-input").press("Enter");
  await expect(sheet.locator("#sheet-status")).toContainText("No place found");

  // found: pick it
  await sheet.locator("#search-input").fill("ipoh");
  await sheet.locator("#search-btn").click();
  await expect(sheet.locator("#results .choice")).toHaveText(["Ipoh, Perak, Malaysia"]);
  await sheet.locator("#results .choice").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("Location saved");
  await expect(page.locator("#place-name")).toHaveText("Ipoh, Malaysia");

  // it really is saved on the server (the bot will use it too)
  await page.reload();
  await ready(page);
  await expect(page.locator("#place-name")).toHaveText("Ipoh, Malaysia");

  // and back with a one-tap shortcut
  await page.locator("#place-btn").click();
  await sheet.locator("#shortcuts .choice", { hasText: "Kuala Lumpur" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#place-name")).toHaveText("Kuala Lumpur, Malaysia");
  expect(errors).toEqual([]);
});

test("FR-9 the page can only choose from the list: bad requests are refused", async ({ request }) => {
  const headers = { authorization: `tma ${signInitData(ACTIVE)}` };
  const bodies: unknown[] = [{ preset: 99 }, { preset: -1 }, { pick: 7 }, { pick: "0" }, { saved: 9 }, { saved: -1 }, { lat: 91, lon: 2 }, { lat: 3, lon: 181 }, { lat: "3.1", lon: "101.7" }, { lat: 3.1 }, { name: "Evil" }, {}, [], "x".repeat(500)];
  for (const data of bodies) {
    const res = await request.post("/api/app/place", { headers, data });
    expect(res.status(), JSON.stringify(data).slice(0, 40)).toBe(400);
  }
  expect((await request.get("/api/app/places?q=" + "a".repeat(80), { headers })).status()).toBe(400);
  const hostile = await request.get("/api/app/places?q=" + encodeURIComponent("<script>alert(1)</script>'; DROP TABLE users;--"), { headers });
  expect(hostile.status()).toBe(200);
  expect(await hostile.json()).toEqual({ results: [] });
  const still = await (await request.get("/api/app/dashboard", { headers })).json();
  expect(still.place).toBe("Kuala Lumpur, Malaysia");
});

test("F9 city search unavailable: a message, the sheet stays open, the typed text is kept", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#place-btn").click();
  await page.route("**/api/app/places**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "search_unavailable", message: "City search is unavailable right now. Please try again shortly." } }) }));
  await page.locator("#search-input").fill("penang");
  await page.locator("#search-btn").click();
  await expect(page.locator("#sheet-status")).toContainText("City search is unavailable");
  await expect(page.locator("#sheet")).toBeVisible();
  await expect(page.locator("#search-input")).toHaveValue("penang");
});

test("F10 saving fails when the weather can't be checked: nothing changes", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await setMock({ forecastDown: true });
  await page.locator("#place-btn").click();
  await page.locator("#shortcuts .choice", { hasText: "Ipoh" }).click();
  await expect(page.locator("#sheet-status")).toContainText("couldn't reach the weather service");
  await expect(page.locator("#sheet")).toBeVisible();
  await page.locator("#sheet-close").click();
  await expect(page.locator("#place-name")).toHaveText("Kuala Lumpur, Malaysia");
  await healthyMock();
  await page.reload();
  await ready(page);
  await expect(page.locator("#place-name")).toHaveText("Kuala Lumpur, Malaysia");
});

// ------------------------------------------------------------------ weather failures (F4, F5, F8)
test("F4 Open-Meteo down: the backup source answers and the page says so", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await setMock({ forecastDown: true });
  await page.locator("#refresh-btn").click();
  await expect(page.locator("#source")).toContainText("MET Norway (backup source)");
  await expect(page.locator("#stale-banner")).toHaveCount(0);
  await healthyMock();
  await page.locator("#refresh-btn").click();
  await expect(page.locator("#source")).toContainText("Weather: Open-Meteo");
  await expect(page.locator("#toast")).toHaveText("Updated");
});

test("F5 both sources down: saved data stays, clearly labelled, and recovers on retry", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await setMock({ forecastDown: true, metnoDown: true });
  await page.locator("#refresh-btn").click();
  await expect(page.locator("#stale-banner")).toContainText("Showing saved data from");
  await expect(page.locator("#now-temp")).toHaveText("28°"); // still there
  await page.screenshot({ path: `${SHOTS}/stale-390.png` });
  await healthyMock();
  await page.locator("#stale-retry").click();
  await expect(page.locator("#stale-banner")).toHaveCount(0);
});

test("F5/F8 first visit with nothing saved and no connection: an error screen with Try again", async ({ page }) => {
  let block = true;
  await page.route("**/api/app/dashboard**", (r) => (block ? r.abort() : r.continue()));
  await openApp(page, { userId: ACTIVE });
  await expect(page.locator("#gate-title")).toContainText("couldn't load the weather", { timeout: 15000 });
  await expect(page.locator("#gate-retry")).toHaveText("Try again");
  await page.screenshot({ path: `${SHOTS}/error-390.png` });
  block = false;
  await page.locator("#gate-retry").click();
  await ready(page);
  await expect(page.locator("#now-temp")).toHaveText("28°");
});

test("F8 offline on a later visit: the saved copy is shown and labelled", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page); // this visit saves a copy on the device
  await page.route("**/api/app/dashboard**", (r) => r.abort());
  await page.reload();
  await expect(page.locator("#now-temp")).toHaveText("28°");
  await expect(page.locator("#stale-banner")).toContainText("Showing saved data", { timeout: 15000 });
});

test("F8 a malformed answer is treated as a failure, never drawn", async ({ page }) => {
  await page.route("**/api/app/dashboard**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, place: "<img src=x onerror=alert(1)>", now: {} }) }));
  await openApp(page, { userId: ACTIVE });
  await expect(page.locator("#gate-retry")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#app")).toBeHidden();
});

test("NFR-1 someone who loses access no longer sees the saved copy", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("skybrief.dash")).length)).toBe(1);
  await page.route("**/api/app/dashboard**", (r) => r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "denied", message: "You don't have access to this dashboard." } }) }));
  await page.reload();
  await expect(page.locator("#gate-title")).toHaveText("You don't have access to this dashboard.");
  await expect(page.locator("#app")).toBeHidden();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("skybrief.dash")).length)).toBe(0);
});

test("NFR-6 text from the server is never run as HTML", async ({ page }) => {
  await page.route("**/api/app/dashboard**", async (r) => {
    const res = await r.fetch();
    const d = await res.json();
    d.place = '<img src=x onerror="window.__xss=1">';
    d.now.cond = "<script>window.__xss=1</script>";
    d.tips = ['<b onclick="window.__xss=1">tip</b>'];
    await r.fulfill({ response: res, json: d });
  });
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await expect(page.locator("#place-name")).toHaveText('<img src=x onerror="window.__xss=1">');
  expect(await page.locator("#place-name img, #now-cond script, #best b").count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

// ------------------------------------------------------------------ environment (F11, F12)
test("F11 storage blocked: the page still works", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
  });
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#days-7").click();
  await expect(page.locator("#days .day")).toHaveCount(7);
  expect(errors).toEqual([]);
});

test("F12 JavaScript off: a plain message", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/app/");
  await expect(page.locator(".noscript")).toContainText("needs JavaScript");
  await context.close();
});

// ------------------------------------------------------------------ keyboard (NFR-4)
test("NFR-4 keyboard: skip link first, visible focus, the sheet opens and closes and returns focus", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#place-btn")).toBeFocused();
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(page.locator("#sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#sheet")).toBeHidden();
  await expect(page.locator("#place-btn")).toBeFocused();
  // every stop on the way down has a visible outline
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const o = await page.evaluate(() => ({ tag: document.activeElement?.tagName, style: getComputedStyle(document.activeElement!).outlineStyle }));
    if (o.tag !== "BODY") expect(o.style, `stop ${i} (${o.tag})`).not.toBe("none");
  }
});

// ------------------------------------------------------------------ server basics (NFR-6, NFR-7)
test("NFR-6/7 headers, JSON 404, and no secrets in what the browser receives", async ({ request }) => {
  const page = await request.get("/app/");
  const h = page.headers();
  expect(h["content-security-policy"]).toContain("default-src 'none'");
  expect(h["content-security-policy"]).toContain("script-src 'self' https://telegram.org");
  expect(h["content-security-policy"]).not.toContain("unsafe");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");

  const missing = await request.get("/api/app/__nope__");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
  expect(await missing.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
  expect((await request.post("/api/app/dashboard")).status()).toBe(405);

  const api = await request.get("/api/app/dashboard", { headers: { authorization: `tma ${signInitData(ACTIVE)}` } });
  expect(api.headers()["cache-control"]).toBe("no-store");
  let shipped = await api.text();
  for (const file of ["/app/", "/app/app.js", "/app/scene.js", "/app/boot-strings.js", "/app/app.css"]) shipped += await (await request.get(file)).text();
  for (const secret of ["testtoken", "e2e_secret", "waqitest"]) expect(shipped.includes(secret), secret).toBe(false);
  expect(shipped.length, "app shell + one dashboard").toBeLessThan(140_000);
});
