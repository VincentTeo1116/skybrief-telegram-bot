/** Telegram update handling: access control, commands, buttons, settings, GPS, city search, inline mode, admin tools. */
import { lastSentAfterChange } from "./daily";
import { getUser, insertUser, listUsers, patchUser, placeOf, setLocation, toggleSection, type UserPatch } from "./db";
import { SECTIONS, inlineCard, weatherMessage, welcomeMessage } from "./format";
import { LANGS, normLang, t } from "./i18n";
import * as kb from "./keyboards";
import { DEFAULT_PLACE, matchPreset, presetPlace, PRESET_COUNT } from "./presets";
import { Telegram, TelegramError, type BotCommand, type Markup } from "./telegram";
import type { Env, Lang, Place, Status, TgCallback, TgInlineQuery, TgMessage, TgUpdate, TgUser, User } from "./types";
import { AQI_ALERT_LEVELS, CLOCK_MODES, TEMP_UNITS, WIND_UNITS, defaultPrefs, prefsOf } from "./units";
import { escapeHtml as esc, haversineKm, normaliseTime, parseIdList } from "./util";
import { buildView } from "./views";
import { WeatherError, WeatherService, makeWeather, placeLabel } from "./weather";

interface Ctx {
  env: Env;
  tg: Telegram;
  wx: WeatherService;
}

export const isAdmin = (env: Env, id: number) => parseIdList(env.ADMIN_IDS).includes(id);

// ------------------------------------------------------------- bot commands
const USER_COMMANDS = ["weather", "hourly", "tomorrow", "week", "city", "daily", "settime", "evening", "settings", "help"] as const;
const ADMIN_COMMANDS: BotCommand[] = [
  { command: "users", description: "Admin: list users" },
  { command: "allow", description: "Admin: allow a user, /allow 123456" },
  { command: "block", description: "Admin: block a user, /block 123456" },
];

export function botCommands(lang: Lang, admin = false): BotCommand[] {
  const base = USER_COMMANDS.map((c) => ({ command: c, description: t(lang, `cmd_${c}`) }));
  return admin ? [...base, ...ADMIN_COMMANDS] : base;
}

async function setChatCommands(c: Ctx, chatId: number, lang: Lang): Promise<void> {
  try {
    await c.tg.setMyCommands(botCommands(lang, isAdmin(c.env, chatId)), { chatId });
  } catch (e) {
    console.log(JSON.stringify({ event: "set_commands_failed", chatId, error: String(e) }));
  }
}

const quiet = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch {
    /* best effort (stale button, blocked bot, …) */
  }
};

// ---------------------------------------------------------------- entry point
export async function handleUpdate(env: Env, update: TgUpdate): Promise<void> {
  const c: Ctx = { env, tg: new Telegram(env), wx: makeWeather(env) };
  try {
    if (update.callback_query) await onCallback(c, update.callback_query);
    else if (update.message) await onMessage(c, update.message);
    else if (update.inline_query) await onInline(c, update.inline_query);
  } catch (e) {
    // The user blocked the bot / deleted the chat: normal, nothing to apologise to.
    if (e instanceof TelegramError && e.unreachable) {
      console.log(JSON.stringify({ event: "user_unreachable", updateId: update.update_id, error: e.description }));
      return;
    }
    console.log(JSON.stringify({ event: "handler_error", updateId: update.update_id, error: String(e), stack: (e as Error)?.stack }));
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) {
      const u = await getUser(env.DB, chatId).catch(() => null);
      await quiet(c.tg.sendMessage(chatId, t(u?.lang ?? "en", "err_generic")));
    }
  }
}

