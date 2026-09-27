import { runtime as getRuntime } from "@/lib/agent-runtime";
import type { AgentEvent } from "@cela/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/task/:id/stream — SSE: replay buffer then live events */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rt = getRuntime();

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // replay history
      for (const e of rt.replay(id)) send(e);

      // already finished?
      const done = rt.replay(id).some((e) => e.type === "task_finished");

      const unsubscribe = rt.subscribe(id, (e) => {
        send(e);
        if (e.type === "task_finished") {
          setTimeout(() => {
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          }, 100);
        }
      });

      if (done) {
        // history already contained task_finished; close after flush
        setTimeout(() => {
          if (!closed) {
            closed = true;
            unsubscribe();
            try {
              controller.close();
            } catch {
              /* noop */
            }
          }
        }, 150);
      }

      // heartbeat keeps proxies from closing the stream
      const hb = setInterval(() => {
        if (closed) {
          clearInterval(hb);
          return;
        }
        try {
          controller.enqueue(enc.encode(": hb\n\n"));
        } catch {
          closed = true;
          clearInterval(hb);
          unsubscribe();
        }
      }, 15_000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
