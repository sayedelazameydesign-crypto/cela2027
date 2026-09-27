/** Durable task event history; separate from the stable six-method Store contract. */
export interface JournalEntry<E = unknown> {
  seq: number;
  e: E;
}

export interface EventJournal<E = unknown> {
  append(taskId: string, entry: JournalEntry<E>): Promise<void>;
  after(taskId: string, after: number): Promise<JournalEntry<E>[]>;
  files(taskId: string): Promise<Record<string, string>>;
}

function filesFrom<E>(entries: JournalEntry<E>[]): Record<string, string> {
  const files: Record<string, string> = Object.create(null);
  for (const { e } of entries) {
    if (e && typeof e === "object" && "type" in e && e.type === "artifact" &&
        "path" in e && typeof e.path === "string" &&
        "content" in e && typeof e.content === "string") {
      // Avoid prototype pollution from untrusted artifact paths.
      Object.defineProperty(files, e.path, { value: e.content, enumerable: true, configurable: true, writable: true });
    }
  }
  return { ...files };
}

export class MemoryEventJournal<E = unknown> implements EventJournal<E> {
  private entries = new Map<string, JournalEntry<E>[]>();

  async append(taskId: string, entry: JournalEntry<E>): Promise<void> {
    const list = this.entries.get(taskId) ?? [];
    if (!Number.isSafeInteger(entry.seq) || entry.seq !== list.length) {
      throw new Error(`Non-contiguous journal sequence for ${taskId}: ${entry.seq}`);
    }
    list.push(structuredClone(entry));
    this.entries.set(taskId, list);
  }

  async after(taskId: string, after: number): Promise<JournalEntry<E>[]> {
    return structuredClone((this.entries.get(taskId) ?? []).filter((entry) => entry.seq > after));
  }

  async files(taskId: string): Promise<Record<string, string>> {
    return filesFrom(await this.after(taskId, -1));
  }
}

/** Supabase REST adapter: composite (task_id, seq) primary key, no upsert. */
export class SupabaseEventJournal<E = unknown> implements EventJournal<E> {
  constructor(private url: string, private serviceKey: string) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Event journal request failed: HTTP ${response.status}`);
    return response;
  }

  async append(taskId: string, entry: JournalEntry<E>): Promise<void> {
    await this.request("task_events", {
      method: "POST",
      body: JSON.stringify({ task_id: taskId, seq: entry.seq, event: entry.e }),
    });
  }

  async after(taskId: string, after: number): Promise<JournalEntry<E>[]> {
    const params = new URLSearchParams({
      task_id: `eq.${taskId}`,
      seq: `gt.${after}`,
      order: "seq.asc",
      select: "seq,event",
    });
    const response = await this.request(`task_events?${params}`);
    const rows = await response.json() as { seq: number; event: E }[];
    return rows.map((row) => ({ seq: row.seq, e: row.event }));
  }

  async files(taskId: string): Promise<Record<string, string>> {
    return filesFrom(await this.after(taskId, -1));
  }
}
