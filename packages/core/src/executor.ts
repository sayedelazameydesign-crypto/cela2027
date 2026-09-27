/**
 * Executor — runs one authorized step against the tools registry.
 * python_run steps are delegated to the SandboxBridge (Pyodide in the
 * user's browser for v1 — free, isolated; Docker backend later).
 */

export interface SandboxRunResult {
  /** matches the sandbox_request runId when provided by the bridge */
  runId?: string;
  stdout: string;
  stderr: string;
  ok: boolean;
  /** wall-clock ms (informational) */
  durationMs?: number;
}

/** implemented by the API layer; resolves when the browser worker replies */
export interface SandboxBridge {
  requestRun(taskId: string, code: string, files?: Record<string, string | { base64: string }>): Promise<SandboxRunResult>;
}

export interface ToolContext {
  taskId: string;
  bridge: SandboxBridge;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  /** structured payload for evidence/verification */
  data?: Record<string, unknown>;
}

export type ToolImpl = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export function executeStep(
  step: { tool: string; args: Record<string, unknown> },
  tools: Map<string, ToolImpl>,
  ctx: ToolContext
): Promise<ToolResult> {
  const impl = tools.get(step.tool);
  if (!impl) {
    return Promise.resolve({ ok: false, output: `Unknown tool: ${step.tool}` });
  }
  return impl(step.args, ctx);
}
