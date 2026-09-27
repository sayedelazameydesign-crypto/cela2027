#!/usr/bin/env node
/**
 * record-fixture — records a complete task timeline from the REAL running app.
 *
 *   node e2e/scripts/record-fixture.mjs --base http://127.0.0.1:3000 \
 *        --name offline-task --goal "ابنِ لي مشروع Python ..." \
 *        --out e2e/fixtures/events [--executor cpython|none]
 *
 * How it works
 *   1. POST /api/task {goal}                    → taskId
 *   2. GET  /api/task/:id/events?after=<seq>    → incremental capture (100 ms)
 *   3. every `sandbox_request` is answered by THIS process playing the
 *      browser-sandbox role: artifacts seen so far are materialised in a temp
 *      dir and the code runs under the local CPython (`python3`). The server
 *      never executes user code; the client role is what we emulate.
 *   4. after `done`, GET /api/task/:id/files for the final workspace snapshot
 *   5. writes <name>.ndjson (one {seq,e} per line, LF) + <name>.meta.json
 *
 * The fixture is never edited by hand — change the recorder and re-record.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchJson, parseArgs } from "../lib/http.mjs";
import { git, repoRoot } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), {
  base: process.env.E2E_APP_URL ?? "http://127.0.0.1:3000",
  name: "offline-task",
  goal: "ابنِ لي مشروع Python فيه أدوات رياضية مع اختبارات وشغّلها",
  out: path.join(repoRoot, "e2e", "fixtures", "events"),
  executor: "cpython",
  poll: "100",
  timeout: "90000",
});

const base = String(args.base).replace(/\/$/, "");
const pollMs = Number(args.poll);
const timeoutMs = Number(args.timeout);
const outDir = path.resolve(String(args.out));
mkdirSync(outDir, { recursive: true });

function pythonVersion() {
  try {
    return execFileSync("python3", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Play the sandbox role: run `code` against the artifacts seen so far. */
function executeSandbox(code, artifacts) {
  if (args.executor !== "cpython") {
    throw new Error(`executor "${args.executor}" cannot answer sandbox requests; use --executor cpython`);
  }
  const version = pythonVersion();
  if (!version) throw new Error("python3 is required to play the sandbox role while recording");
  const dir = mkdtempSync(path.join(os.tmpdir(), "cela-e2e-sandbox-"));
  try {
    for (const [file, content] of Object.entries(artifacts)) {
      const target = path.join(dir, file);
      if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) throw new Error(`artifact escapes sandbox dir: ${file}`);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let ok = true;
    try {
      stdout = execFileSync("python3", ["-c", code], { cwd: dir, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      ok = false;
      stdout = String(error?.stdout ?? "");
      stderr = String(error?.stderr ?? error?.message ?? error);
    }
    return { ok, stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), durationMs: Date.now() - started, executor: version };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const startedAt = new Date();
  const created = await fetchJson(`${base}/api/task`, { method: "POST", body: { goal: args.goal } });
  const taskId = created.json?.taskId;
  if (!taskId) throw new Error(`POST /api/task did not return a taskId: ${JSON.stringify(created.json)}`);

  const events = [];
  const artifacts = {};
  const sandboxRuns = [];
  const answered = new Set();
  let after = -1;
  let done = false;
  let polls = 0;
  const deadline = Date.now() + timeoutMs;

  while (!done) {
    if (Date.now() > deadline) throw new Error(`task ${taskId} did not finish within ${timeoutMs}ms`);
    const page = await fetchJson(`${base}/api/task/${taskId}/events?after=${after}`);
    polls++;
    for (const item of page.json.events) {
      events.push(item);
      after = Math.max(after, item.seq);
      const e = item.e;
      if (e.type === "artifact") artifacts[e.path] = e.content;
      if (e.type === "sandbox_request" && !answered.has(e.runId)) {
        answered.add(e.runId);
        const result = executeSandbox(e.code, artifacts);
        const posted = await fetchJson(`${base}/api/task/${taskId}/sandbox`, {
          method: "POST",
          body: { runId: e.runId, ok: result.ok, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs },
        });
        sandboxRuns.push({ runId: e.runId, ...result, serverAccepted: posted.json?.ok === true });
      }
    }
    done = page.json.done === true;
    if (!done) await new Promise((r) => setTimeout(r, pollMs));
  }

  const files = (await fetchJson(`${base}/api/task/${taskId}/files`)).json.files ?? {};
  const finished = events.map((x) => x.e).find((e) => e.type === "task_finished");

  const ndjson = events.map((item) => JSON.stringify(item)).join("\n") + "\n";
  const ndjsonPath = path.join(outDir, `${args.name}.ndjson`);
  writeFileSync(ndjsonPath, ndjson, { encoding: "utf8" });

  const seqs = events.map((x) => x.seq);
  const gaps = [];
  for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1) gaps.push([seqs[i - 1], seqs[i]]);
  const histogram = {};
  for (const { e } of events) histogram[e.type] = (histogram[e.type] ?? 0) + 1;

  const meta = {
    name: args.name,
    recordedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    app: { baseUrl: base, commit: git(["rev-parse", "HEAD"], { optional: true }) || null, planner: "OfflinePlanner (no OPENROUTER_API_KEY)" },
    request: { goal: args.goal },
    taskId,
    captureMode: "incremental-polling",
    pollIntervalMs: pollMs,
    polls,
    events: { count: events.length, firstSeq: seqs[0] ?? null, lastSeq: seqs.at(-1) ?? null, gaps, byType: histogram },
    finalStatus: finished?.status ?? null,
    summary: finished?.summary ?? null,
    sandbox: sandboxRuns.map((run) => ({ ...run, role: "recorder emulates the browser sandbox client; server never ran the code" })),
    files: Object.fromEntries(Object.entries(files).map(([p, c]) => [p, { bytes: Buffer.byteLength(c, "utf8") }])),
    artifactsMatchFiles: JSON.stringify(Object.keys(artifacts).sort()) === JSON.stringify(Object.keys(files).sort()),
    ndjson: { file: path.relative(repoRoot, ndjsonPath), bytes: Buffer.byteLength(ndjson, "utf8"), sha256: createHash("sha256").update(ndjson).digest("hex") },
    recorder: { node: process.version, platform: `${os.platform()} ${os.release()}` },
  };
  const metaPath = path.join(outDir, `${args.name}.meta.json`);
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", { encoding: "utf8" });

  console.log(`recorded ${events.length} events (seq ${seqs[0]}..${seqs.at(-1)}, ${gaps.length} gap(s)) → ${path.relative(repoRoot, ndjsonPath)}`);
  console.log(`final status ${meta.finalStatus}; sandbox runs ${sandboxRuns.length}; files ${Object.keys(files).length}`);
  console.log(`meta → ${path.relative(repoRoot, metaPath)}`);
  if (meta.finalStatus !== "VERIFIED") {
    console.error("WARNING: the recorded task did not end VERIFIED; inspect meta before committing.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`record-fixture failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
