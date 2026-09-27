/**
 * Server-side agent runtime (Node) — task registry, SSE event bus,
 * and the SandboxBridge that hands python_run steps to the user's
 * browser (Pyodide worker) and awaits the result.
 *
 * Every buffered event carries a monotonic `seq` so the frontend can
 * resume via polling (GET /api/task/:id/events?after=seq) when SSE is
 * cut off by serverless duration limits (Phase 2 of the roadmap).
 *
 * Durable history: when Supabase env vars are set, task records are
 * written through to Supabase (SupabaseStore) — free tier, no card.
 */

import { randomUUID } from "node:crypto";
import {
  Orchestrator,
  type AgentEvent,
  type SandboxRunResult,
  type Workspace,
  type Ledger,
} from "@cela/core";
import { SupabaseStore, type Store } from "@cela/store";

export interface BufferedEvent {
  seq: number;
  e: AgentEvent;
}

interface TaskRuntime {
  id: string;
  goal: string;
  status: string;
  buffer: BufferedEvent[];
  nextSeq: number;
  listeners: Set<(e: AgentEvent) => void>;
  workspace?: Workspace;
  ledger?: Ledger;
  summary?: string;
}

const g = globalThis as unknown as { __celaRuntime?: Runtime; __celaStore?: Store };

function getStore(): Store | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  if (!g.__celaStore) g.__celaStore = new SupabaseStore(url, key);
  return g.__celaStore;
}

class Runtime {
  tasks = new Map<string, TaskRuntime>();
  /** runId → resolver */
  pendingSandbox = new Map<string, (r: SandboxRunResult) => void>();
  store?: Store;

  constructor() {
    this.store = getStore();
  }

  emit(taskId: string, e: AgentEvent) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    if (e.type === "artifact") {
      // keep only the latest version of each file in the replay buffer
      const idx = t.buffer.findIndex(
        (x) => x.e.type === "artifact" && x.e.path === e.path
      );
      if (idx >= 0) t.buffer.splice(idx, 1);
    }
    t.buffer.push({ seq: t.nextSeq++, e });
    if (e.type === "task_status") t.status = e.status;
    if (e.type === "task_finished") t.summary = e.summary;
    for (const l of t.listeners) {
      try {
        l(e);
      } catch {
        /* listener died; ignore */
      }
    }
    // durable write-through (free-tier Supabase when configured)
    if (this.store) {
      try {
        if (e.type === "task_started") {
          void this.store.createTask({
            id: taskId,
            goal: t.goal,
            status: t.status,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        } else if (e.type === "task_finished") {
          void this.store.updateTask(taskId, { status: e.status, summary: e.summary });
        }
      } catch {
        /* persistence is best-effort */
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
    return (this.tasks.get(taskId)?.buffer ?? []).map((x) => x.e);
  }

  /** polling resume endpoint data: events after `after`, plus done flag */
  eventsAfter(taskId: string, after: number): { events: BufferedEvent[]; done: boolean } {
    const t = this.tasks.get(taskId);
    if (!t) return { events: [], done: true };
    const events = t.buffer.filter((x) => x.seq > after);
    const done = t.buffer.some((x) => x.e.type === "task_finished");
    return { events, done };
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
      buffer: [],
      nextSeq: 0,
      listeners: new Set(),
    };
    this.tasks.set(id, t);

    const bridge = {
      requestRun: async (taskId: string, code: string): Promise<SandboxRunResult> => {
        const runId = `${taskId}:${randomUUID().slice(0, 6)}`;
        this.emit(taskId, { type: "sandbox_request", taskId, runId, code });
        return new Promise<SandboxRunResult>((resolve) => {
          // store resolver under composite runId emitted above
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
