/**
 * Health monitoring for the admin. A cheap probe runs every 5 minutes from the cron:
 *   - Open-Meteo (the primary forecast source)
 *   - MET Norway (the backup), only tried when the primary fails
 *   - the MetMalaysia warnings feed
 * and every admin is messaged ONCE when something has been failing for a while, and once when it recovers.
 * Thresholds avoid noise: a single blip is not worth a message.
 */
import { metaGetJson, metaSetJson } from "./db";
import { DEFAULT_PLACE } from "./presets";
import { Telegram } from "./telegram";
import type { Env } from "./types";
import { parseIdList } from "./util";
import { makeWeather } from "./weather";

export type Dependency = "primary" | "backup" | "warnings";

/** Consecutive failed checks before the admin is told (5 minutes apart). */
export const THRESHOLDS: Record<Dependency, number> = { primary: 3, backup: 3, warnings: 6 };

export interface HealthState {
  fails: number;
  alerted: boolean;
  lastOk: number;
  lastFail: number;
  lastError: string;
}

export type HealthEvent = "none" | "down" | "recovered";

export const emptyHealth = (): HealthState => ({ fails: 0, alerted: false, lastOk: 0, lastFail: 0, lastError: "" });

/** The state machine: one more check result in, the new state and whether to message the admin out. */
export function step(prev: HealthState | null, ok: boolean, now: number, error: string, threshold: number): { state: HealthState; event: HealthEvent } {
  const s = prev ?? emptyHealth();
  if (ok) {
    return { state: { ...s, fails: 0, alerted: false, lastOk: now }, event: s.alerted ? "recovered" : "none" };
  }
  const fails = s.fails + 1;
  const down = fails >= threshold && !s.alerted;
  return { state: { fails, alerted: s.alerted || down, lastOk: s.lastOk, lastFail: now, lastError: error }, event: down ? "down" : "none" };
}

export const healthKey = (d: Dependency) => `health:${d}`;

export async function notifyAdmins(env: Env, text: string): Promise<void> {
  const tg = new Telegram(env);
  for (const id of parseIdList(env.ADMIN_IDS)) {
    try {
      await tg.sendMessage(id, text);
    } catch {
      /* an admin who blocked the bot can't be told; nothing else to do */
    }
  }
}

const NAMES: Record<Dependency, string> = { primary: "Open-Meteo (weather)", backup: "MET Norway (backup weather)", warnings: "MetMalaysia warnings feed" };

/** What to tell the admin about an event. `primaryDown` = the primary is failing right now (makes a backup outage critical). */
export function healthMessage(dep: Dependency, event: Exclude<HealthEvent, "none">, s: HealthState, primaryDown: boolean): string {
  const mins = (n: number) => `${n * 5} minutes`;
  if (event === "recovered") return `✅ ${NAMES[dep]} is back to normal.`;
  const err = s.lastError ? `\n<code>${s.lastError.replace(/[<>&]/g, "")}</code>` : "";
  if (dep === "primary") return `⚠️ <b>${NAMES.primary}</b> has failed ${s.fails} checks in a row (~${mins(s.fails)}).\nReports are using the MET Norway backup (less detail; new locations can't be saved until it recovers).${err}`;
  if (dep === "backup") {
    return primaryDown
      ? `❗ <b>NO weather source is working.</b> Open-Meteo and MET Norway are both failing, so reports and daily messages are failing for everyone.${err}`
      : `⚠️ ${NAMES.backup} is failing (the primary is fine, so nobody is affected yet).${err}`;
  }
  return `⚠️ The <b>MetMalaysia warnings feed</b> has been unreachable for ~${mins(s.fails)}. People may not receive official warnings until it recovers.${err}`;
}

/** Run one probe and message the admins about anything that changed. Returns what happened (for the status page). */
export async function runHealth(env: Env, now = new Date()): Promise<{ primary: boolean; warnings: boolean }> {
  const t = now.getTime();
  const wx = makeWeather(env);

  const [pState, bState, wState] = await Promise.all([
    metaGetJson<HealthState>(env.DB, healthKey("primary")),
    metaGetJson<HealthState>(env.DB, healthKey("backup")),
    metaGetJson<HealthState>(env.DB, healthKey("warnings")),
  ]);
  const res = await wx.healthCheck(DEFAULT_PLACE, !!bState && (bState.fails > 0 || bState.alerted));

  const p = step(pState, res.primary === null, t, res.primary ?? "", THRESHOLDS.primary);
  const w = step(wState, res.warnings === null, t, res.warnings ?? "", THRESHOLDS.warnings);
  // the backup is only tested while the primary is failing; when the primary is fine we leave its last known state alone
  const b = res.backup === undefined ? null : step(bState, res.backup === null, t, res.backup ?? "", THRESHOLDS.backup);

  await Promise.all([
    metaSetJson(env.DB, healthKey("primary"), p.state),
    metaSetJson(env.DB, healthKey("warnings"), w.state),
    ...(b ? [metaSetJson(env.DB, healthKey("backup"), b.state)] : []),
    metaSetJson(env.DB, "health:last", { at: t }),
  ]);

  const primaryDown = res.primary !== null;
  if (p.event !== "none") await notifyAdmins(env, healthMessage("primary", p.event, p.state, primaryDown));
  if (b && b.event !== "none") await notifyAdmins(env, healthMessage("backup", b.event, b.state, primaryDown));
  if (w.event !== "none") await notifyAdmins(env, healthMessage("warnings", w.event, w.state, primaryDown));
  return { primary: !primaryDown, warnings: res.warnings === null };
}
