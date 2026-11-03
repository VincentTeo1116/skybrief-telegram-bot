/**
 * Proactive alerts: "rain likely soon" and "air quality reached your level".
 *
 * Runs every 15 minutes (cron minute % 15 == 5, so it rarely coincides with common report times).
 * Rain detection uses HOURLY forecast data, so "soon" means the next 1-2 hours, not minutes.
 */
import { alertCandidates, patchUser, placeOf, type UserPatch } from "./db";
import { aqiAlertMessage, rainAlertMessage } from "./format";
import { rainAlert } from "./insights";
import { alertKeyboard } from "./keyboards";
import { Telegram, TelegramError } from "./telegram";
import type { Env, Report, User } from "./types";
import { prefsOf } from "./units";
import { localParts, minutesOf, normaliseTime } from "./util";
import { makeWeather } from "./weather";

/** Each city costs ~3 outgoing requests; keep a pass inside the free plan's per-invocation cap. Others are served on the next pass. */
export const ALERT_MAX_CITIES = 6;
export const RAIN_COOLDOWN_MS = 3 * 3_600_000;
export const AQI_COOLDOWN_MS = 3 * 3_600_000;
/** AQI must fall this far below the user's level before the alert can fire again. */
export const AQI_RECOVERY_MARGIN = 10;
export const DEFAULT_QUIET_HOURS = "22:00-06:30";

export interface Quiet {
  start: number;
  end: number;
}

/** "22:00-06:30" -> minutes; "off" -> null (never quiet). Bad values fall back to the default. */
export function parseQuietHours(value: string | undefined): Quiet | null {
  const v = (value ?? DEFAULT_QUIET_HOURS).trim().toLowerCase();
  if (v === "off" || v === "none") return null;
  const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(v);
  const a = m && normaliseTime(m[1]);
  const b = m && normaliseTime(m[2]);
  if (!a || !b) return parseQuietHours(DEFAULT_QUIET_HOURS);
  return { start: minutesOf(a), end: minutesOf(b) };
}

/** Is it quiet time in this timezone? (Unknown timezone counts as quiet: better silent than wrong.) */
export function inQuietHours(tz: string, now: Date, quiet: Quiet | null): boolean {
  if (!quiet) return false;
  try {
    const m = minutesOf(localParts(tz, now).time);
    return quiet.start > quiet.end ? m >= quiet.start || m < quiet.end : m >= quiet.start && m < quiet.end;
  } catch {
    return true;
  }
}

export function decideRain(u: User, r: Report, nowMs: number): { time: string; prob: number } | null {
  if (!u.rainAlerts || nowMs - u.lastRainAlert < RAIN_COOLDOWN_MS) return null;
  return rainAlert(r);
}

/** Alert when AQI reaches the user's level; stay quiet until it has recovered, so a hovering value can't spam. */
export function decideAqi(u: User, r: Report, nowMs: number): { send: boolean; patch: UserPatch } {
  const aqi = r.aq?.aqi;
  if (!u.aqiAlert || aqi == null) return { send: false, patch: {} };
  if (u.aqiAlertActive) {
    return { send: false, patch: aqi < u.aqiAlert - AQI_RECOVERY_MARGIN ? { aqiAlertActive: false } : {} };
  }
  if (aqi >= u.aqiAlert && nowMs - u.lastAqiAlert >= AQI_COOLDOWN_MS) {
    return { send: true, patch: { aqiAlertActive: true, lastAqiAlert: nowMs } };
  }
  return { send: false, patch: {} };
}

export async function runAlerts(env: Env, now = new Date()): Promise<{ cities: number; sent: number }> {
  const nowMs = now.getTime();
  const quiet = parseQuietHours(env.QUIET_HOURS);
  const users = (await alertCandidates(env.DB)).filter((u) => !inQuietHours(u.tz, now, quiet));
  if (!users.length) return { cities: 0, sent: 0 };

  // Group by city so each city is fetched once; serve the longest-waiting cities first.
  const groups = new Map<string, User[]>();
  for (const u of users) {
    const key = `${u.lat.toFixed(2)},${u.lon.toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  const waited = (g: User[]) => Math.min(...g.map((u) => u.lastAlertCheck));
  const ordered = [...groups.values()].sort((a, b) => waited(a) - waited(b)).slice(0, ALERT_MAX_CITIES);

  const tg = new Telegram(env);
  const wx = makeWeather(env);
  let sent = 0;

  for (const group of ordered) {
    let report: Report;
    try {
      report = await wx.fetchReport(placeOf(group[0]), true);
    } catch (e) {
      console.log(JSON.stringify({ event: "alerts_weather_failed", error: String(e).slice(0, 120) }));
      // count it as checked so a broken city goes to the back of the queue instead of blocking the others
      for (const u of group) await patchUser(env.DB, u.chatId, { lastAlertCheck: nowMs });
      continue;
    }
    for (const u of group) {
      const p = prefsOf(u);
      const mine: Report = { ...report, place: placeOf(u) };
      const patch: UserPatch = { lastAlertCheck: nowMs };
      try {
        const rain = decideRain(u, mine, nowMs);
        if (rain) {
          await tg.sendMessage(u.chatId, rainAlertMessage(mine, p, rain), alertKeyboard("rain", u.lang));
          patch.lastRainAlert = nowMs; // only after a successful send
          sent++;
        }
        const aqi = decideAqi(u, mine, nowMs);
        if (aqi.send) {
          await tg.sendMessage(u.chatId, aqiAlertMessage(mine, p), alertKeyboard("aqi", u.lang));
          sent++;
        }
        Object.assign(patch, aqi.patch); // only after a successful send
      } catch (e) {
        if (e instanceof TelegramError && e.unreachable) {
          patch.rainAlerts = false;
          patch.aqiAlert = 0;
        } else {
          console.log(JSON.stringify({ event: "alert_failed", chatId: u.chatId, error: String(e).slice(0, 120) }));
        }
      }
      await patchUser(env.DB, u.chatId, patch);
    }
  }
  console.log(JSON.stringify({ event: "alerts_done", cities: ordered.length, sent }));
  return { cities: ordered.length, sent };
}
