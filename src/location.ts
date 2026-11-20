/**
 * Locations: saving one (FR-9), the short list of saved places (FR-12), and renaming into another language.
 * The one code path shared by the chat (buttons, search, GPS) and the mini app.
 *
 * The ACTIVE place lives in the user's own columns, as it always has. `places_json` is only a memory of up to
 * MAX_PLACES recent places so the mini app can switch between them with one tap.
 */
import { lastSentAfterChange } from "./daily";
import { patchUser, placeOf, setLocation } from "./db";
import { matchPreset, presetPlace } from "./presets";
import type { Env, Lang, Place, Report, User } from "./types";
import { haversineKm } from "./util";
import type { WeatherService } from "./weather";

export const MAX_PLACES = 5;

export interface SavedPlace {
  name: string;
  lat: number;
  lon: number;
  country: string;
  tz: string;
  /** As stored on the user: a Malaysian state, '' (Malaysia, not known yet) or '-' (not Malaysia). */
  region: string;
  district: string;
}

const samePlace = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;

export const activeOf = (u: User): SavedPlace => ({ name: u.placeName, lat: u.lat, lon: u.lon, country: u.country, tz: u.tz, region: u.region, district: u.district });

/** Read the stored list defensively: it is our own JSON, but a damaged row must never break a page. */
function storedPlaces(u: User): SavedPlace[] {
  let raw: unknown;
  try {
    raw = JSON.parse(u.placesJson || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: SavedPlace[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p.name !== "string" || !p.name || typeof p.lat !== "number" || typeof p.lon !== "number" || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (typeof p.tz !== "string" || !p.tz) continue;
    if (out.some((x) => samePlace(x, p as unknown as SavedPlace))) continue;
    out.push({ name: p.name.slice(0, 80), lat: p.lat, lon: p.lon, country: String(p.country ?? ""), tz: p.tz, region: String(p.region ?? ""), district: String(p.district ?? "") });
  }
  return out.slice(0, MAX_PLACES);
}

/**
 * The person's places as the mini app shows them: the stored list, with the active place always present (first, if
 * it was never stored, e.g. for someone who set their city before this feature existed). Every index the app sends
 * back refers to THIS list.
 */
export function savedPlaces(u: User): SavedPlace[] {
  const list = storedPlaces(u);
  if (list.some((p) => samePlace(p, u))) return list;
  return [activeOf(u), ...list].slice(0, MAX_PLACES);
}

export const isActivePlace = (u: User, p: SavedPlace) => samePlace(u, p);

/** Put `p` at the front (newest first), without duplicates, keeping at most MAX_PLACES. */
function remember(list: SavedPlace[], p: SavedPlace): SavedPlace[] {
  return [p, ...list.filter((x) => !samePlace(x, p))].slice(0, MAX_PLACES);
}

/** Make sure the active place is in the stored list under its current name (after a rename, or for older rows). */
export async function syncActivePlace(env: Env, u: User): Promise<User> {
  const active = activeOf(u);
  const list = savedPlaces(u).map((p) => (samePlace(p, active) ? active : p));
  return patchUser(env.DB, u.chatId, { placesJson: JSON.stringify(list) });
}

/**
 * Validate a place by fetching its weather, then persist it as the active place and remember it.
 * Throws WeatherError when the weather can't be fetched, in which case nothing is saved.
 */
export async function savePlace(env: Env, wx: WeatherService, user: User, place: Place): Promise<{ user: User; report: Report }> {
  // No backup source here: it can't tell us the timezone we are about to save.
  const report = await wx.fetchReport(place, true, { allowFallback: false });
  place.tz = report.wx.timezone;
  const before = savedPlaces(user); // includes the place we are leaving, so it stays one tap away
  let u = await setLocation(env.DB, user.chatId, place);
  // The timezone may have changed: don't fire a "late" report right after moving.
  u = await patchUser(env.DB, u.chatId, {
    lastSent: lastSentAfterChange(u.tz, u.dailyTime),
    lastEvening: lastSentAfterChange(u.tz, u.eveningTime),
    placesJson: JSON.stringify(remember(before, activeOf(u))),
  });
  return { user: u, report };
}

/**
 * Switch to one of the saved places (index into savedPlaces). Its timezone and state are already known, so the
 * weather may come from the cache or the backup source. Returns null for an index that isn't in the list.
 */
export async function activatePlace(env: Env, wx: WeatherService, user: User, index: number): Promise<{ user: User; report: Report } | null> {
  const list = savedPlaces(user);
  const p = list[index];
  if (!p) return null;
  const report = await wx.fetchReport({ name: p.name, lat: p.lat, lon: p.lon, country: p.country, tz: p.tz });
  const u = await patchUser(env.DB, user.chatId, {
    placeName: p.name, lat: p.lat, lon: p.lon, country: p.country, tz: p.tz, region: p.region, district: p.district,
    lastSent: lastSentAfterChange(p.tz, user.dailyTime),
    lastEvening: lastSentAfterChange(p.tz, user.eveningTime),
    placesJson: JSON.stringify(list), // order unchanged: the chips must not jump around when tapped
  });
  return { user: u, report: { ...report, place: placeOf(u) } };
}

/** Forget a saved place. The active place can't be removed (there must always be one). Null = nothing to remove. */
export async function forgetPlace(env: Env, user: User, index: number): Promise<User | null> {
  const list = savedPlaces(user);
  const p = list[index];
  if (!p || samePlace(p, user)) return null;
  return patchUser(env.DB, user.chatId, { placesJson: JSON.stringify(list.filter((_, i) => i !== index)) });
}

/** The user's saved place, renamed into `lang` when that can be done reliably. */
export async function localisedPlace(wx: WeatherService, u: User, lang: Lang): Promise<Place> {
  const p = placeOf(u);
  const idx = matchPreset(p.lat, p.lon);
  if (idx !== null) return { ...presetPlace(idx, lang), tz: p.tz };
  try {
    for (const cand of await wx.searchPlaces(p.name, 5, lang)) {
      if (haversineKm(p.lat, p.lon, cand.lat, cand.lon) < 15) return { ...cand, lat: p.lat, lon: p.lon, tz: p.tz };
    }
  } catch {
    /* keep the existing name */
  }
  return p;
}
