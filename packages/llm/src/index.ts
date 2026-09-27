/**
 * OpenRouter adapter — one key, every model (Claude / GPT / Gemini / open models).
 * Model routing with automatic fallback down the chain; free-tier aware:
 * if a model fails (quota/timeout/server), the next one takes over.
 *
 * The API key lives server-side only — never exposed to the browser.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** ordered model chain; falls back on failure */
  models?: string[];
  temperature?: number;
  maxTokens?: number;
  /** per-attempt timeout ms */
  timeoutMs?: number;
}

const DEFAULT_MODELS = [
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash-001",
];

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.length > 10);
}

function defaultModels(): string[] {
  const fromEnv = process.env.OPENROUTER_MODELS;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.split(",").map((m) => m.trim()).filter(Boolean);
  }
  return DEFAULT_MODELS;
}

export interface ChatResult {
  text: string;
  model: string;
  attempts: { model: string; error: string }[];
}

export async function openRouterChat(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string> {
  const result = await openRouterChatDetailed(messages, opts);
  return result.text;
}

export async function openRouterChatDetailed(
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  const chain = opts.models?.length ? opts.models : defaultModels();
  const attempts: { model: string; error: string }[] = [];

  for (const model of chain) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 4096,
        }),
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        attempts.push({ model, error: `HTTP ${res.status}: ${body.slice(0, 200)}` });
        continue;
      }
      const json: any = await res.json();
      const text: string | undefined = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        attempts.push({ model, error: "empty completion" });
        continue;
      }
      return { text, model, attempts };
    } catch (e: any) {
      attempts.push({ model, error: String(e?.message ?? e) });
    }
  }
  throw new Error(
    `All OpenRouter models failed: ${attempts.map((a) => `${a.model}: ${a.error}`).join(" | ")}`
  );
}
