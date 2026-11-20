import { runAlerts, runWarnings } from "./alerts";
import { rememberOrigin } from "./appurl";
import { handleApi } from "./miniapp";
import { runBroadcast } from "./broadcast";
import { runDaily } from "./daily";
import { runHealth } from "./health";
import { recordCron } from "./stats";
import { botCommands, handleUpdate } from "./handlers";
import { Telegram } from "./telegram";
import type { Env, TgUpdate } from "./types";
import { safeEqual } from "./util";

const log = (event: string) => (e: unknown) => console.log(JSON.stringify({ event, error: String(e).slice(0, 200) }));

/**
 * One cron tick (every minute). The free plan caps outgoing requests per invocation, so the jobs are spread across
 * different minutes and skipped when reports are due:
 *   every minute  morning / evening reports, then a broadcast batch if one is running
 *   :02 :07 :12…  health probe                       :05 :20 :35 :50  rain + air-quality alerts
 *                                                    :10 :25 :40 :55  official warnings
 */
export async function runCron(env: Env, now: Date): Promise<void> {
  const minute = now.getUTCMinutes();
  const test = env.ALERTS_EVERY_MINUTE === "1";
  const daily = await runDaily(env, now).catch((e) => {
    log("daily_crashed")(e);
    return { due: 0, sent: 0, failed: 0, morning: 0, evening: 0 };
  });

  if (daily.due === 0) {
    if (env.HEALTH_EVERY_MINUTE === "1" || minute % 5 === 2) await runHealth(env, now).catch(log("health_crashed"));
    let busy = false;
    if (test || minute % 15 === 5) {
      busy = true;
      await runAlerts(env, now).catch(log("alerts_crashed"));
    }
    if (test || minute % 15 === 10) {
      busy = true;
      await runWarnings(env, now).catch(log("warnings_crashed"));
    }
    if (!busy || test) await runBroadcast(env, now).catch(log("broadcast_crashed"));
  }
  await recordCron(env, now, { due: daily.due, sent: daily.sent, failed: daily.failed }).catch(log("record_cron_failed"));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });

/** Unknown address: the custom page with a REAL 404 status for people, plain text for everything else (NFR-7). */
async function notFound(req: Request, env: Env, url: URL): Promise<Response> {
  const wantsPage = (req.method === "GET" || req.method === "HEAD") && (req.headers.get("accept") ?? "").includes("text/html");
  if (env.ASSETS && wantsPage) {
    try {
      const page = await env.ASSETS.fetch(new Request(new URL("/404", url), { headers: { accept: "text/html" } }));
      if (page.ok) {
        const headers = new Headers(page.headers);
        headers.set("cache-control", "no-store");
        return new Response(req.method === "HEAD" ? null : page.body, { status: 404, headers });
      }
    } catch (e) {
      log("not_found_page_failed")(e);
    }
  }
  return new Response("not found", { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // The mini app's API. Static files under /app/ never reach this code: Workers Static Assets serves them first.
    if (url.pathname.startsWith("/api/")) return handleApi(req, env, url);

    // Telegram -> us. Only accept calls that carry our shared secret.
    if (url.pathname === "/webhook" && req.method === "POST") {
      const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
      if (!env.WEBHOOK_SECRET || !safeEqual(secret, env.WEBHOOK_SECRET)) return new Response("forbidden", { status: 403 });
      let update: TgUpdate;
      try {
        update = (await req.json()) as TgUpdate;
      } catch {
        return new Response("bad request", { status: 400 });
      }
      // Answer Telegram immediately; do the work in the background so Telegram never retries.
      ctx.waitUntil(handleUpdate(env, update));
      return new Response("ok");
    }

    // One-time setup: open  https://<your-worker>/setup?key=<WEBHOOK_SECRET>  in a browser.
    if (url.pathname === "/setup") {
      const key = url.searchParams.get("key") ?? "";
      if (!env.WEBHOOK_SECRET || !safeEqual(key, env.WEBHOOK_SECRET)) return new Response("forbidden", { status: 403 });
      const tg = new Telegram(env);
      const hook = `${url.origin}/webhook`;
      // Optional: &menu=app puts the mini app on the button next to the message box; &menu=commands puts the command list back.
      const menu = url.searchParams.get("menu");
      let miniApp: string | null = null;
      let menuButton = "unchanged";
      try {
        await tg.setWebhook(hook, env.WEBHOOK_SECRET);
        await tg.setMyCommands(botCommands("en"));
        await tg.setMyCommands(botCommands("ms"), { languageCode: "ms" });
        await tg.setMyCommands(botCommands("zh"), { languageCode: "zh" });
        miniApp = await rememberOrigin(env, url.origin); // null on plain http (local development): Telegram needs HTTPS
        if (menu === "app" && miniApp) {
          await tg.setChatMenuButton({ type: "web_app", text: "Dashboard", web_app: { url: miniApp } });
          menuButton = "mini app";
        } else if (menu === "commands") {
          await tg.setChatMenuButton({ type: "commands" });
          menuButton = "commands";
        }
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
      return json({ ok: true, webhook: hook, commands: "set (en, ms, zh)", miniApp: miniApp ?? "not available (needs HTTPS)", menuButton });
    }

    if (url.pathname === "/") return new Response("SkyBrief is running ☀️");
    return notFound(req, env, url);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
