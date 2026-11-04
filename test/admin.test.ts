import { describe, expect, it } from "vitest";
import { BATCH_SIZE, MAX_TEXT, broadcastBody, draftKey } from "../src/broadcast";
import { THRESHOLDS, emptyHealth, healthMessage, step, type HealthState } from "../src/health";
import { ago, dayKey } from "../src/stats";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

/** Feed a sequence of check results (true = healthy) through the state machine, 5 minutes apart. */
function run(results: boolean[], threshold: number, start: HealthState | null = null) {
  let state = start;
  const events: string[] = [];
  results.forEach((ok, i) => {
    const r = step(state, ok, T0 + i * 5 * MIN, ok ? "" : `error ${i}`, threshold);
    state = r.state;
    events.push(r.event);
  });
  return { state: state!, events };
}

describe("health monitoring: when is the admin told?", () => {
  it("ignores a brief blip (below the threshold)", () => {
    const { events, state } = run([true, false, false, true], THRESHOLDS.primary);
    expect(events).toEqual(["none", "none", "none", "none"]);
    expect(state.fails).toBe(0);
    expect(state.alerted).toBe(false);
  });

  it("tells the admin once, exactly when the threshold is reached", () => {
    const { events } = run([false, false, false, false, false, false], 3);
    expect(events).toEqual(["none", "none", "down", "none", "none", "none"]); // no repeats while it stays down
  });

  it("tells the admin once when it recovers, and only if it had alerted", () => {
    const { events } = run([false, false, false, false, true, true], 3);
    expect(events).toEqual(["none", "none", "down", "none", "recovered", "none"]);
    expect(run([false, true], 3).events).toEqual(["none", "none"]); // a blip that never alerted needs no "recovered"
  });

  it("can alert again after a recovery", () => {
    const { events } = run([false, false, false, true, false, false, false], 3);
    expect(events).toEqual(["none", "none", "down", "recovered", "none", "none", "down"]);
  });

  it("remembers the last error and when it last worked", () => {
    const { state } = run([true, false, false], 3);
    expect(state.lastError).toBe("error 2");
    expect(state.lastOk).toBe(T0);
    expect(state.fails).toBe(2);
  });

  it("starts from nothing", () => {
    expect(step(null, true, T0, "", 3)).toEqual({ state: { ...emptyHealth(), lastOk: T0 }, event: "none" });
  });

  it("uses sensible thresholds: 15 minutes for weather, 30 for the warnings feed", () => {
    expect(THRESHOLDS).toEqual({ primary: 3, backup: 3, warnings: 6 });
  });
});

describe("what the admin is told", () => {
  const down = (fails: number, error = "boom"): HealthState => ({ fails, alerted: true, lastOk: T0, lastFail: T0 + fails * 5 * MIN, lastError: error });

  it("says the primary is down and that reports fall back to the backup", () => {
    const m = healthMessage("primary", "down", down(3), true);
    expect(m).toContain("Open-Meteo");
    expect(m).toContain("3 checks in a row");
    expect(m).toContain("~15 minutes");
    expect(m).toContain("MET Norway backup");
    expect(m).toContain("boom");
  });

  it("is loud when the backup fails too: nothing is working", () => {
    expect(healthMessage("backup", "down", down(3), true)).toMatch(/NO weather source is working/);
    expect(healthMessage("backup", "down", down(3), false)).not.toMatch(/NO weather source/); // primary fine: nobody is affected
  });

  it("reports the warnings feed separately", () => {
    const m = healthMessage("warnings", "down", down(6), false);
    expect(m).toContain("MetMalaysia warnings feed");
    expect(m).toContain("~30 minutes");
  });

  it("announces recovery for each", () => {
    expect(healthMessage("primary", "recovered", emptyHealth(), false)).toBe("✅ Open-Meteo (weather) is back to normal.");
    expect(healthMessage("warnings", "recovered", emptyHealth(), false)).toContain("MetMalaysia warnings feed is back");
  });

  it("never lets an error string break the message's HTML", () => {
    const m = healthMessage("primary", "down", down(3, "<script>&bad</script>"), false);
    expect(m).not.toContain("<script>");
    expect(m).not.toContain("&bad");
  });
});

describe("broadcast", () => {
  it("escapes the admin's text so markup can't break the message", () => {
    expect(broadcastBody("Meeting at 3 <now> & bring \"notes\"")).toBe('📢 <b>Message from the admin</b>\n\nMeeting at 3 &lt;now&gt; &amp; bring "notes"');
  });

  it("keeps the admin's line breaks", () => {
    expect(broadcastBody("line 1\nline 2")).toContain("line 1\nline 2");
  });

  it("stays well under Telegram's message limit at the maximum length", () => {
    expect(broadcastBody("x".repeat(MAX_TEXT)).length).toBeLessThan(4096);
    expect(MAX_TEXT).toBe(1000);
  });

  it("sends in batches small enough for the free plan's per-run request cap", () => {
    expect(BATCH_SIZE).toBeLessThanOrEqual(25);
    expect(draftKey(42)).toBe("bc:draft:42");
  });
});

describe("status page helpers", () => {
  it("shows how long ago something happened", () => {
    expect(ago(undefined, T0)).toBe("never");
    expect(ago(T0 - 30_000, T0)).toBe("30s ago");
    expect(ago(T0 - 5 * MIN, T0)).toBe("5 min ago");
    expect(ago(T0 - 3 * 3_600_000, T0)).toBe("3 h ago");
    expect(ago(T0 - 3 * 86_400_000, T0)).toBe("3 days ago");
    expect(ago(T0 + 5000, T0)).toBe("0s ago"); // clock skew never prints a negative
  });

  it("keys counters by UTC day", () => {
    expect(dayKey(new Date("2026-11-04T23:59:59Z"))).toBe("2026-11-04");
    expect(dayKey(new Date("2026-11-05T00:00:00Z"))).toBe("2026-11-05");
  });
});
