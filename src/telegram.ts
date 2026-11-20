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
    return this.finish<T>(method, res);
  }

  /** Like call(), for a request that carries a file. */
  async callForm<T = unknown>(method: string, form: FormData): Promise<T> {
    const base = this.env.TELEGRAM_API_BASE || "https://api.telegram.org";
    const res = await fetch(`${base}/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", body: form });
    return this.finish<T>(method, res);
  }

  private async finish<T>(method: string, res: Response): Promise<T> {
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

  /** Send a picture to a chat. Returns Telegram's id for the stored picture (its largest size). */
  async sendPhoto(chatId: number, photo: Blob, caption: string): Promise<string> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("caption", caption);
    form.set("photo", photo, "skybrief.jpg");
    const message = await this.callForm<{ photo?: { file_id?: string }[] }>("sendPhoto", form);
    const sizes = message?.photo ?? [];
    const fileId = sizes[sizes.length - 1]?.file_id;
    if (!fileId) throw new TelegramError("sendPhoto", 502, "no file id returned");
    return fileId;
  }

  /**
   * Prepare a picture the person may share to any chat from a mini app (Bot API 8.0). Returns the id for
   * `Telegram.WebApp.shareMessage`. Older servers answer with an error, which callers treat as "not available".
   */
  async savePreparedPhoto(userId: number, fileId: string, caption: string): Promise<string> {
    const r = await this.call<{ id?: string }>("savePreparedInlineMessage", {
      user_id: userId,
      result: { type: "photo", id: "card", photo_file_id: fileId, caption },
      allow_user_chats: true,
      allow_group_chats: true,
      allow_channel_chats: true,
    });
    if (!r?.id) throw new TelegramError("savePreparedInlineMessage", 502, "no id returned");
    return r.id;
  }

  /** `silent` delivers without a notification sound (used for warnings during quiet hours). */
  sendMessage(chatId: number, text: string, replyMarkup?: Markup, opts: { silent?: boolean } = {}) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
      ...(opts.silent ? { disable_notification: true } : {}),
    });
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

  /** The button next to the message box: the mini app, or back to the command list. Default for every chat. */
  setChatMenuButton(button: { type: "web_app"; text: string; web_app: { url: string } } | { type: "commands" }) {
    return this.call("setChatMenuButton", { menu_button: button });
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
