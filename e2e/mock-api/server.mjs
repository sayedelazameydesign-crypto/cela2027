#!/usr/bin/env node
/**
 * mock-api — replays a recorded fixture behind the app's HTTP contract.
 *
 *   node e2e/mock-api/server.mjs --listen 3200 [--fixture offline-task]
 *
 * Implements exactly the routes the UI uses (docs/SAFE_EVOLUTION.md contract):
 *   POST /api/task                    {goal} → {taskId}   (400 on empty / >4000 chars)
 *   GET  /api/task/:id/stream         SSE replay of released events, then live
 *   GET  /api/task/:id/events?after=  {taskId, events, done}
 *   GET  /api/task/:id/files          {taskId, files} ({} until finished, like the app)
 *   POST /api/task/:id/sandbox        400 runId mismatch · 404 nothing pending · {ok:true}
 *   GET  /pyodide-worker.js           deterministic worker returning the recorded stdout
 *
 * Control plane (command-driven like the proxy):
 *   POST /__mock/commands  load {fixture} · config {interEventDelayMs, holdSandbox,
 *                          sandboxHoldTimeoutMs, taskIdMode} · reset
 *   GET  /__mock/state     config, sessions (released index, sandbox holds), log
 *   GET  /__mock/health
 *
 * Events are "released" on a timer (interEventDelayMs apart). With holdSandbox
 * the release pauses at sandbox_request until the browser posts the sandbox
 * result for that runId (or the hold times out) — the real UI path.
 */
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { listen, parseArgs, readJsonBody, RingLog, sendJson } from "../lib/http.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "..", "fixtures", "events");

export function loadFixture(name) {
  const file = path.join(fixturesDir, `${name}.ndjson`);
  if (!existsSync(file)) throw new Error(`fixture ${name} not found at ${file}`);
  const events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const metaPath = path.join(fixturesDir, `${name}.meta.json`);
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  const taskId = events.find((x) => x.e?.taskId)?.e.taskId;
  if (!taskId) throw new Error(`fixture ${name} has no taskId`);
  return { name, events, meta, taskId, sandboxStdout: meta.sandbox?.[0]?.stdout ?? "" };
}

const DEFAULT_CONFIG = { interEventDelayMs: 10, holdSandbox: true, sandboxHoldTimeoutMs: 15_000, taskIdMode: "fixture" };

