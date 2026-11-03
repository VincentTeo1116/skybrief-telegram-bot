/** D1 (SQLite) access: one row per Telegram user. */
import { normLang } from "./i18n";
import type { ClockMode, Place, Status, TempUnit, User, WindUnit } from "./types";

type Row = Record<string, unknown>;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

function toUser(r: Row): User {
  return {
    chatId: Number(r.chat_id),
    firstName: String(r.first_name ?? ""),
    username: String(r.username ?? ""),
    status: r.status as Status,
    placeName: String(r.place_name),
    lat: Number(r.lat),
    lon: Number(r.lon),
    country: String(r.country ?? ""),
    tz: String(r.tz ?? "UTC"),
    lang: normLang(String(r.lang ?? "en")),
    hidden: new Set(String(r.hidden ?? "").split(",").filter(Boolean)),
    dailyOn: Number(r.daily_on) === 1,
    dailyTime: String(r.daily_time ?? "08:30"),
    lastSent: String(r.last_sent ?? ""),
    searchJson: String(r.search_json ?? ""),
    createdAt: String(r.created_at ?? ""),
    tempUnit: oneOf<TempUnit>(r.temp_unit, ["c", "f"], "c"),
    windUnit: oneOf<WindUnit>(r.wind_unit, ["kmh", "ms", "mph"], "kmh"),
    clock: oneOf<ClockMode>(r.clock, ["auto", "12", "24"], "auto"),
    compact: Number(r.compact) === 1,
    rainAlerts: Number(r.rain_alerts) === 1,
    aqiAlert: Number(r.aqi_alert) || 0,
    aqiAlertActive: Number(r.aqi_alert_active) === 1,
    lastRainAlert: Number(r.last_rain_alert) || 0,
    lastAqiAlert: Number(r.last_aqi_alert) || 0,
    lastAlertCheck: Number(r.last_alert_check) || 0,
    eveningOn: Number(r.evening_on) === 1,
    eveningTime: String(r.evening_time ?? "18:00"),
    lastEvening: String(r.last_evening ?? ""),
  };
}

export function placeOf(u: User): Place {
  return { name: u.placeName, lat: u.lat, lon: u.lon, country: u.country, tz: u.tz };
}

export async function getUser(db: D1Database, chatId: number): Promise<User | null> {
  const r = await db.prepare("SELECT * FROM users WHERE chat_id = ?").bind(chatId).first<Row>();
  return r ? toUser(r) : null;
}

export interface NewUser {
  chatId: number;
  firstName: string;
  username: string;
  status: Status;
  place: Place;
  dailyTime: string;
}

export async function insertUser(db: D1Database, n: NewUser): Promise<User> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (chat_id, first_name, username, status, place_name, lat, lon, country, tz, daily_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(n.chatId, n.firstName, n.username, n.status, n.place.name, n.place.lat, n.place.lon, n.place.country, n.place.tz, n.dailyTime)
    .run();
  return (await getUser(db, n.chatId))!;
}

export interface UserPatch {
  firstName?: string;
  username?: string;
  status?: Status;
  placeName?: string;
  lat?: number;
  lon?: number;
  country?: string;
  tz?: string;
  lang?: string;
  hidden?: Set<string>;
  dailyOn?: boolean;
  dailyTime?: string;
  lastSent?: string;
  searchJson?: string;
  tempUnit?: TempUnit;
  windUnit?: WindUnit;
  clock?: ClockMode;
  compact?: boolean;
  rainAlerts?: boolean;
  aqiAlert?: number;
  aqiAlertActive?: boolean;
  lastRainAlert?: number;
  lastAqiAlert?: number;
  lastAlertCheck?: number;
  eveningOn?: boolean;
  eveningTime?: string;
  lastEvening?: string;
}

// Whitelist of patchable fields -> column names (never interpolate caller-provided keys into SQL).
const COLUMNS: Record<keyof UserPatch, string> = {
  firstName: "first_name",
  username: "username",
  status: "status",
  placeName: "place_name",
  lat: "lat",
  lon: "lon",
  country: "country",
  tz: "tz",
  lang: "lang",
  hidden: "hidden",
  dailyOn: "daily_on",
  dailyTime: "daily_time",
  lastSent: "last_sent",
  searchJson: "search_json",
  tempUnit: "temp_unit",
  windUnit: "wind_unit",
  clock: "clock",
  compact: "compact",
  rainAlerts: "rain_alerts",
  aqiAlert: "aqi_alert",
  aqiAlertActive: "aqi_alert_active",
  lastRainAlert: "last_rain_alert",
  lastAqiAlert: "last_aqi_alert",
  lastAlertCheck: "last_alert_check",
  eveningOn: "evening_on",
  eveningTime: "evening_time",
  lastEvening: "last_evening",
};

export async function patchUser(db: D1Database, chatId: number, patch: UserPatch): Promise<User> {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const key of Object.keys(patch) as (keyof UserPatch)[]) {
    const col = COLUMNS[key];
    if (!col) continue;
    const v = patch[key];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    values.push(v instanceof Set ? [...v].sort().join(",") : typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number));
  }
  if (sets.length) {
    await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE chat_id = ?`).bind(...values, chatId).run();
  }
  return (await getUser(db, chatId))!;
}

export async function setLocation(db: D1Database, chatId: number, p: Place): Promise<User> {
  return patchUser(db, chatId, { placeName: p.name, lat: p.lat, lon: p.lon, country: p.country, tz: p.tz });
}

export async function toggleSection(db: D1Database, chatId: number, section: string): Promise<User> {
  const u = (await getUser(db, chatId))!;
  const hidden = new Set(u.hidden);
  if (hidden.has(section)) hidden.delete(section);
  else hidden.add(section);
  return patchUser(db, chatId, { hidden });
}

/** Users who may receive the morning and/or evening report. */
export async function dailyCandidates(db: D1Database): Promise<User[]> {
  const { results } = await db.prepare("SELECT * FROM users WHERE status = 'active' AND (daily_on = 1 OR evening_on = 1)").all<Row>();
  return results.map(toUser);
}

/** Users with at least one alert switched on. */
export async function alertCandidates(db: D1Database): Promise<User[]> {
  const { results } = await db.prepare("SELECT * FROM users WHERE status = 'active' AND (rain_alerts = 1 OR aqi_alert > 0)").all<Row>();
  return results.map(toUser);
}

export async function listUsers(db: D1Database, limit = 50): Promise<User[]> {
  const { results } = await db.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT ?").bind(limit).all<Row>();
  return results.map(toUser);
}

export type Slot = "morning" | "evening";
const SLOT_COLUMN: Record<Slot, string> = { morning: "last_sent", evening: "last_evening" };

/** Atomically claim today's report for a slot. Returns false if it was already claimed (prevents duplicates). */
export async function claimDaily(db: D1Database, chatId: number, localDate: string, slot: Slot = "morning"): Promise<boolean> {
  const col = SLOT_COLUMN[slot]; // from a fixed map, never from user input
  const r = await db.prepare(`UPDATE users SET ${col} = ? WHERE chat_id = ? AND ${col} <> ?`).bind(localDate, chatId, localDate).run();
  return (r.meta.changes ?? 0) > 0;
}
