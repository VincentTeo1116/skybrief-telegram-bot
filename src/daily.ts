/**
 * Daily reports. A cron trigger fires every minute; each user is served when THEIR local time reaches
 * THEIR chosen time (so users in different cities/timezones each get 08:30 their own morning).
 */
import { claimDaily, dailyCandidates, patchUser } from "./db";
import { t } from "./i18n";
import { Telegram, TelegramError } from "./telegram";
import type { Env, User } from "./types";
import { localParts, minutesOf } from "./util";
import { buildView } from "./views";
import { WeatherError, WeatherService } from "./weather";

/** Cloudflare's free plan allows ~50 outgoing requests per invocation, so cap the work per minute. Anyone left over is served on the next tick. */
export const MAX_PER_TICK = 8;
/** If the Worker was down at the exact minute, still deliver for up to this long afterwards. */
export const CATCH_UP_WINDOW_MIN = 120;

/** Today's local date if `dailyTime` has already passed there (so we don't send a late report right after a setting change), else ''. */
export function lastSentAfterChange(tz: string, dailyTime: string, now = new Date()): string {
  try {
    const { date, time } = localParts(tz, now);
    return minutesOf(time) >= minutesOf(dailyTime) ? date : "";
  } catch {
    return "";
  }
}

export function minutesLate(u: User, now: Date): number | null {
  try {
    const { date, time } = localParts(u.tz, now);
    if (u.lastSent === date) return null;
    return minutesOf(time) - minutesOf(u.dailyTime);
  } catch {
    return null; // unknown timezone: skip rather than crash the whole run
  }
}

export function isDue(u: User, now: Date): boolean {
  const late = minutesLate(u, now);
  return late !== null && late >= 0 && late <= CATCH_UP_WINDOW_MIN;
}

export async function runDaily(env: Env, now = new Date()): Promise<{ due: number; sent: number; failed: number }> {
  const users = await dailyCandidates(env.DB);
  const due = users
    .filter((u) => isDue(u, now))
    .sort((a, b) => (minutesLate(b, now) ?? 0) - (minutesLate(a, now) ?? 0))
    .slice(0, MAX_PER_TICK);
  if (!due.length) return { due: 0, sent: 0, failed: 0 };

  const tg = new Telegram(env);
  const wx = new WeatherService(env.WAQI_TOKEN);
  const refreshed = new Set<string>(); // first user per city gets fresh data; the rest reuse it
  let sent = 0;
  let failed = 0;

  for (const u of due) {
    const { date } = localParts(u.tz, now);
    if (!(await claimDaily(env.DB, u.chatId, date))) continue; // another run got there first
    const cityKey = `${u.lat.toFixed(2)},${u.lon.toFixed(2)}`;
    try {
      const { text, markup } = await buildView(wx, u, "now", {
        force: !refreshed.has(cityKey),
        ribbon: `☀️ <b>${t(u.lang, "ribbon_daily")}</b>`,
      });
      refreshed.add(cityKey);
      await tg.sendMessage(u.chatId, text, markup);
      sent++;
    } catch (e) {
      failed++;
      if (e instanceof TelegramError && e.unreachable) {
        console.log(JSON.stringify({ event: "daily_unreachable", chatId: u.chatId }));
        await patchUser(env.DB, u.chatId, { dailyOn: false });
      } else {
        // Release the claim so the next minute retries (until the catch-up window ends).
        console.log(JSON.stringify({ event: "daily_failed", chatId: u.chatId, error: e instanceof WeatherError ? "weather" : String(e) }));
        await patchUser(env.DB, u.chatId, { lastSent: u.lastSent });
      }
    }
  }
  console.log(JSON.stringify({ event: "daily_done", due: due.length, sent, failed }));
  return { due: due.length, sent, failed };
}
