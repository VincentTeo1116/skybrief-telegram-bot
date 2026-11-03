import type { Env } from "./types";

export class TelegramError extends Error {
  constructor(
    public method: string,
    public code: number,
    public description: string,
  ) {
    super(`Telegram ${method} failed (${code}): ${description}`);
  }
  get notModified(): boolean {
    return /message is not modified/i.test(this.description);
  }
  /** The user blocked the bot, deleted the chat, or the chat no longer exists. */
  get unreachable(): boolean {
    return this.code === 403 || /chat not found|user is deactivated/i.test(this.description);
  }
}

export interface BotCommand {
  command: string;
  description: string;
}
export type Markup = Record<string, unknown>;

/** Thin Telegram Bot API client. Never put the token in an error message or a log line. */
export class Telegram {
  constructor(private env: Env) {}

  async call<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const base = this.env.TELEGRAM_API_BASE || "https://api.telegram.org";
    const res = await fetch(`${base}/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body: { ok?: boolean; result?: T; error_code?: number; description?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON response */
    }
    if (!res.ok || !body.ok) {
      throw new TelegramError(method, body.error_code ?? res.status, body.description ?? res.statusText);
    }
    return body.result as T;
  }

  sendMessage(chatId: number, text: string, replyMarkup?: Markup) {
    return this.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: replyMarkup });
  }

  editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: Markup) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }

  editReplyMarkup(chatId: number, messageId: number, replyMarkup: Markup) {
    return this.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });
  }

  /** Telegram accepts ONE answer per button press. */
  answerCallback(id: string, text?: string, showAlert = false) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
  }

  sendChatAction(chatId: number, action = "typing") {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }

  setMyCommands(commands: BotCommand[], opts: { chatId?: number; languageCode?: string } = {}) {
    return this.call("setMyCommands", {
      commands,
      ...(opts.chatId !== undefined ? { scope: { type: "chat", chat_id: opts.chatId } } : {}),
      ...(opts.languageCode ? { language_code: opts.languageCode } : {}),
    });
  }

  /** Reply to an inline query (`@bot something` typed in any chat). */
  answerInlineQuery(
    id: string,
    results: Record<string, unknown>[],
    opts: { cacheTime?: number; isPersonal?: boolean; button?: { text: string; start_parameter: string } } = {},
  ) {
    return this.call("answerInlineQuery", {
      inline_query_id: id,
      results,
      cache_time: opts.cacheTime ?? 60,
      is_personal: opts.isPersonal ?? true,
      ...(opts.button ? { button: opts.button } : {}),
    });
  }

  setWebhook(url: string, secretToken: string) {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query", "inline_query"],
      max_connections: 20,
    });
  }
}