// ------------------------------------------------------------- access control
/** Returns the user if they may use the bot, otherwise replies appropriately and returns null. */
async function gate(c: Ctx, from: TgUser, chatId: number): Promise<User | null> {
  const admin = isAdmin(c.env, from.id);
  const mode = (c.env.ACCESS_MODE ?? "approval").toLowerCase();
  let user = await getUser(c.env.DB, chatId);

  if (!user) {
    if (!admin && mode === "closed") {
      await c.tg.sendMessage(chatId, t("en", "acc_closed"));
      return null;
    }
    const status: Status = admin || mode === "open" ? "active" : "pending";
    user = await insertUser(c.env.DB, {
      chatId,
      firstName: from.first_name ?? "",
      username: from.username ?? "",
      status,
      place: DEFAULT_PLACE,
      dailyTime: normaliseTime(c.env.DEFAULT_DAILY_TIME ?? "") ?? "08:30",
    });
    // A brand-new user must not get "today's" report immediately if 08:30 already passed.
    user = await patchUser(c.env.DB, chatId, { lastSent: lastSentAfterChange(user.tz, user.dailyTime) });
    if (status === "pending") await notifyAdmins(c, user);
  } else if (admin && user.status !== "active") {
    user = await patchUser(c.env.DB, chatId, { status: "active" });
  }

  if (user.status === "blocked") return null;
  if (user.status === "pending") {
    await c.tg.sendMessage(chatId, t(user.lang, "acc_pending"));
    return null;
  }
  return user;
}

async function notifyAdmins(c: Ctx, u: User): Promise<void> {
  const who = `${esc(u.firstName || "(no name)")}${u.username ? ` (@${esc(u.username)})` : ""}`;
  for (const adminId of parseIdList(c.env.ADMIN_IDS)) {
    await quiet(c.tg.sendMessage(adminId, `🔔 <b>New access request</b>\n${who}\nID: <code>${u.chatId}</code>`, kb.approvalKeyboard(u.chatId)));
  }
}

// ---------------------------------------------------------------- messages
async function onMessage(c: Ctx, m: TgMessage): Promise<void> {
  if (m.chat.type !== "private" || !m.from) return;
  const user = await gate(c, m.from, m.chat.id);
  if (!user) return;

  if (m.location) return onLocation(c, user, m.location.latitude, m.location.longitude);

  const text = (m.text ?? "").trim();
  if (!text) return;
  if (text.startsWith("/")) return onCommand(c, user, text, m.from);
  if (kb.isButton(text, "btn_now")) return sendReport(c, user, "now");
  if (kb.isButton(text, "btn_city")) return sendCityMenu(c, user);
  if (kb.isButton(text, "btn_settings")) return sendSettings(c, user);
  return onCitySearch(c, user, text);
}

