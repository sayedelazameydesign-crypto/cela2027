import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { Runtime } from "@/lib/agent-runtime";
import { MemoryEventJournal, MemoryStore } from "@cela/store";
import type { AgentEvent } from "@cela/core";

const context = { params: Promise.resolve({ id: "task-1" }) };
const globalRuntime = globalThis as typeof globalThis & { __celaRuntime?: Runtime };
const previous = globalRuntime.__celaRuntime;

function request(headers?: HeadersInit, query = "") {
  return new Request(`http://localhost/api/task/task-1/stream${query}`, { headers });
}

async function fixture() {
  const store = new MemoryStore();
  const journal = new MemoryEventJournal<AgentEvent>();
  await store.createTask({
    id: "task-1", goal: "test", status: "RUNNING",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  });
  const writer = new Runtime({ store, journal });
  writer.tasks.set("task-1", {
    id: "task-1", goal: "test", status: "RUNNING", buffer: [], nextSeq: 0, listeners: new Set(),
  });
  writer.emit("task-1", { type: "task_started", taskId: "task-1", goal: "test" });
  writer.emit("task-1", { type: "agent_message", taskId: "task-1", content: "hello" });
  await writer.flush("task-1");
  // Simulate a different instance serving the SSE request.
  globalRuntime.__celaRuntime = new Runtime({ store, journal });
  return { writer, store };
}

afterEach(() => {
  globalRuntime.__celaRuntime = previous;
  vi.useRealTimers();
});

describe("resumable task SSE", () => {
  it("replays ordered events with ids on a first connection and closes after completion", async () => {
    const { writer } = await fixture();
    writer.emit("task-1", { type: "task_finished", taskId: "task-1", status: "VERIFIED", summary: "ok" });
    await writer.flush("task-1");
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('id: 0\ndata: {"type":"task_started"');
    expect(body).toContain('id: 1\ndata: {"type":"agent_message"');
    expect(body).toContain('id: 2\ndata: {"type":"task_finished"');
    expect(body.match(/^id:/gm)).toHaveLength(3);
  });

  it("resumes strictly after Last-Event-ID, without replaying an old sandbox request", async () => {
    const { writer } = await fixture();
    writer.emit("task-1", { type: "task_finished", taskId: "task-1", status: "VERIFIED", summary: "ok" });
    await writer.flush("task-1");
    const response = await GET(request({ "Last-Event-ID": "1" }), context);
    expect(await response.text()).toMatch(/^id: 2\ndata: .*task_finished.*\n\n$/);
  });

  it("does not replay an already delivered sandbox_request after reconnect", async () => {
    const { writer } = await fixture();
    writer.emit("task-1", {
      type: "sandbox_request", taskId: "task-1", runId: "task-1:r1", code: "print(1)",
    });
    writer.emit("task-1", { type: "task_finished", taskId: "task-1", status: "VERIFIED", summary: "ok" });
    await writer.flush("task-1");
    const response = await GET(request({ "Last-Event-ID": "2" }), context);
    expect(await response.text()).toMatch(/^id: 3\ndata: .*task_finished.*\n\n$/);
  });

  it("uses the header over a manual cursor, supports cursor zero, and rejects malformed cursors", async () => {
    const { writer } = await fixture();
    writer.emit("task-1", { type: "task_finished", taskId: "task-1", status: "VERIFIED", summary: "ok" });
    await writer.flush("task-1");
    expect(await (await GET(request({ "Last-Event-ID": "0" }, "?after=1"), context)).text())
      .toMatch(/^id: 1\ndata: /);
    expect(await (await GET(request(undefined, "?after=1"), context)).text())
      .toMatch(/^id: 2\ndata: /);
    for (const invalid of ["-1", "1abc", "1.5", "9007199254740992", "NaN"]) {
      expect((await GET(request({ "Last-Event-ID": invalid }), context)).status).toBe(400);
    }
  });

  it("closes an already finished stream with no duplicate payload when cursor is at the end", async () => {
    const { writer } = await fixture();
    writer.emit("task-1", { type: "task_finished", taskId: "task-1", status: "VERIFIED", summary: "ok" });
    await writer.flush("task-1");
    expect(await (await GET(request({ "Last-Event-ID": "2" }), context)).text()).toBe("");
  });

  it("returns a non-streaming 503 when the event journal cannot be read", async () => {
    globalRuntime.__celaRuntime = new Runtime({ journal: {
      append: async () => {}, files: async () => ({}),
      after: async () => { throw new Error("database offline"); },
    } });
    const response = await GET(request(), context);
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
  });

  it("does not duplicate events when a new event arrives during a live cross-instance connection", async () => {
    const { writer } = await fixture();
    vi.useFakeTimers();
    const response = await GET(request({ "Last-Event-ID": "0" }), context);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('id: 1\ndata: ');
    writer.emit("task-1", { type: "task_finished", taskId: "task-1", status: "VERIFIED", summary: "ok" });
    await writer.flush("task-1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(decoder.decode((await reader.read()).value)).toContain('id: 2\ndata: ');
    expect((await reader.read()).done).toBe(true);
  });
});
