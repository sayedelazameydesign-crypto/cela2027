import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  OpenRouterProvider,
  ProviderFabric,
  isOpenRouterConfigured,
  openRouterChatDetailed,
  type ChatMessage,
  type ModelProvider,
} from "./src/index";

const messages: ChatMessage[] = [{ role: "user", content: "Reply briefly" }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenRouter backward-compatibility contract", () => {
  it("keeps configuration detection server-side", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(isOpenRouterConfigured()).toBe(false);

    vi.stubEnv("OPENROUTER_API_KEY", "test-key-long-enough");
    expect(isOpenRouterConfigured()).toBe(true);
  });

  it("keeps the existing model fallback result and attempt evidence", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-long-enough");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("quota", { status: 429 }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: "ok" } }] })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await openRouterChatDetailed(messages, {
      models: ["provider/first", "provider/second"],
      timeoutMs: 1_000,
    });

    // Exact legacy shape: no provider/fabric fields leak into existing consumers.
    expect(result).toEqual({
      text: "ok",
      model: "provider/second",
      attempts: [{ model: "provider/first", error: "HTTP 429: quota" }],
    });
    const [url, request] = fetchMock.mock.calls[1];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer test-key-long-enough" })
    );
  });

  it("keeps the existing missing-key failure", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(openRouterChatDetailed(messages)).rejects.toThrow(
      "OPENROUTER_API_KEY is not configured"
    );
  });
});

describe("ModelProvider contract", () => {
  it("exposes generate and health without changing the legacy wrapper", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-long-enough");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ choices: [{ message: { content: "provider-ok" } }] })
      )
    );
    const provider: ModelProvider = new OpenRouterProvider();

    expectTypeOf(provider.generate).toBeFunction();
    expectTypeOf(provider.health).toBeFunction();
    await expect(provider.health()).resolves.toEqual({
      provider: "openrouter",
      configured: true,
      status: "configured",
    });
    await expect(
      provider.generate({ messages, options: { models: ["provider/model"] } })
    ).resolves.toEqual({
      provider: "openrouter",
      text: "provider-ok",
      model: "provider/model",
      attempts: [],
    });
  });
});

describe("ProviderFabric contract", () => {
  it("uses only the explicit order and records provider fallback evidence", async () => {
    const unconfigured: ModelProvider = {
      id: "primary",
      health: async () => ({
        provider: "primary",
        configured: false,
        status: "unconfigured",
      }),
      generate: vi.fn(),
    };
    const failing: ModelProvider = {
      id: "fallback-a",
      health: async () => ({
        provider: "fallback-a",
        configured: true,
        status: "configured",
      }),
      generate: vi.fn().mockRejectedValue(new Error("temporary outage")),
    };
    const healthy: ModelProvider = {
      id: "fallback-b",
      health: async () => ({
        provider: "fallback-b",
        configured: true,
        status: "configured",
      }),
      generate: vi.fn().mockResolvedValue({
        provider: "fallback-b",
        text: "fabric-ok",
        model: "model-b",
        attempts: [],
      }),
    };
    const fabric = new ProviderFabric([unconfigured, failing, healthy]);

    await expect(
      fabric.generate({
        providerOrder: ["primary", "missing", "fallback-a", "fallback-b"],
        messages,
      })
    ).resolves.toEqual({
      provider: "fallback-b",
      text: "fabric-ok",
      model: "model-b",
      attempts: [],
      providerAttempts: [
        { provider: "primary", error: "provider not configured" },
        { provider: "missing", error: "provider not registered" },
        { provider: "fallback-a", error: "temporary outage" },
      ],
    });
    expect(unconfigured.generate).not.toHaveBeenCalled();
  });

  it("aggregates health without performing model requests", async () => {
    const provider = new OpenRouterProvider();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fabric = new ProviderFabric([provider]);

    await expect(fabric.health()).resolves.toEqual([
      { provider: "openrouter", configured: false, status: "unconfigured" },
    ]);
  });

  it("rejects duplicate provider identifiers", () => {
    const provider = new OpenRouterProvider();
    expect(() => new ProviderFabric([provider, provider])).toThrow(
      "Duplicate model provider: openrouter"
    );
  });
});
