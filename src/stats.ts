/** Counters, run records and the /status page for admins. All stored in the `meta` table. */
import { countByStatus, metaGetJson, metaGetMany, metaIncr, metaPruneCounters, metaSetJson } from "./db";
import { activeJob, LAST_KEY, type BroadcastResult } from "./broadcast";
import { healthKey, THRESHOLDS, type Dependency, type HealthState } from "./health";
import type { Env } from "./types";
import { escapeHtml } from "./util";

export type Counter = "morning" | "evening" | "rain" | "aqi" | "warning" | "failed";

/** Counters are per UTC day: key "d:2026-11-04:morning". */
export const dayKey = (now: Date) => now.toISOString().slice(0, 10);

export async function count(db: D1Database, now: Date, name: Counter, n = 1): Promise<void> {
  await metaIncr(db, `d:${dayKey(now)}:${name}`, n);
}

export interface CronRecord {
  at: number;
  due: number;
  sent: number;
  failed: number;
}

/** The heartbeat: written every minute, so /status can tell when the cron has stopped. Old counters are pruned once a day. */
export async function recordCron(env: Env, now: Date, rec: Omit<CronRecord, "at">): Promise<void> {
  await metaSetJson(env.DB, "cron:last", { at: now.getTime(), ...rec } satisfies CronRecord);
  if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
    await metaPruneCounters(env.DB, dayKey(new Date(now.getTime() - 3 * 86_400_000)));
  }
}

/** "3 min ago", "2 h ago", "never". */
export function ago(ms: number | undefined, now: number): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function dependencyLine(label: string, dep: Dependency, h: HealthState | null, now: number): string {
  if (!h) return `⚪ ${label}: no check yet`;
  if (h.fails === 0) return `✅ ${label}: OK (last good check ${ago(h.lastOk, now)})`;
  const alerted = h.alerted ? " · admin alerted" : ` · alert after ${THRESHOLDS[dep]}`;
  return `❗ ${label}: failing ×${h.fails} since ${ago(h.lastOk, now)}${alerted}\n   <code>${escapeHtml(h.lastError || "?").slice(0, 110)}</code>`;
}

export async function statusMessage(env: Env, now = new Date()): Promise<string> {
  const t = now.getTime();
  const [users, cron, counters, last, job, hp, hb, hw, hl] = await Promise.all([
    countByStatus(env.DB),
    metaGetJson<CronRecord>(env.DB, "cron:last"),
    metaGetMany(env.DB, `d:${dayKey(now)}:`),
    metaGetJson<BroadcastResult>(env.DB, LAST_KEY),
    activeJob(env),
    metaGetJson<HealthState>(env.DB, healthKey("primary")),
    metaGetJson<HealthState>(env.DB, healthKey("backup")),
    metaGetJson<HealthState>(env.DB, healthKey("warnings")),
    metaGetJson<{ at: number }>(env.DB, "health:last"),
  ]);
  const n = (name: Counter) => Number(counters[`d:${dayKey(now)}:${name}`] ?? 0);

  const cronAge = cron ? t - cron.at : Infinity;
  const cronLine = !cron
    ? "⚪ Cron: no run recorded yet"
    : cronAge > 3 * 60_000
      ? `❗ Cron: last ran ${ago(cron.at, t)}: it should run every minute`
      : `✅ Cron: last ran ${ago(cron.at, t)}`;

  const lines = [
    "📊 <b>SkyBrief status</b>",
    "",
    cronLine,
    `👥 Users: ${users.active} active · ${users.pending} pending · ${users.blocked} blocked`,
    `📬 Today (UTC): morning ${n("morning")} · evening ${n("evening")} · rain ${n("rain")} · AQI ${n("aqi")} · warnings ${n("warning")} · failed ${n("failed")}`,
    "",
    dependencyLine("Open-Meteo", "primary", hp, t),
    hb && (hb.fails > 0 || hb.alerted) ? dependencyLine("MET Norway backup", "backup", hb, t) : "🛟 MET Norway backup: not needed (tested only when Open-Meteo fails)",
    dependencyLine("MetMalaysia warnings", "warnings", hw, t),
    hl ? `<i>Last health check ${ago(hl.at, t)}</i>` : "",
    "",
  ];
  if (job) lines.push(`📢 Broadcast running: ${job.sent + job.failed} of ${job.total} handled`);
  else if (last) lines.push(`📢 Last broadcast (${ago(last.finishedAt, t)}): ${last.sent} delivered, ${last.failed} unreachable${last.stopped ? " (stopped early)" : ""}`);
  else lines.push("📢 No broadcasts yet");
  return lines.join("\n");
}
