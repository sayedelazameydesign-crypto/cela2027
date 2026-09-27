/**
 * Shared harness helpers: calibration values, fixture loading and the two
 * control planes (fault proxy, mock API). Everything a spec asserts about the
 * network comes from these control planes — not from page.route().
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
export const e2eRoot = path.resolve(here, "..", "..");

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export interface Calibration {
  measuredAt: string;
  environment: { appCommit: string; appUrl: string };
  derived: Record<string, { value: unknown; formula: string }>;
}

export const calibration = JSON.parse(readFileSync(path.join(e2eRoot, "retry-calibration.json"), "utf8")) as Calibration;

export function derivedNumber(key: string): number {
  const value = calibration.derived[key]?.value;
  if (typeof value !== "number") throw new Error(`calibration derived.${key} is not a number`);
  return value;
}

export function derivedSchedule(): number[] {
  const value = calibration.derived.retrySchedule?.value;
  if (!Array.isArray(value)) throw new Error("calibration derived.retrySchedule is not an array");
  return value as number[];
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export const ports = {
  app: Number(process.env.E2E_APP_PORT ?? 3000),
  proxy: Number(process.env.E2E_PROXY_PORT ?? 3100),
  mock: Number(process.env.E2E_MOCK_PORT ?? 3200),
};
export const urls = {
  app: `http://127.0.0.1:${ports.app}`,
  proxy: `http://127.0.0.1:${ports.proxy}`,
  mock: `http://127.0.0.1:${ports.mock}`,
};

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

export interface FixtureEvent {
  seq: number;
  e: { type: string; taskId: string; [key: string]: unknown };
}

export interface Fixture {
  name: string;
  taskId: string;
  goal: string;
  events: FixtureEvent[];
  meta: Record<string, any>;
  plan: { summary: string; steps: Array<{ id: string; title: string; tool: string }> };
  artifacts: Record<string, string>;
  sandboxStdout: string;
  finalStatus: string;
  finalSummary: string;
  evidenceDetails: string[];
}

export function loadFixture(name = "offline-task"): Fixture {
  const file = path.join(e2eRoot, "fixtures", "events", `${name}.ndjson`);
  if (!existsSync(file)) throw new Error(`fixture not found: ${file}`);
  const events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as FixtureEvent);
  const metaFile = path.join(e2eRoot, "fixtures", "events", `${name}.meta.json`);
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : {};
  const byType = (type: string) => events.filter((x) => x.e.type === type).map((x) => x.e);
  const planCreated = byType("plan_created")[0] as any;
  const finished = byType("task_finished")[0] as any;
  const artifacts: Record<string, string> = {};
  for (const artifact of byType("artifact") as any[]) artifacts[artifact.path] = artifact.content;
  return {
    name,
    taskId: events[0].e.taskId,
    goal: String(events[0].e.goal),
    events,
    meta,
    plan: planCreated.plan,
    artifacts,
    sandboxStdout: meta.sandbox?.[0]?.stdout ?? "",
    finalStatus: finished.status,
    finalSummary: finished.summary,
    evidenceDetails: (byType("step_finished") as any[]).map((s) => s.evidence?.[0]?.detail).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Control planes
// ---------------------------------------------------------------------------

export interface ProxyLogEntry {
  at: string;
  method: string;
  path: string;
  fault: string | null;
  delayMs: number | null;
  routedTo: string | null;
  status: number | string | null;
  durationMs: number | null;
  upstreamError: string | null;
}

export interface ProxyState {
  target: string;
  rules: Array<{ id: number; kind: string; match: Record<string, string>; count: number | string; remaining: number | string; fired: number; target?: string; ms?: number; status?: number }>;
  log: { entries: ProxyLogEntry[]; dropped: number };
}

export interface MockSession {
  taskId: string;
  goal: string;
  released: number;
  total: number;
  finished: boolean;
  listeners: number;
  pendingHolds: string[];
  holdTimeouts: number;
  sandboxPosts: Array<{ runId: string; ok: boolean; stdoutLength: number; at: string; accepted: boolean }>;
}

export interface MockState {
  fixture: { name: string; events: number; taskId: string };
  config: { interEventDelayMs: number; holdSandbox: boolean; sandboxHoldTimeoutMs: number; taskIdMode: "fixture" | "unique" };
  sessions: MockSession[];
  log: { entries: Array<{ at: string; method: string; path: string; status: number | null }> };
}

async function post(request: APIRequestContext, url: string, body: Record<string, unknown>) {
  const response = await request.post(url, { data: body });
  const json = await response.json();
  expect(response.ok(), `${url} ${JSON.stringify(body)} → ${response.status()} ${JSON.stringify(json)}`).toBeTruthy();
  return json.result;
}

export const proxy = {
  command: (request: APIRequestContext, body: Record<string, unknown>) => post(request, `${urls.proxy}/__proxy/commands`, body),
  state: async (request: APIRequestContext): Promise<ProxyState> => (await request.get(`${urls.proxy}/__proxy/state`)).json(),
  apiEntries: (state: ProxyState) => state.log.entries.filter((entry) => entry.path.startsWith("/api/")),
};

export const mock = {
  command: (request: APIRequestContext, body: Record<string, unknown>) => post(request, `${urls.mock}/__mock/commands`, body),
  state: async (request: APIRequestContext): Promise<MockState> => (await request.get(`${urls.mock}/__mock/state`)).json(),
};

/** Mocked stage: proxy sends the API + worker to the mock; both planes reset. */
export async function useMockedApi(request: APIRequestContext, config: Partial<MockState["config"]> = {}) {
  await proxy.command(request, { command: "reset" });
  await mock.command(request, { command: "reset" });
  await mock.command(request, { command: "config", interEventDelayMs: derivedNumber("mockInterEventDelayMs"), ...config });
  await proxy.command(request, { command: "route", match: { pathPrefix: "/api/" }, target: urls.mock });
  await proxy.command(request, { command: "route", match: { path: "/pyodide-worker.js" }, target: urls.mock });
}

