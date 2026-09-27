import { NextResponse } from "next/server";
import { runtime as getRuntime } from "@/lib/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/task/:id/files — workspace snapshot (for the file viewer / download) */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const files = await getRuntime().workspaceFiles(id);
  return NextResponse.json({ taskId: id, files });
}
