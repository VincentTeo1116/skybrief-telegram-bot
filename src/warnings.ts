/**
 * Official weather warnings from the Malaysian Meteorological Department (MetMalaysia), via the open data
 * portal: https://api.data.gov.my/weather/warning/   (the trailing slash matters: without it the API redirects)
 *
 * What the feed looks like (verified against the live service):
 *  - a short list of CURRENT items: thunderstorms, heavy rain, hot weather, strong winds & rough seas, tropical
 *    cyclone status ("No Advisory" when there is none) ...
 *  - free text in English and Malay, naming STATES and districts. There are no coordinates, so the best we can do
 *    is match on the user's STATE and show the districts the warning actually lists.
 *  - times are local Malaysian time without a timezone.
 *  - sea warnings list "the waters of Penang • Perak …": they must NOT be shown to people on land.
 */
import type { Place } from "./types";
import { addHours } from "./insights";
import { localParts } from "./util";

export type State =
  | "Johor" | "Kedah" | "Kelantan" | "Melaka" | "Negeri Sembilan" | "Pahang" | "Perak" | "Perlis" | "Pulau Pinang"
  | "Sabah" | "Sarawak" | "Selangor" | "Terengganu" | "Kuala Lumpur" | "Putrajaya" | "Labuan";

/** Names a state can have in a geocoder result (English / Malay / Chinese), lower-cased. */
const PLACE_ALIASES: [State, RegExp][] = [
  ["Kuala Lumpur", /kuala lumpur|吉隆坡/],
  ["Putrajaya", /putrajaya|布城/],
  ["Labuan", /labuan|纳闽/],
  ["Pulau Pinang", /penang|pulau pinang|槟城|槟榔屿/],
  ["Melaka", /melaka|malacca|马六甲/],
  ["Negeri Sembilan", /negeri sembilan|森美兰/],
  ["Johor", /johor|柔佛/],
  ["Kedah", /kedah|吉打/],
  ["Kelantan", /kelantan|吉兰丹/],
  ["Pahang", /pahang|彭亨/],
  ["Perak", /perak|霹雳/],
  ["Perlis", /perlis|玻璃市/],
  ["Sabah", /sabah|沙巴/],
  ["Sarawak", /sarawak|砂拉越|砂劳越/],
  ["Selangor", /selangor|雪兰莪/],
  ["Terengganu", /terengganu|登嘉楼/],
];

/** How the warning text refers to each state (English and Malay). */
const TEXT_ALIASES: Record<State, RegExp> = {
  "Kuala Lumpur": /kuala lumpur/i,
  Putrajaya: /putrajaya/i,
  Labuan: /labuan/i,
  "Pulau Pinang": /penang|pulau pinang/i,
  Melaka: /melaka|malacca/i,
  "Negeri Sembilan": /negeri sembilan/i,
  Johor: /johor/i,
  Kedah: /kedah/i,
  Kelantan: /kelantan/i,
  Pahang: /pahang/i,
  Perak: /perak/i,
  Perlis: /perlis/i,
  Sabah: /sabah/i,
  Sarawak: /sarawak/i,
  Selangor: /selangor/i,
  Terengganu: /terengganu/i,
};

