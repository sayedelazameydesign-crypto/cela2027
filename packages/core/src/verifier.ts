/**
 * Verifier — independent evidence collection. Never trusts the executor:
 * re-reads the workspace and inspects sandbox output directly.
 * (Port of agi-system verifier.py: VERIFIED only with evidence.)
 */

import type { Evidence } from "./events";
import type { SandboxRunResult } from "./executor";
import { Workspace } from "./workspace";

export interface VerifyInput {
  step: { tool: string; args: Record<string, unknown> };
  result: { ok: boolean; output: string; data?: Record<string, unknown> };
  sandbox?: SandboxRunResult;
}

function now(): string {
  return new Date().toISOString();
}

/** verify a single step independently */
export function verifyStep(input: VerifyInput, ws: Workspace): Evidence[] {
  const evidence: Evidence[] = [];
  const { step, result, sandbox } = input;

  if (step.tool === "write" || step.tool === "scaffold_project" || step.tool === "edit") {
    // re-read the actual workspace — not the tool's claim
    const paths: string[] = [];
    if (typeof step.args.path === "string") paths.push(step.args.path);
    if (Array.isArray(step.args.files)) {
      for (const f of step.args.files as any[]) {
        if (typeof f?.path === "string") paths.push(f.path);
      }
    }
    const checks: Record<string, boolean | number | string> = { claimed_ok: result.ok };
    let existing = 0;
    for (const p of paths) {
      if (ws.exists(p) && ws.read(p).length > 0) existing++;
    }
    checks.files_expected = paths.length;
    checks.files_present_nonempty = existing;
    checks.all_present = existing === paths.length && paths.length > 0;
    evidence.push({
      checks,
      detail: `التحقق المستقل: ${existing}/${paths.length} ملفاً موجوداً وغير فارغ في مساحة العمل`,
      at: now(),
    });
  }

  if (step.tool === "python_run") {
    const ok = Boolean(sandbox?.ok) && result.ok;
    const out = sandbox?.stdout ?? result.output ?? "";
    evidence.push({
      checks: {
        sandbox_ok: ok,
        exit_clean: !sandbox?.stderr || sandbox.stderr.trim().length === 0,
        stdout_len: out.length,
        stdout_preview: out.slice(0, 200),
      },
      detail: ok ? "تنفيذ Python تم داخل الصندوق وينتج مخرجات" : "فشل تنفيذ Python في الصندوق",
      at: now(),
    });
  }

  if (step.tool === "read" || step.tool === "ls") {
    evidence.push({
      checks: { claimed_ok: result.ok, output_len: result.output.length },
      detail: "عملية قراءة/سرد — لا تغيير على الحالة",
      at: now(),
    });
  }

  if (evidence.length === 0) {
    evidence.push({
      checks: { claimed_ok: result.ok },
      detail: "لا فحوصات مستقلة متاحة لهذه الأداة",
      at: now(),
    });
  }
  return evidence;
}

/** overall verification: evidence exists for every mutating step */
export function verifyRun(
  records: { tool: string; status: string; evidence: Evidence[] }[]
): { verified: boolean; reason: string } {
  const mutating = records.filter((r) =>
    ["write", "edit", "patch", "scaffold_project", "python_run"].includes(r.tool)
  );
  if (mutating.length === 0) {
    return { verified: false, reason: "لا خطوات تنفيذية في الخطة" };
  }
  const unverified = mutating.filter(
    (r) => r.status !== "VERIFIED" || r.evidence.length === 0
  );
  if (unverified.length > 0) {
    return { verified: false, reason: `${unverified.length} خطوة بدون أدلة تحقق` };
  }
  return { verified: true, reason: "كل الخطوات التنفيذية موثقة بالأدلة" };
}
