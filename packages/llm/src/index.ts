/**
 * @cela/llm public surface.
 *
 * Existing OpenRouter exports remain source-compatible. Provider-neutral types
 * and ProviderFabric are additive and are not wired into Core in this phase.
 */

export {
  OpenRouterProvider,
  isOpenRouterConfigured,
  openRouterChat,
  openRouterChatDetailed,
} from "./providers/openrouter";
export { ProviderFabric } from "./fabric";
export type {
  FabricRequest,
  FabricResponse,
  ProviderAttempt,
} from "./fabric";
export type {
  ChatMessage,
  ChatOptions,
  ChatRequest,
  ChatResponse,
  ChatResult,
  ModelProvider,
  ProviderHealth,
} from "./types";
