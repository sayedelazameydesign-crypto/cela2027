import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  ProviderHealth,
} from "./types";

export interface ProviderAttempt {
  provider: string;
  error: string;
}

export interface FabricRequest extends ChatRequest {
  /** Explicit order only; routing policy is intentionally deferred. */
  providerOrder: string[];
}

export interface FabricResponse extends ChatResponse {
  providerAttempts: ProviderAttempt[];
}

/**
 * Provider-neutral dispatcher. It contains no provider-specific conditions and
 * has no implicit routing order, so introducing it cannot change runtime behavior.
 */
export class ProviderFabric {
  private readonly providers = new Map<string, ModelProvider>();

  constructor(providers: ModelProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.id)) {
        throw new Error(`Duplicate model provider: ${provider.id}`);
      }
      this.providers.set(provider.id, provider);
    }
  }

  async health(): Promise<ProviderHealth[]> {
    return Promise.all([...this.providers.values()].map((provider) => provider.health()));
  }

  async generate(request: FabricRequest): Promise<FabricResponse> {
    const providerAttempts: ProviderAttempt[] = [];

    for (const providerId of request.providerOrder) {
      const provider = this.providers.get(providerId);
      if (!provider) {
        providerAttempts.push({ provider: providerId, error: "provider not registered" });
        continue;
      }

      const health = await provider.health();
      if (!health.configured) {
        providerAttempts.push({ provider: providerId, error: "provider not configured" });
        continue;
      }

      try {
        const response = await provider.generate({
          messages: request.messages,
          options: request.options,
        });
        return { ...response, providerAttempts };
      } catch (error: any) {
        providerAttempts.push({
          provider: provider.id,
          error: String(error?.message ?? error),
        });
      }
    }

    throw new Error(
      `All model providers failed: ${providerAttempts
        .map((attempt) => `${attempt.provider}: ${attempt.error}`)
        .join(" | ")}`
    );
  }
}
