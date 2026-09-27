/**
 * Policy engine — fail-closed: anything not explicitly allowed is denied.
 * (Ported from agi-system policy.py: allowlist + containment + risk model.)
 */

import type { PlannedStep } from "./events";
import { PathEscapeError, Workspace } from "./workspace";

export type Risk = "low" | "medium" | "high";

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  risk: Risk;
}

/** Tools that never mutate state */
const READ_ONLY_TOOLS = new Set(["read", "ls"]);

/** Risk weight per tool */
const TOOL_RISK: Record<string, Risk> = {
  read: "low",
  ls: "low",
  write: "medium",
  edit: "medium",
  patch: "medium",
  scaffold_project: "medium",
  delete_file: "high",
  python_run: "medium",
};

export interface PolicyOptions {
  /** allowed tool names; empty set denies everything */
  allowedTools?: string[];
  /** refuse plans longer than this */
  maxSteps?: number;
  /** refuse workspaces growing beyond this many bytes */
  maxWorkspaceBytes?: number;
  /** refuse single writes beyond this many bytes */
  maxFileBytes?: number;
}

export class PolicyEngine {
  private allowed: Set<string>;
  private maxSteps: number;
  private maxWorkspaceBytes: number;
  private maxFileBytes: number;

  constructor(opts: PolicyOptions = {}) {
    this.allowed = new Set(
      opts.allowedTools ?? [
        "read", "ls", "write", "edit", "patch", "scaffold_project", "python_run",
      ]
    );
    this.maxSteps = opts.maxSteps ?? 40;
    this.maxWorkspaceBytes = opts.maxWorkspaceBytes ?? 5_000_000;
    this.maxFileBytes = opts.maxFileBytes ?? 500_000;
  }

  /** paths referenced by a step's args */
  private pathsOf(step: PlannedStep): string[] {
    const out: string[] = [];
    const a = step.args ?? {};
    if (typeof a.path === "string") out.push(a.path);
    if (typeof a.dir === "string") out.push(a.dir);
    if (Array.isArray(a.files)) {
      for (const f of a.files) {
        if (f && typeof f === "object" && typeof (f as any).path === "string") {
          out.push((f as any).path);
        }
      }
    }
    if (step.tool === "scaffold_project" && typeof a.name === "string") {
      out.push(a.name);
    }
    return out;
  }

  evaluate(step: PlannedStep, ws: Workspace): PolicyDecision {
    if (!this.allowed.has(step.tool)) {
      return { allowed: false, reason: `Tool not in allowlist: ${step.tool}`, risk: "high" };
    }
    if (ws.totalBytes() + ws.list().length * 8 > this.maxWorkspaceBytes) {
      return { allowed: false, reason: "Workspace quota exceeded", risk: "high" };
    }
    // path containment — dry-run resolve every referenced path
    for (const p of this.pathsOf(step)) {
      try {
        ws.resolve(p);
      } catch (e) {
        if (e instanceof PathEscapeError) {
          return { allowed: false, reason: e.message, risk: "high" };
        }
        return { allowed: false, reason: `Invalid path: ${p}`, risk: "medium" };
      }
    }
    // file size caps
    if (typeof step.args.content === "string" && step.args.content.length > this.maxFileBytes) {
      return { allowed: false, reason: `File exceeds ${this.maxFileBytes} bytes`, risk: "medium" };
    }
    if (step.tool === "scaffold_project" && Array.isArray(step.args.files)) {
      const total = (step.args.files as any[]).reduce(
        (n, f) => n + (typeof f?.content === "string" ? f.content.length : 0), 0
      );
      if (total > this.maxWorkspaceBytes) {
        return { allowed: false, reason: "Scaffold exceeds workspace quota", risk: "medium" };
      }
    }
    const risk = TOOL_RISK[step.tool] ?? "medium";
    return { allowed: true, reason: "ok", risk };
  }

  checkPlan(steps: PlannedStep[]): PolicyDecision {
    if (!Array.isArray(steps) || steps.length === 0) {
      return { allowed: false, reason: "Empty plan", risk: "high" };
    }
    if (steps.length > this.maxSteps) {
      return { allowed: false, reason: `Plan too long: ${steps.length} > ${this.maxSteps}`, risk: "high" };
    }
    for (const s of steps) {
      if (typeof s.tool !== "string") {
        return { allowed: false, reason: "Step without tool", risk: "high" };
      }
      if (!this.allowed.has(s.tool)) {
        return { allowed: false, reason: `Tool not in allowlist: ${s.tool}`, risk: "high" };
      }
    }
    return { allowed: true, reason: "ok", risk: "low" };
  }
}
