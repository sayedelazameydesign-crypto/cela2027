/**
 * Stage: browser-e2e-mocked-app-api
 *
 * The real UI (production build) talks through the fault proxy to the mock
 * API, which replays fixtures/events/offline-task.ndjson with the app's exact
 * HTTP contract. The sandbox request is HELD by the mock until the browser's
 * worker path posts a result — so the final VERIFIED state on screen is
 * causally dependent on the UI's own /pyodide-worker.js → POST /sandbox path,
 * not on a timer.
 */
import { expect, test } from "@playwright/test";
import { collectPageErrors, loadFixture, mock, proxy, ui, urls, useMockedApi } from "../helpers/harness";

const fixture = loadFixture("offline-task");
const mockHref = new URL(urls.mock).href;

test.describe("mocked app API — recorded VERIFIED task", () => {
  test.beforeEach(async ({ request }) => {
    await useMockedApi(request);
  });

  test("plays the fixture from goal to evidence, using the browser's own sandbox path", async ({ page, request }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto("/");
    await expect(ui.heading(page)).toBeVisible();
    await expect(ui.filesHeading(page)).toContainText("(0)");

    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();

    // The task is running: input replaced by the running footer, status badge live.
    await expect(ui.footerRunning(page)).toBeVisible();
    await expect(page.getByText(fixture.goal, { exact: true })).toBeVisible();

    // Terminal state from the fixture.
    await expect(ui.statusBadge(page)).toHaveText("مُوثَّق بالأدلة");
    await expect(ui.finalBanner(page)).toBeVisible();
    await expect(page.getByText(fixture.finalSummary, { exact: true })).toBeVisible();

    // Plan + timeline mirror the recorded events.
    await expect(ui.planSummary(page, fixture.plan.summary)).toBeVisible();
    await expect(page.getByText(`${fixture.plan.steps.length} خطوات`, { exact: true })).toBeVisible();
    await expect(ui.steps(page)).toHaveCount(fixture.plan.steps.length);
    for (const [index, step] of fixture.plan.steps.entries()) {
      const item = ui.steps(page).nth(index);
      await expect(item).toContainText(step.title);
      await expect(item).toContainText(step.tool);
      await expect(item).toContainText(`✓ ${fixture.evidenceDetails[index]}`);
    }

    // Sandbox output rendered from the worker message (mock worker returns the recorded stdout).
    await expect(ui.sandboxOutput(page)).toBeVisible();
    await expect(ui.sandboxOutput(page)).toHaveText(fixture.sandboxStdout);

    // Files panel: every artifact is listed and its content is shown when selected.
    const artifactPaths = Object.keys(fixture.artifacts);
    await expect(ui.filesHeading(page)).toContainText(`(${artifactPaths.length})`);
    for (const filePath of artifactPaths) {
      await ui.fileButton(page, filePath).click();
      const firstLine = fixture.artifacts[filePath].split("\n").find((line) => line.trim().length > 0) ?? "";
      await expect(page.locator("pre", { hasText: firstLine })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "تنزيل المشروع" })).toBeVisible();
    await expect(ui.footerIdle(page)).toBeVisible();
    await expect(ui.newTaskButton(page)).toBeVisible();

    expect(pageErrors, "no uncaught page errors during the run").toEqual([]);

    // ---- Network evidence from the control planes -------------------------
    const proxyState = await proxy.state(request);
    const apiCalls = proxy.apiEntries(proxyState);
    expect(apiCalls.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      "POST /api/task",
      `GET /api/task/${fixture.taskId}/stream`,
      `POST /api/task/${fixture.taskId}/sandbox`,
    ]);
    expect(apiCalls.every((entry) => entry.routedTo === mockHref), "every API call went to the mock, none to the real app").toBeTruthy();
    const workerCall = proxyState.log.entries.find((entry) => entry.path === "/pyodide-worker.js");
    expect(workerCall?.routedTo, "the worker script came from the mock").toBe(mockHref);
    expect(apiCalls.filter((entry) => entry.fault !== null)).toEqual([]);

    const mockState = await mock.state(request);
    expect(mockState.sessions).toHaveLength(1);
    const session = mockState.sessions[0];
    expect(session.taskId).toBe(fixture.taskId);
    expect(session.goal).toBe(fixture.goal);
    expect(session.finished).toBe(true);
    expect(session.released).toBe(fixture.events.length);
    expect(session.pendingHolds).toEqual([]);
    expect(session.holdTimeouts, "the sandbox hold was released by the browser, not by the timeout").toBe(0);
    expect(session.sandboxPosts).toHaveLength(1);
    expect(session.sandboxPosts[0]).toMatchObject({ accepted: true, ok: true, stdoutLength: fixture.sandboxStdout.length });
    expect(session.sandboxPosts[0].runId.startsWith(`${fixture.taskId}:`)).toBeTruthy();
  });

  test("a second task after «مهمة جديدة» starts from a clean slate", async ({ page, request }) => {
    await mock.command(request, { command: "config", taskIdMode: "unique" }); // two distinct sessions
    await page.goto("/");
    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();
    await expect(ui.finalBanner(page)).toBeVisible();

    await ui.newTaskButton(page).click();
    await expect(ui.heading(page)).toBeVisible();
    await expect(ui.filesHeading(page)).toContainText("(0)");
    await expect(ui.statusBadge(page)).toHaveCount(0);
    await expect(ui.goalInput(page)).toHaveValue("");

    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();
    await expect(ui.finalBanner(page)).toBeVisible();
    await expect(ui.filesHeading(page)).toContainText(`(${Object.keys(fixture.artifacts).length})`);

    const mockState = await mock.state(request);
    expect(mockState.sessions).toHaveLength(2);
    expect(new Set(mockState.sessions.map((session) => session.taskId)).size).toBe(2);
    expect(mockState.sessions.every((session) => session.finished && session.sandboxPosts.length === 1 && session.sandboxPosts[0].accepted)).toBeTruthy();
  });
});
