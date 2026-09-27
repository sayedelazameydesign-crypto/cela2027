import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkArchitecture as templateCheck } from "../scripts/check-architecture.mjs";
import { checkArchitecture as sourceCheck } from "../../../scripts/check-architecture.mjs";
import {
  DEFAULT_PROTECTED_PATTERNS,
  isProtectedPath,
  looksBinary,
  protectedMatchers,
  textProblems,
} from "../scripts/check-change-policy.mjs";
import { isProtectedPath as sourceIsProtectedPath } from "../../../scripts/check-change-policy.mjs";

/**
 * Template self-tests.  Named `run-tests.mjs` on purpose so neither the root
 * vitest include globs nor `node --test` discovery pick it up: the template is
 * inert until a project installs it.
 *
 * Run: node tools/governance-template/tests/run-tests.mjs
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const scriptsDir = path.join(here, "..", "scripts");

test("the generalized architecture guard is equivalent to the repository guard", async () => {
  const config = JSON.parse(
    await readFile(path.join(here, "..", ".governance", "project.json"), "utf8")
  );
  const [template, source] = await Promise.all([
    templateCheck(repoRoot, config),
    sourceCheck(),
  ]);

  assert.deepEqual(
    template.violations,
    source.violations,
    "violation sets must match exactly (both empty on a clean tree)"
  );
  assert.equal(template.workspaces.length, source.workspaces.length);
  assert.ok(template.workspaces.length >= 6, "expected the six cela2027 workspaces");
});

test("protected-path semantics match the repository guard when patterns are declared", () => {
  const matchers = protectedMatchers({
    protectedPatterns: [
      "^packages/(core|llm|sandbox|store|tools)/src/",
      "^apps/web/app/api/(?:.*\\/)?route\\.ts$",
      "^apps/web/lib/agent-runtime\\.ts$",
    ],
  });
  const samples = [
    "packages/core/src/orchestrator.ts",
    "packages/llm/src/providers/gemini.ts",
    "apps/web/app/api/task/route.ts",
    "apps/web/app/api/task/[id]/events/route.ts",
    "apps/web/lib/agent-runtime.ts",
    "apps/web/app/page.tsx",
    "docs/STATUS.md",
    "packages/core/orchestrator.test.ts",
    "scripts/check-architecture.mjs",
  ];
  for (const sample of samples) {
    assert.equal(
      isProtectedPath(sample, matchers),
      sourceIsProtectedPath(sample),
      `protection disagreement for ${sample}`
    );
  }
});

test("the default protected patterns are conservative when undeclared", () => {
  const matchers = protectedMatchers({});
  assert.deepEqual(DEFAULT_PROTECTED_PATTERNS, ["^packages/[^/]+/src/", "^src/"]);
  assert.equal(isProtectedPath("src/index.ts", matchers), true);
  assert.equal(isProtectedPath("docs/STATUS.md", matchers), false);
});

test("text and binary helpers behave as the source guard", () => {
  assert.deepEqual(textProblems("clean\nlines\n"), []);
  assert.equal(textProblems("trailing   \n").length, 1);
  assert.equal(textProblems("======= next\n").length, 1);
  assert.equal(looksBinary(Buffer.from([0x00, 0x01])), true);
  assert.equal(looksBinary(Buffer.from("plain text")), false);
  assert.equal(looksBinary(Buffer.alloc(0)), false);
});

test("the python change-policy port agrees with the node guard byte for byte", async () => {
  const node = spawnSync("node", [path.join(repoRoot, "scripts", "check-change-policy.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const python = spawnSync(
    "python3",
    [path.join(scriptsDir, "check-change-policy.py"), "--root", repoRoot],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(node.status, 0, node.stderr);
  assert.equal(python.status, 0, python.stderr);
  assert.equal(python.stdout.trim(), node.stdout.trim());
});

test("the repository declares the protected patterns its hardcoded guard enforces", async () => {
  const policy = JSON.parse(await readFile(path.join(repoRoot, ".github", "change-policy.json"), "utf8"));
  const declared = protectedMatchers(policy);
  const samples = [
    "packages/core/src/orchestrator.ts",
    "packages/llm/src/providers/gemini.ts",
    "packages/store/src/index.ts",
    "apps/web/app/api/task/route.ts",
    "apps/web/app/api/task/[id]/events/route.ts",
    "apps/web/lib/agent-runtime.ts",
    "apps/web/app/page.tsx",
    "apps/web/components/NetworkGraph.tsx",
    "docs/STATUS.md",
    "tools/governance-template/scripts/check-architecture.mjs",
    "packages/core/orchestrator.test.ts",
    "scripts/check-architecture.mjs",
  ];
  for (const sample of samples) {
    assert.equal(
      isProtectedPath(sample, declared),
      sourceIsProtectedPath(sample),
      `declared patterns disagree with the hardcoded guard for ${sample}`
    );
  }
});

test("the python import-boundary guard accepts stdlib-only code", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gov-clean-"));
  try {
    await mkdir(path.join(root, "core"), { recursive: true });
    await writeFile(path.join(root, "core", "kernel.py"), "import json\nfrom pathlib import Path\nfrom . import models\n");
    await writeFile(path.join(root, "core", "models.py"), "from __future__ import annotations\n");
    await mkdir(path.join(root, ".governance"), { recursive: true });
    await writeFile(
      path.join(root, ".governance", "project.json"),
      JSON.stringify({
        language: "python",
        scans: { python: { include: ["core"], localPackages: ["core"], declaredThirdParty: [] } },
      })
    );
    const run = spawnSync("python3", [path.join(scriptsDir, "check-import-boundary.py"), root], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Import boundary OK/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the python import-boundary guard fails closed on an undeclared dependency", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gov-dirty-"));
  try {
    await mkdir(path.join(root, "core"), { recursive: true });
    await writeFile(path.join(root, "core", "kernel.py"), "import json\nimport requests\n\ndef f():\n    import boto3\n");
    await mkdir(path.join(root, ".governance"), { recursive: true });
    await writeFile(
      path.join(root, ".governance", "project.json"),
      JSON.stringify({
        language: "python",
        scans: { python: { include: ["core"], localPackages: ["core"], declaredThirdParty: [] } },
      })
    );
    const run = spawnSync("python3", [path.join(scriptsDir, "check-import-boundary.py"), root], {
      encoding: "utf8",
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /undeclared third-party import `requests`/);
    // an import hidden inside a function body is still a dependency
    assert.match(run.stderr, /undeclared third-party import `boto3`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the python import-boundary guard refuses to run without a scan target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gov-empty-"));
  try {
    await mkdir(path.join(root, ".governance"), { recursive: true });
    await writeFile(
      path.join(root, ".governance", "project.json"),
      JSON.stringify({ language: "python", scans: { python: { include: [] } } })
    );
    const run = spawnSync("python3", [path.join(scriptsDir, "check-import-boundary.py"), root], {
      encoding: "utf8",
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /scans\.python\.include is empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
