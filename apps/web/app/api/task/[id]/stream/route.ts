import { runtime as getRuntime } from "@/lib/agent-runtime";
import type { AgentEvent } from "@cela/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE: replay and poll the journal for live events across runtime instances. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rt = getRuntime();
  const initial = await rt.eventsAfter(id, -1);
  let lastSeq = -1;
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: AgentEvent) => {
        if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        controller.close();
      };
      for (const item of initial.events) {
        send(item.e);
        lastSeq = item.seq;
      }
      if (initial.done) {
        close();
        return;
      }

      let busy = false;
      interval = setInterval(() => {
        if (closed || busy) return;
        busy = true;
        void rt.eventsAfter(id, lastSeq).then(({ events, done }) => {
          if (closed) return;
          for (const item of events) {
            send(item.e);
            lastSeq = item.seq;
          }
          if (done) close();
          else controller.enqueue(enc.encode(": hb\n\n"));
        }).catch(() => close()).finally(() => { busy = false; });
      }, 1_000);
      req.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
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
