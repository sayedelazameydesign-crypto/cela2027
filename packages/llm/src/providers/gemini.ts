import type {
  ChatMessage,
  ChatOptions,
  ChatRequest,
  ChatResponse,
  ChatResult,
  ModelProvider,
  ProviderHealth,
} from "../types";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

export function isGeminiConfigured(): boolean {
  const key = apiKey();
  return Boolean(key && key.length > 10);
}

function selectedModel(options: ChatOptions): string {
  return options.models?.[0] || process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function baseUrl(): string {
  return (process.env.GEMINI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function requestBody(messages: ChatMessage[], options: ChatOptions) {
  const systemInstruction = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  return {
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxTokens ?? 4096,
    },
  };
}

async function requestGemini(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  const key = apiKey();
  if (!key) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not configured");

  const model = selectedModel(options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);

  try {
    const response = await fetch(
      `${baseUrl()}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-goog-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody(messages, options)),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Gemini request failed for ${model}: HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const json: any = await response.json();
    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
      : "";
    if (!text) throw new Error(`Gemini request failed for ${model}: empty completion`);

    return { text, model, attempts: [] };
  } catch (error: any) {
    if (error instanceof Error && error.message.startsWith("Gemini request failed")) throw error;
    throw new Error(`Gemini request failed for ${model}: ${String(error?.message ?? error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export class GeminiProvider implements ModelProvider {
  readonly id = "gemini";

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const result = await requestGemini(request.messages, request.options);
    return { ...result, provider: this.id };
  }

  async health(): Promise<ProviderHealth> {
    const configured = isGeminiConfigured();
    return {
      provider: this.id,
      configured,
      status: configured ? "configured" : "unconfigured",
    };
  }
}
