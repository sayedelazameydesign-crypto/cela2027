/**
 * OpenRouter adapter — preserves the public behavior that existed before
 * ModelProvider while exposing that implementation through the shared contract.
 */

import type {
  ChatMessage,
  ChatOptions,
  ChatRequest,
  ChatResponse,
  ChatResult,
  ModelProvider,
  ProviderHealth,
} from "../types";

/**
 * Free-first chain from the existing implementation. Keep this order stable in
 * the contract migration; changing routing belongs to a separate change.
 */
const DEFAULT_MODELS = [
  "deepseek/deepseek-chat-v3.1:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "anthropic/claude-sonnet-4.5",
];

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.length > 10);
}

function defaultModels(): string[] {
  const fromEnv = process.env.OPENROUTER_MODELS;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.split(",").map((model) => model.trim()).filter(Boolean);
  }
  return DEFAULT_MODELS;
}

async function requestOpenRouter(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const chain = options.models?.length ? options.models : defaultModels();
  const attempts: ChatResult["attempts"] = [];

  for (const model of chain) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/sayedelazameydesign-crypto/cela2027",
          "X-Title": "cela2027",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 4096,
        }),
      }).finally(() => clearTimeout(timer));

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        attempts.push({ model, error: `HTTP ${response.status}: ${body.slice(0, 200)}` });
        continue;
      }

      const json: any = await response.json();
      const text: string | undefined = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        attempts.push({ model, error: "empty completion" });
        continue;
      }
      return { text, model, attempts };
    } catch (error: any) {
      attempts.push({ model, error: String(error?.message ?? error) });
    }
  }

  throw new Error(
    `All OpenRouter models failed: ${attempts
      .map((attempt) => `${attempt.model}: ${attempt.error}`)
      .join(" | ")}`
  );
}

export class OpenRouterProvider implements ModelProvider {
  readonly id = "openrouter";

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const result = await requestOpenRouter(request.messages, request.options);
    return { ...result, provider: this.id };
  }

  async health(): Promise<ProviderHealth> {
    const configured = isOpenRouterConfigured();
    return {
      provider: this.id,
      configured,
      status: configured ? "configured" : "unconfigured",
    };
  }
}

const defaultProvider = new OpenRouterProvider();

/** Existing API retained so packages/core/src/planner.ts remains untouched. */
export async function openRouterChatDetailed(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  const { provider: _provider, ...result } = await defaultProvider.generate({ messages, options });
  return result;
}

/** Existing API retained so packages/core/src/planner.ts remains untouched. */
export async function openRouterChat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const result = await openRouterChatDetailed(messages, options);
  return result.text;
}
