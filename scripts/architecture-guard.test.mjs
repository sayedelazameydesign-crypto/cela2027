import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectModuleReferences, resolveAlias } from "./check-architecture.mjs";

describe("architecture import parser", () => {
  it("covers type imports, re-exports, dynamic imports, import types, and require", () => {
    const source = `
      import type { Store } from "@cela/store";
      export type { SandboxResult } from "@cela/sandbox";
      export { openRouterChat } from "@cela/llm";
      const lazy = import("@cela/core");
      type Planner = import("@cela/core").Planner;
      import Tools = require("@cela/tools");
      const legacy = require("@cela/core/legacy");
    `;

    const parsed = collectModuleReferences(source, "fixture.ts");

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.references).toEqual(
      expect.arrayContaining([
        { specifier: "@cela/store", kind: "import type" },
        { specifier: "@cela/sandbox", kind: "export type" },
        { specifier: "@cela/llm", kind: "re-export" },
        { specifier: "@cela/core", kind: "dynamic import" },
        { specifier: "@cela/core", kind: "import type expression" },
        { specifier: "@cela/tools", kind: "import equals" },
        { specifier: "@cela/core/legacy", kind: "require" },
      ])
    );
  });

  it("fails closed for computed dynamic imports", () => {
    const parsed = collectModuleReferences(
      "const provider = '@cela/llm'; import(provider); require(provider);",
      "fixture.ts"
    );

    expect(parsed.references).toEqual([]);
    expect(parsed.diagnostics).toEqual([
      "dynamic import must use a static string literal so its boundary can be verified",
      "require must use a static string literal so its boundary can be verified",
    ]);
  });

  it("resolves wildcard aliases to canonical filesystem targets", () => {
    const config = {
      base: path.resolve("/repo"),
      paths: { "@web/*": ["apps/web/*"] },
    };

    expect(resolveAlias(config, "@web/lib/runtime")).toEqual([
      path.resolve("/repo/apps/web/lib/runtime"),
    ]);
    expect(resolveAlias(config, "external-package")).toEqual([]);
  });
});
