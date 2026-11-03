/**
 * End-to-end test: runs the REAL Worker in Cloudflare's runtime (workerd via `wrangler dev`) with a local D1
 * database and a mock Telegram server, then plays a full multi-user scenario through the webhook.
 *
 *   npm run test:integration
 *
 * Weather calls go to the live Open-Meteo API (internet needed). If a `secrets.json` with WAQI_TOKEN exists
 * it is used so the measured-AQI path is exercised too (the token is never printed).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";

const MOCK_PORT = 18999;
const WORKER_PORT = 18787;
const SECRET = "test_secret_123";
const ADMIN = 1001;
const isWin = process.platform === "win32";
const waqi = existsSync("secrets.json") ? JSON.parse(readFileSync("secrets.json", "utf8")).WAQI_TOKEN ?? "" : "";

// ------------------------------------------------------------------ mock Telegram
const calls = []; // { method, body }
const answeredCallbacks = new Map(); // callback_query_id -> times answered
let nextMessageId = 1000;
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const method = req.url.split("/").pop();
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ method, body });
    if (method === "answerCallbackQuery") answeredCallbacks.set(body.callback_query_id, (answeredCallbacks.get(body.callback_query_id) ?? 0) + 1);
    res.setHeader("content-type", "application/json");
    if (body.chat_id === 777 && (method === "sendMessage" || method === "editMessageText")) {
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
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}
const to = (chatId, method = "sendMessage") => calls.filter((c) => c.method === method && c.body.chat_id === chatId);
async function waitFor(pred, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = pred();
    if (v) return v;
    await sleep(150);
  }
  return null;
}
let updateId = 1;
async function post(update, secret = SECRET) {
  const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({ update_id: updateId++, ...update }),
  });
  return res.status;
}
const from = (id, name = `User${id}`) => ({ id, first_name: name, username: `user${id}` });
const say = (id, text, name) => post({ message: { message_id: 1, from: from(id, name), chat: { id, type: "private" }, text } });
const shareLocation = (id, latitude, longitude) =>
  post({ message: { message_id: 2, from: from(id), chat: { id, type: "private" }, location: { latitude, longitude } } });
let cbSeq = 1;
const tap = (id, data, messageId = 5000) => {
  const cid = `cb${cbSeq++}`;
  return post({ callback_query: { id: cid, from: from(id), data, message: { message_id: messageId, chat: { id, type: "private" } } } }).then(() => cid);
};
const mark = () => calls.length;
const since = (n) => calls.slice(n);
const text = (c) => String(c.body.text ?? "");
const buttons = (c) => (c.body.reply_markup?.inline_keyboard ?? []).flat();

// ------------------------------------------------------------------ process management
let worker;
function killTree(proc) {
  if (!proc?.pid) return;
  if (isWin) spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  else proc.kill("SIGKILL");
}
async function shutdown(code) {
  killTree(worker);
  mock.close();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(130));

// ------------------------------------------------------------------ run
console.log("Preparing local database…");
rmSync(".wrangler/state", { recursive: true, force: true });
const mig = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "skybrief", "--local"], { shell: true, input: "y\n", encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
if (mig.status !== 0) {
  console.error(mig.stdout, mig.stderr);
  process.exit(1);
}

await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
console.log("Starting the Worker in workerd (wrangler dev)…");
const vars = {
  TELEGRAM_BOT_TOKEN: "testtoken",
  WEBHOOK_SECRET: SECRET,
  ADMIN_IDS: String(ADMIN),
  ACCESS_MODE: "approval",
  TELEGRAM_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
  ...(waqi ? { WAQI_TOKEN: waqi } : {}),
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
    up = (await fetch(`http://127.0.0.1:${WORKER_PORT}/`)).ok;
  } catch {
    await sleep(300);
  }
}
if (!up) {
  console.error("Worker did not start:\n", workerLog.slice(-3000));
  await shutdown(1);
}
console.log("Worker is up. Running scenarios:\n");

try {
  // ---- 1. endpoints & security
  console.log("Security & setup");
  check("GET / health", (await (await fetch(`http://127.0.0.1:${WORKER_PORT}/`)).text()).includes("SkyBrief"));
  check("webhook without the secret → 403", (await post({ message: {} }, "wrong")) === 403);
  check("/setup with a wrong key → 403", (await fetch(`http://127.0.0.1:${WORKER_PORT}/setup?key=nope`)).status === 403);
  let n = mark();
  const setup = await (await fetch(`http://127.0.0.1:${WORKER_PORT}/setup?key=${SECRET}`)).json();
  check("/setup registers webhook + commands", setup.ok === true);
  const hook = since(n).find((c) => c.method === "setWebhook");
  check("setWebhook carries url + secret_token", hook?.body.secret_token === SECRET && String(hook?.body.url).endsWith("/webhook"));
  check("command menus set for en, ms, zh", since(n).filter((c) => c.method === "setMyCommands").length === 3);

  // ---- 2. admin /start
  console.log("\nAdmin onboarding (English, Kuala Lumpur default)");
  n = mark();
  await say(ADMIN, "/start", "Boss");
  await waitFor(() => to(ADMIN).length >= 2 && since(n).filter((c) => c.method === "sendMessage" && c.body.chat_id === ADMIN).length >= 2);
  const admMsgs = since(n).filter((c) => c.method === "sendMessage" && c.body.chat_id === ADMIN);
  check("welcome message sent with bottom keyboard", text(admMsgs[0]).includes("SkyBrief") && !!admMsgs[0].body.reply_markup?.keyboard);
  check("bottom bar has a location-request button", JSON.stringify(admMsgs[0].body.reply_markup).includes('"request_location":true'));
  check("report: Kuala Lumpur + weather + air + tips", ["Kuala Lumpur", "Humidity", "Air quality", "Rain outlook", "Tips"].every((s) => text(admMsgs[1]).includes(s)), text(admMsgs[1]).slice(0, 200));
  check("report has Refresh / Hourly / Change location / Settings / Daily buttons", ["r:now", "v:hourly", "chg", "set"].every((d) => buttons(admMsgs[1]).some((b) => b.callback_data === d)));
  check("admin gets the admin command menu", since(n).some((c) => c.method === "setMyCommands" && JSON.stringify(c.body.commands).includes('"allow"')));
  if (waqi) check("measured AQI from a real station is used", /station \(\d+ km\)/.test(text(admMsgs[1])), text(admMsgs[1]).split("\n").slice(-2).join(" | "));

  // ---- 3. city search + pick
  console.log("\nCity search & one-tap change");
  n = mark();
  await say(ADMIN, "Ipoh");
  const results = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && text(c).includes("Which one")));
  check("typing a city name shows choices", !!results && buttons(results).some((b) => b.callback_data === "pick:0"), JSON.stringify(results?.body));
  n = mark();
  await tap(ADMIN, "pick:0");
  const picked = await waitFor(() => since(n).find((c) => c.method === "editMessageText" && text(c).includes("Ipoh")));
  check("picking a result saves it and shows the report", !!picked && text(picked).includes("Location saved") && text(picked).includes("Perak"), text(picked ?? { body: {} }).slice(0, 120));
  n = mark();
  await tap(ADMIN, "pre:3");
  const preset = await waitFor(() => since(n).find((c) => c.method === "editMessageText" && text(c).includes("George Town")));
  check("one-tap preset city works (Penang)", !!preset);
  n = mark();
  await tap(ADMIN, "pick:4");
  const expired = await waitFor(() => since(n).find((c) => c.method === "editMessageText" && text(c).includes("expired")));
  check("a pick beyond the stored results says the list expired", !!expired);
  await tap(ADMIN, "pre:99");
  await tap(ADMIN, "bogus:data"); // must be ignored without errors (the final log check proves it)

  // ---- 4. settings: hide a section, then language
  console.log("\nSettings: sections & language");
  n = mark();
  await tap(ADMIN, "set");
  const settings = await waitFor(() => since(n).find((c) => c.method === "editMessageText"));
  check("Settings screen lists 6 sections + 3 languages", !!settings && buttons(settings).filter((b) => b.callback_data.startsWith("tg:")).length === 6 && buttons(settings).filter((b) => b.callback_data.startsWith("lang:")).length === 3);
  n = mark();
  await tap(ADMIN, "tg:air");
  const toggled = await waitFor(() => since(n).find((c) => c.method === "editMessageText"));
  check("toggling air quality flips ✅ → ⬜", buttons(toggled ?? { body: {} }).find((b) => b.callback_data === "tg:air")?.text.startsWith("⬜"));
  n = mark();
  await tap(ADMIN, "v:now");
  const noAir = await waitFor(() => since(n).find((c) => c.method === "editMessageText"));
  check("report now hides Air quality but keeps everything else", !!noAir && !text(noAir).includes("Air quality") && text(noAir).includes("Humidity"));
  n = mark();
  await tap(ADMIN, "tg:air"); // turn it back on
  await waitFor(() => since(n).find((c) => c.method === "editMessageText"));

  n = mark();
  await tap(ADMIN, "lang:zh");
  const zhSettings = await waitFor(() => since(n).find((c) => c.method === "editMessageText"));
  const zhNotice = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && text(c).includes("中文")));
  check("switching to 中文 re-renders Settings in Chinese", !!zhSettings && text(zhSettings).includes("设置"));
  check("bottom keyboard is replaced with Chinese buttons", !!zhNotice && JSON.stringify(zhNotice.body.reply_markup).includes("当前天气"));
  check("command menu re-sent in Chinese", since(n).some((c) => c.method === "setMyCommands" && JSON.stringify(c.body.commands).includes("当前天气")));
  n = mark();
  await tap(ADMIN, "v:now");
  const zhReport = await waitFor(() => since(n).find((c) => c.method === "editMessageText"));
  check("report is fully Chinese (wind, humidity, air, place name)", !!zhReport && ["湿度", "风力", "空气质量", "乔治市"].every((s) => text(zhReport).includes(s)), text(zhReport ?? { body: {} }).slice(0, 160));
  n = mark();
  await say(ADMIN, "🌦 当前天气");
  const viaButton = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && text(c).includes("湿度")));
  check("Chinese bottom-bar button works", !!viaButton);

  // ---- 5. GPS
  console.log("\nGPS location (Telegram 'Share my location')");
  n = mark();
  await shareLocation(ADMIN, 3.1478, 101.6953);
  const gps = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && text(c).includes("位置已保存")));
  check("shared location is detected, named, saved and reported", !!gps && text(gps).includes("湿度"), text(gps ?? { body: {} }).slice(0, 100));

  // ---- 6. multi-user access control
  console.log("\nMultiple users & access control");
  n = mark();
  await say(2002, "/start", "Alice");
  const pending = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && c.body.chat_id === 2002));
  check("new user is told their request is pending", !!pending && text(pending).includes("sent to the admin"));
  const request = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && c.body.chat_id === ADMIN && text(c).includes("New access request")));
  check("admin is notified with Approve / Deny buttons", !!request && buttons(request).some((b) => b.callback_data === "adm:ok:2002") && buttons(request).some((b) => b.callback_data === "adm:no:2002"));
  n = mark();
  await say(2002, "/weather");
  await waitFor(() => since(n).find((c) => c.body.chat_id === 2002));
  check("a pending user gets no weather", !since(n).some((c) => c.body.chat_id === 2002 && text(c).includes("Humidity")));
  n = mark();
  await tap(2002, "adm:ok:2002"); // non-admin pressing the admin button must do nothing
  await sleep(1200);
  check("a non-admin can't approve themselves", !since(n).some((c) => c.method === "sendMessage" && text(c).includes("approved")));
  n = mark();
  await tap(ADMIN, "adm:ok:2002", 7000);
  const approved = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && c.body.chat_id === 2002 && text(c).includes("approved")));
  check("admin approval notifies the user", !!approved);
  n = mark();
  await say(2002, "/start", "Alice");
  const aliceReport = await waitFor(() => since(n).filter((c) => c.method === "sendMessage" && c.body.chat_id === 2002 && text(c).includes("Humidity"))[0]);
  check("approved user gets the default English report", !!aliceReport && text(aliceReport).includes("Kuala Lumpur"));
  check("users are independent: Alice's report is English while the admin's is Chinese", !!aliceReport && !/[一-鿿]/.test(text(aliceReport)));

  n = mark();
  await say(ADMIN, "/block 3003");
  await waitFor(() => since(n).find((c) => c.method === "sendMessage" && text(c).includes("Blocked")));
  n = mark();
  await say(3003, "/start");
  await sleep(1500);
  check("a blocked user gets no reply at all", !since(n).some((c) => c.body.chat_id === 3003));
  n = mark();
  await say(ADMIN, "/users");
  const list = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && text(c).includes("Users (")));
  check("/users lists everyone with status", !!list && ["1001", "2002", "3003"].every((id) => text(list).includes(id)) && text(list).includes("⛔"), text(list ?? { body: {} }));
  n = mark();
  await say(2002, "/users");
  await sleep(1500);
  check("/users is admin-only", !since(n).some((c) => text(c).includes("Users (")));
  n = mark();
  await say(ADMIN, "/allow 777");
  await waitFor(() => since(n).find((c) => c.method === "sendMessage" && c.body.chat_id === ADMIN && text(c).includes("Allowed")));

  // ---- 7. /settime & /daily
  console.log("\nDaily report settings");
  n = mark();
  await say(2002, "/settime 25:99");
  const bad = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && c.body.chat_id === 2002));
  check("invalid /settime shows usage", !!bad && text(bad).includes("Usage"));
  n = mark();
  await say(2002, "/daily");
  const off = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && c.body.chat_id === 2002));
  check("/daily toggles the report off", !!off && text(off).includes("OFF"));
  await say(2002, "/daily");
  await sleep(600);

  // ---- 8. the actual scheduled run, several users, different languages, one unreachable
  console.log("\nDaily push (cron) for several users at once");
  const klNow = new Date(Date.now() + 8 * 3600 * 1000);
  let target = new Date(klNow.getTime() + 60_000);
  if (klNow.getUTCSeconds() > 45) target = new Date(target.getTime() + 60_000);
  const hhmm = `${String(target.getUTCHours()).padStart(2, "0")}:${String(target.getUTCMinutes()).padStart(2, "0")}`;
  for (const id of [ADMIN, 2002, 777]) await say(id, `/settime ${hhmm}`);
  await sleep(2500);
  const waitMs = Math.max(0, Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), target.getUTCHours(), target.getUTCMinutes()) - 8 * 3600 * 1000 - Date.now()) + 2000;
  console.log(`  (daily time set to ${hhmm} Kuala Lumpur; waiting ${Math.round(waitMs / 1000)}s for it to arrive…)`);
  const early = mark();
  await sleep(500);
  check("nothing is sent before the chosen time", !since(early).some((c) => text(c).includes("Good morning") || text(c).includes("早安")));
  await sleep(waitMs);
  const trigger = async () => (await fetch(`http://127.0.0.1:${WORKER_PORT}/cdn-cgi/handler/scheduled`)).status;
  n = mark();
  check("cron trigger accepted", (await trigger()) === 200);
  const adminDaily = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && c.body.chat_id === ADMIN && text(c).includes("早安")), 40000);
  const aliceDaily = await waitFor(() => since(n).find((c) => c.method === "sendMessage" && c.body.chat_id === 2002 && text(c).includes("Good morning")), 40000);
  check("admin receives the daily report in Chinese", !!adminDaily);
  check("Alice receives hers in English, in the same minute", !!aliceDaily);
  await sleep(2500);
  const attempts777 = to(777).length;
  const sentAfterFirst = since(n).filter((c) => c.method === "sendMessage" && text(c).match(/Good morning|早安/)).length;
  n = mark();
  await trigger();
  await sleep(4000);
  check("running the cron again sends no duplicates", !since(n).some((c) => c.method === "sendMessage" && text(c).match(/Good morning|早安/)), `first run sent ${sentAfterFirst}`);
  check("a user who blocked the bot is switched off, not retried forever", to(777).length === attempts777);

  // ---- 9. Telegram contract
  console.log("\nTelegram API hygiene");
  const multi = [...answeredCallbacks.entries()].filter(([, count]) => count > 1);
  check("every button press is answered at most once", multi.length === 0, JSON.stringify(multi));
  const tooLong = calls.filter((c) => c.method === "sendMessage" && text(c).length > 4096);
  check("no message exceeds Telegram's 4096-character limit", tooLong.length === 0);
  check("the bot token never appears in messages", !calls.some((c) => JSON.stringify(c.body).includes("testtoken")));
  check("no handler errors were logged", !/handler_error/.test(workerLog), (workerLog.match(/handler_error.*/g) ?? []).slice(0, 2).join("\n"));
} catch (e) {
  failures.push(`crash: ${e.stack ?? e}`);
  console.error(e);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  console.log("\nLast worker log lines:\n" + workerLog.slice(-1500));
}
await shutdown(failures.length ? 1 : 0);
