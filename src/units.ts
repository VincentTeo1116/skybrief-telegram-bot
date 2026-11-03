/** Display preferences and unit conversion. The data stays metric internally; we convert only when rendering. */
import type { Lang, Prefs, TempUnit, User, WindUnit } from "./types";

export const TEMP_UNITS: readonly TempUnit[] = ["c", "f"];
export const WIND_UNITS: readonly WindUnit[] = ["kmh", "ms", "mph"];
export const CLOCK_MODES = ["auto", "12", "24"] as const;
export const AQI_ALERT_LEVELS = [0, 101, 151, 201] as const;

export function defaultPrefs(lang: Lang = "en"): Prefs {
  return { lang, hidden: new Set(), tempUnit: "c", windUnit: "kmh", clock: "auto", compact: false };
}

export function prefsOf(u: User): Prefs {
  return { lang: u.lang, hidden: u.hidden, tempUnit: u.tempUnit, windUnit: u.windUnit, clock: u.clock, compact: u.compact };
}

export const cToDisplay = (c: number, unit: TempUnit): number => (unit === "f" ? (c * 9) / 5 + 32 : c);

/** "28°" in the user's unit, or "–" when unknown. */
export function deg(c: number | null | undefined, p: Pick<Prefs, "tempUnit">): string {
  return c == null ? "–" : `${Math.round(cToDisplay(c, p.tempUnit))}°`;
}

export const unitLetter = (p: Pick<Prefs, "tempUnit">) => (p.tempUnit === "f" ? "F" : "C");

/** Size of a temperature DIFFERENCE in the user's unit (no +32 offset). Always positive. */
export function deltaDisplay(deltaC: number, p: Pick<Prefs, "tempUnit">): number {
  return Math.round(Math.abs(p.tempUnit === "f" ? deltaC * 1.8 : deltaC));
}

/** Wind speed given in km/h, rendered in the user's unit. */
export function speed(kmh: number, p: Pick<Prefs, "windUnit">): string {
  switch (p.windUnit) {
    case "ms": {
      const v = kmh / 3.6;
      return `${v < 10 ? v.toFixed(1) : Math.round(v)} m/s`;
    }
    case "mph":
      return `${Math.round(kmh * 0.621371)} mph`;
    default:
      return `${Math.round(kmh)} km/h`;
  }
}
