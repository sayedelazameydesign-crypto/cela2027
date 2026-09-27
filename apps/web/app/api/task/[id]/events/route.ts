import { NextResponse } from "next/server";
import { runtime as getRuntime } from "@/lib/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/task/:id/events?after=SEQ
 * Polling resume endpoint — the serverless-safe alternative to SSE
 * (roadmap Phase 2). Returns buffered events after the given seq.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const after = Number.parseInt(url.searchParams.get("after") ?? "-1", 10);
  const safeAfter = Number.isFinite(after) ? after : -1;
  const { events, done } = await getRuntime().eventsAfter(id, Number.isNaN(safeAfter) ? -1 : safeAfter);
  return NextResponse.json({ taskId: id, events, done });
}
