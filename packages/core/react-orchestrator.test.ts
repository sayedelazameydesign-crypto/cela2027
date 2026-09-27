import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "./src/orchestrator";
import { OfflinePlanner, type Planner } from "./src/planner";
import type { AgentEvent, Plan, PlannedStep } from "./src/events";
import type { SandboxBridge, SandboxRunResult } from "./src/executor";

describe("Orchestrator ReAct self-correction", () => {
  it("retries a failing step when replanStep provides a corrected step and passes", async () => {
    let runCount = 0;
    const bridge: SandboxBridge = {
      requestRun: async (_taskId: string, code: string): Promise<SandboxRunResult> => {
        runCount++;
        if (runCount === 1) {
          return { stdout: "", stderr: "SyntaxError: invalid syntax", ok: false };
        }
        return { stdout: "TESTS PASSED", stderr: "", ok: true };
      },
    };

    const replanStepMock = vi.fn(
      async (failedStep: PlannedStep, error: string): Promise<PlannedStep> => {
        expect(error).toContain("SyntaxError");
        return {
          ...failedStep,
          title: "محاولة تصحيح الكود",
          args: { code: "print('fixed')" },
        };
      }
    );

    const planner: Planner = {
      plan: async (_goal: string): Promise<Plan> => ({
        summary: "خطة تجريبية للاختبار",
        steps: [
          {
            tool: "python_run",
            title: "كود فيه خطأ",
            args: { code: "print('error'" },
          },
        ],
      }),
      replanStep: replanStepMock,
    };

    const events: AgentEvent[] = [];
    const orch = new Orchestrator({ planner, bridge, maxRetriesPerStep: 2 });
    const res = await orch.runTask("react-task-1", "تصحيح ذاتي", (e) => events.push(e));

    expect(replanStepMock).toHaveBeenCalledTimes(1);
    expect(runCount).toBe(2);
    expect(res.status).toBe("VERIFIED");

    // Check ledger recorded retrying event
    const retryingEntries = res.ledger.export().filter((e) => e.type === "step_retrying");
    expect(retryingEntries.length).toBe(1);
    expect((retryingEntries[0].payload as any).attempt).toBe(1);

    // Verify ledger hash chain integrity is preserved
    const verifyResult = await res.ledger.verify();
    expect(verifyResult.valid).toBe(true);
  });

  it("fails task after exhausting maxRetriesPerStep", async () => {
    const bridge: SandboxBridge = {
      requestRun: async (): Promise<SandboxRunResult> => ({
        stdout: "",
        stderr: "Persistent failure",
        ok: false,
      }),
    };

    const replanStepMock = vi.fn(async (step: PlannedStep) => step);
    const planner: Planner = {
      plan: async (): Promise<Plan> => ({
        summary: "خطة مستمرة بالفشل",
        steps: [
          {
            tool: "python_run",
            title: "فشل دائم",
            args: { code: "fail" },
          },
        ],
      }),
      replanStep: replanStepMock,
    };

    const events: AgentEvent[] = [];
    const orch = new Orchestrator({ planner, bridge, maxRetriesPerStep: 2 });
    const res = await orch.runTask("react-task-2", "فشل دائم", (e) => events.push(e));

    expect(replanStepMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe("FAILED");

    const retryingEntries = res.ledger.export().filter((e) => e.type === "step_retrying");
    expect(retryingEntries.length).toBe(2);

    const verifyResult = await res.ledger.verify();
    expect(verifyResult.valid).toBe(true);
  });
});

describe("ReAct retry security", () => {
  it("denies a corrected step that escapes the workspace before executing it", async () => {
    const bridge: SandboxBridge = { requestRun: vi.fn().mockResolvedValue({ ok: false, stdout: "", stderr: "broken" }) };
    const planner: Planner = {
      plan: async () => ({ summary: "test", steps: [{ tool: "python_run", title: "test", args: { code: "broken" } }] }),
      replanStep: async () => ({ tool: "write", title: "escape", args: { path: "../escape.txt", content: "bad" } }),
    };
    const events: AgentEvent[] = [];
    const res = await new Orchestrator({ bridge, planner, maxRetriesPerStep: 2 })
      .runTask("unsafe", "test", e => events.push(e));
    expect(res.status).toBe("DENIED");
    expect(bridge.requestRun).toHaveBeenCalledTimes(1);
    expect(res.workspace.list()).toEqual([]);
    expect((await res.ledger.verify()).valid).toBe(true);
  });

  it("syncs the current workspace into every sandbox request", async () => {
    const bridge: SandboxBridge = { requestRun: vi.fn().mockResolvedValue({ ok: true, stdout: "ok", stderr: "" }) };
    const planner: Planner = {
      plan: async () => ({ summary: "test", steps: [
        { tool: "write", title: "file", args: { path: "pkg/module.py", content: "value = 1" } },
        { tool: "python_run", title: "run", args: { code: "from pkg import module" } },
      ] }),
    };
    const res = await new Orchestrator({ planner, bridge }).runTask("files", "test", () => {});
    expect(res.status).toBe("VERIFIED");
    expect(bridge.requestRun).toHaveBeenCalledWith("files", "from pkg import module", { "pkg/module.py": "value = 1" });
  });

  it("does not treat a successful tool claim with failing independent evidence as VERIFIED", async () => {
    const bridge: SandboxBridge = { requestRun: async () => ({ ok: true, stdout: "ok", stderr: "" }) };
    const planner: Planner = {
      plan: async () => ({ summary: "test", steps: [{ tool: "write", title: "empty", args: { path: "empty.txt", content: "" } }] }),
    };
    const res = await new Orchestrator({ planner, bridge }).runTask("empty", "test", () => {});
    expect(res.status).toBe("FAILED");
  });
});
