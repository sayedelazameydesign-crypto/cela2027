// node --test e2e/mock-api/
// Contract parity of the mock with the real API (status codes, shapes, SSE,
// polling filter, sandbox hold) — verified on real sockets against the
// committed fixture.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createAppClient } from "../lib/app-client.mjs";
import { listen } from "../lib/http.mjs";
import { createMockApi, loadFixture } from "./server.mjs";

let mock;
let base;
let client;
const fixture = loadFixture("offline-task");

async function command(body) {
  const response = await fetch(`${base}/__mock/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() };
}

before(async () => {
  mock = createMockApi({ fixture: "offline-task" });
  const address = await listen(mock.server, 0);
  base = `http://127.0.0.1:${address.port}`;
  client = createAppClient(base);
});

after(async () => {
  await command({ command: "reset" });
  await new Promise((resolve) => mock.server.close(resolve));
});

beforeEach(async () => {
  await command({ command: "reset" });
  await command({ command: "config", interEventDelayMs: 1 });
});

test("POST /api/task validates like the app and returns the fixture taskId", async () => {
  const empty = await fetch(`${base}/api/task`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal: "  " }) });
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: "الهدف مطلوب" });
  const long = await fetch(`${base}/api/task`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal: "x".repeat(4001) }) });
  assert.equal(long.status, 400);
  const taskId = await client.createTask("هدف");
  assert.equal(taskId, fixture.taskId);
});

test("polling: events?after filters by seq, done flips only after task_finished, files appear at the end", async () => {
  await command({ command: "config", holdSandbox: false });
  const taskId = await client.createTask("هدف");
  const first = await client.eventsAfter(taskId, -1);
  assert.equal(first.taskId, taskId);
  assert.ok(first.events.length <= fixture.events.length);
  assert.deepEqual(await client.files(taskId), { taskId, files: {} }, "no files before the task finished");

  let page;
  const deadline = Date.now() + 5000;
  do {
    page = await client.eventsAfter(taskId, -1);
    if (!page.done) await new Promise((r) => setTimeout(r, 10));
  } while (!page.done && Date.now() < deadline);
  assert.equal(page.done, true);
  assert.deepEqual(page.events, fixture.events, "the full released timeline equals the fixture byte-for-byte (as JSON)");

  const tail = await client.eventsAfter(taskId, 15);
  assert.deepEqual(tail.events.map((x) => x.seq), [16, 17]);

  const files = await client.files(taskId);
  assert.deepEqual(Object.keys(files.files).sort(), ["celia_app/README.md", "celia_app/math_tools.py", "celia_app/test_math_tools.py"]);

  const unknown = await client.eventsAfter("nope", -1);
  assert.deepEqual(unknown, { taskId: "nope", events: [], done: true });
});

test("SSE: replay + live events, closes after task_finished, sandbox hold waits for POST /sandbox", async () => {
  const taskId = await client.createTask("هدف");
  const sandboxSeen = [];
  const arrivals = await client.streamUntilFinished(taskId, {
    timeoutMs: 5000,
    onEvent: async (event) => {
      if (event.type === "sandbox_request") {
        sandboxSeen.push(event.runId);
        // wrong runId prefix → 400; unknown pending → 404; pending → ok
        const bad = await client.answerSandbox(taskId, "other:1", { stdout: "" });
        assert.equal(bad.status, 400);
        const missing = await client.answerSandbox(taskId, `${taskId}:zzzzzz`, { stdout: "" });
        assert.equal(missing.status, 404);
        const ok = await client.answerSandbox(taskId, event.runId, { stdout: fixture.sandboxStdout });
        assert.equal(ok.status, 200);
      }
    },
  });
  assert.equal(sandboxSeen.length, 1);
  assert.deepEqual(arrivals.map((a) => a.e.type), fixture.events.map((x) => x.e.type));
  assert.equal(arrivals.at(-1).e.status, "VERIFIED");
  const state = await (await fetch(`${base}/__mock/state`)).json();
  const session = state.sessions.find((s) => s.taskId === taskId);
  assert.equal(session.finished, true);
  assert.equal(session.pendingHolds.length, 0);
  assert.equal(session.sandboxPosts.filter((p) => p.accepted).length, 1);
});

test("sandbox hold times out and the timeline continues (documented escape hatch)", async () => {
  await command({ command: "config", sandboxHoldTimeoutMs: 100 });
  const taskId = await client.createTask("هدف");
  const arrivals = await client.streamUntilFinished(taskId, { timeoutMs: 5000 });
  assert.equal(arrivals.at(-1).e.type, "task_finished");
  const state = await (await fetch(`${base}/__mock/state`)).json();
  assert.equal(state.sessions.find((s) => s.taskId === taskId).holdTimeouts, 1);
});

test("worker script is deterministic and carries the recorded stdout", async () => {
  const response = await fetch(`${base}/pyodide-worker.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  const script = await response.text();
  assert.ok(script.includes(JSON.stringify(fixture.sandboxStdout)));
  assert.ok(script.includes("ALL TESTS PASSED"));
});

test("unique taskId mode keeps runId prefixed by the new taskId", async () => {
  await command({ command: "config", taskIdMode: "unique", holdSandbox: false });
  const a = await client.createTask("أ");
  const b = await client.createTask("ب");
  assert.notEqual(a, b);
  await new Promise((r) => setTimeout(r, 100));
  const events = (await client.eventsAfter(a, -1)).events;
  const request = events.find((x) => x.e.type === "sandbox_request");
  assert.ok(request.e.runId.startsWith(a + ":"));
  assert.ok(events.every((x) => x.e.taskId === a));
});

test("invalid commands are rejected", async () => {
  assert.equal((await command({ command: "config", nope: 1 })).status, 400);
  assert.equal((await command({ command: "load", fixture: "does-not-exist" })).status, 400);
  assert.equal((await command({ command: "x" })).status, 400);
});
