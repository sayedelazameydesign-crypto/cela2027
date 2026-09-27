/**
 * Stage: browser-e2e-mocked-app-api — failure characterization.
 *
 * Faults are injected by the proxy (command-driven), the API is the mock.
 * These tests pin how the CURRENT UI behaves under failure; several of them
 * document gaps (no retry, no reconnect, error text not surfaced). When UI-U0
 * changes that behaviour these tests must be updated deliberately — that is
 * their purpose.
 */
import { expect, test } from "@playwright/test";
import { derivedNumber, derivedSchedule, loadFixture, mock, proxy, sleep, ui, useMockedApi } from "../helpers/harness";

const fixture = loadFixture("offline-task");
// A client that retried with the calibrated schedule would have retried within this window.
const retryWindowMs = derivedSchedule().reduce((sum, ms) => sum + ms, 0) + derivedNumber("pollIntervalMs") * 4;

test.describe("mocked app API — fault injection through the proxy", () => {
  test.beforeEach(async ({ request }) => {
    await useMockedApi(request);
  });

  test("POST /api/task → 503 once: UI shows «فشل», does not retry, and a manual retry succeeds", async ({ page, request }) => {
    await proxy.command(request, { command: "fail-next", match: { method: "POST", path: "/api/task" }, count: 1, status: 503 });

    await page.goto("/");
    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();

    await expect(ui.statusBadge(page)).toHaveText("فشل");
    // Characterization: the input stays (no taskId), and the error text is not rendered anywhere.
    await expect(ui.goalInput(page)).toBeVisible();
    await expect(ui.runButton(page)).toBeEnabled();
    await expect(page.getByText("injected by fault-proxy")).toHaveCount(0);

    await sleep(retryWindowMs);
    let apiCalls = proxy.apiEntries(await proxy.state(request));
    expect(apiCalls.map((entry) => `${entry.method} ${entry.path} ${entry.fault ?? "-"} ${entry.status}`)).toEqual(["POST /api/task fail 503"]);
    test.info().annotations.push({ type: "characterization", description: `UI performed no automatic retry within ${retryWindowMs}ms after a 503 on POST /api/task` });

    // Manual retry by the user succeeds (the fault rule was single-shot).
    await ui.runButton(page).click();
    await expect(ui.statusBadge(page)).toHaveText("مُوثَّق بالأدلة");
    await expect(ui.finalBanner(page)).toBeVisible();

    apiCalls = proxy.apiEntries(await proxy.state(request));
    expect(apiCalls.filter((entry) => entry.path === "/api/task")).toHaveLength(2);
    const state = await proxy.state(request);
    expect(state.rules.find((rule) => rule.kind === "fail")).toMatchObject({ fired: 1, remaining: 0 });
  });

  test("SSE stream answers 503: UI stops silently — no reconnect, no polling fallback", async ({ page, request }) => {
    // An HTTP error on the EventSource is terminal for the browser (no auto-reconnect),
    // so this is the deterministic way to reach the UI's own onerror path.
    await proxy.command(request, { command: "fail-next", match: { method: "GET", path: `/api/task/${fixture.taskId}/stream` }, count: 1, status: 503 });
    await mock.command(request, { command: "config", sandboxHoldTimeoutMs: 500 });

    await page.goto("/");
    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();

    // Optimistic PLANNING badge stays, the footer flips to "done" although nothing ran.
    await expect(ui.footerIdle(page)).toBeVisible();
    await expect(ui.statusBadge(page)).toHaveText("جارٍ التخطيط");
    await expect(ui.steps(page)).toHaveCount(0);
    await expect(ui.filesHeading(page)).toContainText("(0)");

    await sleep(retryWindowMs);
    const apiCalls = proxy.apiEntries(await proxy.state(request));
    expect(apiCalls.map((entry) => `${entry.method} ${entry.path} ${entry.fault ?? "-"} ${entry.status}`)).toEqual([
      "POST /api/task - 200",
      `GET /api/task/${fixture.taskId}/stream fail 503`,
    ]);
    test.info().annotations.push({ type: "characterization", description: `after the stream failed with 503 the UI opened no second stream and issued no events?after= poll within ${retryWindowMs}ms` });

    // Meanwhile the mock kept releasing events nobody consumed — the task "happened" server-side.
    await expect.poll(async () => (await mock.state(request)).sessions[0]?.finished, { message: "mock session finishes on its own (hold timeout)" }).toBe(true);
    const session = (await mock.state(request)).sessions[0];
    expect(session.sandboxPosts).toEqual([]);
    expect(session.holdTimeouts).toBe(1);
    // …and the UI still shows the stale state.
    await expect(ui.statusBadge(page)).toHaveText("جارٍ التخطيط");
  });

  test("SSE connection dropped once: absorbed by the browser's transparent retry, task completes", async ({ page, request }) => {
    // Chromium re-issues a GET whose connection closed before any response byte;
    // the UI never sees an error. One dropped connection therefore costs one extra request.
    await proxy.command(request, { command: "drop", match: { method: "GET", path: `/api/task/${fixture.taskId}/stream` }, count: 1 });

    await page.goto("/");
    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();
    await expect(ui.finalBanner(page)).toBeVisible();

    const streamCalls = proxy.apiEntries(await proxy.state(request)).filter((entry) => entry.path.endsWith("/stream"));
    expect(streamCalls.map((entry) => `${entry.fault ?? "-"} ${entry.status}`)).toEqual(["drop dropped", "- client-closed"]);
    test.info().annotations.push({ type: "characterization", description: "a dropped SSE connection is retried by the browser network stack (2 GET /stream), not by the UI" });
  });

  test("SSE connection dropped persistently: UI gives up silently after the browser's retry", async ({ page, request }) => {
    await proxy.command(request, { command: "drop", match: { method: "GET", path: `/api/task/${fixture.taskId}/stream` }, count: "unlimited" });
    await mock.command(request, { command: "config", sandboxHoldTimeoutMs: 500 });

    await page.goto("/");
    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();

    await expect(ui.footerIdle(page)).toBeVisible();
    await expect(ui.statusBadge(page)).toHaveText("جارٍ التخطيط");

    const attemptsAtGiveUp = proxy.apiEntries(await proxy.state(request)).filter((entry) => entry.path.endsWith("/stream"));
    expect(attemptsAtGiveUp.length).toBeGreaterThanOrEqual(1);
    expect(attemptsAtGiveUp.every((entry) => entry.fault === "drop")).toBeTruthy();

    await sleep(retryWindowMs);
    const attemptsLater = proxy.apiEntries(await proxy.state(request)).filter((entry) => entry.path.endsWith("/stream"));
    expect(attemptsLater.length, "no further stream attempts once the UI closed the EventSource").toBe(attemptsAtGiveUp.length);
    expect(proxy.apiEntries(await proxy.state(request)).filter((entry) => entry.path.includes("/events"))).toEqual([]);
    test.info().annotations.push({ type: "characterization", description: `browser made ${attemptsAtGiveUp.length} GET /stream attempt(s) before the UI's onerror closed the EventSource; no polling fallback` });
  });

  test("slow POST /api/task (delay below the calibrated timeout) still completes", async ({ page, request }) => {
    const delayMs = derivedNumber("proxyDelayBelowTimeoutMs");
    await proxy.command(request, { command: "delay", match: { method: "POST", path: "/api/task" }, count: 1, ms: delayMs });

    await page.goto("/");
    await ui.goalInput(page).fill(fixture.goal);
    const clickedAt = Date.now();
    await ui.runButton(page).click();

    // While POST /api/task is pending there is no taskId yet: the input stays,
    // the button is disabled and the badge already says PLANNING (optimistic).
    await expect(ui.statusBadge(page)).toHaveText("جارٍ التخطيط");
    await expect(ui.runButton(page)).toBeDisabled();
    await expect(ui.goalInput(page)).toBeVisible();
    // The UI has no request timeout of its own, so the delayed response is simply awaited.
    await expect(ui.finalBanner(page)).toBeVisible({ timeout: delayMs + derivedNumber("expectTimeoutMs") });
    expect(Date.now() - clickedAt).toBeGreaterThanOrEqual(delayMs);

    const post = proxy.apiEntries(await proxy.state(request)).find((entry) => entry.path === "/api/task");
    expect(post).toMatchObject({ delayMs, status: 200 });
    expect(post!.durationMs!).toBeGreaterThanOrEqual(delayMs);
  });

  test("POST /sandbox → 500: worker output is shown, the result is never re-sent, the task stays pending", async ({ page, request }) => {
    const holdMs = derivedNumber("expectTimeoutMs") * 2;
    await mock.command(request, { command: "config", sandboxHoldTimeoutMs: holdMs });
    await proxy.command(request, { command: "fail-next", match: { method: "POST", path: `/api/task/${fixture.taskId}/sandbox` }, count: 1, status: 500 });

    await page.goto("/");
    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();

    // The worker ran and its output is rendered — but the server never received it.
    await expect(ui.sandboxOutput(page)).toHaveText(fixture.sandboxStdout);
    await expect(ui.statusBadge(page)).toHaveText("قيد التنفيذ");
    await expect(ui.footerRunning(page)).toBeVisible();

    await sleep(retryWindowMs);
    const sandboxPosts = proxy.apiEntries(await proxy.state(request)).filter((entry) => entry.path.endsWith("/sandbox"));
    expect(sandboxPosts.map((entry) => `${entry.fault ?? "-"} ${entry.status}`)).toEqual(["fail 500"]);
    const session = (await mock.state(request)).sessions[0];
    expect(session.pendingHolds).toHaveLength(1);
    expect(session.finished).toBe(false);
    await expect(ui.statusBadge(page)).toHaveText("قيد التنفيذ");
    test.info().annotations.push({ type: "characterization", description: `a failed POST /sandbox is swallowed by the UI (no retry within ${retryWindowMs}ms); the task waits for the server-side sandbox timeout` });

    // Once the hold expires the recording continues (mock escape hatch — the real server would FAIL the step after its 60s wait).
    await expect(ui.finalBanner(page)).toBeVisible({ timeout: holdMs + derivedNumber("expectTimeoutMs") });
  });
});
