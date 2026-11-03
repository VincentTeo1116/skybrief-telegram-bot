// Runs the checks against the REAL weather services (needs internet): npm run test:live
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const env = { ...process.env, LIVE: "1" };
if (!env.WAQI_TOKEN && existsSync("secrets.json")) env.WAQI_TOKEN = JSON.parse(readFileSync("secrets.json", "utf8")).WAQI_TOKEN ?? "";
const r = spawnSync("npx", ["vitest", "run", "test/live.test.ts"], { stdio: "inherit", shell: true, env });
process.exit(r.status ?? 1);
