/**
 * Unified Sandbox interface.
 *
 * v1 backend: Pyodide (CPython compiled to WASM) running inside a Web Worker
 * in the user's browser — zero server cost, real isolation, no credit card.
 *
 * The server never runs user code. The API layer emits `sandbox_request`
 * events; the browser executes them in the worker and posts results back.
 *
 * Future backends (same interface, no core changes):
 *  - DockerSandbox (self-hosted container pool)
 *  - E2BSandbox (cloud microVM free tier)
 */

export interface SandboxExecution {
  runId: string;
  code: string;
}

export interface SandboxResult {
  runId: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  /** wall-clock ms, for the UI timeline */
  durationMs?: number;
}

/** timeout for a single python_run step (client side) */
export const SANDBOX_TIMEOUT_MS = 30_000;

/** guardrails applied before code ever reaches the worker */
export function validateSandboxCode(code: string): { allowed: boolean; reason?: string } {
  if (typeof code !== "string" || code.trim().length === 0) {
    return { allowed: false, reason: "كود فارغ" };
  }
  if (code.length > 100_000) {
    return { allowed: false, reason: "الكود يتجاوز 100 ألف حرف" };
  }
  return { allowed: true };
}
