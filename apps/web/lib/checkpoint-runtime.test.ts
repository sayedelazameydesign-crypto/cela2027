import { describe, expect, it, vi } from "vitest";
import { Runtime } from "./agent-runtime";
import { MemorySnapshotStore } from "@cela/store";

describe("Runtime snapshot inspection across instances", () => {
  it("stores the completed offline task and restores the verified ledger and workspace", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    const snapshots = new MemorySnapshotStore();
    const writer = new Runtime({ snapshots });
    const taskId = await writer.startTask("build math tools");
    let runId = "";
    await vi.waitFor(() => {
      const request = writer.tasks.get(taskId)?.buffer.find((item) => item.e.type === "sandbox_request")?.e;
      if (!request || request.type !== "sandbox_request") throw new Error("Sandbox not requested yet");
      runId = request.runId;
    });
    expect(writer.resolveSandbox(runId, { ok: true, stdout: "ALL TESTS PASSED", stderr: "" })).toBe(true);
    await vi.waitFor(async () => expect(await snapshots.loadSnapshot(taskId)).toBeDefined());
    const reader = new Runtime({ snapshots });
    const restored = await reader.loadCheckpoint(taskId);
    expect(restored?.workspace.read("celia_app/math_tools.py")).toContain("def fib(n):");
    expect((await restored!.ledger.verify()).valid).toBe(true);
    expect(restored?.ledger.export().at(-1)?.type).toBe("task_finished");
    expect(restored?.currentStepIndex).toBe(2);
    vi.unstubAllEnvs();
  });
});
