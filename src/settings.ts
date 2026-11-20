/**
 * The rules for changing a person's settings, in one place: the chat's buttons and commands and the mini app's
 * settings sheet (FR-13) both go through here, so a change behaves the same wherever it is made.
 */
import { lastSentAfterChange } from "./daily";
import { patchUser, type UserPatch } from "./db";
import { LANGS } from "./i18n";
import { localisedPlace, syncActivePlace } from "./location";
import type { ClockMode, Env, Lang, TempUnit, User, WindUnit } from "./types";
import { AQI_ALERT_LEVELS, CLOCK_MODES, TEMP_UNITS, WIND_UNITS } from "./units";
import { normaliseTime } from "./util";
import type { WeatherService } from "./weather";

export interface SettingsChange {
  lang?: Lang;
  tempUnit?: TempUnit;
  windUnit?: WindUnit;
  clock?: ClockMode;
  dailyOn?: boolean;
  dailyTime?: string; // "HH:MM"
  eveningOn?: boolean;
  eveningTime?: string;
  rainAlerts?: boolean;
  aqiAlert?: number; // 0 (off), 101, 151 or 201
  warningsOn?: boolean;
}

const BOOLEANS = ["dailyOn", "eveningOn", "rainAlerts", "warningsOn"] as const;
const KEYS = new Set<string>(["lang", "tempUnit", "windUnit", "clock", "dailyTime", "eveningTime", "aqiAlert", ...BOOLEANS]);

/**
 * Read a settings change that came from outside (the mini app). Strict allow-list: an unknown key, a wrong type or a
 * value that isn't one of the choices makes the WHOLE change invalid (null), so nothing half-applies.
 */
export function parseSettingsChange(body: unknown): SettingsChange | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (!keys.length || keys.some((k) => !KEYS.has(k))) return null;
  const out: SettingsChange = {};

  if ("lang" in input) {
    if (typeof input.lang !== "string" || !(input.lang in LANGS)) return null;
    out.lang = input.lang as Lang;
  }
  if ("tempUnit" in input) {
    if (!(TEMP_UNITS as readonly unknown[]).includes(input.tempUnit)) return null;
    out.tempUnit = input.tempUnit as TempUnit;
  }
  if ("windUnit" in input) {
    if (!(WIND_UNITS as readonly unknown[]).includes(input.windUnit)) return null;
    out.windUnit = input.windUnit as WindUnit;
  }
  if ("clock" in input) {
    if (!(CLOCK_MODES as readonly unknown[]).includes(input.clock)) return null;
    out.clock = input.clock as ClockMode;
  }
  for (const key of ["dailyTime", "eveningTime"] as const) {
    if (!(key in input)) continue;
    const time = typeof input[key] === "string" ? normaliseTime(input[key] as string) : null;
    if (!time) return null;
    out[key] = time;
  }
  for (const key of BOOLEANS) {
    if (!(key in input)) continue;
    if (typeof input[key] !== "boolean") return null;
    out[key] = input[key] as boolean;
  }
  if ("aqiAlert" in input) {
    if (!(AQI_ALERT_LEVELS as readonly unknown[]).includes(input.aqiAlert)) return null;
    out.aqiAlert = input.aqiAlert as number;
  }
  return out;
}

/**
 * What to store for a change (everything except the language, which also renames the saved place: see setLanguage).
 * The side rules live here: switching a report on or moving its time must not fire a "late" report at once, and
 * touching an alert resets its cooldown.
 */
export function settingsPatch(user: User, c: SettingsChange, now = new Date()): UserPatch {
  const patch: UserPatch = {};
  if (c.tempUnit) patch.tempUnit = c.tempUnit;
  if (c.windUnit) patch.windUnit = c.windUnit;
  if (c.clock) patch.clock = c.clock;

  if (c.dailyTime) Object.assign(patch, { dailyTime: c.dailyTime, dailyOn: true, lastSent: lastSentAfterChange(user.tz, c.dailyTime, now) });
  if (c.dailyOn !== undefined) {
    patch.dailyOn = c.dailyOn;
    if (c.dailyOn) patch.lastSent = lastSentAfterChange(user.tz, c.dailyTime ?? user.dailyTime, now);
  }
  if (c.eveningTime) Object.assign(patch, { eveningTime: c.eveningTime, eveningOn: true, lastEvening: lastSentAfterChange(user.tz, c.eveningTime, now) });
  if (c.eveningOn !== undefined) {
    patch.eveningOn = c.eveningOn;
    if (c.eveningOn) patch.lastEvening = lastSentAfterChange(user.tz, c.eveningTime ?? user.eveningTime, now);
  }

  if (c.rainAlerts !== undefined) Object.assign(patch, { rainAlerts: c.rainAlerts, lastRainAlert: 0 });
  if (c.aqiAlert !== undefined) Object.assign(patch, { aqiAlert: c.aqiAlert, aqiAlertActive: false, lastAqiAlert: 0 });
  if (c.warningsOn !== undefined) patch.warningsOn = c.warningsOn;
  return patch;
}

/** Change the language, and rename the saved place into it when that can be done reliably. */
export async function setLanguage(env: Env, wx: WeatherService, user: User, lang: Lang): Promise<User> {
  let u = await patchUser(env.DB, user.chatId, { lang });
  const np = await localisedPlace(wx, u, lang);
  if (np.name !== u.placeName || np.country !== u.country) {
    u = await patchUser(env.DB, u.chatId, { placeName: np.name, country: np.country }); // rename only: keeps the saved state
    u = await syncActivePlace(env, u); // the list of saved places shows the new name too
  }
  return u;
}
