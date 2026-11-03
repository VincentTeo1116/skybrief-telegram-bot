/**
 * Scheduled reports. A cron trigger fires every minute; each user is served when THEIR local time reaches
 * THEIR chosen time (so users in different cities/timezones each get their own morning), for two optional slots:
 *   morning: today's report            evening: tomorrow's outlook
 */
import { claimDaily, dailyCandidates, patchUser, type Slot } from "./db";
import { t } from "./i18n";
import { Telegram, TelegramError } from "./telegram";
import type { Env, User } from "./types";
import { localParts, minutesOf } from "./util";
import { buildView } from "./views";
import { WeatherError, makeWeather } from "./weather";

/** Cloudflare's free plan allows ~50 outgoing requests per invocation, so cap the work per minute. Anyone left over is served on the next tick. */
export const MAX_PER_TICK = 8;
/** If the Worker was down at the exact minute, still deliver for up to this long afterwards. */
export const CATCH_UP_WINDOW_MIN = 120;

interface SlotConfig {
  on: (u: User) => boolean;
  time: (u: User) => string;
  last: (u: User) => string;
  lastKey: "lastSent" | "lastEvening";
  view: "now" | "tomorrow";
  ribbonKey: string;
}
const SLOTS: Record<Slot, SlotConfig> = {
  morning: { on: (u) => u.dailyOn, time: (u) => u.dailyTime, last: (u) => u.lastSent, lastKey: "lastSent", view: "now", ribbonKey: "ribbon_daily" },
  evening: { on: (u) => u.eveningOn, time: (u) => u.eveningTime, last: (u) => u.lastEvening, lastKey: "lastEvening", view: "tomorrow", ribbonKey: "ribbon_evening" },
};

/** Today's local date if `time` has already passed there (so we don't send a late report right after a setting change), else ''. */
export function lastSentAfterChange(tz: string, time: string, now = new Date()): string {
  try {
    const { date, time: nowTime } = localParts(tz, now);
    return minutesOf(nowTime) >= minutesOf(time) ? date : "";
  } catch {
    return "";
  }
}

/** Minutes past the user's chosen time (negative = not yet), or null if this slot is off / already sent today / the timezone is invalid. */
export function minutesLate(u: User, now: Date, slot: Slot = "morning"): number | null {
  const cfg = SLOTS[slot];
  if (!cfg.on(u)) return null;
  try {
    const { date, time } = localParts(u.tz, now);
    if (cfg.last(u) === date) return null;
    return minutesOf(time) - minutesOf(cfg.time(u));
  } catch {
    return null; // unknown timezone: skip rather than crash the whole run
  }
}

export function isDue(u: User, now: Date, slot: Slot = "morning"): boolean {
  const late = minutesLate(u, now, slot);
  return late !== null && late >= 0 && late <= CATCH_UP_WINDOW_MIN;
}

export interface DueItem {
  user: User;
  slot: Slot;
  late: number;
}

/** Everything due right now, capped at MAX_PER_TICK. Least overdue first, so a few permanently failing sends can't starve everybody else. */
export function dueItems(users: User[], now: Date): DueItem[] {
  const items: DueItem[] = [];
  for (const user of users) {
    for (const slot of ["morning", "evening"] as const) {
      if (isDue(user, now, slot)) items.push({ user, slot, late: minutesLate(user, now, slot)! });
    }
  }
  return items.sort((a, b) => a.late - b.late).slice(0, MAX_PER_TICK);
}

export async function runDaily(env: Env, now = new Date()): Promise<{ due: number; sent: number; failed: number }> {
  const due = dueItems(await dailyCandidates(env.DB), now);
  if (!due.length) return { due: 0, sent: 0, failed: 0 };

  const tg = new Telegram(env);
  const wx = makeWeather(env);
  const refreshed = new Set<string>(); // first user per city gets fresh data; the rest reuse it
  let sent = 0;
  let failed = 0;

  for (const { user: u, slot } of due) {
    const cfg = SLOTS[slot];
    const { date } = localParts(u.tz, now);
    if (!(await claimDaily(env.DB, u.chatId, date, slot))) continue; // another run got there first
    const cityKey = `${u.lat.toFixed(2)},${u.lon.toFixed(2)}`;
    try {
      const { text, markup } = await buildView(wx, u, cfg.view, {
        force: !refreshed.has(cityKey),
        ribbon: `${slot === "morning" ? "☀️" : "🌙"} <b>${t(u.lang, cfg.ribbonKey)}</b>`,
      });
      refreshed.add(cityKey);
      await tg.sendMessage(u.chatId, text, markup);
      sent++;
    } catch (e) {
      failed++;
      if (e instanceof TelegramError && e.unreachable) {
        console.log(JSON.stringify({ event: "daily_unreachable", chatId: u.chatId, slot }));
        await patchUser(env.DB, u.chatId, { dailyOn: false, eveningOn: false });
      } else {
        // Release the claim so the next minute retries (until the catch-up window ends).
        console.log(JSON.stringify({ event: "daily_failed", chatId: u.chatId, slot, error: e instanceof WeatherError ? "weather" : String(e) }));
        await patchUser(env.DB, u.chatId, { [cfg.lastKey]: cfg.last(u) });
      }
    }
  }
  console.log(JSON.stringify({ event: "daily_done", due: due.length, sent, failed }));
  return { due: due.length, sent, failed };
}
