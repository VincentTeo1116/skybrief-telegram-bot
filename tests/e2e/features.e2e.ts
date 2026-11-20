/**
 * The v2.4 features end to end against the REAL Worker: settings (FR-13), saved places (FR-12), GPS (FR-17),
 * the official IPU (FR-14), day details (FR-15), the hourly chart (FR-16) and the picture card (FR-18),
 * each with its failure path.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACTIVE, PENDING, axe, healthyMock, openApp, ready, setMock, setTelegram, signInitData, SHOTS, smallTargets, telegramCalls } from "./helpers";

const auth = () => ({ authorization: `tma ${signInitData(ACTIVE)}` });
const DEFAULTS = { lang: "en", tempUnit: "c", windUnit: "kmh", clock: "auto", dailyOn: true, dailyTime: "08:30", eveningOn: false, rainAlerts: false, aqiAlert: 0, warningsOn: true };
const fakeJpeg = (size = 4000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dashboard = async (request: APIRequestContext) => (await request.get("/api/app/dashboard", { headers: auth() })).json();

/** Known state: default settings, Kuala Lumpur active, no other saved places. */
async function reset(request: APIRequestContext) {
  await healthyMock();
  await setTelegram({ photoDown: false, prepareDown: false });
  expect((await request.post("/api/app/settings", { headers: auth(), data: DEFAULTS })).status()).toBe(200);
  expect((await request.post("/api/app/place", { headers: auth(), data: { preset: 0 } })).status()).toBe(200);
  for (let guard = 0; guard < 8; guard++) {
    const d = await dashboard(request);
    const extra = d.places.findIndex((p: { active: boolean }) => !p.active);
    if (extra < 0) break;
    expect((await request.post("/api/app/place/remove", { headers: auth(), data: { saved: extra } })).status()).toBe(200);
  }
}

test.beforeEach(async ({ request }) => {
  await reset(request);
});
test.afterAll(async ({ request }) => {
  await reset(request);
});