async function onCommand(c: Ctx, user: User, text: string, from: TgUser): Promise<void> {
  const [head, ...args] = text.split(/\s+/);
  const cmd = head.slice(1).split("@")[0].toLowerCase();
  const admin = isAdmin(c.env, user.chatId);
  const help = () => c.tg.sendMessage(user.chatId, t(user.lang, "help"), kb.mainReplyKeyboard(user.lang));

  switch (cmd) {
    case "start": {
      if (!user.firstName && from.first_name) {
        user = await patchUser(c.env.DB, user.chatId, {
          firstName: from.first_name,
          username: from.username ?? "",
          dailyOn: true,
          lastSent: lastSentAfterChange(user.tz, user.dailyTime),
        });
      }
      await setChatCommands(c, user.chatId, user.lang);
      await c.tg.sendMessage(
        user.chatId,
        welcomeMessage(user.lang, user.firstName, placeLabel(placeOf(user)), user.dailyTime),
        kb.mainReplyKeyboard(user.lang),
      );
      return sendReport(c, user, "now");
    }
    case "help":
      return void (await help());
    case "weather":
      return sendReport(c, user, "now");
    case "hourly":
      return sendReport(c, user, "hourly");
    case "tomorrow":
      return sendReport(c, user, "tomorrow");
    case "week":
      return sendReport(c, user, "week");
    case "city":
      return sendCityMenu(c, user);
    case "settings":
      return sendSettings(c, user);
    case "daily": {
      const on = !user.dailyOn;
      const u = await patchUser(c.env.DB, user.chatId, { dailyOn: on, ...(on ? { lastSent: lastSentAfterChange(user.tz, user.dailyTime) } : {}) });
      const msg = u.dailyOn ? t(u.lang, "daily_on_msg", { time: u.dailyTime, tz: u.tz }) : t(u.lang, "daily_off_msg");
      return void (await c.tg.sendMessage(u.chatId, msg));
    }
    case "settime": {
      const hhmm = args.length === 1 ? normaliseTime(args[0]) : null; // "8:30 pm" (two words) is rejected, not read as 08:30
      if (!hhmm) return void (await c.tg.sendMessage(user.chatId, t(user.lang, "settime_usage")));
      const u = await patchUser(c.env.DB, user.chatId, { dailyTime: hhmm, dailyOn: true, lastSent: lastSentAfterChange(user.tz, hhmm) });
      return void (await c.tg.sendMessage(u.chatId, t(u.lang, "settime_ok", { time: hhmm, tz: u.tz })));
    }
    case "evening": {
      let patch: UserPatch;
      if (args.length) {
        const hhmm = args.length === 1 ? normaliseTime(args[0]) : null;
        if (!hhmm) return void (await c.tg.sendMessage(user.chatId, t(user.lang, "evening_usage")));
        patch = { eveningOn: true, eveningTime: hhmm, lastEvening: lastSentAfterChange(user.tz, hhmm) };
      } else {
        const on = !user.eveningOn;
        patch = { eveningOn: on, ...(on ? { lastEvening: lastSentAfterChange(user.tz, user.eveningTime) } : {}) };
      }
      const u = await patchUser(c.env.DB, user.chatId, patch);
      const msg = u.eveningOn ? t(u.lang, "evening_on_msg", { time: u.eveningTime, tz: u.tz }) : t(u.lang, "evening_off_msg");
      return void (await c.tg.sendMessage(u.chatId, msg));
    }
    case "users":
    case "allow":
    case "block":
      if (!admin) return void (await help());
      return onAdminCommand(c, user, cmd, args);
    default:
      return void (await help());
  }
}

// ------------------------------------------------------------------- views
async function sendReport(c: Ctx, user: User, view: kb.View): Promise<void> {
  await quiet(c.tg.sendChatAction(user.chatId));
  try {
    const { text, markup } = await buildView(c.wx, user, view);
    await c.tg.sendMessage(user.chatId, text, markup);
  } catch (e) {
    if (!(e instanceof WeatherError)) throw e;
    await c.tg.sendMessage(user.chatId, t(user.lang, "err_wx"), kb.retryKeyboard(view, user.lang));
  }
}

const cityMenuText = (u: User) => t(u.lang, "city_menu", { p: esc(placeLabel(placeOf(u))) });

async function sendCityMenu(c: Ctx, user: User): Promise<void> {
  await c.tg.sendMessage(user.chatId, cityMenuText(user), kb.locationMenu(user.lang));
}

async function sendSettings(c: Ctx, user: User): Promise<void> {
  const v = kb.settingsView(user, "menu");
  await c.tg.sendMessage(user.chatId, v.text, v.markup);
}

// ---------------------------------------------------------------- location
/** Validate a place by fetching its weather, persist it, and return the report message. */
async function applyPlace(c: Ctx, user: User, place: Place): Promise<{ text: string; markup: Markup; user: User }> {
  // No backup source here: it can't tell us the timezone we are about to save.
  const report = await c.wx.fetchReport(place, true, { allowFallback: false });
  place.tz = report.wx.timezone;
  let u = await setLocation(c.env.DB, user.chatId, place);
  // The timezone may have changed: don't fire a "late" report right after moving.
  u = await patchUser(c.env.DB, u.chatId, {
    lastSent: lastSentAfterChange(u.tz, u.dailyTime),
    lastEvening: lastSentAfterChange(u.tz, u.eveningTime),
  });
  const ribbon = `✅ <b>${t(u.lang, "ribbon_saved")}</b> ${esc(placeLabel(place))}`;
  return { text: weatherMessage(report, prefsOf(u), ribbon), markup: kb.reportKeyboard(u, "now"), user: u };
}

