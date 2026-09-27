// node --test e2e/proxy/
// Real sockets, ephemeral ports, no mocks: proves the proxy forwards bytes and
// streams, and that every command does exactly what docs/E2E_PLAN.md claims.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { listen, readBody } from "../lib/http.mjs";
import { createFaultProxy } from "./fault-proxy.mjs";

let upstream;
let secondary;
let proxy;
let base;
let upstreamHits = 0;

function makeUpstream(label) {
  return http.createServer(async (req, res) => {
    upstreamHits++;
    const url = new URL(req.url, "http://u.local");
    if (url.pathname === "/json") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, from: label, encoding: req.headers["accept-encoding"] ?? null }));
    }
    if (url.pathname === "/echo" && req.method === "POST") {
      const body = await readBody(req);
      res.writeHead(200, { "content-type": req.headers["content-type"] ?? "application/octet-stream" });
      return res.end(body);
    }
    if (url.pathname === "/sse") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      let n = 0;
      const timer = setInterval(() => {
        n++;
        res.write(`data: {"n":${n}}\n\n`);
        if (n === 3) {
          clearInterval(timer);
          res.end();
        }
      }, 60);
      req.on("close", () => clearInterval(timer));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ api: true, from: label, path: url.pathname }));
    }
    res.writeHead(404);
    res.end("nope");
  });
}

async function command(body) {
  const response = await fetch(`${base}/__proxy/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() };
}

async function state() {
  return (await fetch(`${base}/__proxy/state`)).json();
}

before(async () => {
  upstream = makeUpstream("primary");
  secondary = makeUpstream("secondary");
  const u = await listen(upstream, 0);
  await listen(secondary, 0);
  proxy = createFaultProxy({ target: `http://127.0.0.1:${u.port}` });
  const p = await listen(proxy.server, 0);
  base = `http://127.0.0.1:${p.port}`;
});

after(async () => {
  for (const server of [proxy?.server, upstream, secondary]) {
    await new Promise((resolve) => server?.close(resolve));
  }
});

beforeEach(async () => {
  await command({ command: "reset" });
});

test("health + passthrough JSON with identity encoding and a log entry", async () => {
  const health = await (await fetch(`${base}/__proxy/health`)).json();
  assert.equal(health.ok, true);

  const response = await fetch(`${base}/json`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-fault-proxy"), "passthrough");
  const body = await response.json();
  assert.deepEqual(body, { ok: true, from: "primary", encoding: "identity" });

  const s = await state();
  const entry = s.log.entries.at(-1);
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/json");
  assert.equal(entry.status, 200);
  assert.equal(entry.fault, null);
  assert.equal(typeof entry.durationMs, "number");
});

test("POST bodies are piped through unchanged (UTF-8 Arabic payload)", async () => {
  const payload = JSON.stringify({ goal: "ابنِ لي مشروع Python", n: 1 });
  const response = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), payload);
});

test("SSE is streamed incrementally, not buffered until the end", async () => {
  const response = await fetch(`${base}/sse`);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const arrivals = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    arrivals.push(Date.now());
    text += decoder.decode(value, { stream: true });
  }
  assert.equal((text.match(/data:/g) ?? []).length, 3, "all three events arrived");
  assert.ok(arrivals.length >= 2, `expected multiple chunks, got ${arrivals.length}`);
  const spread = arrivals.at(-1) - arrivals[0];
  assert.ok(spread >= 50, `chunks should arrive over time (spread ${spread}ms)`);
});

