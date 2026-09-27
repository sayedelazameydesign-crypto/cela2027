# Provider contract — P1 evidence

## Proven state

`main` originally contained one implementation in `packages/llm/src/index.ts`: OpenRouter functions with an internal model fallback chain. `packages/core/src/planner.ts` imported `openRouterChat` and `isOpenRouterConfigured` directly.

This P1 change is intentionally limited to reorganizing that implementation behind additive contracts:

```text
packages/llm/src/
├── index.ts
├── types.ts
├── fabric.ts
└── providers/
    └── openrouter.ts
```

No Gemini or NVIDIA adapter is claimed in this phase. Repository secrets do not prove runtime integration.

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

The existing public exports remain available with their original result shapes:

```ts
openRouterChat(messages, options): Promise<string>
openRouterChatDetailed(messages, options): Promise<ChatResult>
isOpenRouterConfigured(): boolean
```

Those wrappers now delegate to `OpenRouterProvider`. The `provider` evidence field is removed before returning the legacy `ChatResult`, so existing consumers do not observe a response-shape change.

`packages/core/src/planner.ts` is unchanged and therefore preserves:

```text
OpenRouterPlanner
  → openRouterChat
  → OpenRouterProvider
  → existing OpenRouter model fallback

FallbackPlanner
  → existing OfflinePlanner application fallback
```

Provider fallback and application fallback remain separate. The Fabric is exported but not activated in runtime.

## Health semantics

`health()` in P1 reports configuration state only:

```text
configured | unconfigured
```

It does not spend quota or perform a live request. A network health probe belongs to a later integration phase.

## Secret boundaries

Only `OPENROUTER_API_KEY` is consumed by the implemented provider in P1. `GEMINI_API_KEY` and `NVIDIA_API_KEY` may exist in GitHub Actions Secrets, but they remain unused until their adapters are introduced and tested in separate changes.

GitHub Actions secrets are not automatically available to local development, Arena preview, Vercel, or other runtime environments.

## Deferred stages

```text
P2  Gemini adapter + mocked contract tests
P3  NVIDIA adapter + mocked contract tests
P4  routing policy and cost evidence
P5  Planner injection behind a feature flag
P6  reusable workflow entrypoints
P7  UI dispatch/polling integration
```

Do not add provider branches to `Orchestrator`, Planner, or workflow YAML. TypeScript remains business logic; GitHub Actions remains orchestration.

## Not a Nimna/FastAPI repository

This repository has no `config.py`, `core/agent.py`, `NIMNA_ENV`, or FastAPI startup contract. `NIMNA_API_KEY` is therefore not added: it would be an unused secret without an authentication contract.