// ------------------------------------------------------------------ FR-13 settings
test("FR-13 settings: units, clock and language change the dashboard at once", async ({ page }) => {
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#settings-btn").click();
  const sheet = page.locator("#settings");
  await expect(sheet.locator("#settings-title")).toHaveText("Settings");
  expect(await axe(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/settings-390.png` });

  await sheet.getByRole("button", { name: "°F" }).click();
  await expect(sheet.locator("#settings-status")).toHaveText("Saved");
  await expect(page.locator("#now-temp")).toHaveText("83°");
  await expect(page.locator("#now-unit")).toHaveText("F");
  await expect(sheet.getByRole("button", { name: "°F" })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("button", { name: "°F" })).toBeFocused(); // keyboard users keep their place

  await sheet.getByRole("button", { name: "mph" }).click();
  await expect(page.locator("#details")).toContainText("7 mph");
  await sheet.getByRole("button", { name: "24-hour" }).click();
  await expect(page.locator("#details")).toContainText("07:01");

  const before = (await telegramCalls()).length;
  await sheet.getByRole("button", { name: "中文" }).click();
  await expect(sheet.locator("#settings-title")).toHaveText("设置");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page.locator("#now-cond")).toHaveText("局部多云");
  // the chat is told too, so its bottom keyboard and command menu follow
  const after = (await telegramCalls()).slice(before);
  expect(after.some((c) => c.method === "sendMessage" && c.text.includes("语言已切换为中文"))).toBe(true);
  expect(after.some((c) => c.method === "setMyCommands")).toBe(true);

  await sheet.getByRole("button", { name: "English" }).click();
  await expect(sheet.locator("#settings-title")).toHaveText("Settings");
  await sheet.getByRole("button", { name: "°C" }).click();
  await expect(page.locator("#now-temp")).toHaveText("28°");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.locator("#settings-btn")).toBeFocused();
  expect(errors).toEqual([]);
});

test("FR-13 settings: reports and alerts are saved for the bot", async ({ page, request }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#settings-btn").click();
  const sheet = page.locator("#settings");

  const evening = sheet.getByRole("switch", { name: "Evening report (tomorrow's outlook)" });
  await expect(evening).toHaveAttribute("aria-checked", "false");
  await expect(sheet.locator('input[type="time"]')).toHaveCount(1); // only the morning report is on
  await evening.click();
  await expect(sheet.getByRole("switch", { name: "Evening report (tomorrow's outlook)" })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.locator('input[type="time"]')).toHaveCount(2);
  await sheet.getByLabel("Evening report (tomorrow's outlook): Time").fill("19:30");
  await sheet.getByLabel("Evening report (tomorrow's outlook): Time").blur();
  await expect(sheet.locator("#settings-status")).toHaveText("Saved");

  await sheet.getByRole("switch", { name: "Rain alerts" }).click();
  await expect(sheet.getByRole("switch", { name: "Rain alerts" })).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("button", { name: "151+" }).click();
  await expect(sheet.getByRole("button", { name: "151+" })).toHaveAttribute("aria-pressed", "true");

  // official warnings off: the warning card goes away, exactly as in the chat report
  await expect(page.locator("#warnings")).toHaveCount(1);
  await sheet.getByRole("switch", { name: "Official warnings" }).click();
  await expect(sheet.getByRole("switch", { name: "Official warnings" })).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#warnings")).toHaveCount(0);

  const saved = (await dashboard(request)).settings;
  expect(saved).toMatchObject({ eveningOn: true, eveningTime: "19:30", rainAlerts: true, aqiAlert: 151, warningsOn: false, dailyOn: true, dailyTime: "08:30" });
});

test("FR-13 settings: a failed save says so and puts the control back", async ({ page, request }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#settings-btn").click();
  await page.route("**/api/app/settings", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "server_error", message: "Something went wrong on my side. Please try again." } }) }));
  await page.locator("#settings").getByRole("button", { name: "°F" }).click();
  await expect(page.locator("#settings-status")).toHaveText("Something went wrong on my side. Please try again.");
  await expect(page.locator("#settings").getByRole("button", { name: "°C" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#now-temp")).toHaveText("28°");
  expect((await dashboard(request)).settings.tempUnit).toBe("c");
});

test("FR-13 settings: only known settings with valid values are accepted", async ({ request }) => {
  const bad: unknown[] = [{ tempUnit: "k" }, { windUnit: "knots" }, { clock: "13" }, { lang: "fr" }, { dailyTime: "25:00" }, { dailyTime: 830 }, { eveningTime: "7pm" }, { aqiAlert: 120 }, { dailyOn: "yes" }, { status: "active" }, { tempUnit: "f", chatId: 1 }, {}, [], "x".repeat(400)];
  for (const data of bad) expect((await request.post("/api/app/settings", { headers: auth(), data })).status(), JSON.stringify(data).slice(0, 40)).toBe(400);
  expect((await dashboard(request)).settings).toMatchObject(DEFAULTS); // nothing half-applied
  expect((await request.post("/api/app/settings", { headers: { authorization: `tma ${signInitData(PENDING)}` }, data: { tempUnit: "f" } })).status()).toBe(403);
  expect((await request.post("/api/app/settings", { data: { tempUnit: "f" } })).status()).toBe(401);
});

// ------------------------------------------------------------------ FR-12 saved places, FR-14 official IPU
test("FR-12/14 saved places: chips switch with one tap; the official IPU follows the place", async ({ page, request }) => {
  await request.get("/api/app/places?q=ipoh", { headers: auth() });
  await request.post("/api/app/place", { headers: auth(), data: { pick: 0 } });
  await request.post("/api/app/place", { headers: auth(), data: { preset: 0 } });

  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  const chips = page.locator("#place-chips .chip");
  await expect(chips).toHaveText(["Kuala Lumpur", "Ipoh"]);
  await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "true");

  // FR-14: Kuala Lumpur's nearest Department of Environment station
  await expect(page.locator("#ipu")).toContainText("Malaysia API (IPU)");
  await expect(page.locator("#ipu-value")).toHaveText("63");
  await expect(page.locator("#ipu-label")).toHaveText("Moderate");
  await expect(page.locator("#ipu-station")).toContainText("Cheras station");
  await expect(page.locator("#ipu")).toContainText("Department of Environment");

  await chips.nth(1).click();
  await expect(page.locator("#place-name")).toHaveText("Ipoh, Malaysia");
  await expect(page.locator("#place-chips .chip").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#place-chips .chip")).toHaveText(["Kuala Lumpur", "Ipoh"]); // the order does not jump
  await expect(page.locator("#ipu-value")).toHaveText("44");
  await expect(page.locator("#ipu-station")).toContainText("Tasek Ipoh station");
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/places-390.png` });

  // forget one from the sheet; the place you are at can't be removed
  await page.locator("#place-btn").click();
  await expect(page.locator("#saved .saved-row")).toHaveCount(2);
  await expect(page.locator("#saved .saved-row").nth(1)).toContainText("Current");
  await expect(page.getByRole("button", { name: "Remove Ipoh" })).toHaveCount(0); // you can't remove where you are
  await page.getByRole("button", { name: "Remove Kuala Lumpur" }).click();
  await expect(page.locator("#sheet-status")).toHaveText("Removed");
  await expect(page.locator("#saved-block")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#place-chips")).toBeHidden();
  expect((await dashboard(request)).places).toEqual([{ name: "Ipoh", label: "Ipoh, Malaysia", active: true, home: false }]);
  expect(errors).toEqual([]);
});

test("FR-12 saved places: at most five; bad indexes and removing the active place are refused", async ({ request }) => {
  for (const preset of [1, 2, 3, 4, 5, 6]) expect((await request.post("/api/app/place", { headers: auth(), data: { preset } })).status()).toBe(200);
  const d = await dashboard(request);
  expect(d.places).toHaveLength(5);
  expect(d.places[0]).toMatchObject({ name: "Melaka", active: true }); // newest first
  expect(d.places.some((p: { name: string }) => p.name === "Kuala Lumpur")).toBe(false); // the oldest dropped out
  for (const data of [{ saved: 0 }, { saved: 5 }, { saved: -1 }, { saved: "1" }, {}]) {
    expect((await request.post("/api/app/place/remove", { headers: auth(), data })).status(), JSON.stringify(data)).toBe(400);
  }
  expect((await dashboard(request)).places).toHaveLength(5);
});

test("FR-12 saved places: when the weather can't be loaded, nothing changes", async ({ page }) => {
  await page.request.post("/api/app/place", { headers: auth(), data: { preset: 5 } }); // Ipoh
  await page.request.post("/api/app/place", { headers: auth(), data: { preset: 0 } });
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.route("**/api/app/place", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "weather_unavailable", message: "I couldn't reach the weather service. Please try again in a moment." } }) }));
  await page.locator("#place-chips .chip", { hasText: "Ipoh" }).click();
  await expect(page.locator("#toast")).toContainText("couldn't reach the weather service");
  await expect(page.locator("#place-name")).toHaveText("Kuala Lumpur, Malaysia");
  await expect(page.locator("#place-chips .chip", { hasText: "Ipoh" })).toBeEnabled();
});

