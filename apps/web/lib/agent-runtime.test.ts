import { describe, expect, it, vi } from "vitest";
import { Runtime } from "./agent-runtime";
import { MemoryEventJournal, MemoryStore, type EventJournal } from "@cela/store";
import type { AgentEvent } from "@cela/core";

const started: AgentEvent = { type: "task_started", taskId: "t1", goal: "test" };
const file: AgentEvent = { type: "artifact", taskId: "t1", path: "a.py", content: "hello", size: 5 };
const finished: AgentEvent = { type: "task_finished", taskId: "t1", status: "VERIFIED", summary: "ok" };

describe("Runtime durable replay", () => {
  it("replays ordered events, latest files, completion and polling cursors from a different instance", async () => {
    const store = new MemoryStore();
    const journal = new MemoryEventJournal<AgentEvent>();
    await store.createTask({ id: "t1", goal: "test", status: "RUNNING", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    const writer = new Runtime({ store, journal });
    writer.tasks.set("t1", { id: "t1", goal: "test", status: "RUNNING", buffer: [], nextSeq: 0, listeners: new Set() });
    writer.emit("t1", started);
    writer.emit("t1", file);
    writer.emit("t1", { ...file, content: "new", size: 3 });
    writer.emit("t1", finished);
    await writer.flush("t1");

    const reader = new Runtime({ store, journal });
    expect((await reader.eventsAfter("t1", 1)).events.map(({ seq }) => seq)).toEqual([2, 3]);
    expect((await reader.replay("t1")).map((e) => e.type)).toEqual(["task_started", "artifact", "artifact", "task_finished"]);
    expect(await reader.workspaceFiles("t1")).toEqual({ "a.py": "new" });
    expect((await reader.eventsAfter("t1", 3)).done).toBe(true);
  });

  it("serializes async journal writes and propagates persistence failures to readers", async () => {
    const journal = new MemoryEventJournal<AgentEvent>();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const append = journal.append.bind(journal);
    const slow: EventJournal<AgentEvent> = {
      ...journal,
      append: vi.fn(async (taskId, entry) => { if (entry.seq === 0) await gate; await append(taskId, entry); }),
      after: journal.after.bind(journal), files: journal.files.bind(journal),
    };
    const rt = new Runtime({ journal: slow });
    rt.tasks.set("t1", { id: "t1", goal: "test", status: "RUNNING", buffer: [], nextSeq: 0, listeners: new Set() });
    rt.emit("t1", started);
    rt.emit("t1", file);
    release();
    expect((await rt.eventsAfter("t1", -1)).events.map(({ seq }) => seq)).toEqual([0, 1]);

    const broken = new Runtime({ journal: { append: async () => { throw new Error("database offline"); }, after: slow.after, files: slow.files } });
    broken.tasks.set("t1", { id: "t1", goal: "test", status: "RUNNING", buffer: [], nextSeq: 0, listeners: new Set() });
    broken.emit("t1", started);
    await expect(broken.eventsAfter("t1", -1)).rejects.toThrow("database offline");
  });
});
