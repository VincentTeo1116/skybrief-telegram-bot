/** One-tap city shortcuts. Edit freely: [English, Bahasa Melayu, 中文, lat, lon, IANA timezone, country code, state, district (for Malaysian cities)]. */
import type { Lang, Place } from "./types";

const COUNTRIES: Record<string, [string, string, string]> = {
  MY: ["Malaysia", "Malaysia", "马来西亚"],
  SG: ["Singapore", "Singapura", "新加坡"],
};

type Row = [string, string, string, number, number, string, string, string?, string?];
const DATA: Row[] = [
  ["Kuala Lumpur", "Kuala Lumpur", "吉隆坡", 3.139, 101.6869, "Asia/Kuala_Lumpur", "MY", "Kuala Lumpur"],
  ["Petaling Jaya", "Petaling Jaya", "八打灵再也", 3.1073, 101.6067, "Asia/Kuala_Lumpur", "MY", "Selangor", "Petaling"],
  ["Shah Alam", "Shah Alam", "沙阿南", 3.0733, 101.5185, "Asia/Kuala_Lumpur", "MY", "Selangor", "Petaling"],
  ["George Town (Penang)", "George Town (Pulau Pinang)", "乔治市（槟城）", 5.4141, 100.3288, "Asia/Kuala_Lumpur", "MY", "Pulau Pinang", "Timur Laut"],
  ["Johor Bahru", "Johor Bahru", "新山", 1.4927, 103.7414, "Asia/Kuala_Lumpur", "MY", "Johor", "Johor Bahru"],
  ["Ipoh", "Ipoh", "怡保", 4.5975, 101.0901, "Asia/Kuala_Lumpur", "MY", "Perak", "Kinta"],
  ["Melaka", "Melaka", "马六甲", 2.1896, 102.2501, "Asia/Kuala_Lumpur", "MY", "Melaka", "Melaka Tengah"],
  ["Kota Kinabalu", "Kota Kinabalu", "亚庇", 5.9804, 116.0735, "Asia/Kuching", "MY", "Sabah", "Kota Kinabalu"],
  ["Kuching", "Kuching", "古晋", 1.5535, 110.3593, "Asia/Kuching", "MY", "Sarawak", "Kuching"],
  ["Singapore", "Singapura", "新加坡", 1.3521, 103.8198, "Asia/Singapore", "SG"],
];

const IDX: Record<Lang, number> = { en: 0, ms: 1, zh: 2 };

export const PRESET_COUNT = DATA.length;

export function presetName(i: number, lang: Lang): string {
  return DATA[i][IDX[lang]] as string;
}

export function presetPlace(i: number, lang: Lang = "en"): Place {
  const r = DATA[i];
  return {
    name: r[IDX[lang]] as string,
    lat: r[3],
    lon: r[4],
    country: COUNTRIES[r[6]][IDX[lang]],
    district: r[8],
    state: r[7], // the English state name: official warnings are matched on it (kept apart from `admin`, which shows in labels)
    tz: r[5],
  };
}

/** Index of the preset at these coordinates, or null. */
export function matchPreset(lat: number, lon: number): number | null {
  const i = DATA.findIndex((r) => Math.abs(r[3] - lat) < 0.0005 && Math.abs(r[4] - lon) < 0.0005);
  return i >= 0 ? i : null;
}

/** Nearest preset within `maxKm`, used as a friendly name when reverse geocoding is unavailable. */
export function nearestPreset(lat: number, lon: number, maxKm: number, distance: (a: number, b: number, c: number, d: number) => number): number | null {
  let best: number | null = null;
  let bestKm = maxKm;
  DATA.forEach((r, i) => {
    const km = distance(lat, lon, r[3], r[4]);
    if (km < bestKm) {
      best = i;
      bestKm = km;
    }
  });
  return best;
}

export const DEFAULT_PLACE: Place = presetPlace(0, "en");
