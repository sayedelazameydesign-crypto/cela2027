/**
 * Orchestrator — the agent loop:
 *   Goal → Plan → Policy gate → Execute → Independent Verify → Evidence → Ledger
 * Every transition is emitted to the UI (SSE) and sealed in the ledger.
 */

import type {
  AgentEvent,
  AgentEventListener,
  DecisionRecord,
  Plan,
  StepStatus,
  TaskStatus,
} from "./events";
import { Ledger } from "./ledger";
import { PolicyEngine } from "./policy";
import { createDefaultPlanner, type Planner } from "./planner";
import { executeStep, type SandboxBridge } from "./executor";
import { verifyRun, verifyStep } from "./verifier";
import { Workspace } from "./workspace";
import { buildDefaultTools } from "./tools-impl";

export interface OrchestratorOptions {
  planner?: Planner;
  policy?: PolicyEngine;
  bridge: SandboxBridge;
}

export class Orchestrator {
  private planner: Planner;
  private policy: PolicyEngine;
  private bridge: SandboxBridge;

  constructor(opts: OrchestratorOptions) {
    this.planner = opts.planner ?? createDefaultPlanner();
    this.policy = opts.policy ?? new PolicyEngine();
    this.bridge = opts.bridge;
  }

  /** run a full task; returns the workspace snapshot on success */
  async runTask(
    taskId: string,
    goal: string,
    emit: AgentEventListener
  ): Promise<{ status: TaskStatus; summary: string; workspace: Workspace; ledger: Ledger }> {
    const ws = new Workspace();
    const ledger = new Ledger();
    const tools = buildDefaultTools(ws);

    const emitAndLog = async (event: AgentEvent) => {
      emit(event);
      await ledger.append(event.type, event);
    };

    await emitAndLog({ type: "task_started", taskId, goal });
    emit({ type: "task_status", taskId, status: "PLANNING" });

    // 1) Plan
    let plan: Plan;
    try {
      plan = await this.planner.plan(goal);
    } catch (e: any) {
      await emitAndLog({ type: "task_finished", taskId, status: "FAILED", summary: `فشل التخطيط: ${e?.message ?? e}` });
      return { status: "FAILED", summary: `فشل التخطيط: ${e?.message ?? e}`, workspace: ws, ledger };
    }
    emit({ type: "plan_created", taskId, plan });
    emit({ type: "agent_message", taskId, content: plan.summary });
    await ledger.append("plan_created", plan);

    // 2) Plan-level policy gate
    const planCheck = this.policy.checkPlan(plan.steps);
    if (!planCheck.allowed) {
      emit({ type: "task_status", taskId, status: "DENIED" });
      await emitAndLog({ type: "task_finished", taskId, status: "DENIED", summary: `رفض السياسة: ${planCheck.reason}` });
      return { status: "DENIED", summary: `رفض السياسة: ${planCheck.reason}`, workspace: ws, ledger };
    }

    emit({ type: "task_status", taskId, status: "RUNNING" });

    // 3) Execute steps with per-step policy + verification
    const records: { tool: string; status: StepStatus; evidence: DecisionRecord["evidence"] }[] = [];
    let failed: string | null = null;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepId = `s${i + 1}`;

      const decision = this.policy.evaluate(step, ws);
      if (!decision.allowed) {
        emit({ type: "step_started", taskId, stepId, title: step.title, tool: step.tool });
        emit({ type: "step_finished", taskId, stepId, status: "DENIED", error: decision.reason });
        await ledger.append("step_denied", { stepId, tool: step.tool, reason: decision.reason });
        records.push({ tool: step.tool, status: "DENIED", evidence: [] });
        failed = `السياسة رفضت الخطوة ${stepId}: ${decision.reason}`;
        break;
      }

      emit({ type: "step_started", taskId, stepId, title: step.title, tool: step.tool });
      await ledger.append("step_started", { stepId, tool: step.tool, title: step.title });

      let result;
      let sandbox;
      try {
        if (step.tool === "python_run") {
          const code = String(step.args.code ?? "");
          sandbox = await this.bridge.requestRun(taskId, code);
          result = {
            ok: sandbox.ok,
            output: sandbox.stdout || sandbox.stderr || "(بدون مخرجات)",
            data: { runId: sandbox.runId },
          };
        } else {
          result = await executeStep(step, tools, { taskId, bridge: this.bridge });
        }
      } catch (e: any) {
        result = { ok: false, output: String(e?.message ?? e) };
      }

      const evidence = verifyStep({ step, result, sandbox }, ws);
      const status: StepStatus = evidence.some((ev) => ev.checks.sandbox_ok === false) || !result.ok
        ? "FAILED"
        : "VERIFIED";

      emit({
        type: "step_finished",
        taskId,
        stepId,
        status,
        evidence,
        error: result.ok ? undefined : result.output,
      });
      await ledger.append("step_finished", { stepId, status, evidence });
      records.push({ tool: step.tool, status, evidence });

      // surface produced files as artifacts immediately
      for (const p of ws.list()) {
        emit({ type: "artifact", taskId, path: p, content: ws.read(p), size: ws.read(p).length });
      }

      if (status === "FAILED") {
        failed = `الخطوة ${stepId} (${step.tool}) فشلت: ${result.output.slice(0, 300)}`;
        break;
      }
    }

    // 4) Final verification
    const final = verifyRun(records);
    const status: TaskStatus = failed ? "FAILED" : final.verified ? "VERIFIED" : "FAILED";
    const summary = failed ?? final.reason;

    emit({ type: "task_status", taskId, status });
    await emitAndLog({ type: "task_finished", taskId, status, summary });

    return { status, summary, workspace: ws, ledger };
  }
}
