import { describe, expect, it } from "vitest";
import {
  canonicalState,
  classify,
  clip,
  coversArea,
  currentLandWarnings,
  isCurrent,
  listedAreas,
  mentionsState,
  normalizeArea,
  nowMalaysia,
  parseWarnings,
  stateOfPlace,
  stateSegment,
  warningId,
  warningsForUser,
  type Warning,
} from "../src/warnings";
import real from "./data/mmd-warnings.json";

/** A real MetMalaysia feed recorded on 2026-11-04: a sea warning, a thunderstorm warning (06:00-10:00) and "No Advisory". */
const FEED = parseWarnings(real);
const THUNDER = FEED.find((w) => w.titleEn === "Thunderstorms Warning")!;
const SEA = FEED.find((w) => /Rough Seas/.test(w.titleEn))!;
const NONE = FEED.find((w) => w.titleEn === "No Advisory")!;

/** A Malaysian wall-clock time on 2026-11-04 as a Date (Malaysia is UTC+8). */
const my = (h: number, m = 0, day = 4) => new Date(Date.UTC(2026, 10, day, h - 8, m));

const make = (o: Partial<Warning> & { text: string }): Warning => {
  const base = {
    id: "x",
    issued: "2026-11-04T06:00",
    from: "2026-11-04T06:00",
    to: "2026-11-04T12:00",
    titleEn: "Heavy Rain Warning",
    titleBm: "Amaran Hujan Lebat",
    textEn: o.text,
    textBm: o.text,
    instructionEn: "",
    instructionBm: "",
  };
  const w = { ...base, ...o } as Warning;
  return { ...w, textEn: o.text, textBm: o.textBm ?? o.text, kind: classify(w) };
};

describe("reading the real feed", () => {
  it("parses every item and sorts them into land / sea / none", () => {
    expect(FEED).toHaveLength(3);
    expect(THUNDER.kind).toBe("land");
    expect(SEA.kind).toBe("sea");
    expect(NONE.kind).toBe("none");
  });

  it("keeps the times as Malaysian local minutes and reads both languages", () => {
    expect(THUNDER).toMatchObject({ issued: "2026-11-04T06:45", from: "2026-11-04T06:00", to: "2026-11-04T10:00" });
    expect(THUNDER.titleBm).toBe("Amaran Ribut Petir");
    expect(THUNDER.textBm).toContain("Ribut petir");
    expect(NONE.from).toBeNull();
  });

  it("gives each warning a stable, distinct id (a re-issued warning gets a new one)", () => {
    expect(new Set(FEED.map((w) => w.id)).size).toBe(3);
    expect(warningId("2026-11-04T06:45", "Thunderstorms Warning")).toBe(THUNDER.id);
    expect(warningId("2026-11-04T09:15", "Thunderstorms Warning")).not.toBe(THUNDER.id);
  });

  it("copes with a feed that changes shape instead of crashing", () => {
    expect(parseWarnings(null)).toEqual([]);
    expect(parseWarnings({ error: "nope" })).toEqual([]);
    expect(parseWarnings([null, 5, "x", {}, { warning_issue: {} }])).toEqual([]);
    const odd = parseWarnings([{ warning_issue: { issued: "2026-11-04T06:00:00", title_en: "Odd" }, valid_from: "2026-11-04T06:00:00", valid_to: "2026-11-04T09:00:00" }]);
    expect(odd).toHaveLength(1);
    expect(odd[0].textEn).toBe("");
    expect(odd[0].titleBm).toBe("Odd"); // falls back to English
  });
});

describe("what counts as a warning for people on land", () => {
  it("excludes sea warnings, even though they list states like Penang and Perak", () => {
    expect(SEA.textEn).toMatch(/Penang/);
    expect(mentionsState(SEA, "Pulau Pinang")).toBe(true); // it DOES name the state…
    expect(currentLandWarnings(FEED, my(8, 50))).toEqual([THUNDER]); // …but it is never shown
  });

  it("recognises sea warnings by title (English or Malay) or by the 'waters' section", () => {
    expect(classify({ titleEn: "Strong Winds and Rough Seas Warning", titleBm: "", textEn: "", from: "a", to: "b" })).toBe("sea");
    expect(classify({ titleEn: "x", titleBm: "Amaran Angin Kencang dan Laut Bergelora", textEn: "", from: "a", to: "b" })).toBe("sea");
    expect(classify({ titleEn: "Warning", titleBm: "", textEn: "SECTION A: FOR MALAYSIAN WATERS [WITHIN 24 NAUTICAL MILES]", from: "a", to: "b" })).toBe("sea");
    expect(classify({ titleEn: "Heavy Rain Warning", titleBm: "", textEn: "Heavy rain over Perak", from: "a", to: "b" })).toBe("land");
    expect(classify({ titleEn: "Hot Weather Warning", titleBm: "", textEn: "Level 1 in Perlis", from: "a", to: "b" })).toBe("land");
  });

  it("ignores 'No Advisory' and anything without a validity period", () => {
    expect(classify({ titleEn: "No Advisory", titleBm: "", textEn: "x", from: "a", to: "b" })).toBe("none");
    expect(classify({ titleEn: "Thunderstorms Warning", titleBm: "", textEn: "x", from: null, to: null })).toBe("none");
  });

  it("is current from 12 hours before it starts until it ends", () => {
    expect(isCurrent(THUNDER, "2026-11-04T08:50")).toBe(true);
    expect(isCurrent(THUNDER, "2026-11-04T10:00")).toBe(true); // the last minute
    expect(isCurrent(THUNDER, "2026-11-04T10:01")).toBe(false); // expired
    expect(isCurrent(THUNDER, "2026-11-03T20:00")).toBe(true); // starts within 12 h: worth knowing now
    expect(isCurrent(THUNDER, "2026-11-03T17:00")).toBe(false); // 13 h away: too early
    expect(isCurrent(NONE, "2026-11-04T08:50")).toBe(false);
  });

  it("converts any instant to Malaysian time in the feed's format", () => {
    expect(nowMalaysia(new Date("2026-11-04T00:50:00Z"))).toBe("2026-11-04T08:50");
    expect(nowMalaysia(new Date("2026-11-03T16:05:00Z"))).toBe("2026-11-04T00:05");
  });
});

