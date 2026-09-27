import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Single compatibility gate runner (governance template).
 *
 * Runs `verify[]` from .governance/project.json in order, stops at the first
 * failure, and prints a measured summary.  One command locally and in CI:
 *
 *     node tools/governance-template/scripts/verify.mjs
 *
 * Requires: node. Steps may invoke any language toolchain.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function repoRootFromGit() {
  try {
    return spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: here, encoding: "utf8" })
      .stdout.trim();
  } catch {
    return path.resolve(here, "..");
  }
}

const root = repoRootFromGit() || process.cwd();
const configPath = path.join(root, ".governance", "project.json");

let config;
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (error) {
  console.error(`cannot read ${configPath}: ${error.message}`);
  process.exit(2);
}

const steps = Array.isArray(config.verify) ? config.verify : [];
if (steps.length === 0) {
  console.error("verify[] is empty; nothing to gate");
  process.exit(2);
}

const shell = process.platform === "win32" ? "cmd" : "sh";
const flag = process.platform === "win32" ? "/c" : "-c";
const started = Date.now();
const results = [];

for (const step of steps) {
  const label = step.name ?? step.command;
  const began = Date.now();
  process.stdout.write(`\n── ${label}\n   $ ${step.command}\n`);
  const run = spawnSync(shell, [flag, step.command], { cwd: root, stdio: "inherit" });
  results.push({ label, ok: run.status === 0, ms: Date.now() - began });
  if (run.status !== 0) {
    console.error(`\nverify FAILED at "${label}" (exit ${run.status}).`);
    for (const item of results) {
      console.error(`  ${item.ok ? "PASS" : "FAIL"}  ${item.label}  (${item.ms}ms)`);
    }
    process.exit(run.status ?? 1);
  }
}

console.log(`\nverify OK — ${results.length} gates in ${Date.now() - started}ms:`);
for (const item of results) console.log(`  PASS  ${item.label}  (${item.ms}ms)`);
