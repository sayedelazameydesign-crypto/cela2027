/**
 * Characterization: the landing page depends on WebGL.
 *
 * NetworkGraph constructs THREE.WebGLRenderer inside an effect without a
 * guard; when no WebGL context can be created the error is uncaught and React
 * unmounts the whole tree — the page becomes empty. Found while bringing up the
 * harness on a GPU-less runner; reproduced deterministically here by making
 * canvas.getContext() return null for WebGL contexts.
 *
 * Expected to be inverted by the UI-U0 work (graceful fallback); until then
 * this test pins the current behaviour so the fix is visible in CI.
 */
import { expect, test } from "@playwright/test";
import { collectPageErrors, ui, useMockedApi } from "../helpers/harness";

test.describe("mocked app API — rendering without WebGL", () => {
  test.beforeEach(async ({ request }) => {
    await useMockedApi(request);
  });

  test("with WebGL available the page renders a canvas and no page errors", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.goto("/");
    await expect(ui.heading(page)).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(1);
    const renderer = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return null;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "available";
    });
    test.info().annotations.push({ type: "webgl-renderer", description: String(renderer) });
    expect(renderer).not.toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test("without WebGL the whole UI unmounts (current behaviour, to be fixed by UI-U0)", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (typeof type === "string" && type.startsWith("webgl")) return null;
        return (original as any).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });

    await page.goto("/");
    await expect.poll(() => pageErrors.length, { message: "an uncaught error is raised while mounting" }).toBeGreaterThan(0);
    expect(pageErrors.some((message) => /WebGL context/i.test(message)), `page errors: ${pageErrors.join(" | ")}`).toBeTruthy();
    await expect(ui.heading(page)).toHaveCount(0);
    await expect(ui.goalInput(page)).toHaveCount(0);
    test.info().annotations.push({ type: "characterization", description: `no WebGL ⇒ React tree unmounted; errors: ${pageErrors.join(" | ")}` });
  });
});
