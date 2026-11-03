import { placeOf } from "./db";
import { hourlyMessage, tomorrowMessage, weatherMessage, weekMessage } from "./format";
import { reportKeyboard, type View } from "./keyboards";
import type { Markup } from "./telegram";
import type { User } from "./types";
import { prefsOf } from "./units";
import type { WeatherService } from "./weather";

/** Build the message text + inline keyboard for one of a user's report views. */
export async function buildView(
  wx: WeatherService,
  user: User,
  view: View = "now",
  opts: { force?: boolean; ribbon?: string } = {},
): Promise<{ text: string; markup: Markup }> {
  const report = await wx.fetchReport(placeOf(user), opts.force ?? false);
  const p = prefsOf(user);
  let text: string;
  switch (view) {
    case "hourly":
      text = hourlyMessage(report, p);
      break;
    case "tomorrow":
      text = tomorrowMessage(report, p, opts.ribbon);
      break;
    case "week":
      text = weekMessage(report, p);
      break;
    default:
      text = weatherMessage(report, p, opts.ribbon);
  }
  return { text, markup: reportKeyboard(user, view) };
}