/** The user's saved place, renamed into `lang` when that can be done reliably. */
async function localisedPlace(c: Ctx, u: User, lang: Lang): Promise<Place> {
  const p = placeOf(u);
  const idx = matchPreset(p.lat, p.lon);
  if (idx !== null) return { ...presetPlace(idx, lang), tz: p.tz };
  try {
    for (const cand of await c.wx.searchPlaces(p.name, 5, lang)) {
      if (haversineKm(p.lat, p.lon, cand.lat, cand.lon) < 15) return { ...cand, lat: p.lat, lon: p.lon, tz: p.tz };
    }
  } catch {
    /* keep the existing name */
  }
  return p;
}

async function onLocation(c: Ctx, user: User, lat: number, lon: number): Promise<void> {
  await quiet(c.tg.sendChatAction(user.chatId));
  try {
    const place = await c.wx.reverseGeocode(lat, lon, user.lang);
    const r = await applyPlace(c, user, place);
    await c.tg.sendMessage(user.chatId, r.text, r.markup);
  } catch (e) {
    if (!(e instanceof WeatherError)) throw e;
    await c.tg.sendMessage(user.chatId, t(user.lang, "err_loc"));
  }
}

async function onCitySearch(c: Ctx, user: User, text: string): Promise<void> {
  if (text.length < 2 || text.length > 60) {
    return void (await c.tg.sendMessage(user.chatId, t(user.lang, "type_city")));
  }
  await quiet(c.tg.sendChatAction(user.chatId));
  let results: Place[];
  try {
    results = await c.wx.searchPlaces(text, 5, user.lang);
  } catch (e) {
    if (!(e instanceof WeatherError)) throw e;
    return void (await c.tg.sendMessage(user.chatId, t(user.lang, "err_search")));
  }
  if (!results.length) {
    return void (await c.tg.sendMessage(user.chatId, t(user.lang, "not_found", { q: esc(text) })));
  }
  await patchUser(c.env.DB, user.chatId, { searchJson: JSON.stringify(results) });
  await c.tg.sendMessage(user.chatId, t(user.lang, "which_one"), kb.resultsKeyboard(results, user.lang));
}

// ----------------------------------------------------------- inline buttons
/** Edit the message. Returns true if edited; false if identical (we then answer with a toast). */
async function edit(c: Ctx, q: TgCallback, text: string, markup: Markup | undefined, lang: Lang): Promise<boolean> {
  const msg = q.message!;
  try {
    await c.tg.editMessageText(msg.chat.id, msg.message_id, text, markup);
    return true;
  } catch (e) {
    if (e instanceof TelegramError && e.notModified) {
      await quiet(c.tg.answerCallback(q.id, t(lang, "toast_uptodate")));
      return false;
    }
    throw e;
  }
}