describe("states", () => {
  it("understands how geocoders name them: English, Malay and Chinese", () => {
    const cases: [string, string | null][] = [
      ["Wilayah Persekutuan Kuala Lumpur", "Kuala Lumpur"],
      ["Kuala Lumpur", "Kuala Lumpur"],
      ["吉隆坡", "Kuala Lumpur"],
      ["Wilayah Persekutuan Putrajaya", "Putrajaya"],
      ["Wilayah Persekutuan Labuan", "Labuan"],
      ["Pulau Pinang", "Pulau Pinang"],
      ["Penang", "Pulau Pinang"],
      ["槟城", "Pulau Pinang"],
      ["Malacca", "Melaka"],
      ["Negeri Sembilan", "Negeri Sembilan"],
      ["Johor", "Johor"],
      ["霹雳", "Perak"],
      ["Selangor", "Selangor"],
      ["砂拉越", "Sarawak"],
      ["Singapore", null],
      ["Tokyo", null],
      ["", null],
    ];
    for (const [text, state] of cases) expect(canonicalState(text), text).toBe(state);
    expect(canonicalState(null)).toBeNull();
  });

  it("takes the state from a place, preferring the explicit state field", () => {
    expect(stateOfPlace({ state: "Perak", admin: "Selangor" })).toBe("Perak");
    expect(stateOfPlace({ admin: "Wilayah Persekutuan Kuala Lumpur" })).toBe("Kuala Lumpur");
    expect(stateOfPlace({ admin: "Tokyo" })).toBeNull();
    expect(stateOfPlace({})).toBeNull();
  });

  it("finds which states the real thunderstorm warning names", () => {
    for (const s of ["Kedah", "Pulau Pinang", "Perak", "Kelantan", "Terengganu", "Pahang", "Selangor", "Sarawak"] as const) expect(mentionsState(THUNDER, s), s).toBe(true);
    for (const s of ["Kuala Lumpur", "Johor", "Sabah", "Melaka", "Perlis"] as const) expect(mentionsState(THUNDER, s), s).toBe(false);
  });
});

