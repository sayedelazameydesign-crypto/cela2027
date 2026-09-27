import { describe, expect, it } from "vitest";
import { POST as createTask } from "./task/route";
import { GET as getEvents } from "./task/[id]/events/route";
import { GET as getFiles } from "./task/[id]/files/route";
import { POST as resolveSandbox } from "./task/[id]/sandbox/route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Task API compatibility contract", () => {
  it("keeps the existing validation response for an empty goal", async () => {
    const response = await createTask(postJson("http://localhost/api/task", { goal: "   " }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "الهدف مطلوب" });
  });

  it("keeps the 4000-character goal limit", async () => {
    const response = await createTask(
      postJson("http://localhost/api/task", { goal: "x".repeat(4001) })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "الهدف طويل جداً (4000 حرف كحد أقصى)",
    });
  });

  it("returns the polling envelope for an unknown task", async () => {
    const response = await getEvents(
      new Request("http://localhost/api/task/missing/events?after=not-a-number"),
      context("missing")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      taskId: "missing",
      events: [],
      done: true,
    });
  });

  it("returns the file envelope for an unknown task", async () => {
    const response = await getFiles(
      new Request("http://localhost/api/task/missing/files"),
      context("missing")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ taskId: "missing", files: {} });
  });

  it("rejects sandbox results that do not belong to the task", async () => {
    const response = await resolveSandbox(
      postJson("http://localhost/api/task/task-1/sandbox", {
        runId: "another-task:run-1",
        ok: true,
      }),
      context("task-1")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "runId لا يطابق المهمة" });
  });
});