// ------------------------------------------------------------------ FR-17 GPS
test("FR-17 GPS through Telegram's location service", async ({ page, request }) => {
  await openApp(page, { userId: ACTIVE, gps: { latitude: 3.1478, longitude: 101.7128 } });
  await ready(page);
  await page.locator("#place-btn").click();
  await page.locator("#gps-btn").click();
  await expect(page.locator("#sheet")).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("Location saved");
  await expect(page.locator("#place-name")).toHaveText("Bukit Bintang, Kuala Lumpur, Malaysia"); // the name comes from the server's own lookup
  const d = await dashboard(request);
  expect(d.places[0]).toMatchObject({ name: "Bukit Bintang, Kuala Lumpur", active: true });
  expect(d.ipu.value).toBe(63); // still within reach of the Cheras station
});

test("FR-17 GPS through the browser when Telegram has no location service", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 3.1478, longitude: 101.7128 });
  await openApp(page, { userId: ACTIVE, modern: false });
  await ready(page);
  await page.locator("#place-btn").click();
  await page.locator("#gps-btn").click();
  await expect(page.locator("#place-name")).toHaveText("Bukit Bintang, Kuala Lumpur, Malaysia");
});

test("F16 GPS refused: a plain message, and searching still works", async ({ page }) => {
  await openApp(page, { userId: ACTIVE, gps: "denied" }); // Telegram says no, and the browser has no permission either
  await ready(page);
  await page.locator("#place-btn").click();
  await page.locator("#gps-btn").click();
  await expect(page.locator("#sheet-status")).toContainText("couldn't get your location", { timeout: 20_000 });
  await expect(page.locator("#sheet")).toBeVisible();
  await expect(page.locator("#place-name")).toHaveText("Kuala Lumpur, Malaysia");
  await page.locator("#search-input").fill("ipoh");
  await page.locator("#search-btn").click();
  await expect(page.locator("#results .choice")).toHaveText(["Ipoh, Perak, Malaysia"]);
});

