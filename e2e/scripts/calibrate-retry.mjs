#!/usr/bin/env node
/**
 * calibrate-retry — measures the real system through the fault proxy and
 * derives every timeout / pacing / retry value the E2E harness uses.
 *
 *   node e2e/scripts/calibrate-retry.mjs [--app http://127.0.0.1:3000] [--samples 15]
 *
 * Requires the production app to be running (next start). Starts an in-process
 * fault proxy on an ephemeral port so faults can be injected deterministically.
 *
 * Output
 *   e2e/retry-calibration.json         committed; consumed by playwright.config.ts
 *   e2e/reports/retry-calibration.raw.json   raw samples (git-ignored)
 *
 * Nothing in the derived block is typed by hand: each value states its formula
 * and the measurement it came from. Values that cannot be measured in the
 * current environment are marked as such instead of being guessed.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppClient, OFFLINE_PLAN_STDOUT } from "../lib/app-client.mjs";
import { fetchJson, listen, parseArgs, waitFor } from "../lib/http.mjs";
import { retry, summarise } from "../lib/retry.mjs";
import { createFaultProxy } from "../proxy/fault-proxy.mjs";
import { e2eRoot, git, repoRoot } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), { app: process.env.E2E_APP_URL ?? "http://127.0.0.1:3000", samples: "15", "skip-server-start": false });
const appUrl = String(args.app).replace(/\/$/, "");
const N = Math.max(3, Number(args.samples));
const GOAL = "معايرة E2E: مشروع Python صغير مع اختبارات";

const ceilTo = (step, value) => Math.ceil(value / step) * step;

async function timed(fn) {
  const started = performance.now();
  const value = await fn();
  return { ms: Math.round((performance.now() - started) * 10) / 10, value };
}

/** Read the server-side sandbox wait from the app source (kept honest, not copied). */
function appSandboxTimeoutMs() {
  const source = readFileSync(path.join(repoRoot, "apps/web/lib/agent-runtime.ts"), "utf8");
  const match = source.match(/setTimeout\(\(\) => \{[\s\S]*?pendingSandbox[\s\S]*?\}, (\d[\d_]*)\);/);
  if (!match) throw new Error("could not locate the sandbox timeout in apps/web/lib/agent-runtime.ts");
  return Number(match[1].replaceAll("_", ""));
}

async function portIsFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    return false;
  } catch {
    return true;
  }
}

