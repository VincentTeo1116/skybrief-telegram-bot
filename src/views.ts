import { placeOf } from "./db";
import { hourlyMessage, weatherMessage } from "./format";
import { reportKeyboard, type View } from "./keyboards";
import type { Markup } from "./telegram";
import type { User } from "./types";
import type { WeatherService } from "./weather";

/** Build the message text + inline keyboard for a user's report. */
export async function buildView(
  wx: WeatherService,
  user: User,
  view: View = "now",
  opts: { force?: boolean; ribbon?: string } = {},
): Promise<{ text: string; markup: Markup }> {
  const report = await wx.fetchReport(placeOf(user), opts.force ?? false);
  const text = view === "hourly" ? hourlyMessage(report, user.lang) : weatherMessage(report, user.lang, user.hidden, opts.ribbon);
  return { text, markup: reportKeyboard(user, view) };
}
