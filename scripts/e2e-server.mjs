/**
 * Server for the mini app's browser tests (Playwright starts it; see playwright.config.ts).
 *
 * Runs the REAL Worker in Cloudflare's runtime (`wrangler dev`) with its own local D1 database, a mock Telegram
 * and the controllable mock of every weather service, then creates the test users through the real webhook.
 * Nothing touches the internet.
 *
 *   worker        http://127.0.0.1:18790   (E2E_PORT)
 *   mock weather  http://127.0.0.1:19011   GET /__set?forecastDown=1 …
 *   ready signal  http://127.0.0.1:19013   answers 200 once the users exist
 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import http from "node:http";
import { startMockWeather, state } from "./mock-weather.mjs";

const PORT = Number(process.env.E2E_PORT ?? 18790);
const WX_PORT = 19011;
const TG_PORT = 19012;
const READY_PORT = 19013;
const STATE_DIR = ".wrangler/e2e-state"; // separate from the integration test's database
const SECRET = "e2e_secret";
const WORKER = `http://127.0.0.1:${PORT}`;
const WX = `http://127.0.0.1:${WX_PORT}`;
const isWin = process.platform === "win32";
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };

export const USERS = { active: 1001, pending: 5005 }; // 1001 is the admin, so /start makes them active at once

let worker;
let ready = false;
const servers = [];
function stop(code) {
  if (worker?.pid) {
    if (isWin) spawnSync("taskkill", ["/PID", String(worker.pid), "/T", "/F"], { stdio: "ignore" });
    else worker.kill("SIGKILL");
  }
  for (const s of servers) s.close();
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

// A thunderstorm warning for Kuala Lumpur is active from the start, so the real warnings pipeline is exercised.
state.warnOn = true;

rmSync(STATE_DIR, { recursive: true, force: true });
const mig = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "skybrief", "--local", "--persist-to", STATE_DIR], { shell: true, input: "y\n", encoding: "utf8", env });
if (mig.status !== 0) {
  console.error("Migrations failed:\n", mig.stdout, mig.stderr);
  process.exit(1);
}

// Mock Telegram: accepts everything and remembers what it was asked, so the tests can check it.
//   GET /__calls   -> [{ method, type, bytes, text }]        GET /__set?photoDown=1&prepareDown=1
const tgCalls = [];
const tgState = { photoDown: false, prepareDown: false };
const telegram = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/__calls") return res.end(JSON.stringify(tgCalls));
    if (url.pathname === "/__set") {
      for (const [k, v] of url.searchParams) tgState[k] = v === "1";
      return res.end(JSON.stringify(tgState));
    }
    const method = url.pathname.split("/").pop();
    const raw = Buffer.concat(chunks);
    const type = req.headers["content-type"] ?? "";
    tgCalls.push({ method, type: type.split(";")[0], bytes: raw.length, text: type.includes("json") ? raw.toString("utf8").slice(0, 2000) : raw.toString("latin1").slice(0, 600) });
    if (tgCalls.length > 300) tgCalls.shift();
    const fail = (description) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error_code: 400, description }));
    };
    if (method === "sendPhoto") return tgState.photoDown ? fail("Bad Request: photo") : res.end(JSON.stringify({ ok: true, result: { message_id: 2, photo: [{ file_id: "small" }, { file_id: "FILE_LARGE" }] } }));
    if (method === "savePreparedInlineMessage") return tgState.prepareDown ? fail("Bad Request: method not found") : res.end(JSON.stringify({ ok: true, result: { id: "PREPARED_1" } }));
    res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
});
await new Promise((r) => telegram.listen(TG_PORT, "127.0.0.1", r));
servers.push(telegram, await startMockWeather(WX_PORT));

const readiness = http.createServer((_req, res) => {
  res.statusCode = ready ? 200 : 503;
  res.end(ready ? "ready" : "starting");
});
await new Promise((r) => readiness.listen(READY_PORT, "127.0.0.1", r));
servers.push(readiness);

const vars = {
  TELEGRAM_BOT_TOKEN: "testtoken",
  WEBHOOK_SECRET: SECRET,
  ADMIN_IDS: String(USERS.active),
  ACCESS_MODE: "approval",
  QUIET_HOURS: "off",
  WAQI_TOKEN: "waqitest",
  APP_URL: "https://skybrief.test",
  APP_REFRESH_MS: "0", // let the tests force a refresh whenever they change the mock weather
  APP_SHARE_MS: "1500", // short, but still long enough to test that two quick shares are refused
  TELEGRAM_API_BASE: `http://127.0.0.1:${TG_PORT}`,
  OPEN_METEO_FORECAST_URL: `${WX}/forecast`,
  OPEN_METEO_AIR_URL: `${WX}/air`,
  OPEN_METEO_GEO_URL: `${WX}/geo`,
  NOMINATIM_URL: `${WX}/reverse`,
  WAQI_URL: `${WX}/waqi`,
  METNO_URL: `${WX}/metno`,
  WARNINGS_URL: `${WX}/warnings`,
  IPU_URL: `${WX}/ipu`,
};
worker = spawn(
  "npx",
  ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", STATE_DIR, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
  { shell: true, env, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
worker.stdout.on("data", (d) => (log += d));
worker.stderr.on("data", (d) => (log += d));
worker.on("exit", (code) => {
  if (!ready) {
    console.error("wrangler dev exited early:\n", log.slice(-3000));
    stop(code ?? 1);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 300 && !up; i++) {
  try {
    up = (await fetch(`${WORKER}/`)).ok;
  } catch {
    await sleep(300);
  }
}
if (!up) {
  console.error("Worker did not start:\n", log.slice(-3000));
  stop(1);
}

let updateId = 1;
const say = (id, text) =>
  fetch(`${WORKER}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET },
    body: JSON.stringify({ update_id: updateId++, message: { message_id: 1, from: { id, first_name: `User${id}`, username: `user${id}` }, chat: { id, type: "private" }, text } }),
  });
await say(USERS.active, "/start");
await say(USERS.pending, "/start");
await sleep(2500); // the webhook answers at once and works in the background
ready = true;
console.log(`e2e server ready: ${WORKER}/app/`);
