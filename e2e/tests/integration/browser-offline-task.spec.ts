/**
 * Stage: application integration — the real UI against the real API, with the
 * real Pyodide worker (loaded from cdn.jsdelivr.net inside the browser).
 *
 * Nothing is mocked and the proxy is a plain passthrough; its log is used
 * only as evidence of what the browser actually requested.
 *
 * Precondition: the browser must be able to reach the Pyodide CDN. Where it
 * cannot (this harness was built in such a sandbox) the test is SKIPPED with
 * the probe result in the skip reason — never silently passed.
 */
import { expect, test } from "@playwright/test";
import { collectPageErrors, derivedNumber, loadFixture, proxy, ui, useRealApi } from "../helpers/harness";

const fixture = loadFixture("offline-task");
const taskCompletionTimeoutMs = derivedNumber("taskCompletionTimeoutMs");
const PYODIDE_PROBE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";

test.describe("integration — browser journey on the real API", () => {
  test.beforeEach(async ({ request }) => {
    await useRealApi(request);
  });

  test("goal → real planner → real Pyodide in a worker → VERIFIED with artifacts", async ({ page, request }) => {
    test.setTimeout(taskCompletionTimeoutMs * 2);

    // Probe the CDN from the browser process (same network path as the worker).
    const probe = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(10_000) });
        return { ok: response.ok, status: response.status };
      } catch (error) {
        return { ok: false, status: 0, error: String(error) };
      }
    }, PYODIDE_PROBE);
    test.skip(!probe.ok, `Pyodide CDN unreachable from the browser: ${JSON.stringify(probe)} — the worker cannot load, so the real sandbox path cannot be exercised here`);

    const pageErrors = collectPageErrors(page);
    await page.goto("/");
    await expect(ui.heading(page)).toBeVisible();
    await ui.goalInput(page).fill(fixture.goal);
    await ui.runButton(page).click();

    await expect(ui.footerRunning(page)).toBeVisible();
    // Pyodide bootstrap dominates; the app's own sandbox wait bounds it (calibrated).
    await expect(ui.sandboxOutput(page)).toBeVisible({ timeout: taskCompletionTimeoutMs });
    await expect(ui.sandboxOutput(page)).toHaveText(fixture.sandboxStdout);
    await expect(ui.statusBadge(page)).toHaveText("مُوثَّق بالأدلة");
    await expect(ui.finalBanner(page)).toBeVisible();
    await expect(ui.steps(page)).toHaveCount(fixture.plan.steps.length);
    await expect(ui.filesHeading(page)).toContainText(`(${Object.keys(fixture.artifacts).length})`);
    for (const filePath of Object.keys(fixture.artifacts)) await expect(ui.fileButton(page, filePath)).toBeVisible();
    expect(pageErrors).toEqual([]);

    // Evidence: the browser used the real API and the real worker, nothing was routed or faulted.
    const state = await proxy.state(request);
    const apiCalls = proxy.apiEntries(state);
    expect(apiCalls.map((entry) => entry.method + " " + entry.path.replace(/\/api\/task\/[^/]+\//, "/api/task/:id/"))).toEqual([
      "POST /api/task",
      "GET /api/task/:id/stream",
      "POST /api/task/:id/sandbox",
    ]);
    expect(apiCalls.every((entry) => entry.routedTo === null && entry.fault === null)).toBeTruthy();
    const worker = state.log.entries.find((entry) => entry.path === "/pyodide-worker.js");
    expect(worker).toMatchObject({ routedTo: null, status: 200 });
    test.info().annotations.push({ type: "evidence", description: `sandbox POST status ${apiCalls[2].status}; worker served by the app` });
  });
});