test("FR-17 GPS: the server names the place itself and refuses impossible coordinates", async ({ request }) => {
  const res = await request.post("/api/app/place", { headers: auth(), data: { lat: 3.1478, lon: 101.7128, name: "Evil Lair", country: "Nowhere" } });
  expect(res.status()).toBe(200);
  expect((await res.json()).place).toBe("Bukit Bintang, Kuala Lumpur, Malaysia");
  for (const data of [{ lat: 91, lon: 0 }, { lat: 0, lon: -181 }, { lat: "3", lon: 101 }, { lat: null, lon: 101 }, { lat: 3.1 }]) {
    expect((await request.post("/api/app/place", { headers: auth(), data })).status(), JSON.stringify(data)).toBe(400);
  }
});

// ------------------------------------------------------------------ FR-15 day details, FR-16 chart
test("FR-15 tapping a day opens its details; one at a time; works by keyboard", async ({ page }) => {
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  const rows = page.locator("#days .day");
  await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "false");
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "true");
  const detail = page.locator("#day-detail-1");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".period")).toHaveCount(3);
  for (const text of ["Morning", "Afternoon", "Evening", "Rain chance 10%", "Wind up to 18 km/h", "UV 9 · Very high", "Sunrise 7:01 AM · Sunset 7:12 PM", "Best time outside:"]) await expect(detail).toContainText(text);
  await expect(detail.locator(".tips li").first()).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.locator("#forecast").screenshot({ path: `${SHOTS}/day-detail-390.png` });

  await rows.nth(0).click(); // opening another closes the first
  await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "false");
  await expect(detail).toBeHidden();
  await expect(page.locator("#day-detail-0")).toBeVisible();
  await expect(page.locator("#day-detail-0")).not.toContainText("Best time outside:"); // today's has its own card

  await rows.nth(0).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#day-detail-0")).toBeHidden();
  await page.keyboard.press("Space");
  await expect(page.locator("#day-detail-0")).toBeVisible();

  // it stays open when the list grows to 7 days
  await page.locator("#days-7").click();
  await expect(page.locator("#days .day")).toHaveCount(7);
  await expect(page.locator("#day-detail-0")).toBeVisible();
  await page.locator("#days .day").nth(6).click();
  await expect(page.locator("#day-detail-6")).toContainText("Sunrise");
  await page.locator("#days-3").click();
  await expect(page.locator('#days .day[aria-expanded="true"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("FR-16 the hourly temperature line sits exactly above the hour columns", async ({ page }) => {
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  const shape = await page.evaluate(() => {
    const svg = document.getElementById("hour-chart")!;
    const list = document.getElementById("hours")!;
    const line = svg.querySelector(".chart-line")!.getAttribute("d")!;
    const first = list.querySelector(".hour")!.getBoundingClientRect();
    return {
      svgWidth: Math.round(svg.getBoundingClientRect().width),
      listWidth: Math.round(list.getBoundingClientRect().width),
      viewBox: svg.getAttribute("viewBox"),
      curves: (line.match(/C/g) ?? []).length,
      startsAt: Number(line.slice(1).split(" ")[0]),
      firstColumnCentre: (first.left + first.width / 2 - list.getBoundingClientRect().left) / list.getBoundingClientRect().width,
      meters: list.querySelectorAll(".hour-meter").length,
      hidden: svg.getAttribute("aria-hidden"),
      bad: /NaN|undefined|Infinity/.test(line),
    };
  });
  expect(shape.svgWidth).toBe(shape.listWidth);
  expect(shape.viewBox).toBe("0 0 2400 100");
  expect(shape.curves).toBe(23); // 24 points
  expect(shape.startsAt / 2400).toBeCloseTo(shape.firstColumnCentre, 2);
  expect(shape).toMatchObject({ meters: 24, hidden: "true", bad: false });
});

