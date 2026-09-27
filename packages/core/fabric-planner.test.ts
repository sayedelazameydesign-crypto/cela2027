import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderFabric, type ModelProvider } from "@cela/llm";
import { FabricPlanner, OfflinePlanner, createDefaultPlanner } from "./src/planner";

const planJSON = JSON.stringify({ summary: "ok", steps: [{ tool: "write", title: "ملف", args: { path: "a.txt", content: "ok" } }] });

afterEach(() => vi.unstubAllEnvs());

describe("FabricPlanner integration", () => {
  it("uses Gemini's plan after an OpenRouter failure", async () => {
    const primary: ModelProvider = {
      id: "openrouter", health: async () => ({ provider: "openrouter", configured: true, status: "configured" }),
      generate: vi.fn().mockRejectedValue(new Error("HTTP 429")),
    };
    const secondary: ModelProvider = {
      id: "gemini", health: async () => ({ provider: "gemini", configured: true, status: "configured" }),
      generate: vi.fn().mockResolvedValue({ provider: "gemini", text: planJSON, model: "test", attempts: [] }),
    };
    const planner = new FabricPlanner({ fabric: new ProviderFabric([primary, secondary]) });
    expect((await planner.plan("goal")).steps[0].args.path).toBe("a.txt");
    expect(primary.generate).toHaveBeenCalledTimes(1);
    expect(secondary.generate).toHaveBeenCalledTimes(1);
  });

  it("retains offline mode when neither API key is set", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    expect(createDefaultPlanner()).toBeInstanceOf(OfflinePlanner);
  });
});
