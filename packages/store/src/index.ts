export * from "./journal";

/**
 * Persistence layer.
 * Default: MemoryStore (zero config — runs anywhere, incl. Vercel per-instance).
 * Supabase is wired in apps/web when NEXT_PUBLIC_SUPABASE_URL is set
 * (free tier, no credit card). The interface below is the only contract
 * the API layer depends on, so backends are swappable.
 */

export interface TaskRecord {
  id: string;
  goal: string;
  status: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  taskId: string;
  role: "user" | "agent";
  content: string;
  at: string;
}

export interface Store {
  createTask(task: TaskRecord): Promise<void>;
  updateTask(id: string, patch: Partial<TaskRecord>): Promise<void>;
  getTask(id: string): Promise<TaskRecord | undefined>;
  listTasks(): Promise<TaskRecord[]>;
  addMessage(msg: MessageRecord): Promise<void>;
  listMessages(taskId: string): Promise<MessageRecord[]>;
}

export class MemoryStore implements Store {
  private tasks = new Map<string, TaskRecord>();
  private messages: MessageRecord[] = [];

  async createTask(task: TaskRecord): Promise<void> {
    this.tasks.set(task.id, { ...task });
  }
  async updateTask(id: string, patch: Partial<TaskRecord>): Promise<void> {
    const t = this.tasks.get(id);
    if (t) Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  }
  async getTask(id: string): Promise<TaskRecord | undefined> {
    return this.tasks.get(id) ? { ...this.tasks.get(id)! } : undefined;
  }
  async listTasks(): Promise<TaskRecord[]> {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async addMessage(msg: MessageRecord): Promise<void> {
    this.messages.push({ ...msg });
  }
  async listMessages(taskId: string): Promise<MessageRecord[]> {
    return this.messages.filter((m) => m.taskId === taskId);
  }
}

/**
 * SupabaseStore — durable persistence on the FREE tier (no credit card).
 * Uses the plain REST API (PostgREST) — zero SDK dependency.
 * Activated automatically by agent-runtime when NEXT_PUBLIC_SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY are set. Table setup SQL:
 *
 *   create table if not exists tasks (
 *     id text primary key,
 *     goal text not null,
 *     status text not null default 'PLANNING',
 *     summary text,
 *     created_at timestamptz not null default now(),
 *     updated_at timestamptz not null default now()
 *   );
 *   create table if not exists messages (
 *     id text primary key default gen_random_uuid()::text,
 *     task_id text not null references tasks(id),
 *     role text not null,
 *     content text not null,
 *     at timestamptz not null default now()
 *   );
 */
export class SupabaseStore implements Store {
  constructor(private url: string, private serviceKey: string) {}

  private async rpc(
    path: string,
    init: { method: string; body?: unknown; prefer?: string } = { method: "GET" }
  ): Promise<Response> {
    const headers: Record<string, string> = {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      "Content-Type": "application/json",
    };
    if (init.prefer) headers.Prefer = init.prefer;
    return fetch(`${this.url}/rest/v1/${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  }

  async createTask(task: TaskRecord): Promise<void> {
    const res = await this.rpc("tasks", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: {
        id: task.id,
        goal: task.goal,
        status: task.status,
        summary: task.summary ?? null,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      },
    });
    if (!res.ok) throw new Error(`SupabaseStore.createTask: ${res.status}`);
  }

  async updateTask(id: string, patch: Partial<TaskRecord>): Promise<void> {
    const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.summary !== undefined) body.summary = patch.summary;
    const res = await this.rpc(`tasks?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    });
    if (!res.ok) throw new Error(`SupabaseStore.updateTask: ${res.status}`);
  }

  async getTask(id: string): Promise<TaskRecord | undefined> {
    const res = await this.rpc(`tasks?id=eq.${encodeURIComponent(id)}`);
    if (!res.ok) return undefined;
    const rows = (await res.json()) as any[];
    if (!rows.length) return undefined;
    const r = rows[0];
    return {
      id: r.id,
      goal: r.goal,
      status: r.status,
      summary: r.summary ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async listTasks(): Promise<TaskRecord[]> {
    const res = await this.rpc("tasks?order=created_at.desc");
    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    return rows.map((r) => ({
      id: r.id,
      goal: r.goal,
      status: r.status,
      summary: r.summary ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async addMessage(msg: MessageRecord): Promise<void> {
    const res = await this.rpc("messages", {
      method: "POST",
      body: { task_id: msg.taskId, role: msg.role, content: msg.content, at: msg.at },
    });
    if (!res.ok) throw new Error(`SupabaseStore.addMessage: ${res.status}`);
  }

  async listMessages(taskId: string): Promise<MessageRecord[]> {
    const res = await this.rpc(
      `messages?task_id=eq.${encodeURIComponent(taskId)}&order=at.asc`
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      role: r.role,
      content: r.content,
      at: r.at,
    }));
  }
}
