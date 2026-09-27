/** Wire format matches Core's TaskCheckpoint without importing Core into the leaf Store package. */
export interface TaskSnapshot {
  version: 1;
  id: string;
  goal: string;
  status: "PLANNING" | "RUNNING" | "AWAITING_SANDBOX" | "VERIFIED" | "FAILED" | "DENIED";
  currentStepIndex: number;
  workspace: Record<string, string | { base64: string }>;
  ledger: Array<{ seq: number; at: string; type: string; payload: unknown; prev: string; hash: string }>;
  lastLedgerHash: string;
}

export interface SnapshotStore {
  saveSnapshot(snapshot: TaskSnapshot): Promise<void>;
  loadSnapshot(taskId: string): Promise<TaskSnapshot | undefined>;
}
