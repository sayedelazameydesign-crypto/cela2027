import { describe, expect, expectTypeOf, it } from "vitest";
import * as core from "./src/index";
import type { AgentEvent, Planner, SandboxBridge, TaskStatus } from "./src/index";
import { PolicyEngine } from "./src/policy";
import { buildDefaultTools } from "./src/tools-impl";
import { Workspace } from "./src/workspace";
import { TOOL_MANIFEST } from "@cela/tools";

describe("@cela/core public compatibility surface", () => {
  it("continues to export the stable extension points", () => {
    expect(core.Orchestrator).toBeTypeOf("function");
    expect(core.PolicyEngine).toBeTypeOf("function");
    expect(core.Workspace).toBeTypeOf("function");
    expect(core.Ledger).toBeTypeOf("function");
    expect(core.createDefaultPlanner).toBeTypeOf("function");
    expect(core.executeStep).toBeTypeOf("function");
    expect(core.verifyStep).toBeTypeOf("function");
  });

  it("keeps provider and sandbox adapters structurally injectable", () => {
    expectTypeOf<Planner>().toHaveProperty("plan");
    expectTypeOf<SandboxBridge>().toHaveProperty("requestRun");
  });

  it("keeps the established task and event contracts assignable", () => {
    const status: TaskStatus = "VERIFIED";
    const event: AgentEvent = {
      type: "task_finished",
      taskId: "contract-task",
      status,
      summary: "verified",
    };

    expect(event.type).toBe("task_finished");
    expect(event.status).toBe("VERIFIED");
  });
});

describe("tool boundary compatibility", () => {
  it("keeps every documented tool accepted by the default policy", () => {
    const policy = new PolicyEngine();
    const steps = TOOL_MANIFEST.map((tool) => ({
      tool: tool.name,
      args: {},
      title: tool.name,
    }));

    expect(policy.checkPlan(steps)).toEqual({ allowed: true, reason: "ok", risk: "low" });
  });

  it("keeps a concrete implementation for each non-sandbox tool", () => {
    const tools = buildDefaultTools(new Workspace());
    const localTools = TOOL_MANIFEST.filter((tool) => !("sandbox" in tool && tool.sandbox));

    for (const tool of localTools) {
      expect(tools.has(tool.name), `missing implementation for ${tool.name}`).toBe(true);
    }
  });
});
