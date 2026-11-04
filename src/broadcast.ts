/**
 * Admin broadcast: one message to every active user.
 *
 * Sending happens from the cron in small batches (the free plan caps outgoing requests per invocation, so a
 * webhook can't message 100 people at once). The job lives in the `meta` table, so a restart never loses it
 * and never sends anyone the message twice (a cursor remembers where it got to).
 *
 * Flow: /broadcast <text>  ->  preview with [Send] [Cancel]  ->  the cron delivers  ->  the admin gets a summary.
 */
import { activeIdsAfter, countActive, metaDelete, metaGetJson, metaSet, metaSetJson, metaGet } from "./db";
import { notifyAdmins } from "./health";
import { Telegram, TelegramError } from "./telegram";
import type { Env } from "./types";
import { escapeHtml } from "./util";

export const BATCH_SIZE = 20;
export const MAX_TEXT = 1000;

export interface BroadcastJob {
  text: string;
  cursor: number; // last chat_id handled
  total: number;
  sent: number;
  failed: number;
  by: number;
  startedAt: number;
}

export interface BroadcastResult {
  text: string;
  total: number;
  sent: number;
  failed: number;
  by: number;
  finishedAt: number;
  stopped: boolean;
}

export const JOB_KEY = "bc:job";
export const LAST_KEY = "bc:last";
export const draftKey = (adminId: number) => `bc:draft:${adminId}`;

/** What recipients see. The admin's text is escaped, so no markup (or accidental "<") can break the message. */
export const broadcastBody = (text: string) => `📢 <b>Message from the admin</b>\n\n${escapeHtml(text)}`;

export async function saveDraft(env: Env, adminId: number, text: string): Promise<{ total: number }> {
  await metaSet(env.DB, draftKey(adminId), text.slice(0, MAX_TEXT));
  return { total: await countActive(env.DB) };
}

export const takeDraft = (env: Env, adminId: number) => metaGet(env.DB, draftKey(adminId));
export const dropDraft = (env: Env, adminId: number) => metaDelete(env.DB, draftKey(adminId));

export async function activeJob(env: Env): Promise<BroadcastJob | null> {
  return metaGetJson<BroadcastJob>(env.DB, JOB_KEY);
}

export async function startBroadcast(env: Env, adminId: number, now = new Date()): Promise<{ ok: true; total: number } | { ok: false; reason: "busy" | "no-draft" | "nobody" }> {
  if (await activeJob(env)) return { ok: false, reason: "busy" };
  const text = await takeDraft(env, adminId);
  if (!text) return { ok: false, reason: "no-draft" };
  const total = await countActive(env.DB);
  if (!total) return { ok: false, reason: "nobody" };
  await metaSetJson(env.DB, JOB_KEY, { text, cursor: 0, total, sent: 0, failed: 0, by: adminId, startedAt: now.getTime() } satisfies BroadcastJob);
  await dropDraft(env, adminId);
  return { ok: true, total };
}

async function finish(env: Env, job: BroadcastJob, stopped: boolean, now: Date): Promise<void> {
  await metaSetJson(env.DB, LAST_KEY, { text: job.text.slice(0, 80), total: job.total, sent: job.sent, failed: job.failed, by: job.by, finishedAt: now.getTime(), stopped } satisfies BroadcastResult);
  await metaDelete(env.DB, JOB_KEY);
  await notifyAdmins(env, `📢 Broadcast ${stopped ? "stopped" : "finished"}: delivered to <b>${job.sent}</b> of ${job.total}${job.failed ? `, ${job.failed} could not be reached (they blocked the bot)` : ""}.`);
}

export async function stopBroadcast(env: Env, now = new Date()): Promise<boolean> {
  const job = await activeJob(env);
  if (!job) return false;
  await finish(env, job, true, now);
  return true;
}

/** Send the next batch. Returns how many were delivered, or null when there is no job. */
export async function runBroadcast(env: Env, now = new Date()): Promise<number | null> {
  const job = await activeJob(env);
  if (!job) return null;
  const ids = await activeIdsAfter(env.DB, job.cursor, BATCH_SIZE);
  const tg = new Telegram(env);
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await tg.sendMessage(id, broadcastBody(job.text));
      sent++;
    } catch (e) {
      failed++;
      if (!(e instanceof TelegramError && e.unreachable)) console.log(JSON.stringify({ event: "broadcast_failed", chatId: id, error: String(e).slice(0, 100) }));
    }
  }
  const next: BroadcastJob = { ...job, cursor: ids.length ? ids[ids.length - 1] : job.cursor, sent: job.sent + sent, failed: job.failed + failed };
  if (ids.length < BATCH_SIZE) await finish(env, next, false, now); // that was the last batch
  else await metaSetJson(env.DB, JOB_KEY, next);
  return sent;
}
