import { describe, expect, it } from "vitest";
import { SECTIONS } from "../src/format";
import { T } from "../src/i18n";

/**
 * A missing translation key throws at runtime ("Missing translation key"), which would break a message for
 * users of that language. This scans the source so a typo is caught by `npm test` instead of by a user.
 */
// every source file as raw text (Vite's glob import: no Node typings needed)
const sources = import.meta.glob("../src/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const files = Object.keys(sources).filter((f) => !f.endsWith("/i18n.ts"));
const code = files.map((f) => sources[f]).join("\n");

// keys passed as literals:  t(lang, "key")  /  t(u.lang, "key")  /  t("en", "key")
const literal = [...code.matchAll(/\bt\(\s*[^,()]+(?:\([^)]*\))?\s*,\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
// keys chosen between two literals:  t(lang, cond ? "a" : "b")
const ternary = [...code.matchAll(/\bt\([^,]+,\s*[^"?]*\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g)].flatMap((m) => [m[1], m[2]]);
// keys built from a known set (these loops are the only places keys are composed)
const composed = [
  ...SECTIONS.map((s) => `sec_${s}`),
  ...["weather", "hourly", "tomorrow", "week", "warnings", "city", "daily", "settime", "evening", "settings", "help"].map((c) => `cmd_${c}`),
  ...["rising", "falling", "steady"].map((k) => `aqi_${k}`),
  ...["morning", "afternoon", "evening"].map((k) => `p_${k}`),
  "ribbon_daily",
  "ribbon_evening",
];

describe("translation coverage", () => {
  it("found a sensible number of calls to check (the scan itself works)", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(literal.length).toBeGreaterThan(80);
  });

  it("every translation key used in the code exists", () => {
    const used = new Set([...literal, ...ternary, ...composed]);
    const missing = [...used].filter((k) => !(k in T));
    expect(missing).toEqual([]);
  });

  it("every dynamic key family is fully translated", () => {
    for (const key of composed) expect(T[key], key).toBeDefined();
  });

  it("no translation is dead (every key is used somewhere)", () => {
    const used = new Set([...literal, ...ternary, ...composed]);
    // keys referenced through variables or from tests/config rather than a literal t(...) call
    const indirect = new Set<string>(["btn_now", "btn_city", "btn_loc", "btn_settings", "help", "welcome"]);
    const dead = Object.keys(T).filter((k) => !used.has(k) && !indirect.has(k) && !code.includes(`"${k}"`) && !code.includes(`\`${k}`));
    expect(dead).toEqual([]);
  });
});
