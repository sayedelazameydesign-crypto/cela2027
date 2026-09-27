import { describe, expect, it } from "vitest";
import { SANDBOX_TIMEOUT_MS, validateSandboxCode } from "./src/index";

describe("Sandbox compatibility contract", () => {
  it("keeps the published timeout at 30 seconds", () => {
    expect(SANDBOX_TIMEOUT_MS).toBe(30_000);
  });

  it("accepts ordinary Python and rejects empty or oversized input", () => {
    expect(validateSandboxCode("print('ok')")).toEqual({ allowed: true });
    expect(validateSandboxCode("   ")).toEqual({ allowed: false, reason: "كود فارغ" });
    expect(validateSandboxCode("x".repeat(100_001))).toEqual({
      allowed: false,
      reason: "الكود يتجاوز 100 ألف حرف",
    });
  });
});
