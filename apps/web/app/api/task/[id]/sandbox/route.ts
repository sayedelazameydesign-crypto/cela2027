import { NextResponse } from "next/server";
import { runtime as getRuntime } from "@/lib/agent-runtime";
import { validateSandboxCode } from "@cela/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/task/:id/sandbox { runId, ok, stdout, stderr } — from the browser worker */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON غير صالح" }, { status: 400 });
  }
  const runId = String(body?.runId ?? "");
  if (!runId.startsWith(id + ":")) {
    return NextResponse.json({ error: "runId لا يطابق المهمة" }, { status: 400 });
  }
  // basic guardrail parity with the planner policy
  const check = validateSandboxCode(String(body?.code ?? "print()"));
  if (!check.allowed) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }
  const accepted = getRuntime().resolveSandbox(runId, {
    ok: Boolean(body?.ok),
    stdout: String(body?.stdout ?? ""),
    stderr: String(body?.stderr ?? ""),
    durationMs: Number(body?.durationMs ?? 0),
  });
  if (!accepted) {
    return NextResponse.json({ error: "لا طلب صندوق معلّق بهذا المعرّف" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
