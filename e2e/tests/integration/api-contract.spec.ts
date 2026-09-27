/**
 * Stage: application integration — real app API through the proxy, no mocks.
 *
 * Verifies the HTTP contract the UI and the mock both rely on, and that the
 * app's event stream still matches the recorded fixture structurally
 * (types/order/plan/artifacts). If the app changes its contract this stage
 * fails while the mocked stage keeps passing — that gap is the signal.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { derivedNumber, loadFixture, proxy, urls, useRealApi } from "../helpers/harness";

const fixture = loadFixture("offline-task");
const taskCompletionTimeoutMs = derivedNumber("taskCompletionTimeoutMs");
const pollIntervalMs = derivedNumber("pollIntervalMs");

type Wire = { seq: number; e: Record<string, any> & { type: string; taskId: string } };

async function createTask(request: APIRequestContext, goal: string) {
  const response = await request.post(`${urls.proxy}/api/task`, { data: { goal } });
  return { status: response.status(), json: await response.json() };
}

async function eventsAfter(request: APIRequestContext, taskId: string, after: number) {
  const response = await request.get(`${urls.proxy}/api/task/${taskId}/events?after=${after}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { taskId: string; events: Wire[]; done: boolean };
}

/** Drive a task to completion by polling, answering the sandbox with the recorded stdout. */
async function runToCompletion(request: APIRequestContext, goal: string) {
  const created = await createTask(request, goal);
  expect(created.status).toBe(200);
  const taskId = created.json.taskId as string;
  expect(taskId).toMatch(/^[0-9a-z]+$/i);

  const events: Wire[] = [];
  let answered: string | null = null;
  const deadline = Date.now() + taskCompletionTimeoutMs;
  while (Date.now() < deadline) {
    const page = await eventsAfter(request, taskId, events.length ? events[events.length - 1].seq : -1);
    for (const item of page.events) {
      events.push(item);
      if (item.e.type === "sandbox_request" && !answered) {
        answered = item.e.runId;
        const posted = await request.post(`${urls.proxy}/api/task/${taskId}/sandbox`, {
          data: { runId: item.e.runId, ok: true, stdout: fixture.sandboxStdout, stderr: "", durationMs: 1 },
        });
        expect(posted.status(), "sandbox result accepted").toBe(200);
      }
    }
    if (page.done) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return { taskId, events, answered };
}

test.describe("integration — real app API through the proxy", () => {
  test.beforeEach(async ({ request }) => {
    await useRealApi(request);
  });

  test("input validation matches the contract", async ({ request }) => {
    expect(await createTask(request, "   ")).toEqual({ status: 400, json: { error: "الهدف مطلوب" } });
    expect((await createTask(request, "x".repeat(4001))).status).toBe(400);
    const unknown = await eventsAfter(request, "does-not-exist", -1);
    expect(unknown).toEqual({ taskId: "does-not-exist", events: [], done: true });
  });

  test("offline task reaches VERIFIED and structurally matches the recorded fixture", async ({ request }) => {
    const run = await runToCompletion(request, fixture.goal);
    expect(run.answered, "the app asked the client to run the sandbox").not.toBeNull();

    const last = run.events[run.events.length - 1];
    expect(last.e.type).toBe("task_finished");
    expect(last.e.status).toBe("VERIFIED");
    expect(last.e.summary).toBe(fixture.finalSummary);

    // for a live consumer seq is contiguous from 0, and every event carries this taskId
    expect(run.events.map((x) => x.seq)).toEqual(run.events.map((_, i) => i));
    expect(run.events.every((x) => x.e.taskId === run.taskId)).toBeTruthy();

    // same event types in the same order as the fixture
    expect(run.events.map((x) => x.e.type)).toEqual(fixture.events.map((x) => x.e.type));

    // same plan and artifacts (content is deterministic in OfflinePlanner mode)
    const plan = run.events.find((x) => x.e.type === "plan_created")!.e.plan;
    expect(plan.steps.map((s: any) => [s.id, s.title, s.tool])).toEqual(fixture.plan.steps.map((s) => [s.id, s.title, s.tool]));
    const artifacts = Object.fromEntries(run.events.filter((x) => x.e.type === "artifact").map((x) => [x.e.path, x.e.content]));
    expect(artifacts).toEqual(fixture.artifacts);

    // sandbox contract: runId is prefixed by the taskId
    const sandboxRequest = run.events.find((x) => x.e.type === "sandbox_request")!.e;
    expect(String(sandboxRequest.runId).startsWith(`${run.taskId}:`)).toBeTruthy();
    expect(typeof sandboxRequest.code).toBe("string");

    // files endpoint agrees with the artifacts once finished
    const files = await (await request.get(`${urls.proxy}/api/task/${run.taskId}/files`)).json();
    expect(files).toEqual({ taskId: run.taskId, files: fixture.artifacts });

    // everything went through the proxy to the real app (no route rule active)
    const apiCalls = proxy.apiEntries(await proxy.state(request));
    expect(apiCalls.length).toBeGreaterThan(3);
    expect(apiCalls.every((entry) => entry.routedTo === null && entry.fault === null)).toBeTruthy();
  });

  test("sandbox endpoint rejects foreign runIds and unknown pending requests", async ({ request }) => {
    const created = await createTask(request, fixture.goal);
    const taskId = created.json.taskId as string;
    const foreign = await request.post(`${urls.proxy}/api/task/${taskId}/sandbox`, { data: { runId: "other:1", ok: true, stdout: "" } });
    expect(foreign.status()).toBe(400);
    const unknown = await request.post(`${urls.proxy}/api/task/${taskId}/sandbox`, { data: { runId: `${taskId}:zzzzzz`, ok: true, stdout: "" } });
    expect(unknown.status()).toBe(404);
    // Let the task finish (answer the real pending request) so the server does not wait 60s on our behalf.
    const deadline = Date.now() + taskCompletionTimeoutMs;
    let pending: string | null = null;
    while (!pending && Date.now() < deadline) {
      const page = await eventsAfter(request, taskId, -1);
      pending = page.events.find((x) => x.e.type === "sandbox_request")?.e.runId ?? null;
      if (!pending) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    expect(pending).not.toBeNull();
    const accepted = await request.post(`${urls.proxy}/api/task/${taskId}/sandbox`, { data: { runId: pending, ok: true, stdout: fixture.sandboxStdout, stderr: "" } });
    expect(accepted.status()).toBe(200);
  });

  test("late joiners (SSE replay, events?after=-1) see the buffer with artifacts de-duplicated by path", async ({ request }) => {
    // Live consumers (the UI's EventSource opened right after POST, incremental polling)
    // receive every event; the replay buffer keeps only the latest artifact per path,
    // so a late joiner sees fewer events with seq gaps. Both late views must agree.
    const run = await runToCompletion(request, fixture.goal); // live view
    const postHoc = await eventsAfter(request, run.taskId, -1); // late polling view
    expect(postHoc.done).toBe(true);

    // Playwright's request context cannot consume SSE incrementally; a finished task's stream replays and closes.
    const response = await fetch(`${urls.proxy}/api/task/${run.taskId}/stream`, { signal: AbortSignal.timeout(derivedNumber("apiRequestTimeoutMs") * 5) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    const streamed = text.split("\n\n").filter((block) => block.startsWith("data: ")).map((block) => JSON.parse(block.slice(6)));
    expect(streamed, "SSE replay equals the late polling view").toEqual(postHoc.events.map((x) => x.e));

    const liveArtifacts = run.events.filter((x) => x.e.type === "artifact");
    const uniquePaths = new Set(liveArtifacts.map((x) => x.e.path));
    const lateArtifacts = postHoc.events.filter((x) => x.e.type === "artifact");
    expect(lateArtifacts.map((x) => x.e.path).sort()).toEqual([...uniquePaths].sort());
    expect(postHoc.events.length).toBe(run.events.length - (liveArtifacts.length - uniquePaths.size));
    // seq stays strictly increasing (gaps allowed), so an `after=` cursor remains valid
    const seqs = postHoc.events.map((x) => x.seq);
    expect(seqs.every((seq, i) => i === 0 || seq > seqs[i - 1])).toBeTruthy();
    expect(seqs[seqs.length - 1]).toBe(run.events[run.events.length - 1].seq);
    // the surviving artifacts are the latest versions (step 2's), matching the fixture contents
    expect(Object.fromEntries(lateArtifacts.map((x) => [x.e.path, x.e.content]))).toEqual(fixture.artifacts);
    test.info().annotations.push({ type: "contract", description: `late joiners see ${postHoc.events.length} of ${run.events.length} events (artifact de-dup by path; seq ${JSON.stringify(seqs)})` });
  });
});
