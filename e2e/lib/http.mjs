// Tiny HTTP helpers shared by the proxy, the mock API, the recorder and the
// calibration script. Node built-ins only.
import http from "node:http";

/** Read a request body fully (with a size cap). */
export function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readJsonBody(req, limit) {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return undefined;
  return JSON.parse(raw.toString("utf8"));
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

/** Fixed-capacity ring buffer used for the request logs exposed on the control `state` endpoints. */
export class RingLog {
  constructor(capacity = 500) {
    this.capacity = capacity;
    this.items = [];
    this.dropped = 0;
  }
  push(item) {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.shift();
      this.dropped++;
    }
    return item;
  }
  clear() {
    this.items = [];
    this.dropped = 0;
  }
  toJSON() {
    return { capacity: this.capacity, dropped: this.dropped, entries: this.items };
  }
}

/** Parse `--flag value` / `--flag=value` / `--bool` argv into an object. */
export function parseArgs(argv, defaults = {}) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      out[arg.slice(2)] = argv[++i];
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

/** Promise wrapper around server.listen with an ephemeral-port friendly result. */
export function listen(server, port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

/** JSON fetch with timeout; throws on non-2xx unless `allow` includes the status. */
export async function fetchJson(url, { method = "GET", body, timeoutMs = 10_000, allow = [] } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = { raw: text };
    }
    if (!response.ok && !allow.includes(response.status)) {
      throw new Error(`${method} ${url} → ${response.status} ${text.slice(0, 200)}`);
    }
    return { status: response.status, json, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

/** Poll until `fn` resolves truthy or the deadline passes. */
export async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 100, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

export { http };