test("fail-next answers exactly N matching requests locally, then passes through", async () => {
  const before = upstreamHits;
  const created = await command({ command: "fail-next", match: { method: "GET", path: "/json" }, count: 2, status: 503 });
  assert.equal(created.status, 200);

  const first = await fetch(`${base}/json`);
  const second = await fetch(`${base}/json`);
  const third = await fetch(`${base}/json`);
  assert.equal(first.status, 503);
  assert.equal(first.headers.get("x-fault-proxy"), "fail-next");
  assert.deepEqual(await first.json(), { error: "injected by fault-proxy" });
  assert.equal(second.status, 503);
  assert.equal(third.status, 200);
  assert.equal(upstreamHits - before, 1, "upstream saw only the third request");

  // a non-matching path is never affected
  const other = await fetch(`${base}/api/x`);
  assert.equal(other.status, 200);

  const s = await state();
  const rule = s.rules.find((r) => r.kind === "fail");
  assert.equal(rule.fired, 2);
  assert.equal(rule.remaining, 0);
  assert.deepEqual(s.log.entries.filter((e) => e.path === "/json").map((e) => e.fault), ["fail", "fail", null]);
});

test("delay holds a matching request for at least ms before forwarding", async () => {
  await command({ command: "delay", match: { method: "POST", path: "/echo" }, ms: 300 });
  const started = Date.now();
  const response = await fetch(`${base}/echo`, { method: "POST", body: "x" });
  const elapsed = Date.now() - started;
  assert.equal(response.status, 200);
  assert.ok(elapsed >= 290, `expected >= 300ms, took ${elapsed}ms`);
  const fast = Date.now();
  await fetch(`${base}/echo`, { method: "POST", body: "y" });
  assert.ok(Date.now() - fast < 200, "second request is not delayed (count=1)");
  const s = await state();
  assert.equal(s.log.entries.find((e) => e.path === "/echo").delayMs, 300);
});

test("drop destroys the socket so the client sees a network error", async () => {
  await command({ command: "drop", match: { path: "/json" } });
  await assert.rejects(() => fetch(`${base}/json`), /fetch failed/);
  const s = await state();
  assert.equal(s.log.entries.at(-1).fault, "drop");
  assert.equal(s.log.entries.at(-1).status, "dropped");
  const recovered = await fetch(`${base}/json`);
  assert.equal(recovered.status, 200);
});

test("route sends matching prefixes to another upstream and leaves the rest alone", async () => {
  const port = secondary.address().port;
  await command({ command: "route", match: { pathPrefix: "/api/" }, target: `http://127.0.0.1:${port}` });
  const api = await (await fetch(`${base}/api/task`)).json();
  assert.deepEqual(api, { api: true, from: "secondary", path: "/api/task" });
  const page = await (await fetch(`${base}/json`)).json();
  assert.equal(page.from, "primary");
  const s = await state();
  assert.equal(s.log.entries.find((e) => e.path === "/api/task").routedTo, `http://127.0.0.1:${port}/`);
  assert.equal(s.rules.find((r) => r.kind === "route").count, "unlimited");
});

test("faults compose: delay + fail-next on the same request", async () => {
  await command({ command: "delay", match: { path: "/json" }, ms: 150 });
  await command({ command: "fail-next", match: { path: "/json" }, status: 500 });
  const started = Date.now();
  const response = await fetch(`${base}/json`);
  assert.equal(response.status, 500);
  assert.ok(Date.now() - started >= 140);
});

test("reset clears rules and the log; invalid commands are rejected with 400", async () => {
  await command({ command: "fail-next", match: { path: "/json" } });
  await fetch(`${base}/json`);
  const reset = await command({ command: "reset" });
  assert.equal(reset.json.result.reset, true);
  const s = await state();
  assert.equal(s.rules.length, 0);
  assert.equal(s.log.entries.length, 0);

  assert.equal((await command({ command: "nope" })).status, 400);
  assert.equal((await command({ command: "delay", match: { path: "/x" } })).status, 400);
  assert.equal((await command({ command: "fail-next", match: { bogus: 1 } })).status, 400);
  assert.equal((await command({ command: "fail-next", count: 0 })).status, 400);
});

test("unreachable upstream yields a 502 JSON error, not a hang", async () => {
  await command({ command: "route", match: { pathPrefix: "/api/" }, target: "http://127.0.0.1:9" });
  const response = await fetch(`${base}/api/task`);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("x-fault-proxy"), "upstream-error");
  const body = await response.json();
  assert.match(body.error, /upstream unreachable/);
});
