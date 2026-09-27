import { describe, it, expect } from "vitest";
import { OfflinePlanner, parsePlan } from "./src/planner";
import { Orchestrator } from "./src/orchestrator";
import { PolicyEngine } from "./src/policy";
import type { AgentEvent, Plan } from "./src/events";
import type { SandboxBridge } from "./src/executor";

describe("OfflinePlanner", () => {
  it("produces a valid, policy-passing plan", async () => {
    const p = new OfflinePlanner();
    const plan = await p.plan("ابنِ لي تطبيق تجريبي");
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    const last = plan.steps[plan.steps.length - 1];
    expect(last.tool).toBe("python_run");
  });
});

describe("parsePlan", () => {
  it("parses fenced JSON", () => {
    const plan = parsePlan(
      'هذه هي خطتك:\n```json\n{"summary":"s","steps":[{"tool":"write","args":{"path":"a.txt","content":"hi"},"title":"كتابة"}]}\n```'
    );
    expect(plan.steps[0].tool).toBe("write");
    expect(plan.summary).toBe("s");
  });

  it("parses raw JSON with surrounding prose", () => {
    const plan = parsePlan('نص قبله {"summary":"س","steps":[{"tool":"ls","args":{},"title":"سرد"}]} نص بعده');
    expect(plan.steps[0].tool).toBe("ls");
  });

  it("throws on garbage", () => {
    expect(() => parsePlan("لا خطة هنا")).toThrow();
  });
});

const okBridge: SandboxBridge = {
  requestRun: async () => ({ stdout: "ALL TESTS PASSED", stderr: "", ok: true }),
};

const failBridge: SandboxBridge = {
  requestRun: async () => ({ stdout: "", stderr: "Traceback: boom", ok: false }),
};

async function collect(fn: (emit: (e: AgentEvent) => void) => Promise<unknown>) {
  const events: AgentEvent[] = [];
  await fn((e) => events.push(e));
  return events;
}

describe("Orchestrator (حلقة الوكيل)", () => {
  it("completes the offline plan as VERIFIED with evidence", async () => {
    const orch = new Orchestrator({ planner: new OfflinePlanner(), bridge: okBridge });
    let plan: Plan | undefined;
    const events = await collect((emit) =>
      orch.runTask("t1", "هدف تجريبي", (e) => {
        if (e.type === "plan_created") plan = e.plan;
        emit(e);
      })
    );

    expect(plan).toBeDefined();
    const finished = events.find((e) => e.type === "task_finished") as any;
    expect(finished.status).toBe("VERIFIED");

    const stepFinished = events.filter((e) => e.type === "step_finished") as any[];
    expect(stepFinished.length).toBeGreaterThanOrEqual(2);
    expect(stepFinished.every((s) => s.status === "VERIFIED")).toBe(true);
    expect(stepFinished[0].evidence.length).toBeGreaterThan(0);
  });

  it("fails the task when the sandbox run fails", async () => {
    const orch = new Orchestrator({ planner: new OfflinePlanner(), bridge: failBridge });
    const events = await collect((emit) => orch.runTask("t2", "هدف", emit));
    const finished = events.find((e) => e.type === "task_finished") as any;
    expect(finished.status).toBe("FAILED");
  });

  it("DENIES a plan with non-allowlisted tools", async () => {
    const policy = new PolicyEngine({ allowedTools: ["read"] });
    const planner = new OfflinePlanner();
    const orch = new Orchestrator({ planner, bridge: okBridge, policy });
    const events = await collect((emit) => orch.runTask("t3", "هدف", emit));
    const finished = events.find((e) => e.type === "task_finished") as any;
    expect(finished.status).toBe("DENIED");
  });

  it("emits artifacts for produced files", async () => {
    const orch = new Orchestrator({ planner: new OfflinePlanner(), bridge: okBridge });
    const events = await collect((emit) => orch.runTask("t4", "هدف", emit));
    const artifacts = events.filter((e) => e.type === "artifact") as any[];
    const paths = new Set(artifacts.map((a) => a.path));
    expect(paths.has("celia_app/math_tools.py")).toBe(true);
    expect(paths.has("celia_app/test_math_tools.py")).toBe(true);
  });
});
