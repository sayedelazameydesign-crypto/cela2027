// Minimal client for the cela2027 task API, shared by the calibration script,
// the fixture recorder and the integration tests. Node built-ins only.
import { fetchJson } from "./http.mjs";

/** The deterministic result the recorded fixture proved for the offline plan. */
export const OFFLINE_PLAN_STDOUT = "add(2,3) = 5\nfib(10) = 55\nmean = 2.5\nALL TESTS PASSED";

export function createAppClient(baseUrl) {
  const base = String(baseUrl).replace(/\/$/, "");
  return {
    base,
    async createTask(goal) {
      const { json } = await fetchJson(`${base}/api/task`, { method: "POST", body: { goal } });
      if (!json?.taskId) throw new Error(`no taskId in ${JSON.stringify(json)}`);
      return json.taskId;
    },
    async eventsAfter(taskId, after = -1) {
      return (await fetchJson(`${base}/api/task/${taskId}/events?after=${after}`)).json;
    },
    async files(taskId) {
      return (await fetchJson(`${base}/api/task/${taskId}/files`)).json;
    },
    async answerSandbox(taskId, runId, result) {
      return fetchJson(`${base}/api/task/${taskId}/sandbox`, { method: "POST", body: { runId, ok: true, stderr: "", durationMs: 1, ...result }, allow: [400, 404] });
    },
    /**
     * Drive a task to completion over the polling endpoint. `onSandbox`
     * receives every sandbox_request and returns {ok, stdout, stderr}.
     * Returns the collected {seq,e} events plus timing marks.
     */
    async runToCompletion(goal, { onSandbox, pollMs = 50, timeoutMs = 60_000 } = {}) {
      const marks = { started: Date.now() };
      const taskId = await this.createTask(goal);
      marks.created = Date.now();
      const events = [];
      const answered = new Set();
      let after = -1;
      let done = false;
      const deadline = Date.now() + timeoutMs;
      while (!done) {
        if (Date.now() > deadline) throw new Error(`task ${taskId} did not finish within ${timeoutMs}ms`);
        const page = await this.eventsAfter(taskId, after);
        for (const item of page.events) {
          events.push(item);
          after = Math.max(after, item.seq);
          if (item.e.type === "sandbox_request" && !answered.has(item.e.runId)) {
            answered.add(item.e.runId);
            marks.sandboxSeen = Date.now();
            const result = onSandbox ? await onSandbox(item.e, events) : { ok: true, stdout: OFFLINE_PLAN_STDOUT, stderr: "" };
            await this.answerSandbox(taskId, item.e.runId, result);
            marks.sandboxAnswered = Date.now();
          }
        }
        done = page.done === true;
        if (!done) await new Promise((r) => setTimeout(r, pollMs));
      }
      marks.finished = Date.now();
      return { taskId, events, marks };
    },
    /**
     * Consume the SSE stream and resolve when task_finished arrives (or the
     * timeout hits). Returns events with arrival timestamps.
     */
    async streamUntilFinished(taskId, { timeoutMs = 60_000, onEvent } = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = Date.now();
      const arrivals = [];
      try {
        const response = await fetch(`${base}/api/task/${taskId}/stream`, { signal: controller.signal, headers: { accept: "text/event-stream" } });
        if (!response.ok) throw new Error(`stream → ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (!data) continue;
            const event = JSON.parse(data);
            const at = Date.now();
            arrivals.push({ atMs: at - started, e: event });
            if (onEvent) await onEvent(event, at);
            if (event.type === "task_finished") {
              controller.abort();
              return arrivals;
            }
          }
        }
        return arrivals;
      } catch (error) {
        if (error?.name === "AbortError" && arrivals.some((a) => a.e.type === "task_finished")) return arrivals;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
