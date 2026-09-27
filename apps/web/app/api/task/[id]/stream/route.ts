import { runtime as getRuntime, type BufferedEvent } from "@/lib/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A cursor belongs to this task's monotonic event journal, NOT to the SHA-256 ledger. */
function cursor(req: Request): number | null {
  // EventSource sends Last-Event-ID on automatic reconnect. An explicit cursor is
  // useful when a new EventSource is created (or a client falls back to polling).
  const header = req.headers.get("Last-Event-ID");
  const raw = header && header.length > 0 ? header : new URL(req.url).searchParams.get("after");
  if (raw === null || raw === "") return -1;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** SSE: replay strictly after the cursor and poll the journal across instances. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const after = cursor(req);
  if (after === null) return new Response("Invalid event cursor", { status: 400 });

  const rt = getRuntime();
  let initial: Awaited<ReturnType<typeof rt.eventsAfter>>;
  try {
    initial = await rt.eventsAfter(id, after);
  } catch {
    return new Response("Event history unavailable", { status: 503 });
  }
  let lastSeq = after;
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let abortHandler: (() => void) | undefined;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = ({ seq, e }: BufferedEvent) => {
        if (closed || seq <= lastSeq) return;
        controller.enqueue(enc.encode(`id: ${seq}\ndata: ${JSON.stringify(e)}\n\n`));
        lastSeq = seq;
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
        controller.close();
      };
      abortHandler = close;
      req.signal.addEventListener("abort", abortHandler, { once: true });
      if (req.signal.aborted) { close(); return; }
      for (const entry of initial.events) send(entry);
      if (initial.done) { close(); return; }

      let busy = false;
      interval = setInterval(() => {
        if (closed || busy) return;
        busy = true;
        void rt.eventsAfter(id, lastSeq).then(({ events, done }) => {
          if (closed) return;
          for (const entry of events) send(entry);
          if (done) close();
          else controller.enqueue(enc.encode(": hb\n\n"));
        }).catch(() => close()).finally(() => { busy = false; });
      }, 1_000);
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
      if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
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
