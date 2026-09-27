#!/usr/bin/env node
/**
 * check-container — keeps the Playwright container pin honest.
 *
 *   node e2e/scripts/check-container.mjs            # offline consistency checks
 *   node e2e/scripts/check-container.mjs --online   # + compare digest with the registry
 *
 * Offline checks (always):
 *   - e2e/package.json pins @playwright/test to an exact version (no ^ or ~)
 *   - that version equals the container tag (v<version>-noble)
 *   - installed @playwright/test (if node_modules exists) matches the pin
 *   - baseline.json chromium version matches playwright-core/browsers.json
 *   - the digest has the sha256:<64 hex> shape
 *   - .github/workflows/e2e.yml uses exactly `<registry>/<repo>:<tag>@<digest>`
 *   - docs/E2E_BASELINE.md quotes the same tag and digest
 *
 * Online check (--online): HEAD https://<registry>/v2/<repo>/manifests/<tag>
 * with OCI/Docker index Accept headers and compare Docker-Content-Digest.
 * Network failure is reported as UNVERIFIED (exit 2), never as success.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { baseline, e2eRoot, readJson, reporter, repoRoot } from "./lib.mjs";

const online = process.argv.includes("--online");
let registryUnreachable = "";
const report = reporter("E2E container pin");
const pins = baseline();
const { container, playwright } = pins;

const imageRef = `${container.registry}/${container.repository}:${container.tag}@${container.digest}`;

// 1. exact version pin in e2e/package.json
const pkg = readJson(path.join(e2eRoot, "package.json"));
const declared = pkg.devDependencies?.["@playwright/test"] ?? pkg.dependencies?.["@playwright/test"];
if (!declared) {
  report.fail("e2e/package.json does not declare @playwright/test");
} else if (!/^\d+\.\d+\.\d+$/.test(declared)) {
  report.fail(`@playwright/test must be pinned exactly (got "${declared}")`);
} else if (declared !== playwright.version) {
  report.fail(`@playwright/test ${declared} != baseline.json playwright.version ${playwright.version}`);
}

// 2. tag <-> version parity
const expectedTag = `v${playwright.version}-noble`;
if (container.tag !== expectedTag) {
  report.fail(`container.tag ${container.tag} must equal ${expectedTag}`);
}

// 3. installed package parity (when installed)
const installedPkgPath = path.join(e2eRoot, "node_modules", "@playwright", "test", "package.json");
if (existsSync(installedPkgPath)) {
  const installed = readJson(installedPkgPath).version;
  if (installed !== playwright.version) {
    report.fail(`installed @playwright/test ${installed} != pinned ${playwright.version} (run npm ci --prefix e2e)`);
  } else {
    report.note(`installed @playwright/test ${installed}`);
  }
  const browsersPath = path.join(e2eRoot, "node_modules", "playwright-core", "browsers.json");
  if (existsSync(browsersPath)) {
    const chromium = readJson(browsersPath).browsers.find((b) => b.name === "chromium");
    if (chromium?.browserVersion !== playwright.chromium) {
      report.fail(`playwright-core expects chromium ${chromium?.browserVersion}, baseline says ${playwright.chromium}`);
    } else {
      report.note(`expected chromium ${chromium.browserVersion}`);
    }
  }
} else {
  report.note("e2e/node_modules not installed — skipped installed-version parity");
}

// 4. digest shape
if (!/^sha256:[0-9a-f]{64}$/.test(container.digest)) {
  report.fail(`container.digest has an invalid shape: ${container.digest}`);
}
for (const [platform, digest] of Object.entries(container.platformDigests ?? {})) {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) report.fail(`platformDigests[${platform}] invalid: ${digest}`);
}

// 5. workflow uses the exact pinned reference
const workflowPath = path.join(repoRoot, ".github", "workflows", "e2e.yml");
if (!existsSync(workflowPath)) {
  report.fail(".github/workflows/e2e.yml is missing");
} else {
  const workflow = readFileSync(workflowPath, "utf8");
  const imageLines = workflow.split("\n").filter((line) => /^\s*image:\s*/.test(line));
  if (imageLines.length === 0) {
    report.fail("e2e.yml declares no container image");
  }
  for (const line of imageLines) {
    const value = line.replace(/^\s*image:\s*/, "").trim().replace(/^["']|["']$/g, "");
    if (value !== imageRef) {
      report.fail(`e2e.yml image "${value}" != pinned "${imageRef}"`);
    }
  }
  if (imageLines.length > 0) report.note(`${imageLines.length} workflow job(s) pinned to ${container.tag}@${container.digest.slice(0, 19)}…`);
}

// 6. docs agree
const docPath = path.join(repoRoot, "docs", "E2E_BASELINE.md");
if (existsSync(docPath)) {
  const doc = readFileSync(docPath, "utf8");
  if (!doc.includes(container.digest)) report.fail("docs/E2E_BASELINE.md does not quote the pinned digest");
  if (!doc.includes(`${container.registry}/${container.repository}:${container.tag}`)) {
    report.fail("docs/E2E_BASELINE.md does not quote the pinned image tag");
  }
}

// 7. online digest comparison
if (online) {
  const url = `https://${container.registry}/v2/${container.repository}/manifests/${container.tag}`;
  const accept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(", ");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(url, { method: "HEAD", headers: { Accept: accept }, signal: controller.signal });
    clearTimeout(timer);
    const remote = response.headers.get("docker-content-digest");
    if (!response.ok || !remote) {
      report.fail(`registry answered ${response.status} without Docker-Content-Digest for ${container.tag}`);
    } else if (remote !== container.digest) {
      report.fail(`registry digest ${remote} != pinned ${container.digest} (tag moved; re-pin deliberately)`);
    } else {
      report.note(`registry confirms ${container.tag} → ${remote}`);
    }
  } catch (error) {
    registryUnreachable = String(error?.message ?? error);
  }
}

if (report.finish() && registryUnreachable) {
  console.error(`E2E container pin: online digest UNVERIFIED — registry unreachable (${registryUnreachable}); offline checks passed`);
  process.exitCode = 2;
}
