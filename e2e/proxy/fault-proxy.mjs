#!/usr/bin/env node
/**
 * fault-proxy — command-driven reverse proxy in front of the app under test.
 *
 *   node e2e/proxy/fault-proxy.mjs --listen 3100 --target http://127.0.0.1:3000
 *
 * The browser talks ONLY to this proxy. Tests reconfigure it through commands
 * instead of touching the application or the browser:
 *
 *   POST /__proxy/commands   {"command": "...", ...}      (see COMMANDS below)
 *   GET  /__proxy/state      rules + request log (evidence that faults fired)
 *   GET  /__proxy/health     {"ok": true}
 *
 * COMMANDS
 *   fail-next  { match, count=1, status=503, body? }  answer the next N matching
 *                                                     requests locally with `status`
 *   delay      { match, count=1, ms }                 hold matching requests `ms`
 *                                                     before forwarding
 *   drop       { match, count=1 }                     destroy the socket mid-flight
 *   route      { match, target }                      forward matching requests to
 *                                                     another upstream (e.g. mock-api)
 *   reset      {}                                     clear all rules and the log
 *   clear-log  {}                                     clear only the request log
 *
 * match = { method?: "GET"|"POST"|..., path?: "/exact", pathPrefix?: "/api/" }
 * count = positive integer, or "unlimited".
 *
 * Streaming is preserved: response headers/chunks are forwarded as they arrive
 * (SSE works through the proxy), and no compression is negotiated.
 */
import http from "node:http";
import { URL, pathToFileURL } from "node:url";
import { listen, parseArgs, readJsonBody, RingLog, sendJson } from "../lib/http.mjs";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function matches(rule, req, pathname) {
  const m = rule.match ?? {};
  if (m.method && m.method.toUpperCase() !== req.method.toUpperCase()) return false;
  if (m.path !== undefined && m.path !== pathname) return false;
  if (m.pathPrefix !== undefined && !pathname.startsWith(m.pathPrefix)) return false;
  return true;
}

function normaliseCount(value) {
  if (value === undefined) return 1;
  if (value === "unlimited") return Infinity;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`count must be a positive integer or "unlimited", got ${JSON.stringify(value)}`);
  return n;
}

function validateMatch(match) {
  if (match === undefined) return {};
  if (typeof match !== "object" || match === null) throw new Error("match must be an object");
  for (const key of Object.keys(match)) {
    if (!["method", "path", "pathPrefix"].includes(key)) throw new Error(`unknown match key ${key}`);
  }
  return match;
}