async function onCallback(c: Ctx, q: TgCallback): Promise<void> {
  const msg = q.message;
  const data = q.data ?? "";
  if (!msg || msg.chat.type !== "private") return void (await quiet(c.tg.answerCallback(q.id)));
  if (data.startsWith("adm:")) return onAdminCallback(c, q, data);

  const user = await gate(c, q.from, msg.chat.id);
  if (!user) return void (await quiet(c.tg.answerCallback(q.id)));
  const lang = user.lang;
  const chatId = user.chatId;
  const ack = (text?: string) => quiet(c.tg.answerCallback(q.id, text));
  /** Show a Settings page (re-rendered from the latest user data) and answer the button press. */
  const showPage = async (u: User, page: kb.SettingsPage) => {
    const v = kb.settingsView(u, page);
    if (await edit(c, q, v.text, v.markup, u.lang)) await ack();
  };

  /**
   * Save a new location and show its report. The button press was already answered ("Switching location…"),
   * and Telegram allows only one answer, so a failure is shown IN the message (with the city menu to try again).
   */
  const switchTo = async (place: Place) => {
    try {
      const r = await applyPlace(c, user, place);
      await edit(c, q, r.text, r.markup, lang);
    } catch (e) {
      if (!(e instanceof WeatherError)) throw e;
      await edit(c, q, t(lang, "err_wx"), kb.locationMenu(lang), lang);
    }
  };

  try {
    if (data.startsWith("v:") || data.startsWith("r:")) {
      const { text, markup } = await buildView(c.wx, user, kb.asView(data.slice(2)), { force: data[0] === "r" });
      if (await edit(c, q, text, markup, lang)) await ack(data[0] === "r" ? t(lang, "toast_updated") : undefined);
    } else if (data === "chg") {
      await ack();
      await edit(c, q, cityMenuText(user), kb.locationMenu(lang), lang);
    } else if (data === "set" || data.startsWith("set:")) {
      const page = data === "set" ? "menu" : data.slice(4);
      await showPage(user, (kb.SETTINGS_PAGES as readonly string[]).includes(page) ? (page as kb.SettingsPage) : "menu");
    } else if (data.startsWith("tg:")) {
      const section = data.slice(3);
      const u = (SECTIONS as readonly string[]).includes(section) ? await toggleSection(c.env.DB, chatId, section) : user;
      await showPage(u, "sec");
    } else if (data.startsWith("lang:")) {
      const code = data.slice(5);
      if (!(code in LANGS)) return void (await ack());
      const newLang = normLang(code);
      if (newLang === lang) return void (await ack()); // already selected: nothing to redo
      let u = await patchUser(c.env.DB, chatId, { lang: newLang });
      const np = await localisedPlace(c, u, newLang);
      if (np.name !== u.placeName || np.country !== u.country) u = await setLocation(c.env.DB, chatId, np);
      await showPage(u, "lang");
      // The bottom keyboard and command menu can only be replaced by sending a message.
      await c.tg.sendMessage(chatId, t(newLang, "lang_changed"), kb.mainReplyKeyboard(newLang));
      await setChatCommands(c, chatId, newLang);
    } else if (data.startsWith("u:")) {
      const [, kind, val] = data.split(":");
      const patch: UserPatch = {};
      if (kind === "t" && (TEMP_UNITS as readonly string[]).includes(val)) patch.tempUnit = val as User["tempUnit"];
      else if (kind === "w" && (WIND_UNITS as readonly string[]).includes(val)) patch.windUnit = val as User["windUnit"];
      else if (kind === "c" && (CLOCK_MODES as readonly string[]).includes(val)) patch.clock = val as User["clock"];
      else if (kind === "k") patch.compact = !user.compact;
      await showPage(Object.keys(patch).length ? await patchUser(c.env.DB, chatId, patch) : user, "units");
    } else if (data.startsWith("al:")) {
      const [, kind, val] = data.split(":");
      let patch: UserPatch = {};
      if (kind === "rain") patch = { rainAlerts: !user.rainAlerts, lastRainAlert: 0 };
      else if (kind === "aqi" && (AQI_ALERT_LEVELS as readonly number[]).includes(Number(val))) {
        patch = { aqiAlert: Number(val), aqiAlertActive: false, lastAqiAlert: 0 };
      } else if (kind === "eve") {
        const on = !user.eveningOn;
        patch = { eveningOn: on, ...(on ? { lastEvening: lastSentAfterChange(user.tz, user.eveningTime) } : {}) };
      }
      await showPage(Object.keys(patch).length ? await patchUser(c.env.DB, chatId, patch) : user, "alerts");
    } else if (data.startsWith("mute:")) {
      const kind = data.slice(5);
      const patch: UserPatch = kind === "rain" ? { rainAlerts: false } : kind === "aqi" ? { aqiAlert: 0, aqiAlertActive: false } : {};
      if (Object.keys(patch).length) await patchUser(c.env.DB, chatId, patch);
      await quiet(c.tg.editReplyMarkup(chatId, msg.message_id, { inline_keyboard: [[{ text: t(lang, "b_report"), callback_data: "v:now" }]] }));
      await ack(t(lang, "toast_muted"));
    } else if (data.startsWith("pre:")) {
      await ack(t(lang, "toast_switch"));
      const i = Number(data.slice(4));
      if (!Number.isInteger(i) || i < 0 || i >= PRESET_COUNT) return;
      await switchTo(presetPlace(i, lang));
    } else if (data.startsWith("pick:")) {
      await ack(t(lang, "toast_switch"));
      let results: Place[] = [];
      try {
        results = JSON.parse(user.searchJson || "[]");
      } catch {
        /* treat as expired */
      }
      const place = results[Number(data.slice(5))];
      if (!place) return void (await edit(c, q, t(lang, "list_expired"), undefined, lang));
      await switchTo(place);
    } else if (data.startsWith("daily:")) {
      const view = kb.asView(data.slice(6));
      const on = !user.dailyOn;
      const u = await patchUser(c.env.DB, chatId, { dailyOn: on, ...(on ? { lastSent: lastSentAfterChange(user.tz, user.dailyTime) } : {}) });
      await c.tg.editReplyMarkup(chatId, msg.message_id, kb.reportKeyboard(u, view));
      await ack(t(lang, u.dailyOn ? "toast_daily_on" : "toast_daily_off"));
    } else {
      await ack();
    }
  } catch (e) {
    if (e instanceof WeatherError) await quiet(c.tg.answerCallback(q.id, t(lang, "err_toast"), true));
    else throw e;
  }
}

