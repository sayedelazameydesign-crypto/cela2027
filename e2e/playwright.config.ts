/**
 * Playwright configuration for the Cela E2E harness.
 *
 * Topology (all loopback, ports via E2E_APP_PORT / E2E_PROXY_PORT / E2E_MOCK_PORT):
 *
 *   browser ──► fault proxy :3100 ──► Next.js app :3000  (production build)
 *                    │
 *                    └─ route /api/* and /pyodide-worker.js ──► mock-api :3200
 *                       (only while a test asked for the mocked stage)
 *
 * Every timeout below is read from e2e/retry-calibration.json (measured by
 * scripts/calibrate-retry.mjs, formulas recorded next to the values) — nothing
 * here is a hand-picked number.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

type Derived = Record<string, { value: unknown; formula: string }>;
const calibration = JSON.parse(readFileSync(path.join(here, "retry-calibration.json"), "utf8")) as {
  measuredAt: string;
  environment: { appCommit: string };
  derived: Derived;
};
const baseline = JSON.parse(readFileSync(path.join(here, "baseline.json"), "utf8")) as { E2E_BASE_SHA: string };

const num = (key: string): number => {
  const value = calibration.derived[key]?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`retry-calibration.json: derived.${key}.value must be a number`);
  return value;
};

const CI = Boolean(process.env.CI);
const ports = {
  app: Number(process.env.E2E_APP_PORT ?? 3000),
  proxy: Number(process.env.E2E_PROXY_PORT ?? 3100),
  mock: Number(process.env.E2E_MOCK_PORT ?? 3200),
};
const appUrl = `http://127.0.0.1:${ports.app}`;
const proxyUrl = `http://127.0.0.1:${ports.proxy}`;
const mockUrl = `http://127.0.0.1:${ports.mock}`;

const retries = calibration.derived.playwrightRetries.value as { local: number; ci: number };
const webServerTimeout = num("webServerTimeoutMs");

// Local substitute browser (CDN-less sandboxes). CI uses the pinned container's
// Chromium and never sets this.
const executablePath = process.env.E2E_CHROMIUM_EXECUTABLE;
const launchOptions = executablePath ? { executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] } : {};

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? retries.ci : retries.local,
  timeout: num("testTimeoutMs"),
  expect: { timeout: num("expectTimeoutMs") },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  metadata: {
    E2E_BASE_SHA: baseline.E2E_BASE_SHA,
    calibrationMeasuredAt: calibration.measuredAt,
    calibrationAppCommit: calibration.environment.appCommit,
    topology: `browser → proxy ${proxyUrl} → app ${appUrl}; mocked stage routes /api/* → ${mockUrl}`,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: proxyUrl,
    locale: "ar-EG",
    timezoneId: "Africa/Cairo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: num("apiRequestTimeoutMs") * 5,
    navigationTimeout: num("expectTimeoutMs") * 2,
    launchOptions,
  },
  projects: [
    { name: "mocked-app-api", testDir: "./tests/mocked-app-api" },
    { name: "integration", testDir: "./tests/integration" },
  ],
  webServer: [
    {
      command: `npx next start -p ${ports.app} -H 127.0.0.1`,
      cwd: path.resolve(here, "..", "apps", "web"),
      url: `${appUrl}/`,
      reuseExistingServer: !CI,
      timeout: webServerTimeout,
      stdout: "ignore",
      stderr: "pipe",
      env: { ...process.env, OPENROUTER_API_KEY: "" }, // OfflinePlanner: deterministic, no network
    },
    {
      command: `node mock-api/server.mjs --listen ${ports.mock}`,
      cwd: here,
      url: `${mockUrl}/__mock/health`,
      reuseExistingServer: !CI,
      timeout: webServerTimeout,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `node proxy/fault-proxy.mjs --listen ${ports.proxy} --target ${appUrl}`,
      cwd: here,
      url: `${proxyUrl}/__proxy/health`,
      reuseExistingServer: !CI,
      timeout: webServerTimeout,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