async function measureServerStart(samples) {
  const results = [];
  for (let i = 0; i < samples; i++) {
    const port = 3300 + i;
    if (!(await portIsFree(port))) throw new Error(`port ${port} is already serving — refusing to measure a fake server start`);
    const started = Date.now();
    // detached → own process group, so the real next-server (grandchild of npx) is killed too
    const child = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: path.join(repoRoot, "apps/web"), stdio: "ignore", detached: true, env: { ...process.env, OPENROUTER_API_KEY: "" } });
    try {
      await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/`)).ok, { timeoutMs: 60_000, intervalMs: 25, label: `next start on ${port}` });
      results.push(Date.now() - started);
    } finally {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      await new Promise((r) => child.once("exit", r));
      await waitFor(() => portIsFree(port), { timeoutMs: 10_000, intervalMs: 50, label: `port ${port} to close` });
    }
  }
  return results;
}

async function main() {
  // 0. preconditions
  const health = await fetch(`${appUrl}/`).catch(() => null);
  if (!health?.ok) throw new Error(`app is not reachable at ${appUrl} — start it with: (cd apps/web && npx next start -p 3000)`);

  const proxy = createFaultProxy({ target: appUrl });
  const address = await listen(proxy.server, 0);
  const base = `http://127.0.0.1:${address.port}`;
  const viaProxy = createAppClient(base);
  const direct = createAppClient(appUrl);
  const command = (body) => fetchJson(`${base}/__proxy/commands`, { method: "POST", body });

  const raw = { pageLoadMs: [], apiDirectMs: [], apiProxiedMs: [], createTaskMs: [], taskWallMs: [], timeToSandboxRequestMs: [], sandboxRoundtripMs: [], sseFirstEventMs: [], interEventGapMs: [], sseCompleteMs: [], serverStartMs: [] };

  // 1. page load + API round trips (direct vs proxied → overhead)
  for (let i = 0; i < N; i++) {
    raw.pageLoadMs.push((await timed(async () => (await fetch(`${base}/`)).text())).ms);
    raw.apiDirectMs.push((await timed(() => direct.eventsAfter("__none__", -1))).ms);
    raw.apiProxiedMs.push((await timed(() => viaProxy.eventsAfter("__none__", -1))).ms);
  }

  // 2. full task over polling with an instant sandbox answer
  for (let i = 0; i < N; i++) {
    const { events, marks } = await viaProxy.runToCompletion(GOAL, { pollMs: 25 });
    const finished = events.map((x) => x.e).find((e) => e.type === "task_finished");
    if (finished?.status !== "VERIFIED") throw new Error(`calibration task ended ${finished?.status}`);
    raw.createTaskMs.push(marks.created - marks.started);
    raw.taskWallMs.push(marks.finished - marks.started);
    raw.timeToSandboxRequestMs.push(marks.sandboxSeen - marks.created);
    raw.sandboxRoundtripMs.push(marks.finished - marks.sandboxAnswered);
  }

  // 3. SSE pacing: real inter-event gaps as seen by a live subscriber
  for (let i = 0; i < N; i++) {
    const taskId = await viaProxy.createTask(GOAL);
    const arrivals = await viaProxy.streamUntilFinished(taskId, {
      timeoutMs: 30_000,
      onEvent: async (event) => {
        if (event.type === "sandbox_request") await viaProxy.answerSandbox(taskId, event.runId, { ok: true, stdout: OFFLINE_PLAN_STDOUT });
      },
    });
    raw.sseFirstEventMs.push(arrivals[0].atMs);
    raw.sseCompleteMs.push(arrivals.at(-1).atMs);
    for (let k = 1; k < arrivals.length; k++) {
      const previous = arrivals[k - 1].e.type;
      if (previous === "sandbox_request") continue; // that gap contains our own answer latency
      raw.interEventGapMs.push(arrivals[k].atMs - arrivals[k - 1].atMs);
    }
  }

  // 4. fault recovery through the proxy with candidate retry schedules
  const faultRecovery = [];
  for (const schedule of [[250, 500, 1000], [500, 1000, 2000]]) {
    for (const fault of ["fail-next", "drop"]) {
      await command({ command: "reset" });
      await command({ command: fault, match: { method: "POST", path: "/api/task" }, count: 1, ...(fault === "fail-next" ? { status: 503 } : {}) });
      const started = Date.now();
      const outcome = await retry(() => viaProxy.createTask(GOAL), { schedule, label: `createTask under ${fault}` });
      faultRecovery.push({ fault, schedule, attemptsToSucceed: outcome.attempts.length, totalMs: Date.now() - started, attempts: outcome.attempts });
    }
  }
  await command({ command: "reset" });

  // 5. delay vs client timeout (what "slow but fine" and "too slow" mean)
  const apiP95 = summarise(raw.apiProxiedMs).p95;
  const apiRequestTimeoutMs = ceilTo(500, Math.max(2000, 10 * apiP95));
  const delayBelow = Math.round(apiRequestTimeoutMs / 2);
  const delayAbove = apiRequestTimeoutMs * 2;
  const delayProbe = {};
  for (const [label, ms] of [["below", delayBelow], ["above", delayAbove]]) {
    await command({ command: "delay", match: { method: "POST", path: "/api/task" }, count: 1, ms });
    const started = Date.now();
    try {
      await fetchJson(`${base}/api/task`, { method: "POST", body: { goal: GOAL }, timeoutMs: apiRequestTimeoutMs });
      delayProbe[label] = { delayMs: ms, clientTimeoutMs: apiRequestTimeoutMs, outcome: "completed", elapsedMs: Date.now() - started };
    } catch (error) {
      delayProbe[label] = { delayMs: ms, clientTimeoutMs: apiRequestTimeoutMs, outcome: "timed-out", elapsedMs: Date.now() - started, error: String(error?.message ?? error).slice(0, 80) };
    }
  }
  await command({ command: "reset" });
  if (delayProbe.below.outcome !== "completed" || delayProbe.above.outcome !== "timed-out") {
    throw new Error(`delay thresholds did not behave as derived: ${JSON.stringify(delayProbe)}`);
  }

  // 6. server start → ready (webServer timeout basis)
  if (!args["skip-server-start"]) raw.serverStartMs = await measureServerStart(3);

  proxy.server.close();

  // ── derive ─────────────────────────────────────────────────────────
  const m = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, summarise(v)]));
  m.proxyOverheadMs = summarise(raw.apiProxiedMs.map((v, i) => Math.round(Math.max(0, v - raw.apiDirectMs[i]) * 10) / 10));
  const fixtureEvents = readFileSync(path.join(e2eRoot, "fixtures/events/offline-task.ndjson"), "utf8").trim().split("\n").length;
  const sandboxTimeoutMs = appSandboxTimeoutMs();

  const mockInterEventDelayMs = Math.max(10, Math.round(m.interEventGapMs.p50));
  const pollIntervalMs = Math.min(250, Math.max(25, Math.round(m.interEventGapMs.p50)));
  const retryBase = ceilTo(50, Math.max(250, 2 * m.createTaskMs.p95));
  const retrySchedule = [retryBase, retryBase * 2, retryBase * 4];
  const mockedTimelineMs = fixtureEvents * mockInterEventDelayMs + m.pageLoadMs.p95;
  const expectTimeoutMs = Math.max(5000, ceilTo(1000, 3 * mockedTimelineMs));
  const taskCompletionTimeoutMs = sandboxTimeoutMs + 15_000;
  const testTimeoutMs = taskCompletionTimeoutMs + expectTimeoutMs + 15_000;
  const webServerTimeoutMs = ceilTo(5000, Math.max(30_000, 10 * (m.serverStartMs.max ?? 3000)));

  const calibration = {
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: `${os.platform()} ${os.arch()} ${os.release()}`, cpus: os.cpus().length, appCommit: git(["rev-parse", "HEAD"], { optional: true }) || null, appUrl, samplesPerMeasurement: N, appMode: "next start (production build), OfflinePlanner" },
    measurements: m,
    faultRecovery: faultRecovery.map(({ attempts, ...rest }) => ({ ...rest, attemptErrors: attempts.filter((a) => !a.ok).map((a) => a.error) })),
    delayProbe,
    derived: {
      mockInterEventDelayMs: { value: mockInterEventDelayMs, formula: "max(10, p50(interEventGapMs))" },
      pollIntervalMs: { value: pollIntervalMs, formula: "clamp(p50(interEventGapMs), 25, 250)" },
      apiRequestTimeoutMs: { value: apiRequestTimeoutMs, formula: "ceil500(max(2000, 10 × p95(apiProxiedMs)))" },
      proxyDelayBelowTimeoutMs: { value: delayBelow, formula: "apiRequestTimeoutMs / 2", verified: delayProbe.below.outcome },
      proxyDelayAboveTimeoutMs: { value: delayAbove, formula: "apiRequestTimeoutMs × 2", verified: delayProbe.above.outcome },
      retrySchedule: { value: retrySchedule, formula: "base = ceil50(max(250, 2 × p95(createTaskMs))); [base, 2·base, 4·base]", recoveredWithin: Math.min(...faultRecovery.map((f) => f.attemptsToSucceed)) + " attempts under fail-next/drop" },
      expectTimeoutMs: { value: expectTimeoutMs, formula: "max(5000, ceil1000(3 × (fixtureEvents × mockInterEventDelayMs + p95(pageLoadMs))))", fixtureEvents },
      taskCompletionTimeoutMs: { value: taskCompletionTimeoutMs, formula: "appSandboxTimeoutMs + 15000", source: `apps/web/lib/agent-runtime.ts server-side sandbox wait = ${sandboxTimeoutMs} ms (app constant; Pyodide CDN load is not measurable in this environment)` },
      testTimeoutMs: { value: testTimeoutMs, formula: "taskCompletionTimeoutMs + expectTimeoutMs + 15000" },
      webServerTimeoutMs: { value: webServerTimeoutMs, formula: "ceil5000(max(30000, 10 × max(serverStartMs)))", note: m.serverStartMs.n === 0 ? "server start not measured (--skip-server-start)" : undefined },
      playwrightRetries: { value: { local: 0, ci: 1 }, formula: "0 locally so flakes surface; 1 in CI for infrastructure hiccups — revisit from repeat-each runs recorded in docs/E2E_BASELINE.md" },
    },
  };

  writeFileSync(path.join(e2eRoot, "retry-calibration.json"), JSON.stringify(calibration, null, 2) + "\n");
  mkdirSync(path.join(e2eRoot, "reports"), { recursive: true });
  writeFileSync(path.join(e2eRoot, "reports/retry-calibration.raw.json"), JSON.stringify({ measuredAt: calibration.measuredAt, raw, faultRecovery }, null, 2) + "\n");

  console.log("measurements (ms):");
  for (const [key, value] of Object.entries(m)) console.log(`  ${key.padEnd(24)} n=${value.n} p50=${value.p50} p95=${value.p95} max=${value.max}`);
  console.log("fault recovery:");
  for (const f of faultRecovery) console.log(`  ${f.fault.padEnd(10)} schedule=${JSON.stringify(f.schedule)} attempts=${f.attemptsToSucceed} total=${f.totalMs}ms`);
  console.log("derived:");
  for (const [key, value] of Object.entries(calibration.derived)) console.log(`  ${key.padEnd(26)} ${JSON.stringify(value.value)}`);
  console.log(`→ e2e/retry-calibration.json`);
}

main().catch((error) => {
  console.error(`calibration failed: ${error?.message ?? error}`);
  process.exit(1);
});