test("FR-16 no chart is drawn when the temperatures are unknown (the list still shows)", async ({ page }) => {
  await page.route("**/api/app/dashboard**", async (r) => {
    const res = await r.fetch();
    const d = await res.json();
    for (const h of d.hourly) h.t = null;
    await r.fulfill({ response: res, json: d });
  });
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  await expect(page.locator("#hour-chart")).toHaveCount(0);
  await expect(page.locator("#hours .hour")).toHaveCount(24);
  expect(errors).toEqual([]);
});

test("F17 no official IPU reading (or none for this place): the block is simply absent", async ({ page }) => {
  await page.route("**/api/app/dashboard**", async (r) => {
    const res = await r.fetch();
    const d = await res.json();
    d.ipu = null;
    await r.fulfill({ response: res, json: d });
  });
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await expect(page.locator("#ipu")).toHaveCount(0);
  await expect(page.locator("#aqi-value")).toContainText("62"); // the rest of the air card is untouched
});

// ------------------------------------------------------------------ FR-18 share a picture card
test("FR-18 share: the card is drawn, sent to the chat, and Telegram's share picker opens", async ({ page }) => {
  await pause(1600);
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#share-btn").click();
  const sheet = page.locator("#share");
  await expect(sheet.locator("#share-title")).toHaveText("Share today's weather");
  await expect(sheet.locator("#card")).toHaveAttribute("data-drawn", "true");
  await expect(sheet.locator("#card")).toHaveAttribute("aria-label", "Picture card: Kuala Lumpur, Malaysia, 28°C, Partly cloudy");
  const png = await page.evaluate(() => (document.getElementById("card") as HTMLCanvasElement).toDataURL("image/png"));
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/share-card-real.png`, Buffer.from(png.split(",")[1], "base64"));
  expect(png.length, "a real picture, not a blank canvas").toBeGreaterThan(100_000);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/share-sheet-390.png` });

  const before = (await telegramCalls()).length;
  await sheet.locator("#share-send").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("Shared");
  expect(await page.evaluate(() => (window as any).__tg.shared)).toBe("PREPARED_1");
  const calls = (await telegramCalls()).slice(before);
  const photo = calls.find((c) => c.method === "sendPhoto")!;
  expect(photo.type).toBe("multipart/form-data");
  expect(photo.bytes, "a real JPEG was uploaded").toBeGreaterThan(30_000);
  expect(photo.bytes).toBeLessThan(700_000);
  expect(photo.text).toContain(String(ACTIVE)); // to the person's own chat
  const prepared = calls.find((c) => c.method === "savePreparedInlineMessage")!;
  expect(JSON.parse(prepared.text)).toMatchObject({ user_id: ACTIVE, result: { type: "photo", photo_file_id: "FILE_LARGE", caption: "🌤 Weather in Kuala Lumpur, Malaysia · SkyBrief" } });
  expect(errors).toEqual([]);
});

test("F18 share on an older Telegram: the picture is in the chat, and the page says to forward it", async ({ page }) => {
  await pause(1600);
  await openApp(page, { userId: ACTIVE, modern: false });
  await ready(page);
  await page.locator("#share-btn").click();
  await expect(page.locator("#card")).toHaveAttribute("data-drawn", "true");
  await page.locator("#share-send").click();
  await expect(page.locator("#toast")).toHaveText("Sent to your SkyBrief chat. Forward it to share.");
  expect(await page.evaluate(() => (window as any).__tg.shared)).toBe("");
});

test("F18 share when Telegram can't prepare it: same fallback", async ({ page }) => {
  await pause(1600);
  await setTelegram({ prepareDown: true });
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#share-btn").click();
  await expect(page.locator("#card")).toHaveAttribute("data-drawn", "true");
  await page.locator("#share-send").click();
  await expect(page.locator("#toast")).toHaveText("Sent to your SkyBrief chat. Forward it to share.");
});

test("F19 share when the picture can't be sent: the sheet stays open with a message", async ({ page }) => {
  await pause(1600);
  await setTelegram({ photoDown: true });
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#share-btn").click();
  await expect(page.locator("#card")).toHaveAttribute("data-drawn", "true");
  await page.locator("#share-send").click();
  await expect(page.locator("#share-status")).toHaveText("I couldn't send the picture. Please try again in a moment.");
  await expect(page.locator("#share")).toBeVisible();
  await expect(page.locator("#share-send")).toBeEnabled();
});

