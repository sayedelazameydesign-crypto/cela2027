import { NextResponse } from "next/server";
import { runtime as getRuntime } from "@/lib/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/task { goal } → { taskId } */
export async function POST(req: Request) {
  let goal = "";
  try {
    const body = await req.json();
    goal = String(body?.goal ?? "").trim();
  } catch {
    /* ignore */
  }
  if (!goal) {
    return NextResponse.json({ error: "الهدف مطلوب" }, { status: 400 });
  }
  if (goal.length > 4000) {
    return NextResponse.json({ error: "الهدف طويل جداً (4000 حرف كحد أقصى)" }, { status: 400 });
  }
  try {
    const taskId = await getRuntime().startTask(goal);
    return NextResponse.json({ taskId });
  } catch {
    return NextResponse.json({ error: "تعذر حفظ المهمة" }, { status: 503 });
  }
}
