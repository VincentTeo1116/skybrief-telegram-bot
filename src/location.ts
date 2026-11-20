/** Saving a location (FR-9): the one code path shared by the chat (buttons, search, GPS) and the mini app. */
import { lastSentAfterChange } from "./daily";
import { patchUser, setLocation } from "./db";
import type { Env, Place, Report, User } from "./types";
import type { WeatherService } from "./weather";

/**
 * Validate a place by fetching its weather, then persist it. Throws WeatherError when the weather can't be fetched,
 * in which case nothing is saved.
 */
export async function savePlace(env: Env, wx: WeatherService, user: User, place: Place): Promise<{ user: User; report: Report }> {
  // No backup source here: it can't tell us the timezone we are about to save.
  const report = await wx.fetchReport(place, true, { allowFallback: false });
  place.tz = report.wx.timezone;
  let u = await setLocation(env.DB, user.chatId, place);
  // The timezone may have changed: don't fire a "late" report right after moving.
  u = await patchUser(env.DB, u.chatId, {
    lastSent: lastSentAfterChange(u.tz, u.dailyTime),
    lastEvening: lastSentAfterChange(u.tz, u.eveningTime),
  });
  return { user: u, report };
}
