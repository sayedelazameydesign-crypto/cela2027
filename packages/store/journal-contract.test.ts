import { describe, expect, it } from "vitest";
import { MemoryEventJournal } from "./src/journal";

const taskId = "task-journal";
const first = { seq: 0, e: { type: "task_started", taskId, goal: "demo" } };
const second = { seq: 1, e: { type: "artifact", taskId, path: "a.txt", content: "first", size: 5 } };
const third = { seq: 2, e: { type: "artifact", taskId, path: "a.txt", content: "latest", size: 6 } };

describe("EventJournal contract", () => {
  it("persists append-only ordered events and supports polling cursors and replay", async () => {
    const journal = new MemoryEventJournal();
    await journal.append(taskId, first);
    await journal.append(taskId, second);
    await journal.append(taskId, third);
    expect(await journal.after(taskId, 0)).toEqual([second, third]);
    expect(await journal.after(taskId, -1)).toEqual([first, second, third]);
    expect(await journal.files(taskId)).toEqual({ "a.txt": "latest" });
    expect(await journal.after("missing", -1)).toEqual([]);
    expect(await journal.files("missing")).toEqual({});
    const entries = await journal.after(taskId, -1);
    (entries[0].e as { goal: string }).goal = "mutated";
    expect(await journal.after(taskId, -1)).toEqual([first, second, third]);
  });

  it("rejects overwriting a sequence instead of silently corrupting replay", async () => {
    const journal = new MemoryEventJournal();
    await journal.append(taskId, first);
    await expect(journal.append(taskId, first)).rejects.toThrow();
  });
});
