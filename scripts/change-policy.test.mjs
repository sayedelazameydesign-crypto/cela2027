import { describe, expect, it } from "vitest";
import { isProtectedPath, looksBinary, textProblems } from "./check-change-policy.mjs";

describe("change policy guard", () => {
  it("protects runtime contracts but permits adjacent characterization tests", () => {
    expect(isProtectedPath("packages/core/src/orchestrator.ts")).toBe(true);
    expect(isProtectedPath("packages/store/src/index.ts")).toBe(true);
    expect(isProtectedPath("apps/web/app/api/task/[id]/events/route.ts")).toBe(true);
    expect(isProtectedPath("apps/web/lib/agent-runtime.ts")).toBe(true);

    expect(isProtectedPath("packages/core/public-contract.test.ts")).toBe(false);
    expect(isProtectedPath("apps/web/app/api/api-contract.test.ts")).toBe(false);
    expect(isProtectedPath("docs/SAFE_EVOLUTION.md")).toBe(false);
  });

  it("detects binary content without classifying normal UTF-8 text as binary", () => {
    expect(looksBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(true);
    expect(looksBinary(Buffer.from("سياسة تطوير آمنة\nplain text\n", "utf8"))).toBe(false);
  });

  it("checks whitespace and conflict markers in untracked text too", () => {
    expect(textProblems("clean\ntext\n")).toEqual([]);
    expect(textProblems("bad  \n<<<<<<< HEAD\n")).toEqual([
      "line 1: trailing whitespace",
      "line 2: unresolved conflict marker",
    ]);
  });
});
