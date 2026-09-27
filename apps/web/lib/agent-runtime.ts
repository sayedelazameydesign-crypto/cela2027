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
  captureCheckpoint,
  restoreCheckpoint,
  type TaskCheckpoint,
} from "@cela/core";
import {
  SupabaseStore, SupabaseEventJournal, SupabaseSnapshotStore,
  type EventJournal, type Store, type SnapshotStore,
} from "@cela/store";

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

const g = globalThis as unknown as { __celaRuntime?: Runtime; __celaStore?: Store; __celaJournal?: EventJournal<AgentEvent>; __celaSnapshots?: SnapshotStore };

function getStore(): Store | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  if (!g.__celaStore) g.__celaStore = new SupabaseStore(url, key);
  return g.__celaStore;
}

function getJournal(): EventJournal<AgentEvent> | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  if (!g.__celaJournal) g.__celaJournal = new SupabaseEventJournal<AgentEvent>(url, key);
  return g.__celaJournal;
}

function getSnapshots(): SnapshotStore | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  if (!g.__celaSnapshots) g.__celaSnapshots = new SupabaseSnapshotStore(url, key);
  return g.__celaSnapshots;
}

export class Runtime {
  tasks = new Map<string, TaskRuntime>();
  /** runId → resolver */
  pendingSandbox = new Map<string, (r: SandboxRunResult) => void>();
  store?: Store;
  journal?: EventJournal<AgentEvent>;
  snapshots?: SnapshotStore;
  private writes = new Map<string, Promise<void>>();

  constructor(options: { store?: Store; journal?: EventJournal<AgentEvent>; snapshots?: SnapshotStore } = {}) {
    this.store = options.store ?? getStore();
    this.journal = options.journal ?? getJournal();
    this.snapshots = options.snapshots ?? getSnapshots();
  }

  /** Inspection-only restoration: does not resume execution or sandbox resolvers. */
  async loadCheckpoint(taskId: string): Promise<Awaited<ReturnType<typeof restoreCheckpoint>> | undefined> {
    const snapshot = await this.snapshots?.loadSnapshot(taskId);
    return snapshot ? restoreCheckpoint(snapshot as TaskCheckpoint) : undefined;
  }

  /** Wait until the local event queue has flushed (also used by polling/SSE replay). */
  async flush(taskId: string): Promise<void> {
    await this.writes.get(taskId);
  }

  emit(taskId: string, e: AgentEvent) {
    const t = this.tasks.get(taskId);
    if (!t) return;
    const entry = { seq: t.nextSeq++, e };
    t.buffer.push(entry);
    if (this.journal) {
      // Serialize writes per task; a slow network must not reorder the monotonic cursor.
      const previous = this.writes.get(taskId) ?? Promise.resolve();
      const next = previous.then(() => this.journal!.append(taskId, entry));
      this.writes.set(taskId, next);
      // Prevent unhandled rejections; flush() still observes and propagates the failure.
      void next.catch(() => {});
    }
    if (e.type === "task_status") t.status = e.status;
    if (e.type === "task_finished") t.summary = e.summary;
    for (const l of t.listeners) {
      try {
        l(e);
      } catch {
        /* listener died; ignore */
      }
    }
    if (this.store && e.type === "task_finished") {
      const previous = this.writes.get(taskId) ?? Promise.resolve();
      const next = previous.then(() => this.store!.updateTask(taskId, { status: e.status, summary: e.summary }));
      this.writes.set(taskId, next);
      void next.catch(() => {});
    }
  }

  subscribe(taskId: string, fn: (e: AgentEvent) => void): () => void {
    const t = this.tasks.get(taskId);
    if (!t) return () => {};
    t.listeners.add(fn);
    return () => t.listeners.delete(fn);
  }

  async replay(taskId: string): Promise<AgentEvent[]> {
    const { events } = await this.eventsAfter(taskId, -1);
    return events.map((x) => x.e);
  }

  /** polling resume endpoint data: events after `after`, plus done flag */
  async eventsAfter(taskId: string, after: number): Promise<{ events: BufferedEvent[]; done: boolean }> {
    const t = this.tasks.get(taskId);
    if (t) await this.flush(taskId);
    const events = this.journal
      ? await this.journal.after(taskId, after) as BufferedEvent[]
      : (t?.buffer ?? []).filter((x) => x.seq > after);
    // A different instance can observe completion through durable task status.
    const record = this.store ? await this.store.getTask(taskId) : undefined;
    const done = (t?.buffer.some((x) => x.e.type === "task_finished") ?? false) ||
      events.some((x) => x.e.type === "task_finished") ||
      (record ? ["VERIFIED", "FAILED", "DENIED"].includes(record.status) : !t && events.length === 0);
    return { events, done };
  }

  async workspaceFiles(taskId: string): Promise<Record<string, string>> {
    const t = this.tasks.get(taskId);
    if (t) await this.flush(taskId);
    if (this.journal) return this.journal.files(taskId);
    return t?.workspace?.snapshot() ?? {};
  }

  /** create a task and run the orchestrator in the background */
  async startTask(goal: string): Promise<string> {
    const id = randomUUID().slice(0, 8);
    const t: TaskRuntime = {
      id,
      goal,
      status: "PLANNING",
      buffer: [],
      nextSeq: 0,
      listeners: new Set(),
    };
    // Write the task record before returning the id or launching background execution.
    // Fail closed if durable storage is configured but unavailable.
    if (this.store) {
      const now = new Date().toISOString();
      await this.store.createTask({ id, goal, status: "PLANNING", createdAt: now, updatedAt: now });
    }
    this.tasks.set(id, t);

    const bridge = {
      requestRun: async (taskId: string, code: string, files?: Record<string, string | { base64: string }>): Promise<SandboxRunResult> => {
        const runId = `${taskId}:${randomUUID().slice(0, 6)}`;
        this.emit(taskId, { type: "sandbox_request", taskId, runId, code, files });
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
    void orch.runTask(id, goal, (e) => this.emit(id, e))
      .then(async (res) => {
        await this.flush(id);
        const t2 = this.tasks.get(id);
        if (t2) {
          t2.workspace = res.workspace;
          t2.ledger = res.ledger;
        }
        if (this.snapshots) {
          try {
            const completedSteps = res.ledger.export().filter((entry) => entry.type === "step_finished").length;
            const snapshot = await captureCheckpoint(id, goal, res.status, completedSteps, res.workspace, res.ledger);
            await this.snapshots.saveSnapshot(snapshot);
          } catch (error) {
            // The task has already emitted a terminal event. Do not rewrite its verified
            // status on snapshot failure; callers loading the snapshot will see the error.
            console.error("Failed to persist task checkpoint", id, error);
          }
        }
      }).catch(async (error: unknown) => {
        const t2 = this.tasks.get(id);
        if (t2) {
          t2.status = "FAILED";
          t2.summary = `تعذر تنفيذ المهمة: ${String(error)}`;
        }
        if (this.store) {
          await this.store.updateTask(id, { status: "FAILED", summary: t2?.summary }).catch(() => {});
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
