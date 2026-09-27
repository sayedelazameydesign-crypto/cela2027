/**
 * Stage: application integration — the real UI against the real API, with the
 * real Pyodide worker (loaded from cdn.jsdelivr.net inside the browser).
 *
 * Nothing is mocked and the proxy is a plain passthrough; its log is used
 * only as evidence of what the browser actually requested.
 *
 * Precondition: the browser must be able to reach the Pyodide CDN. Where it
 * cannot (this harness was built in such a sandbox) the tests are SKIPPED
 * with the probe result in the skip reason — never silently passed.
 *
 * FINDING (first CI run in the pinned container, docs/E2E_BASELINE.md §7):
 * the offline plan's python_run step does `sys.path.insert(0, 'celia_app')`
 * and imports the files written in step 1 — but SandboxBridge.requestRun()
 * sends only {runId, code}; the workspace never reaches the worker, so the
 * real browser sandbox raises ModuleNotFoundError and the task ends FAILED.
 * The recorded fixture shows VERIFIED only because record-fixture.mjs
 * materialised the artifacts before running the code under CPython.
 * The first test pins that behaviour with evidence; the second keeps the
 * intended journey visible as an expected failure until the app ships the
 * workspace to the sandbox.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, derivedNumber, loadFixture, proxy, ui, urls, useRealApi } from "../helpers/harness";

const fixture = loadFixture("offline-task");
const taskCompletionTimeoutMs = derivedNumber("taskCompletionTimeoutMs");
const PYODIDE_PROBE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
const MISSING_MODULE = "ModuleNotFoundError: No module named 'math_tools'";

/** Probe the CDN from the browser process (same network path as the worker). */
async function skipUnlessPyodideReachable(page: Page) {
  await page.goto("about:blank");
  const probe = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      return { ok: response.ok, status: response.status };
    } catch (error) {
      return { ok: false, status: 0, error: String(error) };
    }
  }, PYODIDE_PROBE);
  test.skip(!probe.ok, `Pyodide CDN unreachable from the browser: ${JSON.stringify(probe)} — the worker cannot load, so the real sandbox path cannot be exercised here`);
}

async function startJourney(page: Page) {
  await page.goto("/");
  await expect(ui.heading(page)).toBeVisible();
  await ui.goalInput(page).fill(fixture.goal);
  await ui.runButton(page).click();
  await expect(ui.footerRunning(page)).toBeVisible();
}

test.describe("integration — browser journey on the real API (real Pyodide worker)", () => {
  test.beforeEach(async ({ request }) => {
    await useRealApi(request);
  });

  test("characterization: the sandbox step fails because workspace files never reach the browser worker", async ({ page, request }) => {
    test.setTimeout(taskCompletionTimeoutMs * 2);
    await skipUnlessPyodideReachable(page);
    const pageErrors = collectPageErrors(page);

    await startJourney(page);
    const clickedAt = Date.now();

    // The panel appears only when the worker posted a result → Pyodide loaded and ran the code.
    const panel = ui.sandboxPanel(page);
    await expect(panel).toBeVisible({ timeout: taskCompletionTimeoutMs });
    const workerRoundtripMs = Date.now() - clickedAt;
    const panelText = (await panel.textContent()) ?? "";
    test.info().annotations.push({ type: "measurement", description: `click → worker result rendered: ${workerRoundtripMs}ms (includes Pyodide bootstrap from CDN)` });
    test.info().annotations.push({ type: "sandbox-output", description: panelText.slice(0, 500) });

    // What the user sees.
    await expect(panel).toContainText(MISSING_MODULE);
    await expect(ui.statusBadge(page)).toHaveText("فشل");
    await expect(ui.failedBanner(page)).toBeVisible();
    await expect(ui.steps(page)).toHaveCount(fixture.plan.steps.length);
    await expect(ui.steps(page).nth(1)).toContainText(MISSING_MODULE);
    await expect(ui.filesHeading(page)).toContainText(`(${Object.keys(fixture.artifacts).length})`);
    await expect(ui.footerIdle(page)).toBeVisible();
    expect(pageErrors).toEqual([]);

    // What the server recorded (independent of the UI).
    const taskId = (await proxy.state(request)).log.entries.find((entry) => /^\/api\/task\/[^/]+\/stream$/.test(entry.path))!.path.split("/")[3];
    const events = (await (await request.get(`${urls.proxy}/api/task/${taskId}/events?after=-1`)).json()).events as Array<{ seq: number; e: any }>;
    const step2 = events.find((x) => x.e.type === "step_finished" && x.e.stepId === fixture.plan.steps[1].id)!.e;
    expect(step2.status).toBe("FAILED");
    expect(step2.error).toContain(MISSING_MODULE);
    expect(step2.evidence?.[0]?.checks?.sandbox_ok).toBe(false);
    const finished = events.find((x) => x.e.type === "task_finished")!.e;
    expect(finished.status).toBe("FAILED");
    expect(finished.summary).toContain(MISSING_MODULE);

    // Evidence: the real API and the real worker were used; the browser's result was accepted by the server.
    const state = await proxy.state(request);
    const apiCalls = proxy.apiEntries(state);
    expect(apiCalls.map((entry) => entry.method + " " + entry.path.replace(/\/api\/task\/[^/]+\//, "/api/task/:id/"))).toEqual([
      "POST /api/task",
      "GET /api/task/:id/stream",
      "POST /api/task/:id/sandbox",
    ]);
    expect(apiCalls.every((entry) => entry.routedTo === null && entry.fault === null)).toBeTruthy();
    expect(apiCalls[2].status).toBe(200);
    expect(state.log.entries.find((entry) => entry.path === "/pyodide-worker.js")).toMatchObject({ routedTo: null, status: 200 });
    test.info().annotations.push({
      type: "characterization",
      description: "SandboxBridge.requestRun sends {runId, code} only; the workspace written in step 1 never reaches the Pyodide worker, so python_run cannot import it and the task ends FAILED in a real browser",
    });
  });

  test("intended journey: goal → real planner → real Pyodide → VERIFIED with artifacts", async ({ page }) => {
    test.setTimeout(taskCompletionTimeoutMs * 2);
    await skipUnlessPyodideReachable(page);
    test.fail(true, "expected to fail until the app ships workspace files to the browser sandbox (see the characterization test above); an unexpected pass means the fix landed — remove this marker");

    await startJourney(page);
    await expect(ui.sandboxPanel(page)).toBeVisible({ timeout: taskCompletionTimeoutMs });
    await expect(ui.sandboxPanel(page)).toHaveText(fixture.sandboxStdout);
    await expect(ui.statusBadge(page)).toHaveText("مُوثَّق بالأدلة");
    await expect(ui.finalBanner(page)).toBeVisible();
    await expect(ui.filesHeading(page)).toContainText(`(${Object.keys(fixture.artifacts).length})`);
  });
});
