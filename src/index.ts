import { runDaily } from "./daily";
import { botCommands, handleUpdate } from "./handlers";
import { Telegram } from "./telegram";
import type { Env, TgUpdate } from "./types";
import { safeEqual } from "./util";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

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
      try {
        await tg.setWebhook(hook, env.WEBHOOK_SECRET);
        await tg.setMyCommands(botCommands("en"));
        await tg.setMyCommands(botCommands("ms"), { languageCode: "ms" });
        await tg.setMyCommands(botCommands("zh"), { languageCode: "zh" });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
      return json({ ok: true, webhook: hook, commands: "set (en, ms, zh)" });
    }

    if (url.pathname === "/") return new Response("SkyBrief is running ☀️");
    return new Response("not found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDaily(env, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
