/**
 * End-to-end test: runs the REAL Worker in Cloudflare's runtime (workerd via `wrangler dev`) with a local D1
 * database, a mock Telegram server and a controllable mock of every weather service, then plays a full
 * multi-user scenario through the webhook and the cron trigger.
 *
 *   npm run test:integration          (takes ~2 minutes: one step waits for a real clock minute to arrive)
 *
 * Nothing here touches the internet.
 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import http from "node:http";
import { startMockWeather } from "./mock-weather.mjs";

const TG_PORT = 18999;
const WX_PORT = 19001;
const WORKER_PORT = 18787;
const SECRET = "test_secret_123";
const WORKER = `http://127.0.0.1:${WORKER_PORT}`;
const WX = `http://127.0.0.1:${WX_PORT}`;
const isWin = process.platform === "win32";

const ADMIN = 1001;
const ALICE = 2002;
const BLOCKED = 3003;
const TOKYO_USER = 4004;
const GHOST = 777; // has blocked the bot: Telegram answers 403
const STRANGER = 9009; // never approved

// ------------------------------------------------------------------ mock Telegram
const calls = []; // { method, body }
const answeredCallbacks = new Map(); // callback_query_id -> times answered
let nextMessageId = 1000;
const telegram = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const method = req.url.split("/").pop();
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ method, body });
    if (method === "answerCallbackQuery") answeredCallbacks.set(body.callback_query_id, (answeredCallbacks.get(body.callback_query_id) ?? 0) + 1);
    res.setHeader("content-type", "application/json");
    if (body.chat_id === GHOST && (method === "sendMessage" || method === "editMessageText")) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }));
    }
    res.end(JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: nextMessageId++ } : true }));
  });
});

// ------------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? `\n      ${String(detail).slice(0, 400)}` : ""}`);
  }
}
const mark = () => calls.length;
const since = (n) => calls.slice(n);
const text = (c) => String(c?.body?.text ?? "");
const buttons = (c) => (c?.body?.reply_markup?.inline_keyboard ?? []).flat();
const btn = (c, data) => buttons(c).find((b) => b.callback_data === data);
const sentTo = (n, chatId, pred = () => true) => since(n).filter((c) => c.method === "sendMessage" && c.body.chat_id === chatId && pred(c));
const edits = (n, pred = () => true) => since(n).filter((c) => c.method === "editMessageText" && pred(c));
async function waitFor(pred, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = pred();
    if (v && (!Array.isArray(v) || v.length)) return v;
    await sleep(120);
  }
  return null;
}
let updateId = 1;
async function post(update, secret = SECRET) {
  const res = await fetch(`${WORKER}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({ update_id: updateId++, ...update }),
  });
  return res.status;
}
const from = (id, name = `User${id}`) => ({ id, first_name: name, username: `user${id}` });
const say = (id, t, name) => post({ message: { message_id: 1, from: from(id, name), chat: { id, type: "private" }, text: t } });
const shareLocation = (id, latitude, longitude) =>
  post({ message: { message_id: 2, from: from(id), chat: { id, type: "private" }, location: { latitude, longitude } } });
let cbSeq = 1;
const tap = (id, data, messageId = 5000) => {
  const cid = `cb${cbSeq++}`;
  return post({ callback_query: { id: cid, from: from(id), data, message: { message_id: messageId, chat: { id, type: "private" } } } }).then(() => cid);
};
let iqSeq = 1;
const inline = (id, query) => post({ inline_query: { id: `iq${iqSeq++}`, from: from(id), query, offset: "" } });
const mockSet = (o) => fetch(`${WX}/__set?${new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)]))}`);
const trigger = async () => (await fetch(`${WORKER}/cdn-cgi/handler/scheduled`)).status;
const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

// ------------------------------------------------------------------ process management
let worker;
let weatherServer;
function killTree(proc) {
  if (!proc?.pid) return;
  if (isWin) spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  else proc.kill("SIGKILL");
}
async function shutdown(code) {
  killTree(worker);
  telegram.close();
  weatherServer?.close();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(130));

// ------------------------------------------------------------------ run
console.log("Preparing local database…");
rmSync(".wrangler/state", { recursive: true, force: true });
const mig = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "skybrief", "--local"], { shell: true, input: "y\n", encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
if (mig.status !== 0 || !/0002_features/.test(mig.stdout + mig.stderr)) {
  console.error("Migrations failed or 0002 was not applied:\n", mig.stdout, mig.stderr);
  process.exit(1);
}
console.log("  migrations 0001 + 0002 applied");

await new Promise((r) => telegram.listen(TG_PORT, "127.0.0.1", r));
weatherServer = await startMockWeather(WX_PORT);

console.log("Starting the Worker in workerd (wrangler dev)…");
const vars = {
  TELEGRAM_BOT_TOKEN: "testtoken",
  WEBHOOK_SECRET: SECRET,
  ADMIN_IDS: String(ADMIN),
  ACCESS_MODE: "approval",
  QUIET_HOURS: "off",
  ALERTS_EVERY_MINUTE: "1",
  WAQI_TOKEN: "waqitest",
  TELEGRAM_API_BASE: `http://127.0.0.1:${TG_PORT}`,
  OPEN_METEO_FORECAST_URL: `${WX}/forecast`,
  OPEN_METEO_AIR_URL: `${WX}/air`,
  OPEN_METEO_GEO_URL: `${WX}/geo`,
  NOMINATIM_URL: `${WX}/reverse`,
  WAQI_URL: `${WX}/waqi`,
  METNO_URL: `${WX}/metno`,
  WARNINGS_URL: `${WX}/warnings`,
  HEALTH_EVERY_MINUTE: "1",
};
worker = spawn(
  "npx",
  ["wrangler", "dev", "--port", String(WORKER_PORT), "--test-scheduled", "--ip", "127.0.0.1", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
  { shell: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"] },
);
let workerLog = "";
worker.stdout.on("data", (d) => (workerLog += d));
worker.stderr.on("data", (d) => (workerLog += d));

let up = false;
for (let i = 0; i < 300 && !up; i++) {
  try {
    up = (await fetch(`${WORKER}/`)).ok;
  } catch {
    await sleep(300);
  }
}
if (!up) {
  console.error("Worker did not start:\n", workerLog.slice(-3000));
  await shutdown(1);
}
console.log("Worker is up. Running scenarios:\n");

let n;
try {
  // =========================================================== 1. security & setup
  console.log("Security & setup");
  check("GET / health", (await (await fetch(`${WORKER}/`)).text()).includes("SkyBrief"));
  check("webhook without the secret → 403", (await post({ message: {} }, "wrong")) === 403);
  check("/setup with a wrong key → 403", (await fetch(`${WORKER}/setup?key=nope`)).status === 403);
  n = mark();
  const setup = await (await fetch(`${WORKER}/setup?key=${SECRET}`)).json();
  check("/setup registers webhook + commands", setup.ok === true);
  const hook = since(n).find((c) => c.method === "setWebhook");
  check("setWebhook carries url + secret_token", hook?.body.secret_token === SECRET && String(hook?.body.url).endsWith("/webhook"));
  check("webhook subscribes to inline queries (needed for inline mode)", hook?.body.allowed_updates?.includes("inline_query"));
  check("command menus set for en, ms, zh", since(n).filter((c) => c.method === "setMyCommands").length === 3);
  check("menus list the new commands", ["tomorrow", "week", "evening"].every((cmd) => since(n).every((c) => c.method !== "setMyCommands" || JSON.stringify(c.body.commands).includes(`"${cmd}"`))));

  // =========================================================== 2. admin onboarding
  console.log("\nAdmin onboarding: the new report");
  n = mark();
  await say(ADMIN, "/start", "Boss");
  await waitFor(() => sentTo(n, ADMIN).length >= 2);
  const msgs = sentTo(n, ADMIN);
  const report = msgs[1];
  check("welcome + report arrive, with the bottom keyboard", text(msgs[0]).includes("SkyBrief") && !!msgs[0].body.reply_markup?.keyboard);
  check("report has weather, air, rain, tips", ["Kuala Lumpur", "Humidity", "Air quality", "Rain outlook", "Tips"].every((s) => text(report).includes(s)), text(report).slice(0, 200));
  check("report has the NEW 'Best time outside' section", text(report).includes("Best time outside") && text(report).includes("comfortable temperature"));
  check("report compares with yesterday (📈 3° warmer)", text(report).includes("📈 3° warmer than yesterday"));
  check("report shows the AQI outlook (rising to ~92)", /Rising: peak ~92 around/.test(text(report)), text(report).split("\n").filter((l) => l.includes("AQI") || l.includes("Rising")).join(" | "));
  check("navigation: Today / Hourly / Tomorrow / 7-day + Refresh + Settings", ["v:now", "v:hourly", "v:tomorrow", "v:week", "r:now", "set", "chg", "daily:now"].every((d) => btn(report, d)));
  check("current view (Today) is marked", btn(report, "v:now").text.startsWith("● "));
  check("admin gets the full command menu incl. admin commands", since(n).some((c) => c.method === "setMyCommands" && ["allow", "tomorrow", "evening"].every((x) => JSON.stringify(c.body.commands).includes(x))));

  // =========================================================== 3. views
  console.log("\nViews: tomorrow, 7-day, hourly");
  n = mark();
  await tap(ADMIN, "v:tomorrow");
  const tm = await waitFor(() => edits(n)[0]);
  check("Tomorrow view: forecast, parts of the day, best time, tips", !!tm && ["Tomorrow", "Morning", "Afternoon", "Evening", "Rain chance", "Best time outside", "Tips"].every((s) => text(tm).includes(s)), text(tm ?? {}).slice(0, 300));
  check("Tomorrow view: air-quality peak (model)", !!tm && /Expected peak ~\d+ around/.test(text(tm)));
  check("Tomorrow view: the Tomorrow button is marked", !!tm && btn(tm, "v:tomorrow").text.startsWith("● ") && !btn(tm, "v:now").text.startsWith("● "));
  n = mark();
  await tap(ADMIN, "v:week");
  const wk = await waitFor(() => edits(n)[0]);
  check("7-day view: seven days, today labelled, weekend marked", !!wk && text(wk).includes("7-day outlook") && text(wk).includes("<b>Today</b>") && text(wk).includes("🎉") && (text(wk).match(/💧/g) ?? []).length === 7, text(wk ?? {}));
  n = mark();
  await tap(ADMIN, "v:hourly");
  const hr = await waitFor(() => edits(n)[0]);
  check("Hourly view still works", !!hr && text(hr).includes("Next 12 hours") && (text(hr).match(/<code>/g) ?? []).length === 12);
  n = mark();
  await say(ADMIN, "/tomorrow");
  check("/tomorrow command", !!(await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Tomorrow"))[0])));
  n = mark();
  await say(ADMIN, "/week");
  check("/week command", !!(await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("7-day outlook"))[0])));
  n = mark();
  await tap(ADMIN, "r:week");
  const rw = await waitFor(() => since(n).find((c) => c.method === "answerCallbackQuery"));
  check("Refresh keeps you on the same view (and confirms)", !!rw && edits(n).every((c) => text(c).includes("7-day outlook")) && rw.body.text === "Updated ✅");

  // =========================================================== 4. city search
  console.log("\nCity search & one-tap change");
  n = mark();
  await say(ADMIN, "Ipoh");
  const results = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Which one"))[0]);
  check("typing a city name shows choices", !!results && !!btn(results, "pick:0"));
  n = mark();
  await tap(ADMIN, "pick:0");
  const picked = await waitFor(() => edits(n, (c) => text(c).includes("Ipoh"))[0]);
  check("picking a result saves it and shows the report", !!picked && text(picked).includes("Location saved") && text(picked).includes("Perak"));
  n = mark();
  await tap(ADMIN, "pre:3");
  check("one-tap preset city works (Penang)", !!(await waitFor(() => edits(n, (c) => text(c).includes("George Town"))[0])));
  n = mark();
  await tap(ADMIN, "pick:4");
  check("a pick beyond the stored results says the list expired", !!(await waitFor(() => edits(n, (c) => text(c).includes("expired"))[0])));
  await tap(ADMIN, "pre:99");
  await tap(ADMIN, "bogus:data");
  await tap(ADMIN, "set:nonsense");

  // =========================================================== 5. settings
  console.log("\nSettings: pages & sections");
  n = mark();
  await tap(ADMIN, "set");
  const menu = await waitFor(() => edits(n)[0]);
  check("Settings opens a menu with 4 pages", !!menu && ["set:sec", "set:lang", "set:units", "set:alerts"].every((d) => btn(menu, d)) && !!btn(menu, "v:now"));
  n = mark();
  await tap(ADMIN, "set:sec");
  const sec = await waitFor(() => edits(n)[0]);
  check("Sections page lists 7 sections incl. 'Best time outside'", !!sec && buttons(sec).filter((b) => b.callback_data.startsWith("tg:")).length === 7 && !!btn(sec, "tg:best"));
  n = mark();
  await tap(ADMIN, "tg:air");
  const t1 = await waitFor(() => edits(n)[0]);
  check("toggling air quality flips ✅ → ⬜", btn(t1, "tg:air")?.text.startsWith("⬜"));
  n = mark();
  await tap(ADMIN, "tg:best");
  await waitFor(() => edits(n)[0]);
  n = mark();
  await tap(ADMIN, "v:now");
  const slim = await waitFor(() => edits(n)[0]);
  check("report hides Air quality and Best time, keeps the rest", !!slim && !text(slim).includes("Air quality") && !text(slim).includes("Best time outside") && text(slim).includes("Humidity"));
  await tap(ADMIN, "set:sec");
  await tap(ADMIN, "tg:air");
  await tap(ADMIN, "tg:best");
  await sleep(600);

  // =========================================================== 6. units & display
  console.log("\nUnits & display");
  n = mark();
  await tap(ADMIN, "set:units");
  const units = await waitFor(() => edits(n)[0]);
  check("Units page: °C/°F, km/h|m/s|mph, clock, compact", !!units && ["u:t:c", "u:t:f", "u:w:kmh", "u:w:ms", "u:w:mph", "u:c:auto", "u:c:12", "u:c:24", "u:k"].every((d) => btn(units, d)));
  check("defaults are marked (°C, km/h, Auto, compact off)", btn(units, "u:t:c").text.startsWith("●") && btn(units, "u:w:kmh").text.startsWith("●") && btn(units, "u:c:auto").text.startsWith("●") && btn(units, "u:k").text.startsWith("⬜"));
  n = mark();
  await tap(ADMIN, "u:t:f");
  const uf = await waitFor(() => edits(n)[0]);
  check("choosing °F marks it on the page", btn(uf, "u:t:f").text.startsWith("●") && !btn(uf, "u:t:c").text.startsWith("●"));
  await tap(ADMIN, "u:w:ms");
  await tap(ADMIN, "u:c:24");
  await sleep(500);
  n = mark();
  await tap(ADMIN, "v:now");
  const fr = await waitFor(() => edits(n)[0]);
  check("report is in °F (83°F, 92° high) — no °C left", !!fr && text(fr).includes("83°F") && text(fr).includes("▲ 92°") && !text(fr).includes("°C"), text(fr ?? {}).slice(0, 250));
  check("wind in m/s", text(fr).includes("3.2 m/s"));
  check("24-hour clock — no AM/PM anywhere", !/ (AM|PM)\b/.test(text(fr)) && text(fr).includes("07:01"));
  check("trend uses °F too (3°C ≈ 5°F)", text(fr).includes("📈 5° warmer"));
  n = mark();
  await tap(ADMIN, "set:units");
  await tap(ADMIN, "u:k");
  await sleep(500);
  await tap(ADMIN, "v:now");
  const compact = await waitFor(() => edits(n, (c) => text(c).includes("83°F"))[0]);
  check("compact mode: a short report with the essentials", !!compact && text(compact).length < 700 && !text(compact).includes("┈") && text(compact).includes("AQI") && text(compact).includes("💧 78%"), `${text(compact ?? {}).length} chars:\n${text(compact ?? {})}`);
  // back to defaults
  for (const d of ["set:units", "u:t:c", "u:w:kmh", "u:c:auto", "u:k"]) await tap(ADMIN, d);
  await sleep(700);
  n = mark();
  await tap(ADMIN, "v:now");
  const back = await waitFor(() => edits(n)[0]);
  check("resetting units restores the standard report", !!back && text(back).includes("28°C") && text(back).includes("12 km/h") && text(back).includes("AM") && text(back).includes("Best time outside"));

  // =========================================================== 7. language
  console.log("\nLanguage");
  n = mark();
  await tap(ADMIN, "set:lang");
  const langPage = await waitFor(() => edits(n)[0]);
  check("Language page lists 3 languages, English marked", !!langPage && buttons(langPage).filter((b) => b.callback_data.startsWith("lang:")).length === 3 && btn(langPage, "lang:en").text.startsWith("●"));
  n = mark();
  await tap(ADMIN, "lang:zh");
  const zhPage = await waitFor(() => edits(n)[0]);
  const zhNotice = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("中文"))[0]);
  check("switching to 中文 re-renders the page in Chinese", !!zhPage && text(zhPage).includes("语言"));
  check("bottom keyboard replaced with Chinese buttons", !!zhNotice && JSON.stringify(zhNotice.body.reply_markup).includes("当前天气"));
  check("command menu re-sent in Chinese (incl. new commands)", since(n).some((c) => c.method === "setMyCommands" && JSON.stringify(c.body.commands).includes("明天的预报")));
  n = mark();
  await tap(ADMIN, "v:now");
  const zhReport = await waitFor(() => edits(n)[0]);
  check("report fully Chinese: wind, humidity, air, outlook, best time, trend, place", !!zhReport && ["湿度", "风力", "空气质量", "将上升", "户外最佳时段", "比昨天热 3°", "乔治市"].every((s) => text(zhReport).includes(s)), text(zhReport ?? {}).slice(0, 300));
  n = mark();
  await tap(ADMIN, "v:tomorrow");
  const zhTomorrow = await waitFor(() => edits(n)[0]);
  check("tomorrow view in Chinese", !!zhTomorrow && ["明天", "上午", "下午", "傍晚"].every((s) => text(zhTomorrow).includes(s)));
  n = mark();
  await say(ADMIN, "🌦 当前天气");
  check("Chinese bottom-bar button works", !!(await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("湿度"))[0])));

  // =========================================================== 8. GPS
  console.log("\nGPS location");
  n = mark();
  await shareLocation(ADMIN, 3.1478, 101.6953);
  const gps = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("位置已保存"))[0]);
  check("shared location is detected, named, saved and reported", !!gps && text(gps).includes("湿度") && text(gps).includes("Bukit Bintang"));

  // =========================================================== 9. multi-user access control
  console.log("\nMultiple users & access control");
  n = mark();
  await say(ALICE, "/start", "Alice");
  check("new user is told their request is pending", !!(await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("sent to the admin"))[0])));
  const request = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("New access request"))[0]);
  check("admin is notified with Approve / Deny buttons", !!request && !!btn(request, `adm:ok:${ALICE}`) && !!btn(request, `adm:no:${ALICE}`));
  n = mark();
  await tap(ALICE, `adm:ok:${ALICE}`);
  await sleep(1200);
  check("a non-admin can't approve themselves", !sentTo(n, ALICE).length);
  n = mark();
  await tap(ADMIN, `adm:ok:${ALICE}`, 7000);
  check("admin approval notifies the user", !!(await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("approved"))[0])));
  n = mark();
  await say(ALICE, "/start", "Alice");
  const alice = await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Humidity"))[0]);
  check("approved user gets the default English report, independent of the admin's Chinese/Penang settings", !!alice && text(alice).includes("Kuala Lumpur") && text(alice).includes("Best time outside") && !/[一-鿿]/.test(text(alice)));
  n = mark();
  await say(ADMIN, "/block 3003");
  await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Blocked"))[0]);
  n = mark();
  await say(BLOCKED, "/start");
  await sleep(1500);
  check("a blocked user gets no reply at all", !since(n).some((c) => c.body.chat_id === BLOCKED));
  n = mark();
  await say(ADMIN, "/allow 777");
  await say(ADMIN, "/allow 4004");
  await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Allowed <code>4004"))[0]);
  n = mark();
  await say(ADMIN, "/users");
  const list = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Users ("))[0]);
  check("/users lists everyone with status", !!list && ["1001", "2002", "3003", "777", "4004"].every((id) => text(list).includes(id)) && text(list).includes("⛔"));
  n = mark();
  await say(ALICE, "/users");
  await sleep(1200);
  check("/users is admin-only", !since(n).some((c) => text(c).includes("Users (")));

  // =========================================================== 10. alerts
  console.log("\nAlerts: rain and air quality (opt-in, once, honest)");
  n = mark();
  await tap(ALICE, "set:alerts");
  const alertsPage = await waitFor(() => edits(n)[0]);
  check("Alerts page: rain toggle, AQI levels, evening report", !!alertsPage && !!btn(alertsPage, "al:rain") && [0, 101, 151, 201].every((l) => btn(alertsPage, `al:aqi:${l}`)) && !!btn(alertsPage, "al:eve"));
  check("everything is OFF by default", btn(alertsPage, "al:rain").text.startsWith("⬜") && btn(alertsPage, "al:aqi:0").text.startsWith("●") && btn(alertsPage, "al:eve").text.startsWith("⬜"));
  n = mark();
  await trigger(); // nothing is due and nobody opted in
  await sleep(2000);
  check("no alerts are sent to people who didn't opt in", !since(n).some((c) => /alert/i.test(text(c))));
  await tap(ALICE, "al:rain");
  n = mark();
  await tap(ALICE, "al:aqi:101");
  const armed = await waitFor(() => edits(n)[0]);
  check("opting in is reflected on the page", btn(armed, "al:aqi:101").text.startsWith("●"));

  await mockSet({ rainSoon: 1, rainingNow: 0 });
  n = mark();
  await trigger();
  const rain = await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Rain alert"))[0]);
  check("rain alert arrives when rain is imminent", !!rain && /Rain likely around \d+ [AP]M \(85%\)/.test(text(rain)) && text(rain).includes("umbrella"), text(rain ?? {}));
  check("rain alert has Mute + Full report buttons", !!rain && !!btn(rain, "mute:rain") && !!btn(rain, "v:now"));
  n = mark();
  await trigger();
  await sleep(2500);
  check("the same rain is not announced again (3-hour cooldown)", !sentTo(n, ALICE, (c) => text(c).includes("Rain alert")).length);

  await mockSet({ stationAqi: 130 });
  n = mark();
  await trigger();
  const aqiAlert = await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Air-quality alert"))[0]);
  check("AQI alert when the measured reading reaches the level", !!aqiAlert && text(aqiAlert).includes("<b>130</b>") && text(aqiAlert).includes("Unhealthy for sensitive groups") && !!btn(aqiAlert, "mute:aqi"), text(aqiAlert ?? {}));
  n = mark();
  await trigger();
  await sleep(2500);
  check("no repeat while the air stays bad", !sentTo(n, ALICE, (c) => text(c).includes("Air-quality alert")).length);
  await mockSet({ stationAqi: 60 });
  await trigger();
  await sleep(1500);
  await mockSet({ stationAqi: 130 });
  n = mark();
  await trigger();
  await sleep(2500);
  check("a recovery followed by a quick relapse doesn't flood (cooldown)", !sentTo(n, ALICE, (c) => text(c).includes("Air-quality alert")).length);
  check("admin (who didn't opt in) got no alerts at all", !calls.some((c) => c.method === "sendMessage" && c.body.chat_id === ADMIN && /Rain alert|Air-quality alert/.test(text(c))));

  n = mark();
  await tap(ALICE, "mute:rain", 6000);
  const muted = await waitFor(() => since(n).find((c) => c.method === "answerCallbackQuery"));
  check("tapping Mute turns that alert off", !!muted && muted.body.text === "Muted 🔕");
  n = mark();
  await tap(ALICE, "set:alerts");
  const afterMute = await waitFor(() => edits(n)[0]);
  check("…and the settings page shows it OFF", btn(afterMute, "al:rain").text.startsWith("⬜") && btn(afterMute, "al:aqi:101").text.startsWith("●"));

  // already raining -> never "rain is coming"
  await tap(ALICE, "al:rain"); // on again (this also resets its cooldown)
  await mockSet({ rainingNow: 1, rainSoon: 1, stationAqi: "null" });
  n = mark();
  await trigger();
  await sleep(2500);
  check("no 'rain coming' alert when it is already raining", !sentTo(n, ALICE, (c) => text(c).includes("Rain alert")).length);
  await mockSet({ rainingNow: 0, rainSoon: 1 });
  n = mark();
  await trigger();
  check("…but it fires once the rain has stopped and more is coming", !!(await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Rain alert"))[0])));
  // tidy: everything off again
  await mockSet({ rainSoon: 0, rainingNow: 0, stationAqi: "null" });
  await tap(ALICE, "al:rain");
  await tap(ALICE, "al:aqi:0");
  await sleep(800);
  n = mark();
  await say(ADMIN, "/users");
  const users2 = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Users ("))[0]);
  check("/users no longer flags alerts once they are switched off", !!users2 && !/user2002[\s\S]{0,0}⚠️/.test(text(users2)) && !text(users2).split("\n").find((l) => l.includes("2002"))?.includes("⚠️"));

  // =========================================================== 10b. official warnings
  console.log("\nOfficial warnings (MetMalaysia)");
  const isWarningPush = (c) => text(c).includes("· MetMalaysia");
  const pushesTo = (n, id) => sentTo(n, id, isWarningPush);
  for (const id of [5005, 6006, 7007]) await say(ADMIN, `/allow ${id}`);
  await sleep(900);
  for (const [id, name] of [[5005, "Perak Pat"], [6006, "Shah Sam"], [7007, "Tokyo Tom"]]) await say(id, "/start", name);
  await sleep(2500);
  n = mark();
  await say(5005, "Ipoh");
  await waitFor(() => sentTo(n, 5005, (c) => text(c).includes("Which one"))[0]);
  n = mark();
  await tap(5005, "pick:0");
  check("a user in Ipoh is saved (state Perak, district Kinta)", !!(await waitFor(() => edits(n, (c) => text(c).includes("Location saved"))[0])));
  n = mark();
  await tap(6006, "pre:2");
  check("a user in Shah Alam is saved (state Selangor, district Petaling)", !!(await waitFor(() => edits(n, (c) => text(c).includes("Shah Alam"))[0])));
  n = mark();
  await say(7007, "Tokyo");
  await waitFor(() => sentTo(n, 7007, (c) => text(c).includes("Which one"))[0]);
  n = mark();
  await tap(7007, "pick:0");
  await waitFor(() => edits(n, (c) => text(c).includes("Location saved"))[0]);

  n = mark();
  await trigger(); // only a SEA warning (listing Penang, Perak, Selangor) and "No Advisory" are active
  await sleep(3000);
  check("a sea warning is never sent to people on land (even though it names their state)", !since(n).some(isWarningPush));

  await mockSet({ warnOn: 1 });
  n = mark();
  await say(ALICE, "/warnings");
  const wl = await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Thunderstorms Warning"))[0]);
  check("/warnings lists the active warning with validity, area, instruction and source", !!wl && ["Official warning", "Valid", "Kuala Lumpur", "Stay away from open areas", "Source: Malaysian Meteorological Department"].every((s) => text(wl).includes(s)), text(wl ?? {}));
  check("…and leaves out the sea warning", !!wl && !text(wl).includes("Rough Seas"));
  n = mark();
  await say(ALICE, "/weather");
  const repW = await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Humidity"))[0]);
  check("today's report shows the warning at the top", !!repW && text(repW).includes("⚠️ <b>Official warnings</b>") && text(repW).includes("Thunderstorms Warning") && text(repW).indexOf("Official warnings") < text(repW).indexOf("Humidity"));

  n = mark();
  await trigger();
  await waitFor(() => pushesTo(n, ALICE)[0] && pushesTo(n, ADMIN)[0] && pushesTo(n, 5005)[0]);
  await sleep(2500);
  const pAlice = pushesTo(n, ALICE)[0];
  const pAdmin = pushesTo(n, ADMIN)[0];
  const pPerak = pushesTo(n, 5005)[0];
  check("people in KL, and in Perak (Kinta is listed), are pushed the new warning", !!pAlice && !!pAdmin && !!pPerak);
  check("each push has a Mute button and a link to the full report", !!pAlice && !!btn(pAlice, "mute:warn") && !!btn(pAlice, "v:now"));
  check("the push names the user's own part of the warning", !!pPerak && text(pPerak).includes("📍 Perak (Kampar, Kinta)") && !text(pPerak).includes("Rough Seas"), text(pPerak ?? {}));
  check("pushes follow each user's language (Chinese admin)", !!pAdmin && text(pAdmin).includes("官方警报") && text(pAdmin).includes("（官方原文为英文）"));
  check("exactly ONE push each", [ALICE, ADMIN, 5005].every((id) => pushesTo(n, id).length === 1));
  check("a Shah Alam user is NOT pushed: the warning lists only Selangor's Sabak Bernam district", pushesTo(n, 6006).length === 0);
  check("a Tokyo user is not pushed (Malaysia only)", pushesTo(n, 7007).length === 0);
  check("people who never pressed Start, or are blocked, are not messaged", [4004, 777, BLOCKED].every((id) => pushesTo(n, id).length === 0));
  n = mark();
  await say(6006, "/warnings");
  const shahList = await waitFor(() => sentTo(n, 6006, (c) => text(c).includes("official warnings for Selangor"))[0]);
  check("…and /warnings tells the Shah Alam user there are none for them, but some elsewhere", !!shahList && text(shahList).includes("No active official warnings for Selangor") && text(shahList).includes("1 warning(s) are active in other states"), text(shahList ?? {}));
  n = mark();
  await say(7007, "/warnings");
  check("/warnings says Malaysia-only for a Tokyo user", !!(await waitFor(() => sentTo(n, 7007, (c) => text(c).includes("Malaysia only"))[0])));

  n = mark();
  await trigger();
  await sleep(3000);
  check("the same warning is not pushed again", !since(n).some(isWarningPush));
  await mockSet({ warnVersion: 7 });
  n = mark();
  await trigger();
  check("a re-issued (updated) warning IS pushed again", !!(await waitFor(() => pushesTo(n, ALICE)[0])));
  await sleep(1500);
  check("…still not to the Shah Alam user", pushesTo(n, 6006).length === 0);

  n = mark();
  await tap(ALICE, "mute:warn", 6100);
  const mw = await waitFor(() => since(n).find((c) => c.method === "answerCallbackQuery"));
  check("Mute turns official warnings off for that person", !!mw && mw.body.text === "Muted 🔕");
  n = mark();
  await tap(ALICE, "set:alerts");
  const pageW = await waitFor(() => edits(n)[0]);
  check("…and the Alerts page shows it OFF", !!pageW && btn(pageW, "al:warn")?.text.startsWith("⬜"));
  await mockSet({ warnVersion: 11 });
  n = mark();
  await trigger();
  await waitFor(() => pushesTo(n, ADMIN)[0]);
  await sleep(1500);
  check("a muted person gets nothing while others still do", pushesTo(n, ALICE).length === 0 && pushesTo(n, ADMIN).length === 1);
  await tap(ALICE, "al:warn");
  await sleep(700);
  n = mark();
  await trigger();
  check("switching warnings back on delivers the one they missed", !!(await waitFor(() => pushesTo(n, ALICE)[0])));

  await mockSet({ warnDown: 1 });
  n = mark();
  await say(ALICE, "/warnings");
  check("if the feed is briefly down, people still get the recent copy", !!(await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Thunderstorms Warning"))[0])));
  await mockSet({ warnDown: 0, warnOn: 0 });
  n = mark();
  await say(ALICE, "/warnings");
  check("once the warning is gone, /warnings says so", !!(await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("No active official warnings for Kuala Lumpur"))[0])));

  // =========================================================== 10c. admin tools
  console.log("\nAdmin tools: /status and /broadcast");
  n = mark();
  await say(ALICE, "/status");
  await sleep(1500);
  check("/status is admin-only", !since(n).some((c) => text(c).includes("SkyBrief status")));
  n = mark();
  await say(ADMIN, "/status");
  const st = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("SkyBrief status"))[0]);
  check("/status shows the cron heartbeat, users, today's counters, dependencies", !!st && ["✅ Cron: last ran", "Users: 7 active", "blocked", "Today (UTC): morning", "warnings", "✅ Open-Meteo: OK", "✅ MetMalaysia warnings: OK", "No broadcasts yet"].every((s) => text(st).includes(s)), text(st ?? {}));
  const warnCount = Number(/warnings (\d+)/.exec(text(st ?? {}))?.[1] ?? 0);
  check("…and counted the warnings it sent today", warnCount >= 6, `warnings counter = ${warnCount}`);

  n = mark();
  await say(ALICE, "/broadcast hi all");
  await sleep(1500);
  check("/broadcast is admin-only", !since(n).some((c) => text(c).includes("Broadcast preview")));
  n = mark();
  await say(ADMIN, "/broadcast");
  check("/broadcast without text shows how to use it", !!(await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Usage"))[0])));
  n = mark();
  await say(ADMIN, "/broadcast " + "x".repeat(1001));
  check("an over-long broadcast is refused", !!(await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("limit is 1000"))[0])));
  n = mark();
  await say(ADMIN, "/broadcast stop");
  check("/broadcast stop with nothing running says so", !!(await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("No broadcast is running"))[0])));

  const BODY = "Maintenance at 10pm <b>tonight</b> & thanks\nSecond line";
  n = mark();
  await say(ADMIN, `/broadcast ${BODY}`);
  const prev = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Broadcast preview"))[0]);
  check("the admin gets a preview showing exactly what will be sent, escaped", !!prev && text(prev).includes("Maintenance at 10pm &lt;b&gt;tonight&lt;/b&gt; &amp; thanks\nSecond line") && text(prev).includes("📢 <b>Message from the admin</b>"), text(prev ?? {}));
  check("…with the number of recipients and Send / Cancel buttons", !!prev && text(prev).includes("Send to <b>7</b>") && !!btn(prev, "bc:ok") && !!btn(prev, "bc:no"));
  n = mark();
  await tap(ALICE, "bc:ok");
  await trigger();
  await sleep(3000);
  check("a non-admin pressing Send does nothing", !since(n).some((c) => text(c).includes("Message from the admin")));
  n = mark();
  await tap(ADMIN, "bc:no");
  check("Cancel discards the draft", !!(await waitFor(() => edits(n, (c) => text(c).includes("cancelled"))[0])));
  n = mark();
  await trigger();
  await sleep(2500);
  check("…and nothing is sent", !since(n).some((c) => text(c).includes("Message from the admin")));

  await say(ADMIN, `/broadcast ${BODY}`);
  await sleep(1200);
  n = mark();
  await tap(ADMIN, "bc:ok");
  check("Send starts the broadcast", !!(await waitFor(() => edits(n, (c) => text(c).includes("Sending to <b>7</b>"))[0])));
  n = mark();
  await say(ADMIN, "/broadcast another one");
  check("a second broadcast is refused while one is running", !!(await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("already running"))[0])));
  n = mark();
  await trigger();
  const fin = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("Broadcast finished"))[0]);
  await sleep(1500);
  const got = (id) => sentTo(n, id, (c) => text(c).includes("📢 <b>Message from the admin</b>"));
  check("every reachable active user got it exactly once", [ADMIN, ALICE, 4004, 5005, 6006, 7007].every((id) => got(id).length === 1), JSON.stringify([ADMIN, ALICE, 4004, 5005, 6006, 7007].map((id) => got(id).length)));
  check("…with the text escaped and the line break kept", got(ALICE).length === 1 && text(got(ALICE)[0]).includes("&lt;b&gt;tonight&lt;/b&gt; &amp; thanks\nSecond line"));
  check("blocked and unknown users got nothing", got(BLOCKED).length === 0 && got(STRANGER).length === 0);
  check("the user who blocked the bot was tried once and counted as unreachable", since(n).filter((c) => c.body.chat_id === GHOST && text(c).includes("Message from the admin")).length === 1);
  check("the admin is told the result", !!fin && text(fin).includes("delivered to <b>6</b> of 7") && text(fin).includes("1 could not be reached"), text(fin ?? {}));
  n = mark();
  await tap(ADMIN, "bc:ok");
  const stale = await waitFor(() => since(n).find((c) => c.method === "answerCallbackQuery"));
  check("pressing Send on an old preview says it expired", !!stale && stale.body.show_alert === true && /expired/i.test(stale.body.text));
  n = mark();
  await trigger();
  await sleep(2500);
  check("nothing is sent twice", !since(n).some((c) => text(c).includes("Message from the admin")));
  n = mark();
  await say(ADMIN, "/status");
  const st2 = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("SkyBrief status"))[0]);
  check("/status remembers the last broadcast", !!st2 && text(st2).includes("Last broadcast") && text(st2).includes("6 delivered, 1 unreachable"), text(st2 ?? {}));

  // =========================================================== 11. outages & the backup source
  console.log("\nWhen the weather service is down");
  await mockSet({ forecastDown: 1 });
  n = mark();
  await tap(ALICE, "r:now");
  const bk = await waitFor(() => edits(n)[0]);
  check("Open-Meteo down → the report still arrives from the backup source (MET Norway)", !!bk && text(bk).includes("Weather: MET Norway (backup source)") && text(bk).includes("Kuala Lumpur"), text(bk ?? {}).slice(-200));
  check("backup report is complete (humidity, rain, forecast, tips, no 'undefined')", !!bk && ["Humidity", "Rain outlook", "Next days", "Tips"].every((s) => text(bk).includes(s)) && !/undefined|NaN|null/.test(text(bk)));
  check("backup report has no 'yesterday' comparison (the source has no yesterday)", !!bk && !text(bk).includes("than yesterday"));
  n = mark();
  await tap(ALICE, "v:tomorrow");
  const bkT = await waitFor(() => edits(n)[0]);
  check("tomorrow & 7-day views work from the backup too", !!bkT && text(bkT).includes("Tomorrow") && text(bkT).includes("MET Norway"));
  n = mark();
  await tap(ALICE, "v:week");
  check("…7-day", !!(await waitFor(() => edits(n, (c) => text(c).includes("7-day outlook"))[0])));

  n = mark();
  await say(ALICE, "Tokyo");
  await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Which one"))[0]);
  n = mark();
  await tap(ALICE, "pick:0");
  const refused = await waitFor(() => edits(n)[0]);
  check("changing location during an outage is refused (the backup can't give a timezone) and says why", !!refused && text(refused).includes("couldn't reach") && !!btn(refused, "pre:0") && !text(refused).includes("Location saved"), text(refused ?? {}));
  check("…and the answer to the button was sent only once", [...answeredCallbacks.values()].every((v) => v === 1));

  await mockSet({ metnoDown: 1 });
  n = mark();
  const cid = await tap(ALICE, "r:now");
  const both = await waitFor(() => since(n).find((c) => c.method === "answerCallbackQuery" && c.body.callback_query_id === cid));
  check("both sources down → a clear alert, and the old report stays on screen", !!both && both.body.show_alert === true && /unreachable/i.test(both.body.text) && !edits(n).length);

  await mockSet({ forecastDown: 0, metnoDown: 0 });
  n = mark();
  await tap(ALICE, "r:now");
  const rec = await waitFor(() => edits(n)[0]);
  check("service recovers → back to Open-Meteo", !!rec && text(rec).includes("Weather: Open-Meteo") && !text(rec).includes("backup"));

  // =========================================================== 11b. health alerts to the admin
  console.log("\nHealth alerts to the admin");
  const adminSaid = (n, re) => sentTo(n, ADMIN, (c) => re.test(text(c)));
  await mockSet({ forecastDown: 1 });
  n = mark();
  await trigger();
  await trigger();
  await sleep(1500);
  check("no alert after only 2 failed checks (a blip isn't news)", !adminSaid(n, /has failed/).length);
  await trigger();
  const dn = await waitFor(() => adminSaid(n, /Open-Meteo \(weather\)<\/b> has failed 3 checks/)[0]);
  check("after 3 failed checks the admin is told Open-Meteo is down and that the backup is in use", !!dn && text(dn).includes("MET Norway backup"), text(dn ?? {}));
  await trigger();
  await trigger();
  await sleep(1500);
  check("…once only (no repeats while it stays down)", adminSaid(n, /has failed/).length === 1);
  check("the backup is fine, so there is no 'nothing works' alarm", !adminSaid(n, /NO weather source/).length);
  n = mark();
  await say(ADMIN, "/status");
  const sd = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("SkyBrief status"))[0]);
  check("/status shows the failing dependency and that the admin was alerted", !!sd && /❗ Open-Meteo: failing ×\d+/.test(text(sd)) && text(sd).includes("admin alerted"), text(sd ?? {}));

  await mockSet({ metnoDown: 1 });
  n = mark();
  for (let i = 0; i < 3; i++) await trigger();
  const crit = await waitFor(() => adminSaid(n, /NO weather source is working/)[0]);
  check("when the backup fails too the admin gets a critical alert", !!crit);
  await sleep(1000);
  check("…once", adminSaid(n, /NO weather source/).length === 1);

  await mockSet({ forecastDown: 0, metnoDown: 0 });
  n = mark();
  await trigger();
  await waitFor(() => adminSaid(n, /Open-Meteo \(weather\) is back to normal/)[0] && adminSaid(n, /MET Norway \(backup weather\) is back to normal/)[0]);
  check("recovery is announced for BOTH the primary and the backup", adminSaid(n, /Open-Meteo \(weather\) is back/).length === 1 && adminSaid(n, /MET Norway \(backup weather\) is back/).length === 1);

  await mockSet({ warnDown: 1 });
  n = mark();
  for (let i = 0; i < 5; i++) await trigger();
  await sleep(1000);
  check("the warnings feed alert waits for 6 failed checks (30 minutes)", !adminSaid(n, /warnings feed/).length);
  await trigger();
  check("…then tells the admin once", !!(await waitFor(() => adminSaid(n, /MetMalaysia warnings feed<\/b> has been unreachable/)[0])));
  await mockSet({ warnDown: 0 });
  n = mark();
  await trigger();
  check("…and when it recovers", !!(await waitFor(() => adminSaid(n, /MetMalaysia warnings feed is back to normal/)[0])));

  // =========================================================== 12. inline mode
  console.log("\nInline mode (@bot city in any chat)");
  n = mark();
  await inline(ADMIN, "Ipoh");
  const iq1 = await waitFor(() => since(n).find((c) => c.method === "answerInlineQuery"));
  const r1 = iq1?.body.results?.[0];
  check("searching a city returns a weather card (in the user's language)", !!r1 && r1.type === "article" && r1.title.includes("怡保") && r1.input_message_content.message_text.includes("怡保") && r1.input_message_content.parse_mode === "HTML", JSON.stringify(iq1?.body).slice(0, 300));
  check("card has a summary line and a compact body", !!r1 && /°C/.test(r1.description) && r1.input_message_content.message_text.split("\n").length <= 9);
  check("results are personal and short-cached", iq1?.body.is_personal === true && iq1.body.cache_time > 0 && String(r1?.id).length < 64);
  n = mark();
  await inline(ADMIN, "");
  const iq2 = await waitFor(() => since(n).find((c) => c.method === "answerInlineQuery"));
  check("an empty query offers your saved place", iq2?.body.results?.length === 1 && iq2.body.results[0].title.includes("Bukit Bintang"));
  n = mark();
  await inline(ALICE, "Tokyo");
  const iq3 = await waitFor(() => since(n).find((c) => c.method === "answerInlineQuery"));
  check("another user gets English cards for another city", iq3?.body.results?.[0]?.title === "Tokyo, Japan" && iq3.body.results[0].input_message_content.message_text.includes("Tokyo"));
  n = mark();
  await inline(ALICE, "zzzz");
  const iq4 = await waitFor(() => since(n).find((c) => c.method === "answerInlineQuery"));
  check("an unknown city gets a friendly hint instead of nothing", iq4?.body.results?.length === 1 && iq4.body.results[0].id === "hint");
  n = mark();
  await inline(STRANGER, "Ipoh");
  const iq5 = await waitFor(() => since(n).find((c) => c.method === "answerInlineQuery"));
  check("a stranger gets no weather — just a button into the bot", iq5?.body.results?.length === 0 && iq5.body.button?.start_parameter === "inline" && /Open SkyBrief/.test(iq5.body.button.text));
  n = mark();
  await inline(BLOCKED, "Ipoh");
  const iq6 = await waitFor(() => since(n).find((c) => c.method === "answerInlineQuery"));
  check("a blocked user gets nothing either", iq6?.body.results?.length === 0);

  // =========================================================== 13. evening report + multi-timezone daily push
  console.log("\nMorning + evening reports across timezones");
  n = mark();
  await say(TOKYO_USER, "Tokyo");
  await waitFor(() => sentTo(n, TOKYO_USER, (c) => text(c).includes("Which one"))[0]);
  n = mark();
  await tap(TOKYO_USER, "pick:0");
  const tokyoSaved = await waitFor(() => edits(n, (c) => text(c).includes("Location saved"))[0]);
  check("a Tokyo user is saved with the Asia/Tokyo timezone (from the weather data)", !!tokyoSaved && text(tokyoSaved).includes("Tokyo, Japan"));

  const klNow = new Date(Date.now() + 8 * 3_600_000);
  let target = new Date(klNow.getTime() + 60_000);
  if (klNow.getUTCSeconds() > 45) target = new Date(target.getTime() + 60_000);
  const klTime = hhmm(target);
  const tokyoTime = hhmm(new Date(target.getTime() + 3_600_000)); // the same instant, one hour later on Tokyo's clock
  for (const id of [ADMIN, ALICE, GHOST]) await say(id, `/settime ${klTime}`);
  await say(TOKYO_USER, `/settime ${tokyoTime}`);
  n = mark();
  await say(ALICE, `/evening ${klTime}`);
  const eveOn = await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Evening report"))[0]);
  check("/evening <time> switches the evening report on", !!eveOn && text(eveOn).includes(klTime) && text(eveOn).includes("ON"));
  n = mark();
  await say(ALICE, "/settime 8:30 pm");
  check("'/settime 8:30 pm' is rejected instead of being read as 08:30", !!(await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Usage"))[0])));
  n = mark();
  await say(ALICE, "/evening 7:00 pm");
  check("'/evening 7:00 pm' is rejected too", !!(await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Usage"))[0])));
  n = mark();
  await say(ALICE, "/evening 25:99");
  check("an invalid evening time shows usage", !!(await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Usage"))[0])));
  await sleep(1500);

  const instant = Math.floor(target.getTime() / 60_000) * 60_000 - 8 * 3_600_000;
  const waitMs = Math.max(0, instant - Date.now()) + 2000;
  console.log(`  (KL users set to ${klTime}, the Tokyo user to ${tokyoTime} Tokyo time = the same moment; waiting ${Math.round(waitMs / 1000)}s for it to arrive…)`);
  n = mark();
  await trigger();
  await sleep(1500);
  check("nothing is sent before the chosen time (for any of them)", !since(n).some((c) => /Good morning|早安|Good evening/.test(text(c))));
  await sleep(waitMs);
  n = mark();
  check("cron trigger accepted", (await trigger()) === 200);
  const adminDaily = await waitFor(() => sentTo(n, ADMIN, (c) => text(c).includes("早安"))[0], 40000);
  const aliceMorning = await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Good morning"))[0], 40000);
  const aliceEvening = await waitFor(() => sentTo(n, ALICE, (c) => text(c).includes("Good evening"))[0], 40000);
  const tokyoDaily = await waitFor(() => sentTo(n, TOKYO_USER, (c) => text(c).includes("Good morning"))[0], 40000);
  check("the admin gets her morning report in Chinese", !!adminDaily);
  check("Alice gets her morning report in English, same minute", !!aliceMorning && text(aliceMorning).includes("Humidity"));
  check("…and the EVENING report: tomorrow's outlook", !!aliceEvening && text(aliceEvening).includes("🌙") && text(aliceEvening).includes("Tomorrow") && text(aliceEvening).includes("Morning") && !!btn(aliceEvening, "v:tomorrow")?.text.startsWith("● "), text(aliceEvening ?? {}).slice(0, 200));
  check("the Tokyo user gets hers at HER local time (an hour later on the clock, same instant)", !!tokyoDaily && text(tokyoDaily).includes("Tokyo"));
  await sleep(2500);
  const sent = since(n).filter((c) => c.method === "sendMessage" && c.body.chat_id !== GHOST && /Good morning|早安|Good evening/.test(text(c))).length;
  check("exactly 4 reports went out (admin, Alice ×2, Tokyo)", sent === 4, `sent ${sent}`);
  const attempts777 = since(n).filter((c) => c.body.chat_id === GHOST).length;
  n = mark();
  await trigger();
  await sleep(4000);
  check("running the cron again sends no duplicates", !since(n).some((c) => /Good morning|早安|Good evening/.test(text(c))));
  check("a user who blocked the bot is switched off, not retried forever", since(n).filter((c) => c.body.chat_id === GHOST).length === 0 && attempts777 >= 1);

  // =========================================================== 14. hygiene
  console.log("\nTelegram API hygiene");
  const multi = [...answeredCallbacks.entries()].filter(([, count]) => count > 1);
  check("every button press is answered at most once", multi.length === 0, JSON.stringify(multi));
  check("no message exceeds Telegram's 4096-character limit", !calls.some((c) => (c.method === "sendMessage" || c.method === "editMessageText") && text(c).length > 4096));
  check("no callback_data exceeds Telegram's 64-byte limit", !calls.some((c) => buttons(c).some((b) => Buffer.byteLength(b.callback_data ?? "") > 64)));
  check("the bot token never appears in messages", !calls.some((c) => JSON.stringify(c.body).includes("testtoken")));
  check("no 'undefined' / 'NaN' ever reached a user", !calls.some((c) => /\bundefined\b|\bNaN\b/.test(text(c))));
  check("no handler errors were logged", !/handler_error|daily_crashed|alerts_crashed/.test(workerLog), (workerLog.match(/(handler_error|daily_crashed|alerts_crashed).*/g) ?? []).slice(0, 2).join("\n"));
} catch (e) {
  failures.push(`crash: ${e.stack ?? e}`);
  console.error(e);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  console.log("\nLast worker log lines:\n" + workerLog.slice(-1800));
}
await shutdown(failures.length ? 1 : 0);
