import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeminiProvider,
  isGeminiConfigured,
  type ChatMessage,
  type ModelProvider,
} from "./src/index";

const messages: ChatMessage[] = [
  { role: "system", content: "Be concise" },
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi" },
  { role: "user", content: "Status?" },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GeminiProvider P2 contract", () => {
  it("accepts GEMINI_API_KEY or the GOOGLE_API_KEY compatibility alias", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "google-test-key-long-enough");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const provider: ModelProvider = new GeminiProvider();

    expect(isGeminiConfigured()).toBe(true);
    await expect(provider.health()).resolves.toEqual({
      provider: "gemini",
      configured: true,
      status: "configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails before HTTP when neither key name is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GeminiProvider();

    expect(isGeminiConfigured()).toBe(false);
    await expect(provider.generate({ messages })).rejects.toThrow(
      "GEMINI_API_KEY or GOOGLE_API_KEY is not configured"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps one shared chat request to one generateContent request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-long-enough");
    vi.stubEnv("GEMINI_BASE_URL", "https://gemini.invalid/v1beta/");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: "gemini" }, { text: "-ok" }] } }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GeminiProvider();

    const result = await provider.generate({
      messages,
      options: {
        models: ["gemini-test"],
        temperature: 0,
        maxTokens: 24,
        timeoutMs: 1_000,
      },
    });

    expect(result).toEqual({
      provider: "gemini",
      text: "gemini-ok",
      model: "gemini-test",
      attempts: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gemini.invalid/v1beta/models/gemini-test:generateContent");
    expect(url).not.toContain("gemini-test-key-long-enough");
    expect(request?.headers).toEqual(
      expect.objectContaining({ "x-goog-api-key": "gemini-test-key-long-enough" })
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      systemInstruction: { parts: [{ text: "Be concise" }] },
      contents: [
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi" }] },
        { role: "user", parts: [{ text: "Status?" }] },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 24 },
    });
  });

  it("reports an empty HTTP response without trying another model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-long-enough");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ candidates: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GeminiProvider();

    await expect(
      provider.generate({ messages, options: { models: ["gemini-empty", "must-not-run"] } })
    ).rejects.toThrow("Gemini request failed for gemini-empty: empty completion");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
