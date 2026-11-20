/**
 * Where the mini app lives (FR-1). Telegram only accepts HTTPS addresses for web-app buttons.
 *
 * The Worker cannot know its own public address from a cron run, so `/setup` remembers it in the `meta` table.
 * The optional APP_URL variable (the Worker's public origin) overrides that.
 *
 * Kept apart from miniapp.ts on purpose: daily.ts needs this, and miniapp.ts -> location.ts -> daily.ts would loop.
 */
import { metaGet, metaSet } from "./db";
import type { Env } from "./types";

export const APP_PATH = "/app/";
const META_KEY = "app_url";
const CACHE_MS = 10 * 60 * 1000;

let cached: { at: number; url: string | null } | null = null;

/** "https://skybrief.example.workers.dev" -> "https://skybrief.example.workers.dev/app/". Null for anything that is not a plain HTTPS origin. */
export function appUrlFromOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" ? `${u.origin}${APP_PATH}` : null;
  } catch {
    return null;
  }
}

/** The mini app's address, or null when it is not known yet (then no button is offered). One database read per isolate every 10 minutes. */
export async function getAppUrl(env: Env, now = Date.now()): Promise<string | null> {
  if (env.APP_URL) return appUrlFromOrigin(env.APP_URL);
  if (cached && now - cached.at < CACHE_MS) return cached.url;
  let stored: string | null = null;
  try {
    stored = await metaGet(env.DB, META_KEY);
  } catch {
    /* an unknown address only hides the button */
  }
  cached = { at: now, url: appUrlFromOrigin(stored) };
  return cached.url;
}

/** Called by /setup. Returns the mini app address, or null when the origin is not HTTPS (local development). */
export async function rememberOrigin(env: Env, origin: string): Promise<string | null> {
  const url = appUrlFromOrigin(origin);
  if (url) {
    await metaSet(env.DB, META_KEY, new URL(origin).origin);
    cached = null;
  }
  return env.APP_URL ? appUrlFromOrigin(env.APP_URL) : url;
}
