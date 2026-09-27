import { Ledger, type LedgerEntry } from "./ledger";
import { Workspace } from "./workspace";
import type { TaskStatus } from "./events";

/** Data-only checkpoint. No live listeners, sandbox resolvers, or executable closures. */
export interface TaskCheckpoint {
  version: 1;
  id: string;
  goal: string;
  status: TaskStatus;
  currentStepIndex: number;
  workspace: Record<string, string | { base64: string }>;
  ledger: LedgerEntry[];
  lastLedgerHash: string;
}

const MAX_FILES = 1000;
const MAX_BYTES = 5_000_000;

export async function captureCheckpoint(
  id: string, goal: string, status: TaskStatus, currentStepIndex: number,
  workspace: Workspace, ledger: Ledger
): Promise<TaskCheckpoint> {
  if ((await ledger.verify()).valid !== true) throw new Error("Invalid ledger chain");
  if (!Number.isSafeInteger(currentStepIndex) || currentStepIndex < 0) throw new Error("Invalid step index");
  if (workspace.list().length > MAX_FILES || workspace.totalBytes() > MAX_BYTES) throw new Error("Checkpoint workspace exceeds limits");
  const entries = structuredClone(ledger.export());
  return {
    version: 1, id, goal, status, currentStepIndex,
    workspace: workspace.sandboxSnapshot(), ledger: entries,
    lastLedgerHash: entries.at(-1)?.hash ?? "GENESIS",
  };
}

export async function restoreCheckpoint(data: TaskCheckpoint): Promise<{
  workspace: Workspace; ledger: Ledger; currentStepIndex: number;
}> {
  if (!data || data.version !== 1 || typeof data.id !== "string" || !data.id ||
      typeof data.goal !== "string" || !Number.isSafeInteger(data.currentStepIndex) ||
      data.currentStepIndex < 0 || !data.workspace || typeof data.workspace !== "object" ||
      Array.isArray(data.workspace) || !Array.isArray(data.ledger)) {
    throw new Error("Invalid task checkpoint");
  }
  const entries = structuredClone(data.ledger);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]?.seq !== i) throw new Error("Checkpoint ledger has missing or reordered events");
  }
  const ledger = Ledger.from(entries);
  if (!(await ledger.verify()).valid || data.lastLedgerHash !== (entries.at(-1)?.hash ?? "GENESIS")) {
    throw new Error("Checkpoint ledger hash mismatch");
  }
  const workspace = new Workspace();
  const files = Object.entries(data.workspace);
  if (files.length > MAX_FILES) throw new Error("Checkpoint contains too many files");
  const seen = new Set<string>();
  for (const [path, value] of files) {
    // Check canonical paths, not only containment, so aliasing cannot overwrite earlier entries.
    const resolved = workspace.resolve(path);
    if (resolved !== path || seen.has(resolved)) throw new Error(`Invalid checkpoint path: ${path}`);
    seen.add(resolved);
    if (typeof value === "string") {
      workspace.write(path, value);
    } else if (value && typeof value === "object" && !Array.isArray(value) &&
               Object.keys(value).length === 1 && typeof value.base64 === "string" &&
               /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) {
      const bytes = Buffer.from(value.base64, "base64");
      if (bytes.toString("base64") !== value.base64) throw new Error(`Invalid base64 for ${path}`);
      workspace.writeBinary(path, bytes);
    } else {
      throw new Error(`Invalid checkpoint file: ${path}`);
    }
    if (workspace.totalBytes() > MAX_BYTES) throw new Error("Checkpoint workspace exceeds limits");
  }
  return { workspace, ledger, currentStepIndex: data.currentStepIndex };
}
