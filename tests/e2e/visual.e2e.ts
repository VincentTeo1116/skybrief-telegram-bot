/**
 * The look of the dashboard, checked on the demo scenes (FR-3, FR-11) so every kind of weather can be tested on demand:
 * the right sky, real animation, accessibility in light and dark, every screen size, big text.
 */
import { expect, test } from "@playwright/test";
import { axe, horizontalOverflow, openApp, ready, SHOTS, skyFrame, smallTargets, tinyText } from "./helpers";

const SCENES = [
  { demo: "sunny", sky: "clear-day" },
  { demo: "cloudy", sky: "cloudy-day" },
  { demo: "rainy", sky: "rain-day" },
  { demo: "windy", sky: "windy-day" },
  { demo: "storm", sky: "storm-day" },
  { demo: "night", sky: "clear-night" },
] as const;

for (const s of SCENES) {
  test(`FR-3 ${s.demo}: the sky matches the weather and really moves`, async ({ page }) => {
    const errors = await openApp(page, { path: `/app/?demo=${s.demo}` });
    await ready(page);
    await expect(page.locator("#hero")).toHaveAttribute("data-sky", s.sky);
    await expect(page.locator("#sky")).toHaveAttribute("data-scene", s.sky);
    await expect(page.locator("#sky")).toHaveAttribute("data-animated", "true");
    await expect(page.locator("#demo-banner")).toContainText("Demo data"); // FR-11: demo data is always labelled
    await expect(page.locator("#place-btn")).toBeDisabled();
    const a = await skyFrame(page);
    await page.waitForTimeout(450);
    const b = await skyFrame(page);
    expect(a.length, "the canvas has a picture").toBeGreaterThan(2000);
    expect(a === b, "two moments in time look different").toBe(false);
    expect(errors).toEqual([]);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`NFR-4/5 ${s.demo} ${scheme}: accessibility scan`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await openApp(page, { path: `/app/?demo=${s.demo}` });
      await ready(page);
      expect(await axe(page)).toEqual([]);
      expect(await tinyText(page), "text under 14px").toEqual([]);
      await page.screenshot({ path: `${SHOTS}/demo-${s.demo}-${scheme}-390.png`, fullPage: true });
    });
  }
}

test("FR-3: under 'reduce motion' the sky is one still frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page, { path: "/app/?demo=rainy" });
  await ready(page);
  await expect(page.locator("#sky")).toHaveAttribute("data-animated", "false");
  const a = await skyFrame(page);
  await page.waitForTimeout(450);
  expect(await skyFrame(page)).toBe(a);
  expect(a.length).toBeGreaterThan(2000); // still a picture, not a blank
});

test("FR-11: an unknown demo scene is refused with a plain message", async ({ page }) => {
  await openApp(page, { path: "/app/?demo=blizzard" });
  await expect(page.locator("#gate")).toBeVisible();
  await expect(page.locator("#gate-title")).toContainText("sunny, cloudy, rainy, windy");
});

test("FR-10/11: the demo follows the language asked for", async ({ page }) => {
  await openApp(page, { path: "/app/?demo=sunny&lang=zh" });
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page.locator("#air .card-title")).toHaveText("空气质量");
  await expect(page.locator("#demo-banner")).toContainText("演示数据");
  await page.goto("/app/?demo=sunny&lang=ms");
  await ready(page);
  await expect(page.locator("#air .card-title")).toHaveText("Kualiti udara");
});

// ------------------------------------------------------------------ every screen size (NFR-3)
const SIZES = [
  { name: "320", width: 320, height: 640 },
  { name: "375", width: 375, height: 667 },
  { name: "375-landscape", width: 667, height: 375 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
];
const PAGES = [
  { name: "storm", path: "/app/?demo=storm" },
  { name: "sunny", path: "/app/?demo=sunny" },
  { name: "gate", path: "/app/" }, // a normal browser: the "open in Telegram" screen
  { name: "404", path: "/__does-not-exist__" },
];

for (const size of SIZES) {
  for (const p of PAGES) {
    test(`NFR-3 ${size.name}px ${p.name}: fits, no small targets`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors = await openApp(page, { path: p.path });
      if (p.name === "404") await expect(page.locator('[data-page="404"]')).toBeVisible();
      else if (p.name === "gate") await expect(page.locator("#gate")).toBeVisible();
      else await ready(page);
      expect(await horizontalOverflow(page), "page scrolls sideways").toBeLessThanOrEqual(1);
      if (size.width <= 1024) expect(await smallTargets(page), "tap targets under 44px").toEqual([]);
      // content must not stretch across a very wide screen
      const widest = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll(".card, .box, .gate-box")].map((e) => e.getBoundingClientRect().width)));
      expect(widest, "widest block").toBeLessThanOrEqual(960);
      if (p.name !== "404") expect(errors).toEqual([]); // the 404 itself is logged by the browser as a failed load
      await page.screenshot({ path: `${SHOTS}/size-${size.name}-${p.name}.png`, fullPage: true });
    });
  }
}

test("NFR-3: text at 200% still fits on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openApp(page, { path: "/app/?demo=storm" });
  await ready(page);
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important")); // CSSOM: the CSP forbids style tags
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${SHOTS}/zoom-200-storm.png`, fullPage: true });
  const wide = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => !e.closest(".hours") && e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map((e) => `${e.tagName}.${e.getAttribute("class")}`).slice(0, 6));
  expect(wide, "elements wider than the screen").toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

for (const scheme of ["light", "dark"] as const) {
  test(`NFR-4/7 404 page ${scheme}: real 404, accessible`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const res = await page.goto("/__does-not-exist__");
    expect(res?.status()).toBe(404);
    await expect(page.locator('[data-page="404"] h1')).toHaveText("We couldn't find that page");
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex");
    expect(await axe(page)).toEqual([]);
  });

  test(`NFR-4 'open in Telegram' screen ${scheme}: accessible`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await expect(page.locator("#gate-title")).toHaveText("This dashboard opens inside Telegram.");
    expect(await axe(page)).toEqual([]);
  });
}

test("the app's own font (Plus Jakarta Sans) is used on the dashboard and on the 404 page", async ({ page }) => {
  const errors = await openApp(page, { path: "/app/?demo=sunny" });
  await ready(page);
  for (const url of ["/app/?demo=sunny", "/__does-not-exist__"]) {
    if (!url.startsWith("/app")) await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const used = await page.evaluate(() => ({
      family: getComputedStyle(document.body).fontFamily,
      button: getComputedStyle(document.querySelector("button, .button")!).fontFamily,
      loaded: [...document.fonts].filter((f) => f.family.includes("Plus Jakarta Sans") && f.status === "loaded").length,
    }));
    expect(used.family, url).toContain("Plus Jakarta Sans");
    expect(used.button, url).toContain("Plus Jakarta Sans");
    expect(used.loaded, `${url}: font file really loaded`).toBeGreaterThan(0);
  }
  expect(errors.filter((e) => !e.includes("404"))).toEqual([]); // e.g. a font blocked by the Content-Security-Policy would show here
});
