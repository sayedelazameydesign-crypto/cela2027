export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Ordered model chain inside one provider. */
  models?: string[];
  temperature?: number;
  maxTokens?: number;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number;
}

/** Backward-compatible response returned by the existing OpenRouter functions. */
export interface ChatResult {
  text: string;
  model: string;
  attempts: { model: string; error: string }[];
}

/** Provider-neutral request used by runtime, CLI, or workflow callers. */
export interface ChatRequest {
  messages: ChatMessage[];
  options?: ChatOptions;
}

/** Provider-neutral response with explicit provider evidence. */
export interface ChatResponse extends ChatResult {
  provider: string;
}

export interface ProviderHealth {
  provider: string;
  configured: boolean;
  status: "configured" | "unconfigured";
}

export interface ModelProvider {
  readonly id: string;
  generate(request: ChatRequest): Promise<ChatResponse>;
  health(): Promise<ProviderHealth>;
}
