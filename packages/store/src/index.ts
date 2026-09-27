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
