import type { SnapshotStore, TaskSnapshot } from "./types";

export class MemorySnapshotStore implements SnapshotStore {
  private snapshots = new Map<string, TaskSnapshot>();

  async saveSnapshot(snapshot: TaskSnapshot): Promise<void> {
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
  }

  async loadSnapshot(taskId: string): Promise<TaskSnapshot | undefined> {
    const snapshot = this.snapshots.get(taskId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }
}

/** REST adapter using the existing service role, without a new SDK or reverse dependency on Core. */
/** Bound inline payload size; large artifacts need a separate object-storage/chunk adapter. */
const MAX_INLINE_JSON_BYTES = 512_000;

export class SupabaseSnapshotStore implements SnapshotStore {
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
    if (!response.ok) throw new Error(`Snapshot store request failed: HTTP ${response.status}`);
    return response;
  }

  async saveSnapshot(snapshot: TaskSnapshot): Promise<void> {
    const body = JSON.stringify({ task_id: snapshot.id, snapshot });
    if (new TextEncoder().encode(body).length > MAX_INLINE_JSON_BYTES) {
      throw new Error("Snapshot exceeds inline storage limit; external blob storage required");
    }
    await this.request("task_snapshots", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body,
    });
  }

  async loadSnapshot(taskId: string): Promise<TaskSnapshot | undefined> {
    const params = new URLSearchParams({ task_id: `eq.${taskId}`, select: "snapshot" });
    const response = await this.request(`task_snapshots?${params}`);
    const rows = await response.json() as { snapshot: TaskSnapshot }[];
    return rows[0]?.snapshot;
  }
}
