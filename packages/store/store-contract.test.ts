import { describe, expect, it } from "vitest";
import { MemoryStore, type TaskRecord } from "./src/index";

function task(id: string, createdAt: string): TaskRecord {
  return {
    id,
    goal: `goal-${id}`,
    status: "PLANNING",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("Store compatibility contract", () => {
  it("creates, reads, updates, and lists tasks through the Store interface", async () => {
    const store = new MemoryStore();
    await store.createTask(task("older", "2026-01-01T00:00:00.000Z"));
    await store.createTask(task("newer", "2026-01-02T00:00:00.000Z"));
    await store.updateTask("older", { status: "VERIFIED", summary: "done" });

    await expect(store.getTask("older")).resolves.toEqual(
      expect.objectContaining({ id: "older", status: "VERIFIED", summary: "done" })
    );
    await expect(store.listTasks()).resolves.toEqual([
      expect.objectContaining({ id: "newer" }),
      expect.objectContaining({ id: "older" }),
    ]);
  });

  it("keeps task records isolated from caller mutation", async () => {
    const store = new MemoryStore();
    const original = task("task-1", "2026-01-01T00:00:00.000Z");
    await store.createTask(original);
    original.status = "FAILED";

    const fetched = await store.getTask("task-1");
    expect(fetched?.status).toBe("PLANNING");

    if (fetched) fetched.status = "DENIED";
    await expect(store.getTask("task-1")).resolves.toEqual(
      expect.objectContaining({ status: "PLANNING" })
    );
  });

  it("keeps messages scoped to their task in insertion order", async () => {
    const store = new MemoryStore();
    await store.addMessage({
      id: "m1",
      taskId: "task-1",
      role: "user",
      content: "first",
      at: "2026-01-01T00:00:00.000Z",
    });
    await store.addMessage({
      id: "m2",
      taskId: "task-2",
      role: "agent",
      content: "other",
      at: "2026-01-01T00:00:01.000Z",
    });
    await store.addMessage({
      id: "m3",
      taskId: "task-1",
      role: "agent",
      content: "second",
      at: "2026-01-01T00:00:02.000Z",
    });

    const messages = await store.listMessages("task-1");
    expect(messages.map((message) => message.id)).toEqual(["m1", "m3"]);
  });
});
