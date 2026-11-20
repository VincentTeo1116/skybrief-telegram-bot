import { createHmac } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const ACTIVE = 1001; // created by scripts/e2e-server.mjs (the admin, so active)
export const PENDING = 5005; // asked for access, not approved
export const STRANGER = 4242; // never talked to the bot
export const MOCK = "http://127.0.0.1:19011";
export const SHOTS = "test-results/shots";

/**
 * Sign a session the way Telegram does. Written independently of the Worker's check (Node's crypto here, WebCrypto
 * there), following Telegram's published rule, so the two agreeing is real evidence.
 */
export function signInitData(userId: number, o: { token?: string; ageSeconds?: number; lang?: string } = {}): string {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - (o.ageSeconds ?? 0)),
    query_id: "AAF-test",
    user: JSON.stringify({ id: userId, first_name: "Test", language_code: o.lang ?? "en" }),
  });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(o.token ?? "testtoken").digest();
  p.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
}

export interface OpenOptions {
  /** Signed in as this Telegram user. Omit for "a normal browser, not Telegram". */
  userId?: number;
  /** Use this exact initData instead of signing one. */
  initData?: string;
  scheme?: "light" | "dark";
  path?: string;
}

/** Open the mini app the way Telegram would: its bridge script is replaced by a stub that carries the session. */
export async function openApp(page: Page, o: OpenOptions = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: "/* stubbed in tests */" }));
  const initData = o.initData ?? (o.userId ? signInitData(o.userId) : "");
  await page.addInitScript(
    (cfg) => {
      const noop = () => {};
      (window as any).__tg = { header: "", back: false };
      (window as any).Telegram = {
        WebApp: {
          initData: cfg.initData,
          initDataUnsafe: cfg.userId ? { user: { id: cfg.userId, language_code: "en" } } : {},
          colorScheme: cfg.scheme,
          platform: cfg.initData ? "tdesktop" : "unknown",
          ready: noop,
          expand: noop,
          onEvent: noop,
          setHeaderColor: (c: string) => ((window as any).__tg.header = c),
          setBackgroundColor: noop,
          setBottomBarColor: noop,
          HapticFeedback: { impactOccurred: noop, notificationOccurred: noop },
          BackButton: { show: () => ((window as any).__tg.back = true), hide: () => ((window as any).__tg.back = false), onClick: noop, offClick: noop },
        },
      };
    },
    { initData, userId: o.userId ?? 0, scheme: o.scheme ?? "light" },
  );
  await page.goto(o.path ?? "/app/");
  return errors;
}

/** Wait until real data is on screen. */
export async function ready(page: Page) {
  await expect(page.locator("#app")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#forecast")).toBeVisible();
}

export const setMock = (o: Record<string, string | number | boolean>) =>
  fetch(`${MOCK}/__set?${new URLSearchParams(Object.entries(o).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "1" : "0") : String(v)]))}`);

export const healthyMock = () => setMock({ forecastDown: false, metnoDown: false, rainingNow: false, rainSoon: false, warnDown: false, aqi: 62 });

export async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
}

export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Visible controls smaller than 44 x 44 px. */
export async function smallTargets(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, [role="button"], input:not([type="hidden"]), select, textarea, summary, a.button')]
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ el: e.outerHTML.slice(0, 90), r: e.getBoundingClientRect() }))
      .filter((x) => x.r.width < 44 || x.r.height < 44)
      .map((x) => `${Math.round(x.r.width)}x${Math.round(x.r.height)} ${x.el}`),
  );
}

/** Text smaller than 14 px that someone can actually see. */
export async function tinyText(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || parent.closest(".sr-only, script, style, noscript, [hidden]")) continue;
      if (parent.offsetParent === null && getComputedStyle(parent).position !== "fixed") continue;
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size < 14) out.push(`${size}px "${node.textContent.trim().slice(0, 30)}"`);
    }
    return [...new Set(out)];
  });
}

export const skyFrame = (page: Page) => page.evaluate(() => (document.getElementById("sky") as HTMLCanvasElement).toDataURL());