test("FR-18 share: only a JPEG of a sensible size is accepted, and not twice in quick succession", async ({ request }) => {
  await pause(1600);
  const post = (data: Buffer, type = "image/jpeg", headers = auth()) => request.post("/api/app/share", { headers: { ...headers, "content-type": type }, data });
  expect((await post(Buffer.from("not a picture, just some text ".repeat(100)))).status(), "wrong content").toBe(400);
  expect((await post(fakeJpeg(), "image/png")).status(), "wrong type").toBe(400);
  expect((await post(fakeJpeg(100))).status(), "too small").toBe(400);
  expect((await post(fakeJpeg(800_000))).status(), "too large").toBe(413);
  expect((await post(fakeJpeg(), "image/jpeg", { authorization: `tma ${signInitData(PENDING)}` })).status(), "not approved").toBe(403);
  expect((await request.post("/api/app/share", { headers: { "content-type": "image/jpeg" }, data: fakeJpeg() })).status(), "no session").toBe(401);

  const first = await post(fakeJpeg());
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ sent: true, prepared: "PREPARED_1" });
  const second = await post(fakeJpeg());
  expect(second.status(), "too soon").toBe(429);
  expect(Number(second.headers()["retry-after"])).toBeGreaterThanOrEqual(1);
});

test("FR-18 share in the demo: the card can be previewed, sending is off", async ({ page }) => {
  for (const scene of ["sunny", "storm", "night"]) {
    await openApp(page, { path: `/app/?demo=${scene}` });
    await ready(page);
    await page.locator("#share-btn").click();
    await expect(page.locator("#card")).toHaveAttribute("data-drawn", "true");
    await expect(page.locator("#share-hint")).toHaveText("Sharing is switched off in the demo.");
    await expect(page.locator("#share-send")).toBeDisabled();
    const png = await page.evaluate(() => (document.getElementById("card") as HTMLCanvasElement).toDataURL("image/png"));
    writeFileSync(`${SHOTS}/share-card-${scene}.png`, Buffer.from(png.split(",")[1], "base64"));
    await expect(page.locator("#settings-btn")).toBeDisabled(); // no account in the demo
  }
});