// -------------------------------------------------------------- inline mode
/** `@SkyBrief_AI_bot ipoh` typed in any chat -> weather cards the person can send there. */
async function onInline(c: Ctx, q: TgInlineQuery): Promise<void> {
  const mode = (c.env.ACCESS_MODE ?? "approval").toLowerCase();
  const user = await getUser(c.env.DB, q.from.id);
  const lang = user?.lang ?? "en";
  const allowed = isAdmin(c.env, q.from.id) || user?.status === "active" || (mode === "open" && user?.status !== "blocked");
  if (!allowed) {
    // Private bot: point them to the bot chat instead of answering.
    return void (await c.tg.answerInlineQuery(q.id, [], { cacheTime: 5, button: { text: t(lang, "inline_open"), start_parameter: "inline" } }));
  }

  const p = user ? prefsOf(user) : defaultPrefs();
  const query = q.query.trim().slice(0, 60);
  let places: Place[] = [];
  if (query.length >= 2) {
    try {
      places = await c.wx.searchPlaces(query, 3, lang);
    } catch {
      places = [];
    }
  } else if (user) {
    places = [placeOf(user)];
  }

  const settled = await Promise.allSettled(places.map((pl) => c.wx.fetchReport(pl)));
  const results: Record<string, unknown>[] = [];
  settled.forEach((s, i) => {
    if (s.status !== "fulfilled") return;
    const card = inlineCard(s.value, p);
    const id = `${places[i].lat.toFixed(3)},${places[i].lon.toFixed(3)}`;
    if (results.some((r) => r.id === id)) return; // Telegram rejects the whole answer if two results share an id
    results.push({
      type: "article",
      id,
      title: card.title,
      description: card.description,
      input_message_content: { message_text: card.text, parse_mode: "HTML" },
    });
  });
  if (!results.length) {
    results.push({
      type: "article",
      id: "hint",
      title: t(lang, "inline_hint_title"),
      description: t(lang, "inline_hint_desc"),
      input_message_content: { message_text: t(lang, "inline_hint_text") },
    });
  }
  await c.tg.answerInlineQuery(q.id, results, { cacheTime: 120, isPersonal: true });
}

