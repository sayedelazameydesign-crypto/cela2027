import { describe, it, expect, vi } from "vitest";
import { ProviderFabric, type ModelProvider } from "./src/index";

describe("ProviderFabric - Fallback & Resilience Mechanics", () => {
  it("should failover to Gemini when Primary Provider (OpenRouter) throws an API error", async () => {
    const mockOpenRouter: ModelProvider = {
      id: "openrouter",
      health: async () => ({ provider: "openrouter", configured: true, status: "configured" }),
      generate: vi.fn().mockRejectedValue(new Error("OpenRouter Rate Limit 429")),
    };

    const mockGemini: ModelProvider = {
      id: "gemini",
      health: async () => ({ provider: "gemini", configured: true, status: "configured" }),
      generate: vi.fn().mockResolvedValue({
        provider: "gemini",
        text: '{"steps": []}',
        model: "gemini-2.5-flash",
        attempts: [],
      }),
    };

    const fabric = new ProviderFabric([mockOpenRouter, mockGemini]);

    const result = await fabric.generate({
      providerOrder: ["openrouter", "gemini"],
      messages: [{ role: "user", content: "Test Goal" }],
    });

    expect(mockOpenRouter.generate).toHaveBeenCalledTimes(1);
    expect(mockGemini.generate).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("gemini");
    expect(result.text).toBe('{"steps": []}');
    expect(result.providerAttempts).toEqual([
      { provider: "openrouter", error: "OpenRouter Rate Limit 429" },
    ]);
  });
});
