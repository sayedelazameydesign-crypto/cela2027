# Provider contracts — P1/P2 evidence

## Proven state

`main` originally contained one implementation in `packages/llm/src/index.ts`: OpenRouter functions with an internal model fallback chain. `packages/core/src/planner.ts` imported `openRouterChat` and `isOpenRouterConfigured` directly.

P1 introduced the provider-neutral contracts and moved the existing OpenRouter implementation without changing Core. P2 adds only the Gemini adapter:

```text
packages/llm/src/
├── index.ts
├── types.ts
├── fabric.ts
└── providers/
    ├── openrouter.ts
    └── gemini.ts       # P2
```

No NVIDIA adapter or workflow orchestration is claimed in P2. Repository secrets do not prove runtime integration.

## Stable contracts

```ts
interface ModelProvider {
  readonly id: string;
  generate(request: ChatRequest): Promise<ChatResponse>;
  health(): Promise<ProviderHealth>;
}
```

`ProviderFabric` accepts registered providers and requires an explicit `providerOrder` on every generation request. It has no implicit routing policy and no provider-specific branches.

## Backward compatibility

The existing public OpenRouter exports remain available with their original result shapes:

```ts
openRouterChat(messages, options): Promise<string>
openRouterChatDetailed(messages, options): Promise<ChatResult>
isOpenRouterConfigured(): boolean
```

Those wrappers delegate to `OpenRouterProvider`. The `provider` evidence field is removed before returning the legacy `ChatResult`, so existing consumers do not observe a response-shape change.

`packages/core/src/planner.ts` remains unchanged:

```text
OpenRouterPlanner
  → openRouterChat
  → OpenRouterProvider
  → existing OpenRouter model fallback

FallbackPlanner
  → existing OfflinePlanner application fallback
```

Provider fallback and application fallback remain separate. The Fabric is exported but not activated in runtime.

## P2: Gemini adapter

`GeminiProvider` translates the shared chat contract to the Gemini `generateContent` HTTP boundary:

- `system` messages become `systemInstruction`.
- `assistant` becomes Gemini's `model` role.
- the API key is sent in `x-goog-api-key`, not in the URL.
- `GEMINI_API_KEY` is preferred; `GOOGLE_API_KEY` is a compatibility alias.
- exactly one model is attempted; P2 introduces no model/provider fallback policy.
- successful responses retain the shared evidence shape with an empty `attempts` list.

P2 uses mocked HTTP contract tests only. It does not register Gemini in a runtime Fabric, change provider selection, or consume live quota.

## Health semantics

`health()` reports configuration state only:

```text
configured | unconfigured
```

It does not spend quota or perform a live request. A network health probe belongs to a later integration phase.

## Secret boundaries

Implemented providers consume only:

```text
OpenRouterProvider → OPENROUTER_API_KEY
GeminiProvider     → GEMINI_API_KEY | GOOGLE_API_KEY
```

`NVIDIA_API_KEY` may exist in GitHub Actions Secrets, but remains unused until its adapter is introduced and tested separately. GitHub Actions secrets are not automatically available to local development, Arena preview, Vercel, or other runtime environments.

## Deferred stages

```text
P3  NVIDIA adapter + mocked contract tests
P4  routing policy and cost evidence
P5  Planner injection behind a feature flag
P6  reusable workflow entrypoints
P7  UI dispatch/polling integration
```

Do not add provider branches to `Orchestrator`, Planner, or workflow YAML. TypeScript remains business logic; GitHub Actions remains orchestration.

## Not a Nimna/FastAPI repository

This repository has no `config.py`, `core/agent.py`, `NIMNA_ENV`, or FastAPI startup contract. `NIMNA_API_KEY` is not added: it would be an unused secret without an authentication contract.
