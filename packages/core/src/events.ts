/**
 * cela2027 — core data models
 * Ported philosophy from agi-system:
 * "لا ادعاءات بدون أدلة" — no status becomes VERIFIED without independent evidence.
 */

export type TaskStatus =
  | "PLANNING"
  | "RUNNING"
  | "AWAITING_SANDBOX"
  | "VERIFIED"
  | "FAILED"
  | "DENIED";

export type StepStatus =
  | "PROPOSED"
  | "AUTHORIZED"
  | "EXECUTING"
  | "VERIFIED"
  | "DENIED"
  | "FAILED";

export interface PlannedStep {
  /** tool name, e.g. "write" | "edit" | "python_run" | "scaffold_project" | "read" | "ls" */
  tool: string;
  args: Record<string, unknown>;
  /** Human-readable (Arabic-friendly) title shown in the UI timeline */
  title: string;
}

export interface Plan {
  /** Short summary of the approach shown to the user */
  summary: string;
  steps: PlannedStep[];
}

export interface Evidence {
  /** machine-checkable claims verified independently */
  checks: Record<string, boolean | number | string>;
  /** short human description of what was verified */
  detail: string;
  at: string;
}

export interface DecisionRecord {
  seq: number;
  at: string;
  taskId: string;
  stepId: string;
  tool: string;
  policyDecision: "ALLOWED" | "DENIED";
  risk: "low" | "medium" | "high";
  status: StepStatus;
  evidence: Evidence[];
  error?: string;
}

export interface Task {
  id: string;
  goal: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  path: string;
  content: string;
  size: number;
}

/** Events streamed to the UI over SSE */
export type AgentEvent =
  | { type: "task_started"; taskId: string; goal: string }
  | { type: "task_status"; taskId: string; status: TaskStatus }
  | { type: "plan_created"; taskId: string; plan: Plan }
  | { type: "step_started"; taskId: string; stepId: string; title: string; tool: string }
  | { type: "step_finished"; taskId: string; stepId: string; status: StepStatus; evidence?: Evidence[]; error?: string }
  | { type: "sandbox_request"; taskId: string; runId: string; code: string; files?: Record<string, string | { base64: string }> }
  | { type: "artifact"; taskId: string; path: string; content: string; size: number }
  | { type: "agent_message"; taskId: string; content: string }
  | { type: "task_finished"; taskId: string; status: TaskStatus; summary: string };

export type AgentEventListener = (event: AgentEvent) => void;