/** "Wilayah Persekutuan Kuala Lumpur" / "Pulau Pinang" / "霹雳" -> a canonical state, or null if it isn't one. */
export function canonicalState(text: string | null | undefined): State | null {
  if (!text) return null;
  const t = text.toLowerCase();
  return PLACE_ALIASES.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** The state to store for a place: Malaysian places only, '' when it can't be told (resolved later). */
export function stateOfPlace(p: Pick<Place, "state" | "admin">): State | null {
  return canonicalState(p.state) ?? canonicalState(p.admin);
}

// ----------------------------------------------------------------- the feed
export interface Warning {
  id: string;
  issued: string; // local "YYYY-MM-DDTHH:MM"
  from: string | null;
  to: string | null;
  titleEn: string;
  titleBm: string;
  textEn: string;
  textBm: string;
  instructionEn: string;
  instructionBm: string;
  kind: "land" | "sea" | "none";
}

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const minute = (v: unknown): string | null => (typeof v === "string" && v.length >= 16 ? v.slice(0, 16) : null);

/** A short stable id for "this warning as issued", so nobody is told about the same one twice. */
export function warningId(issued: string, title: string): string {
  let h = 5381;
  for (const ch of `${issued}|${title}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export function classify(w: Pick<Warning, "titleEn" | "titleBm" | "textEn" | "from" | "to">): Warning["kind"] {
  if (!w.from || !w.to || /no advisory|tiada nasihat/i.test(w.titleEn + " " + w.titleBm)) return "none";
  if (/rough sea|sea state|bergelora/i.test(`${w.titleEn} ${w.titleBm}`) || /^\s*SECTION A:\s*FOR MALAYSIAN WATERS/i.test(w.textEn)) return "sea";
  return "land";
}

/** Read the raw JSON defensively: the feed is a third-party format and may change. Anything unusable is skipped. */
export function parseWarnings(raw: unknown): Warning[] {
  if (!Array.isArray(raw)) return [];
  const out: Warning[] = [];
  for (const r of raw as Record<string, any>[]) {
    const issued = minute(r?.warning_issue?.issued);
    const titleEn = str(r?.warning_issue?.title_en);
    if (!issued || !titleEn) continue;
    const w = {
      id: warningId(issued, titleEn),
      issued,
      from: minute(r.valid_from),
      to: minute(r.valid_to),
      titleEn,
      titleBm: str(r?.warning_issue?.title_bm) || titleEn,
      textEn: str(r.text_en),
      textBm: str(r.text_bm) || str(r.text_en),
      instructionEn: str(r.instruction_en),
      instructionBm: str(r.instruction_bm) || str(r.instruction_en),
    };
    out.push({ ...w, kind: classify(w) });
  }
  return out;
}

/** "now" as Malaysian local time, in the feed's own format. */
export function nowMalaysia(now: Date): string {
  const { date, time } = localParts("Asia/Kuala_Lumpur", now);
  return `${date}T${time}`;
}

/** Still in force (or about to be within 12 hours), and for land. Expired and "No Advisory" items are dropped. */
export function isCurrent(w: Warning, nowLocal: string): boolean {
  return w.kind === "land" && !!w.to && !!w.from && w.to >= nowLocal && w.from <= addHours(nowLocal, 12);
}

export const currentLandWarnings = (all: Warning[], now: Date): Warning[] => all.filter((w) => isCurrent(w, nowMalaysia(now)));

/** Does this warning name the state? (English or Malay text.) */
export function mentionsState(w: Warning, state: State): boolean {
  const re = TEXT_ALIASES[state];
  return re.test(w.textEn) || re.test(w.textBm);
}

export function warningsForState(all: Warning[], state: State, now: Date): Warning[] {
  return currentLandWarnings(all, now).filter((w) => mentionsState(w, state));
}

/**
 * The part of the warning that concerns this state, e.g. "Perak (Kampar, Kinta, Kuala Kangsar …)".
 * The text separates states with "•"; returns null when the state isn't found in a bullet.
 */
export function stateSegment(w: Warning, state: State, bm = false): string | null {
  const text = bm ? w.textBm : w.textEn;
  const re = TEXT_ALIASES[state];
  const seg = text.split("•").find((part) => re.test(part));
  if (!seg) return null;
  // start at the state's own name (the first bullet also carries the sentence's introduction) and drop the trailing "until 10:00 AM; Wednesday…"
  const from = seg.search(re);
  const s = seg
    .slice(from)
    .trim()
    .replace(/\s+(until|sehingga)\b.*$/i, "")
    .replace(/\s+/g, " ");
  return s.length > 320 ? s.slice(0, 317).replace(/\s+\S*$/, "") + "…" : s;
}

// ------------------------------------------------------------ districts
/** "Daerah Timor Laut" / "Timur Laut" / "Kinta District" -> one comparable form. */
export function normalizeArea(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(daerah|district|majlis|perbandaran|city of|city|bandar raya|bandaraya)\b/g, " ")
    .replace(/\btimor\b/g, "timur") // the feed writes "Timor Laut", geocoders write "Timur Laut"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The districts / divisions a warning lists for one state. Empty = it names the state without listing any (state-wide). */
export function listedAreas(w: Warning, state: State): string[] {
  const seg = stateSegment(w, state);
  if (!seg) return [];
  const re = TEXT_ALIASES[state];
  return seg
    .replace(re, " ") // the state's own name is not an area
    .split(/[(),:;]|\band\b|\bdan\b/i)
    .map(normalizeArea)
    .filter((x) => x.length >= 3);
}

const sameArea = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));

/**
 * Does the warning cover this person? Conservative on purpose: a warning is hidden ONLY when we positively know the
 * person's district AND the warning lists specific districts that don't include it. In any doubt, show it: a missed
 * flood warning is worse than an unnecessary message.
 */
export function coversArea(w: Warning, state: State, district: string, placeName: string): boolean {
  const areas = listedAreas(w, state);
  if (!areas.length) return true; // state-wide
  const mine = normalizeArea(district);
  if (!mine) return true; // we don't know their district
  if (areas.some((a) => sameArea(a, mine))) return true;
  // the city name itself may be listed ("Kuching", "Sibu"); it only ever ADDS matches
  const cities = placeName.split(/[,()]/).map(normalizeArea).filter((x) => x.length >= 3);
  return cities.some((c) => areas.some((a) => sameArea(a, c)));
}

export interface WarningRecipient {
  region: string;
  district: string;
  placeName: string;
}

/** The current land warnings that apply to this person. */
export function warningsForUser(all: Warning[], u: WarningRecipient, now: Date): Warning[] {
  const state = canonicalState(u.region);
  if (!state) return [];
  return warningsForState(all, state, now).filter((w) => coversArea(w, state, u.district, u.placeName));
}

/** Cut at a word boundary. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}
