/**
 * Server-side agent runtime (Node) — task registry, SSE event bus,
 * and the SandboxBridge that hands python_run steps to the user's
 * browser (Pyodide worker) and awaits the result.
 *
 * NOTE: in-memory by design for v1 (works locally and per Vercel instance).
 * Durable history is a Supabase concern (see @cela/store) — the Store
 * interface is the swap point.
 */

import { randomUUID } from "node:crypto";
import {
  Orchestrator,
  type AgentEvent,
  type SandboxRunResult,
  type Workspace,
  type Ledger,
} from "@cela/core";

interface TaskRuntime {
  id: string;
  goal: string;
  status: string;
  events: AgentEvent[];
  listeners: Set<(e: AgentEvent) => void>;
  workspace?: Workspace;
  ledger?: Ledger;
  summary?: string;
}

const g = globalThis as unknown as { __celaRuntime?: Runtime };

class Runtime {
  tasks = new Map<string, TaskRuntime>();
  /** runId → resolver */
  pendingSandbox = new Map<string, (r: SandboxRunResult) => void>();

  emit(taskId: string, e: AgentEvent) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    if (e.type === "artifact") {
      // keep only the latest version of each file in the replay buffer
      const idx = t.events.findIndex(
        (x) => x.type === "artifact" && x.path === e.path
      );
      if (idx >= 0) t.events.splice(idx, 1);
    }
    t.events.push(e);
    if (e.type === "task_status") t.status = e.status;
    if (e.type === "task_finished") t.summary = e.summary;
    for (const l of t.listeners) {
      try {
        l(e);
      } catch {
        /* listener died; ignore */
      }
    }
  }

  subscribe(taskId: string, fn: (e: AgentEvent) => void): () => void {
    const t = this.tasks.get(taskId);
    if (!t) return () => {};
    t.listeners.add(fn);
    return () => t.listeners.delete(fn);
  }

  replay(taskId: string): AgentEvent[] {
    return this.tasks.get(taskId)?.events ?? [];
  }

  workspaceFiles(taskId: string): Record<string, string> {
    return this.tasks.get(taskId)?.workspace?.snapshot() ?? {};
  }

  /** create a task and run the orchestrator in the background */
  startTask(goal: string): string {
    const id = randomUUID().slice(0, 8);
    const t: TaskRuntime = {
      id,
      goal,
      status: "PLANNING",
      events: [],
      listeners: new Set(),
    };
    this.tasks.set(id, t);

    const bridge = {
      requestRun: async (taskId: string, code: string): Promise<SandboxRunResult> => {
        const runId = `${taskId}:${randomUUID().slice(0, 6)}`;
        this.emit(taskId, { type: "sandbox_request", taskId, runId, code });
        return new Promise<SandboxRunResult>((resolve) => {
          this.pendingSandbox.set(runId, resolve);
          // safety timeout — the browser may never answer
          setTimeout(() => {
            if (this.pendingSandbox.has(runId)) {
              this.pendingSandbox.delete(runId);
              resolve({
                runId,
                ok: false,
                stdout: "",
                stderr: "انتهت مهلة انتظار صندوق Python (المتصفح لم يرد خلال 60 ثانية)",
              });
            }
          }, 60_000);
        });
      },
    };

    const orch = new Orchestrator({ bridge });
    void orch
      .runTask(id, goal, (e) => this.emit(id, e))
      .then((res) => {
        const t2 = this.tasks.get(id);
        if (t2) {
          t2.workspace = res.workspace;
          t2.ledger = res.ledger;
        }
      });
    return id;
  }

  /** browser worker finished a python_run */
  resolveSandbox(runId: string, result: Omit<SandboxRunResult, "runId">): boolean {
    const resolve = this.pendingSandbox.get(runId);
    if (!resolve) return false;
    this.pendingSandbox.delete(runId);
    resolve({ runId, ...result });
    return true;
  }
}

export function runtime(): Runtime {
  if (!g.__celaRuntime) g.__celaRuntime = new Runtime();
  return g.__celaRuntime;
}