// -------------------------------------------------------------------- admin
async function onAdminCommand(c: Ctx, admin: User, cmd: string, args: string[]): Promise<void> {
  const reply = (text: string) => c.tg.sendMessage(admin.chatId, text);

  if (cmd === "users") {
    const users = await listUsers(c.env.DB, 60);
    const icon: Record<Status, string> = { active: "✅", pending: "⏳", blocked: "⛔" };
    const lines = users.map(
      (u) =>
        `${icon[u.status]} ${esc(u.firstName || "?")}${u.username ? ` @${esc(u.username)}` : ""} · <code>${u.chatId}</code> · ${esc(u.placeName)} · ${u.lang}` +
        (u.dailyOn ? ` · 🔔${u.dailyTime}` : "") +
        (u.eveningOn ? ` · 🌙${u.eveningTime}` : "") +
        (u.rainAlerts || u.aqiAlert ? " · ⚠️" : ""),
    );
    // Cut by whole lines so an HTML tag or entity is never split (Telegram would reject the message).
    const head = `👥 <b>Users (${users.length})</b>\n\n`;
    let body = "";
    let shown = 0;
    for (const line of lines) {
      if (head.length + body.length + line.length + 1 > 3800) break;
      body += line + "\n";
      shown++;
    }
    return void (await reply(head + (body || "none yet\n") + (shown < lines.length ? `… and ${lines.length - shown} more` : "")));
  }

  const id = Number(args[0]);
  if (!Number.isInteger(id) || id <= 0) return void (await reply(`Usage: <code>/${cmd} 123456789</code>`));
  const existing = await getUser(c.env.DB, id);
  const status: Status = cmd === "allow" ? "active" : "blocked";
  if (existing) await patchUser(c.env.DB, id, { status });
  else {
    await insertUser(c.env.DB, { chatId: id, firstName: "", username: "", status, place: DEFAULT_PLACE, dailyTime: normaliseTime(c.env.DEFAULT_DAILY_TIME ?? "") ?? "08:30" });
    // Someone who has never pressed /start can't be messaged yet (Telegram answers 403): start with reports off.
    // Their first /start records who they are and switches the daily report on.
    await patchUser(c.env.DB, id, { dailyOn: false });
  }
  if (cmd === "allow") {
    await quiet(c.tg.sendMessage(id, t(existing?.lang ?? "en", "acc_approved")));
    await reply(`✅ Allowed <code>${id}</code>. They can now send /start to the bot.`);
  } else {
    await reply(`⛔ Blocked <code>${id}</code>.`);
  }
}

async function onAdminCallback(c: Ctx, q: TgCallback, data: string): Promise<void> {
  if (!isAdmin(c.env, q.from.id)) return void (await quiet(c.tg.answerCallback(q.id)));
  const [, action, idText] = data.split(":");
  const id = Number(idText);
  const msg = q.message!;
  const target = Number.isInteger(id) ? await getUser(c.env.DB, id) : null;
  if (!target) {
    await quiet(c.tg.answerCallback(q.id, "User not found", true));
    return;
  }
  const label = `${esc(target.firstName || "?")}${target.username ? ` (@${esc(target.username)})` : ""} <code>${id}</code>`;
  if (action === "ok") {
    await patchUser(c.env.DB, id, { status: "active" });
    await quiet(c.tg.sendMessage(id, t(target.lang, "acc_approved")));
    await quiet(c.tg.answerCallback(q.id, "Approved ✅"));
    await quiet(c.tg.editMessageText(msg.chat.id, msg.message_id, `✅ Approved: ${label}`));
  } else {
    await patchUser(c.env.DB, id, { status: "blocked" });
    await quiet(c.tg.answerCallback(q.id, "Denied ⛔"));
    await quiet(c.tg.editMessageText(msg.chat.id, msg.message_id, `⛔ Denied: ${label}`));
  }
}