/** Integration stage: plain passthrough to the real app. */
export async function useRealApi(request: APIRequestContext) {
  await proxy.command(request, { command: "reset" });
}

// ---------------------------------------------------------------------------
// Page helpers (selectors live here so the UI-U0 refactor touches one file)
// ---------------------------------------------------------------------------

export const ui = {
  heading: (page: Page) => page.getByRole("heading", { name: "ماذا تريد أن أبني لك اليوم؟" }),
  goalInput: (page: Page) => page.getByPlaceholder("مثال: ابنِ لي مشروع Python فيه أدوات رياضية مع اختبارات…"),
  runButton: (page: Page) => page.getByRole("button", { name: "نفّذ →" }),
  newTaskButton: (page: Page) => page.getByRole("button", { name: "مهمة جديدة" }),
  statusBadge: (page: Page) => page.locator("header span.rounded-full"),
  planSummary: (page: Page, text: string) => page.getByText(text, { exact: true }),
  steps: (page: Page) => page.locator("ol > li"),
  filesHeading: (page: Page) => page.getByRole("heading", { level: 2, name: /ملفات مساحة العمل/ }),
  fileButton: (page: Page, filePath: string) => page.getByRole("button", { name: filePath, exact: true }),
  sandboxOutput: (page: Page) => page.locator("pre", { hasText: "ALL TESTS PASSED" }),
  finalBanner: (page: Page) => page.getByText("اكتملت المهمة — مُوثَّقة بالأدلة ✓", { exact: true }),
  footerIdle: (page: Page) => page.getByText("اكتملت المهمة — ابدأ هدفاً جديداً", { exact: true }),
  footerRunning: (page: Page) => page.getByText("الوكيل يعمل الآن…", { exact: true }),
};

export function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