export function createFaultProxy({ target, log = new RingLog(500) } = {}) {
  if (!target) throw new Error("target is required");
  const defaultTarget = new URL(target);
  const state = { rules: [], nextRuleId: 1, target: defaultTarget.href, startedAt: new Date().toISOString() };

  function addRule(rule) {
    const stored = { id: state.nextRuleId++, remaining: rule.count, fired: 0, ...rule };
    state.rules.push(stored);
    return stored;
  }

  function handleCommand(body) {
    if (!body || typeof body.command !== "string") throw new Error("body.command is required");
    switch (body.command) {
      case "fail-next":
        return addRule({ kind: "fail", match: validateMatch(body.match), count: normaliseCount(body.count), status: Number(body.status ?? 503), body: body.body ?? { error: "injected by fault-proxy" } });
      case "delay": {
        const ms = Number(body.ms);
        if (!Number.isFinite(ms) || ms < 0) throw new Error("delay requires ms >= 0");
        return addRule({ kind: "delay", match: validateMatch(body.match), count: normaliseCount(body.count), ms });
      }
      case "drop":
        return addRule({ kind: "drop", match: validateMatch(body.match), count: normaliseCount(body.count) });
      case "route": {
        if (typeof body.target !== "string") throw new Error("route requires target");
        const url = new URL(body.target); // validates
        return addRule({ kind: "route", match: validateMatch(body.match), count: Infinity, target: url.href });
      }
      case "reset":
        state.rules = [];
        log.clear();
        return { reset: true };
      case "clear-log":
        log.clear();
        return { cleared: true };
      default:
        throw new Error(`unknown command ${body.command}`);
    }
  }

  /** Pick the first active rule of each kind that matches; consume counts. */
  function selectRules(req, pathname) {
    const selected = { fail: null, delay: null, drop: null, route: null };
    for (const rule of state.rules) {
      if (rule.remaining <= 0 || selected[rule.kind]) continue;
      if (!matches(rule, req, pathname)) continue;
      selected[rule.kind] = rule;
    }
    for (const rule of Object.values(selected)) {
      if (!rule) continue;
      rule.fired++;
      if (rule.remaining !== Infinity) rule.remaining--;
    }
    return selected;
  }

  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url, "http://proxy.local");
    const pathname = url.pathname;

    // ── control plane ────────────────────────────────────────────────
    if (pathname.startsWith("/__proxy/")) {
      try {
        if (pathname === "/__proxy/health") return sendJson(res, 200, { ok: true, target: state.target });
        if (pathname === "/__proxy/state") {
          return sendJson(res, 200, {
            target: state.target,
            startedAt: state.startedAt,
            rules: state.rules.map((r) => ({ ...r, remaining: r.remaining === Infinity ? "unlimited" : r.remaining, count: r.count === Infinity ? "unlimited" : r.count })),
            log: log.toJSON(),
          });
        }
        if (pathname === "/__proxy/commands" && req.method === "POST") {
          const body = await readJsonBody(req, 64 * 1024);
          const result = handleCommand(body);
          const safe = JSON.parse(JSON.stringify(result, (k, v) => (v === Infinity ? "unlimited" : v)));
          return sendJson(res, 200, { ok: true, result: safe });
        }
        return sendJson(res, 404, { error: "unknown control endpoint" });
      } catch (error) {
        return sendJson(res, 400, { error: String(error?.message ?? error) });
      }
    }

    // ── data plane ───────────────────────────────────────────────────
    const rules = selectRules(req, pathname);
    const entry = log.push({
      at: new Date(startedAt).toISOString(),
      method: req.method,
      path: pathname + url.search,
      fault: rules.fail ? "fail" : rules.drop ? "drop" : null,
      delayMs: rules.delay ? rules.delay.ms : 0,
      routedTo: rules.route ? rules.route.target : null,
      status: null,
      durationMs: null,
      upstreamError: null,
    });
    const finish = (status, upstreamError = null) => {
      entry.status = status;
      entry.durationMs = Date.now() - startedAt;
      entry.upstreamError = upstreamError;
    };

    if (rules.delay) await new Promise((r) => setTimeout(r, rules.delay.ms));

    if (rules.fail) {
      const body = Buffer.from(typeof rules.fail.body === "string" ? rules.fail.body : JSON.stringify(rules.fail.body));
      res.writeHead(rules.fail.status, { "content-type": "application/json; charset=utf-8", "content-length": String(body.length), "x-fault-proxy": "fail-next" });
      res.end(body);
      finish(rules.fail.status);
      return;
    }

    if (rules.drop) {
      finish("dropped");
      req.socket.destroy();
      return;
    }

    const upstream = rules.route ? new URL(rules.route.target) : defaultTarget;
    let clientClosed = false;
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key)) continue;
      headers[key] = value;
    }
    headers.host = upstream.host;
    headers["accept-encoding"] = "identity"; // keep bodies inspectable / streamable
    headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
    headers["x-forwarded-proto"] = "http";

    const proxied = http.request(
      { protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || 80, method: req.method, path: url.pathname + url.search, headers },
      (upstreamRes) => {
        const outHeaders = {};
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
          if (HOP_BY_HOP.has(key)) continue;
          outHeaders[key] = value;
        }
        outHeaders["x-fault-proxy"] = rules.route ? "routed" : "passthrough";
        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
        if (typeof res.flushHeaders === "function") res.flushHeaders();
        upstreamRes.on("data", (chunk) => {
          res.write(chunk);
        });
        upstreamRes.on("end", () => {
          res.end();
          finish(upstreamRes.statusCode ?? 502);
        });
        upstreamRes.on("error", (error) => {
          finish(clientClosed ? "client-closed" : "upstream-stream-error", error.message);
          res.destroy(error);
        });
      }
    );
    proxied.on("error", (error) => {
      finish(502, error.message);
      if (!res.headersSent) sendJson(res, 502, { error: `upstream unreachable: ${error.message}` }, { "x-fault-proxy": "upstream-error" });
      else res.destroy(error);
    });
    // client went away (e.g. EventSource closed): stop the upstream request too
    res.on("close", () => {
      if (!res.writableFinished) {
        clientClosed = true;
        proxied.destroy();
      }
    });
    req.pipe(proxied);
  });

  // No WebSocket support by design (next start does not need it).
  server.on("upgrade", (_req, socket) => socket.destroy());

  return { server, state, log, handleCommand };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { listen: process.env.E2E_PROXY_PORT ?? "3100", target: process.env.E2E_APP_URL ?? "http://127.0.0.1:3000", host: "127.0.0.1" });
  const proxy = createFaultProxy({ target: String(args.target) });
  const address = await listen(proxy.server, Number(args.listen), String(args.host));
  console.log(`fault-proxy listening on http://${address.address}:${address.port} → ${proxy.state.target}`);
  const shutdown = () => proxy.server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`fault-proxy failed: ${error?.message ?? error}`);
    process.exit(1);
  });
}