describe("the part of a warning that concerns one state", () => {
  it("starts at the state's name (not at the sentence's introduction)", () => {
    expect(stateSegment(THUNDER, "Kedah")).toBe("Kedah (Kulim and Bandar Baharu)");
    expect(stateSegment(THUNDER, "Selangor")).toBe("Selangor (Sabak Bernam)");
    expect(stateSegment(THUNDER, "Perak")).toMatch(/^Perak \(Kampar, Kinta, Kuala Kangsar/);
  });

  it("drops the trailing 'until 10:00 AM; Wednesday…' from the last state", () => {
    const seg = stateSegment(THUNDER, "Sarawak")!;
    expect(seg).toMatch(/^Sarawak: Sarikei/);
    expect(seg).toMatch(/Sri Aman$/);
    expect(seg).not.toMatch(/until|10:00/);
  });

  it("returns null for a state that isn't named", () => {
    expect(stateSegment(THUNDER, "Johor")).toBeNull();
  });

  it("lists the districts a warning names for a state", () => {
    expect(listedAreas(THUNDER, "Selangor")).toEqual(["sabak bernam"]);
    expect(listedAreas(THUNDER, "Kedah")).toEqual(["kulim", "bandar baharu"]);
    expect(listedAreas(THUNDER, "Perak")).toEqual(expect.arrayContaining(["kinta", "kampar", "hilir perak", "perak tengah", "hulu perak"]));
    expect(listedAreas(THUNDER, "Sarawak")).toEqual(expect.arrayContaining(["kuching", "sibu", "sri aman", "samarahan", "sarikei", "pakan"]));
    expect(listedAreas(THUNDER, "Johor")).toEqual([]);
  });

  it("treats a bare state name as state-wide", () => {
    const w = make({ text: "Heavy rain is expected over Kuala Lumpur • Putrajaya until 12:00 PM." });
    expect(listedAreas(w, "Kuala Lumpur")).toEqual([]);
    expect(listedAreas(w, "Putrajaya")).toEqual([]);
  });
});

describe("matching a person to a warning (conservative: never hide a warning on a guess)", () => {
  it("hides a district-only warning from people we KNOW live elsewhere in the state", () => {
    // the real case: the warning lists only "Selangor (Sabak Bernam)"
    expect(coversArea(THUNDER, "Selangor", "Petaling", "Shah Alam")).toBe(false);
    expect(coversArea(THUNDER, "Selangor", "Sabak Bernam", "Sabak")).toBe(true);
    expect(coversArea(THUNDER, "Selangor", "Daerah Sabak Bernam", "")).toBe(true);
  });

  it("shows it whenever we don't know their district", () => {
    expect(coversArea(THUNDER, "Selangor", "", "Shah Alam")).toBe(true);
    expect(coversArea(THUNDER, "Perak", "", "Ipoh")).toBe(true);
  });

  it("matches listed districts, ignoring 'Daerah' and spelling differences", () => {
    expect(coversArea(THUNDER, "Perak", "Kinta", "Ipoh")).toBe(true);
    expect(coversArea(THUNDER, "Perak", "Daerah Larut Matang", "Taiping")).toBe(true);
    expect(coversArea(THUNDER, "Perak", "Batang Padang", "Tapah")).toBe(false); // not listed
    expect(coversArea(THUNDER, "Pulau Pinang", "Timur Laut", "George Town")).toBe(true); // feed says "Timor Laut"
    expect(coversArea(THUNDER, "Pulau Pinang", "Daerah Barat Daya", "")).toBe(true);
    expect(coversArea(THUNDER, "Pulau Pinang", "Seberang Perai Utara", "")).toBe(false);
  });

  it("matches Sarawak divisions that are listed outside the brackets", () => {
    expect(coversArea(THUNDER, "Sarawak", "Kuching", "Kuching")).toBe(true);
    expect(coversArea(THUNDER, "Sarawak", "Kuching Division", "")).toBe(true);
    expect(coversArea(THUNDER, "Sarawak", "Miri", "Miri")).toBe(false);
  });

  it("lets the city name only ever ADD a match", () => {
    expect(coversArea(THUNDER, "Sarawak", "Some Other District", "Sibu")).toBe(true); // "Sibu" is listed
    expect(coversArea(THUNDER, "Perak", "Batang Padang", "Tapah")).toBe(false);
  });

  it("always shows state-wide warnings", () => {
    const w = make({ text: "Hot weather is expected over Kuala Lumpur until 12:00 PM." });
    expect(coversArea(w, "Kuala Lumpur", "Anything", "Anywhere")).toBe(true);
  });

  it("works end to end against the real feed at 08:50", () => {
    const at = my(8, 50);
    const who = (region: string, district: string, placeName = "x") => warningsForUser(FEED, { region, district, placeName }, at).length;
    expect(who("Perak", "Kinta", "Ipoh")).toBe(1);
    expect(who("Perak", "", "Ipoh")).toBe(1);
    expect(who("Selangor", "Petaling", "Shah Alam")).toBe(0);
    expect(who("Selangor", "", "Shah Alam")).toBe(1); // unknown district: still told
    expect(who("Kuala Lumpur", "")).toBe(0); // KL is not named
    expect(who("Johor", "")).toBe(0);
    expect(who("-", "")).toBe(0);
    expect(who("", "")).toBe(0);
    expect(warningsForUser(FEED, { region: "Perak", district: "Kinta", placeName: "Ipoh" }, my(10, 30))).toHaveLength(0); // expired
  });

  it("several warnings at once", () => {
    const rain = make({ text: "Continuous rain is expected over Perak (Kinta, Kampar) • Pahang (Cameron Highlands) until 12:00 PM.", titleEn: "Heavy Rain Warning" });
    const hot = make({ text: "Level 1 hot weather in Perak (Larut Matang, Manjung) until 12:00 PM.", titleEn: "Hot Weather Warning" });
    expect(warningsForUser([rain, hot, SEA, NONE, THUNDER], { region: "Perak", district: "Kinta", placeName: "Ipoh" }, my(8, 50)).map((w) => w.titleEn)).toEqual([
      "Heavy Rain Warning",
      "Thunderstorms Warning",
    ]);
  });
});

describe("small helpers", () => {
  it("normalises area names", () => {
    expect(normalizeArea("Daerah Timur Laut")).toBe("timur laut");
    expect(normalizeArea("Timor Laut")).toBe("timur laut");
    expect(normalizeArea("Kinta District")).toBe("kinta");
    expect(normalizeArea("  Seberang   Perai-Tengah ")).toBe("seberang perai tengah");
    expect(normalizeArea("Kuching")).toBe("kuching");
  });

  it("clips at a word boundary", () => {
    expect(clip("short", 20)).toBe("short");
    expect(clip("one two three four five", 12)).toBe("one two…");
    expect(clip("x".repeat(50), 10).length).toBeLessThanOrEqual(10);
  });
});