// ================================================================== v2.5
// ------------------------------------------------------------------ FR-19 a day hour by hour
test("FR-19 a day's details include that day hour by hour, with its own temperature line", async ({ page }) => {
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#days .day").nth(1).click();
  const detail = page.locator("#day-detail-1");
  await expect(detail.locator(".hour")).toHaveCount(24);
  await expect(detail.locator(".hour").first()).toContainText("12 AM");
  await expect(detail.locator(".hour").nth(12)).toContainText("12 PM");
  await expect(detail.locator(".chart .chart-line")).toHaveCount(1);
  await expect(detail.getByRole("group", { name: /hour by hour$/ })).toBeVisible();
  // today has the "next 24 hours" strip above, so its details don't repeat it
  await page.locator("#days .day").nth(0).click();
  await expect(page.locator("#day-detail-0 .hour")).toHaveCount(0);
  await expect(page.locator("#hours .hour")).toHaveCount(24); // the main strip is untouched
  await expect(page.locator("#hour-chart")).toHaveCount(1);
  await page.locator("#days .day").nth(2).click();
  expect(await axe(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "the strip scrolls inside itself, not the page").toBeLessThanOrEqual(1);
  await page.locator("#forecast").screenshot({ path: `${SHOTS}/day-hours-390.png` });
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ FR-20 home and order
test("FR-20 saved places: set a home, move one up, and home survives a full list", async ({ page, request }) => {
  for (const preset of [5, 4, 0]) await request.post("/api/app/place", { headers: auth(), data: { preset } }); // Ipoh, Johor Bahru, then back to KL
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  await expect(page.locator("#place-chips .chip")).toHaveText(["Kuala Lumpur", "Johor Bahru", "Ipoh"]);

  await page.locator("#place-btn").click();
  await expect(page.locator("#saved .saved-row")).toHaveCount(3);
  expect(await axe(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);

  await page.getByRole("button", { name: "Set Ipoh as home" }).click();
  await expect(page.locator("#sheet-status")).toHaveText("Saved");
  await expect(page.locator("#saved .saved-row").first()).toContainText("Ipoh");
  await expect(page.getByRole("button", { name: "Ipoh is your home. Remove the home mark" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Move Kuala Lumpur up" })).toHaveCount(0); // nothing moves above home
  await page.getByRole("button", { name: "Move Johor Bahru up" }).click();
  await expect(page.locator("#saved .choice-text")).toHaveText(["Ipoh, Malaysia", "Johor Bahru, Malaysia", "Kuala Lumpur, Malaysia"]);
  await page.screenshot({ path: `${SHOTS}/places-home-390.png` });
  await page.keyboard.press("Escape");
  await expect(page.locator("#place-chips .chip")).toHaveText(["Ipoh", "Johor Bahru", "Kuala Lumpur"]);
  await expect(page.locator("#place-chips .chip").first().getByRole("img", { name: "Home" })).toBeVisible();
  await expect(page.locator("#place-name")).toHaveText("Kuala Lumpur, Malaysia"); // rearranging never changes where you are

  // four more places: the list stays at five, and home is still first
  for (const preset of [1, 2, 3, 6]) expect((await request.post("/api/app/place", { headers: auth(), data: { preset } })).status()).toBe(200);
  const d = await dashboard(request);
  expect(d.places).toHaveLength(5);
  expect(d.places[0]).toMatchObject({ name: "Ipoh", home: true });
  expect(d.places[1]).toMatchObject({ name: "Melaka", active: true }); // the newest comes right after home
  expect(d.places.filter((p: { home: boolean }) => p.home)).toHaveLength(1);

  // taking the mark away
  expect((await request.post("/api/app/place/edit", { headers: auth(), data: { saved: 0, action: "unhome" } })).status()).toBe(200);
  expect((await dashboard(request)).places.some((p: { home: boolean }) => p.home)).toBe(false);
  expect(errors).toEqual([]);
});

test("FR-20 saved places: impossible rearrangements are refused and change nothing", async ({ request }) => {
  await request.post("/api/app/place", { headers: auth(), data: { preset: 5 } });
  await request.post("/api/app/place", { headers: auth(), data: { preset: 0 } });
  const before = (await dashboard(request)).places;
  const bad: unknown[] = [{ saved: 0, action: "up" }, { saved: 9, action: "home" }, { saved: 0, action: "unhome" }, { saved: 1, action: "delete" }, { saved: "1", action: "home" }, { action: "home" }, { saved: 1 }, {}];
  for (const data of bad) expect((await request.post("/api/app/place/edit", { headers: auth(), data })).status(), JSON.stringify(data)).toBe(400);
  expect((await dashboard(request)).places).toEqual(before);
  expect((await request.post("/api/app/place/edit", { headers: auth(), data: { saved: 1, action: "home" } })).status()).toBe(200);
  expect((await request.post("/api/app/place/edit", { headers: auth(), data: { saved: 0, action: "home" } })).status(), "already home").toBe(400);
  expect((await request.post("/api/app/place/edit", { headers: auth(), data: { saved: 1, action: "up" } })).status(), "can't pass home").toBe(400);
  expect((await request.post("/api/app/place/edit", { headers: { authorization: `tma ${signInitData(PENDING)}` }, data: { saved: 0, action: "home" } })).status()).toBe(403);
  // removing the home place (when it isn't the active one) simply removes the mark with it
  expect((await request.post("/api/app/place/remove", { headers: auth(), data: { saved: 0 } })).status()).toBe(200);
  expect((await dashboard(request)).places).toEqual([{ name: "Kuala Lumpur", label: "Kuala Lumpur, Malaysia", active: true, home: false }]);
});

test("FR-20 a failed rearrangement says so and shows what is really saved", async ({ page }) => {
  await page.request.post("/api/app/place", { headers: auth(), data: { preset: 5 } });
  await page.request.post("/api/app/place", { headers: auth(), data: { preset: 0 } });
  await openApp(page, { userId: ACTIVE });
  await ready(page);
  await page.locator("#place-btn").click();
  await page.route("**/api/app/place/edit", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "server_error", message: "Something went wrong on my side. Please try again." } }) }));
  await page.getByRole("button", { name: "Set Ipoh as home" }).click();
  await expect(page.locator("#sheet-status")).toHaveText("Something went wrong on my side. Please try again.");
  await expect(page.getByRole("button", { name: "Set Ipoh as home" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Set Ipoh as home" })).toBeEnabled();
});

// ------------------------------------------------------------------ FR-21 haze
test("FR-21 unhealthy air puts a haze over the sky; clean air does not", async ({ page }) => {
  const errors = await openApp(page, { userId: ACTIVE });
  await ready(page);
  await expect(page.locator("#hero")).toHaveAttribute("data-haze", "0");
  const clear = await page.evaluate(() => (document.getElementById("sky") as HTMLCanvasElement).toDataURL().length);

  await setMock({ aqi: 165 });
  await page.locator("#refresh-btn").click();
  await expect(page.locator("#aqi-value")).toContainText("165");
  await expect(page.locator("#hero")).toHaveAttribute("data-haze", "2");
  await expect(page.locator("#sky")).toHaveAttribute("data-haze", "2");
  await expect(page.locator("#sky")).toHaveAttribute("data-scene", /^partly-/); // the weather scene is still the weather
  await expect(page.locator("#aqi-label")).toHaveText("Unhealthy"); // the words are on the air card: the haze is never the only signal
  expect(await page.evaluate(() => (document.getElementById("sky") as HTMLCanvasElement).toDataURL().length)).not.toBe(clear);
  expect(await axe(page)).toEqual([]);

  await setMock({ aqi: 62 });
  await page.locator("#refresh-btn").click();
  await expect(page.locator("#hero")).toHaveAttribute("data-haze", "0");
  expect(errors).toEqual([]);
});

test("FR-21 the haze demo, and its share card", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page, { path: "/app/?demo=haze" });
  await ready(page);
  await expect(page.locator("#hero")).toHaveAttribute("data-haze", "2");
  await expect(page.locator("#aqi-value")).toContainText("168");
  await page.screenshot({ path: `${SHOTS}/haze-390.png` });
  await page.locator("#share-btn").click();
  await expect(page.locator("#card")).toHaveAttribute("data-drawn", "true");
  const png = await page.evaluate(() => (document.getElementById("card") as HTMLCanvasElement).toDataURL("image/png"));
  writeFileSync(`${SHOTS}/share-card-haze.png`, Buffer.from(png.split(",")[1], "base64"));
});

// ------------------------------------------------------------------ FR-22 first-time tips
test("FR-22 first visit: a short guide, shown once", async ({ page }) => {
  const errors = await openApp(page, { userId: ACTIVE, firstTime: true });
  await ready(page);
  const tips = page.locator("#tips");
  await expect(tips).toBeVisible();
  await expect(tips.locator("#tips-title")).toHaveText("Welcome to your dashboard");
  await expect(tips.locator(".tip-row")).toHaveCount(4);
  expect(await axe(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/tips-390.png` });
  await tips.locator("#tips-ok").click();
  await expect(tips).toBeHidden();

  await page.reload();
  await ready(page);
  await page.waitForTimeout(400);
  await expect(tips).toBeHidden(); // never again on this device

  // but it can be found again, from Settings
  await page.locator("#settings-btn").click();
  await page.locator("#tips-again").click();
  await expect(tips).toBeVisible();
  await expect(page.locator("#settings")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(tips).toBeHidden();
  expect(errors).toEqual([]);
});

test("FR-22 the guide never appears in the demo, nor on a device that can't remember it was shown", async ({ page }) => {
  await page.goto("about:blank");
  await openApp(page, { path: "/app/?demo=sunny", firstTime: true });
  await ready(page);
  await page.waitForTimeout(400);
  await expect(page.locator("#tips")).toBeHidden();
});

test("FR-22 storage blocked: no guide at all, rather than the guide on every visit", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
  });
  const errors = await openApp(page, { userId: ACTIVE, firstTime: true });
  await ready(page);
  await page.waitForTimeout(400);
  await expect(page.locator("#tips")).toBeHidden();
  await expect(page.locator("#place-btn")).toBeEnabled();
  expect(errors).toEqual([]);
});
