import { defineConfig } from "@playwright/test";

/**
 * Browser tests for the mini app:  npm run test:e2e
 *
 * They run against the REAL Worker (wrangler dev) with mock weather services: see scripts/e2e-server.mjs.
 * One worker, in order: the tests change shared state (the mock weather, the test user's location).
 * Uses the Chrome already installed on this machine, so nothing is downloaded.
 */
const PORT = Number(process.env.E2E_PORT ?? 18790);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts$/,
  outputDir: "./test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome",
    headless: true,
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:19013/",
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