export function createMockApi({ fixture = "offline-task", log = new RingLog(500), config: overrides = {} } = {}) {
  const state = { fixture: loadFixture(fixture), config: { ...DEFAULT_CONFIG, ...overrides }, sessions: new Map(), counter: 0 };

  function newSession(goal) {
    const f = state.fixture;
    state.counter++;
    const taskId = state.config.taskIdMode === "unique" ? `${f.taskId.slice(0, 4)}${String(state.counter).padStart(4, "0")}` : f.taskId;
    const session = { taskId, goal, createdAt: Date.now(), released: 0, holds: new Map(), listeners: new Set(), finished: false, sandboxPosts: [], timer: null };
    // Rewrite taskId / runId inside events when running in unique mode so the
    // contract (runId must start with taskId) still holds.
    session.events = f.events.map(({ seq, e }) => {
      const copy = { ...e, taskId };
      if (typeof copy.runId === "string") copy.runId = copy.runId.replace(f.taskId, taskId);
      return { seq, e: copy };
    });
    state.sessions.set(taskId, session);
    scheduleRelease(session);
    return session;
  }

  function notify(session, item) {
    for (const listener of session.listeners) {
      try {
        listener(item);
      } catch {
        /* listener gone */
      }
    }
  }

  function scheduleRelease(session) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => releaseNext(session), state.config.interEventDelayMs);
  }

  function releaseNext(session) {
    session.timer = null;
    if (session.released >= session.events.length) return;
    const item = session.events[session.released];
    session.released++;
    notify(session, item);
    if (item.e.type === "task_finished") {
      session.finished = true;
      return;
    }
    if (item.e.type === "sandbox_request" && state.config.holdSandbox) {
      const hold = { runId: item.e.runId, since: Date.now(), timer: null };
      hold.timer = setTimeout(() => {
        if (session.holds.delete(hold.runId)) {
          hold.timedOut = true;
          session.holdTimeouts = (session.holdTimeouts ?? 0) + 1;
          scheduleRelease(session);
        }
      }, state.config.sandboxHoldTimeoutMs);
      session.holds.set(hold.runId, hold);
      return; // wait for POST /sandbox
    }
    scheduleRelease(session);
  }

  function handleCommand(body) {
    if (!body || typeof body.command !== "string") throw new Error("body.command is required");
    switch (body.command) {
      case "load":
        state.fixture = loadFixture(String(body.fixture ?? "offline-task"));
        return { fixture: state.fixture.name, events: state.fixture.events.length, taskId: state.fixture.taskId };
      case "config": {
        const next = { ...state.config };
        for (const key of Object.keys(body)) {
          if (key === "command") continue;
          if (!(key in DEFAULT_CONFIG)) throw new Error(`unknown config key ${key}`);
          next[key] = body[key];
        }
        if (!Number.isFinite(next.interEventDelayMs) || next.interEventDelayMs < 0) throw new Error("interEventDelayMs must be >= 0");
        if (!["fixture", "unique"].includes(next.taskIdMode)) throw new Error("taskIdMode must be fixture|unique");
        state.config = next;
        return state.config;
      }
      case "reset":
        for (const session of state.sessions.values()) {
          if (session.timer) clearTimeout(session.timer);
          for (const hold of session.holds.values()) clearTimeout(hold.timer);
        }
        state.sessions.clear();
        state.counter = 0;
        state.config = { ...DEFAULT_CONFIG };
        log.clear();
        return { reset: true };
      default:
        throw new Error(`unknown command ${body.command}`);
    }
  }

  const workerScript = () => `/* deterministic sandbox worker served by e2e mock-api — returns the recorded stdout */
self.onmessage = (e) => {
  const { runId } = e.data || {};
  self.postMessage({ runId, ok: true, stdout: ${JSON.stringify(state.fixture.sandboxStdout)}, stderr: "", durationMs: 1 });
};
`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://mock.local");
    const p = url.pathname;
    const entry = log.push({ at: new Date().toISOString(), method: req.method, path: p + url.search, status: null });
    const done = (status) => {
      entry.status = status;
    };
    try {
      // control plane
      if (p === "/__mock/health") return done(200), sendJson(res, 200, { ok: true, fixture: state.fixture.name });
      if (p === "/__mock/state") {
        return done(200), sendJson(res, 200, {
          fixture: { name: state.fixture.name, events: state.fixture.events.length, taskId: state.fixture.taskId },
          config: state.config,
          sessions: [...state.sessions.values()].map((s) => ({ taskId: s.taskId, goal: s.goal, released: s.released, total: s.events.length, finished: s.finished, listeners: s.listeners.size, pendingHolds: [...s.holds.keys()], holdTimeouts: s.holdTimeouts ?? 0, sandboxPosts: s.sandboxPosts })),
          log: log.toJSON(),
        });
      }
      if (p === "/__mock/commands" && req.method === "POST") {
        const result = handleCommand(await readJsonBody(req, 64 * 1024));
        return done(200), sendJson(res, 200, { ok: true, result });
      }

      // deterministic worker (only reached when the proxy routes this path here)
      if (p === "/pyodide-worker.js") {
        const body = Buffer.from(workerScript());
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": String(body.length), "cache-control": "no-store", "x-mock-api": "worker" });
        return done(200), res.end(body);
      }

      // POST /api/task
      if (p === "/api/task" && req.method === "POST") {
        let goal = "";
        try {
          goal = String((await readJsonBody(req, 64 * 1024))?.goal ?? "").trim();
        } catch {
          /* same tolerance as the app */
        }
        if (!goal) return done(400), sendJson(res, 400, { error: "الهدف مطلوب" });
        if (goal.length > 4000) return done(400), sendJson(res, 400, { error: "الهدف طويل جداً (4000 حرف كحد أقصى)" });
        const session = newSession(goal);
        return done(200), sendJson(res, 200, { taskId: session.taskId });
      }

      const match = p.match(/^\/api\/task\/([^/]+)\/(stream|events|files|sandbox)$/);
      if (!match) return done(404), sendJson(res, 404, { error: "not found" });
      const [, taskId, kind] = match;
      const session = state.sessions.get(taskId);

      if (kind === "events" && req.method === "GET") {
        const after = Number.parseInt(url.searchParams.get("after") ?? "-1", 10);
        const safeAfter = Number.isFinite(after) ? after : -1;
        if (!session) return done(200), sendJson(res, 200, { taskId, events: [], done: true });
        const released = session.events.slice(0, session.released);
        return done(200), sendJson(res, 200, { taskId, events: released.filter((x) => x.seq > safeAfter), done: released.some((x) => x.e.type === "task_finished") });
      }

      if (kind === "files" && req.method === "GET") {
        const files = {};
        if (session?.finished) for (const { e } of session.events) if (e.type === "artifact") files[e.path] = e.content;
        return done(200), sendJson(res, 200, { taskId, files });
      }

      if (kind === "sandbox" && req.method === "POST") {
        let body;
        try {
          body = await readJsonBody(req, 1_000_000);
        } catch {
          return done(400), sendJson(res, 400, { error: "JSON غير صالح" });
        }
        const runId = String(body?.runId ?? "");
        if (!runId.startsWith(taskId + ":")) return done(400), sendJson(res, 400, { error: "runId لا يطابق المهمة" });
        const hold = session?.holds.get(runId);
        session?.sandboxPosts.push({ runId, ok: Boolean(body?.ok), stdoutLength: String(body?.stdout ?? "").length, at: new Date().toISOString(), accepted: Boolean(hold) });
        if (!hold) return done(404), sendJson(res, 404, { error: "لا طلب صندوق معلّق بهذا المعرّف" });
        clearTimeout(hold.timer);
        session.holds.delete(runId);
        scheduleRelease(session);
        return done(200), sendJson(res, 200, { ok: true });
      }

      if (kind === "stream" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", "x-mock-api": "stream" });
        res.flushHeaders?.();
        done(200);
        if (!session) {
          res.end();
          return;
        }
        let closed = false;
        const send = ({ e }) => {
          if (closed) return;
          res.write(`data: ${JSON.stringify(e)}\n\n`);
          if (e.type === "task_finished") {
            setTimeout(() => {
              if (!closed) {
                closed = true;
                session.listeners.delete(send);
                res.end();
              }
            }, 100);
          }
        };
        for (const item of session.events.slice(0, session.released)) send(item);
        if (!closed) session.listeners.add(send);
        const heartbeat = setInterval(() => {
          if (closed) return clearInterval(heartbeat);
          res.write(": hb\n\n");
        }, 15_000);
        req.on("close", () => {
          closed = true;
          clearInterval(heartbeat);
          session.listeners.delete(send);
        });
        return;
      }

      return done(405), sendJson(res, 405, { error: "method not allowed" });
    } catch (error) {
      return done(400), sendJson(res, 400, { error: String(error?.message ?? error) });
    }
  });

  return { server, state, log, handleCommand };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { listen: process.env.E2E_MOCK_PORT ?? "3200", fixture: "offline-task", host: "127.0.0.1" });
  const mock = createMockApi({ fixture: String(args.fixture) });
  const address = await listen(mock.server, Number(args.listen), String(args.host));
  console.log(`mock-api listening on http://${address.address}:${address.port} (fixture ${mock.state.fixture.name}, ${mock.state.fixture.events.length} events)`);
  const shutdown = () => mock.server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`mock-api failed: ${error?.message ?? error}`);
    process.exit(1);
  });
}
