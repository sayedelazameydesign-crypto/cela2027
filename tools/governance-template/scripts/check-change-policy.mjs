import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Language-agnostic change-policy guard (governance template).
 *
 * Ported from cela2027 `scripts/check-change-policy.mjs` with exactly three
 * generalizations, no behavioral additions:
 *   1. repository root discovered via `git rev-parse --show-toplevel`, so this
 *      file can live at any depth in the target repository;
 *   2. protected runtime paths are declared as regex strings in
 *      `.github/change-policy.json` → `protectedPatterns`, instead of being
 *      hardcoded per repository;
 *   3. when `protectedPatterns` is absent, a conservative default applies.
 *
 * Requires: git. Works in any language.
 *
 * Policy file shape:
 *   {
 *     "classification": "A|B|C|D|E|F",
 *     "reason": "at least 20 characters explaining the change",
 *     "protectedPatterns": ["^core/.*\\.py$", "^tests/"],     // optional
 *     "protectedChanges": [],        // must list exactly this change's protected paths
 *     "allowedBinaryChanges": []     // must list exactly this change's binary paths
 *   }
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: here,
      encoding: "utf8",
    }).trim();
  } catch {
    return path.resolve(here, "..");
  }
}

const root = repoRoot();
const policyPath = ".github/change-policy.json";
const validClassifications = new Set(["A", "B", "C", "D", "E", "F"]);

/** Used only when the policy declares no `protectedPatterns`. */
export const DEFAULT_PROTECTED_PATTERNS = ["^packages/[^/]+/src/", "^src/"];

function git(args, { optional = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    if (optional) return String(error?.stdout ?? "").trim();
    throw error;
  }
}

function lines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function refExists(ref) {
  return Boolean(git(["rev-parse", "--verify", "--quiet", ref], { optional: true }));
}

function comparisonBase() {
  if (process.env.CHANGE_BASE && refExists(process.env.CHANGE_BASE)) {
    return process.env.CHANGE_BASE;
  }
  if (process.env.GITHUB_BASE_REF) {
    const remote = `origin/${process.env.GITHUB_BASE_REF}`;
    if (refExists(remote)) return remote;
  }
  return refExists("origin/main") ? "origin/main" : undefined;
}

function diffArguments(base, suffix) {
  return base ? ["diff", ...suffix, `${base}...HEAD`, "--"] : [];
}

function changedFiles(base) {
  const changed = new Set();
  if (base) {
    for (const file of lines(git(diffArguments(base, ["--name-only", "--diff-filter=ACMRD"])))) {
      changed.add(file);
    }
  }
  for (const file of lines(git(["diff", "--name-only", "--diff-filter=ACMRD", "HEAD", "--"]))) {
    changed.add(file);
  }
  for (const file of lines(git(["ls-files", "--others", "--exclude-standard"]))) {
    changed.add(file);
  }
  return [...changed].sort();
}

function binaryFilesFromDiff(base) {
  const binary = new Set();
  const outputs = [];
  if (base) outputs.push(git(diffArguments(base, ["--numstat"]), { optional: true }));
  outputs.push(git(["diff", "--numstat", "HEAD", "--"], { optional: true }));
  for (const output of outputs) {
    for (const row of lines(output)) {
      const [added, deleted, ...fileParts] = row.split("\t");
      if (added === "-" && deleted === "-") binary.add(fileParts.join("\t"));
    }
  }
  return binary;
}

export function protectedMatchers(policy) {
  const patterns =
    Array.isArray(policy.protectedPatterns) && policy.protectedPatterns.length > 0
      ? policy.protectedPatterns
      : DEFAULT_PROTECTED_PATTERNS;
  return patterns.map((pattern) => new RegExp(pattern));
}

export function isProtectedPath(file, matchers) {
  return matchers.some((matcher) => matcher.test(file));
}

export function looksBinary(buffer) {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious++;
  }
  return suspicious / sample.length > 0.1;
}

export function textProblems(text) {
  const problems = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (/[ \t]+$/.test(line)) problems.push(`line ${index + 1}: trailing whitespace`);
    if (/^(<<<<<<<|=======|>>>>>>>)(?: |$)/.test(line)) {
      problems.push(`line ${index + 1}: unresolved conflict marker`);
    }
  }
  return problems;
}

async function existingBinaryFiles(files, fromDiff) {
  const binary = new Set(fromDiff);
  for (const file of files) {
    const absolute = path.join(root, file);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) continue;
      const content = await readFile(absolute);
      if (looksBinary(content)) binary.add(file);
    } catch {
      // Deleted files are already covered by git's numstat classification.
    }
  }
  return [...binary].sort();
}

async function assertChangedText(files, binaryFiles, violations) {
  const binary = new Set(binaryFiles);
  for (const file of files) {
    if (binary.has(file)) continue;
    try {
      const content = await readFile(path.join(root, file), "utf8");
      for (const problem of textProblems(content)) violations.push(`${file}: ${problem}`);
    } catch {
      // Deleted files have no working-tree text to inspect.
    }
  }
}

function assertWhitespace(base, violations) {
  const checks = [];
  if (base) checks.push(diffArguments(base, ["--check"]));
  checks.push(["diff", "--check", "HEAD", "--"]);
  for (const args of checks) {
    const result = git(args, { optional: true });
    if (result) violations.push(`git diff --check failed:\n${result}`);
  }
}

function samePaths(actual, allowed) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...allowed].sort());
}

export async function checkChangePolicy() {
  const base = comparisonBase();
  const changed = changedFiles(base);
  const policy = JSON.parse(await readFile(path.join(root, policyPath), "utf8"));
  const matchers = protectedMatchers(policy);
  const protectedChanges = changed.filter((file) => isProtectedPath(file, matchers));
  const binaryChanges = await existingBinaryFiles(changed, binaryFilesFromDiff(base));
  const violations = [];

  assertWhitespace(base, violations);
  await assertChangedText(changed, binaryChanges, violations);

  if (!validClassifications.has(policy.classification)) {
    violations.push(`change classification must be one of A/B/C/D/E/F, got ${policy.classification}`);
  }
  if (typeof policy.reason !== "string" || policy.reason.trim().length < 20) {
    violations.push("change-policy reason must explain the change in at least 20 characters");
  }
  if (policy.classification === "F" && process.env.ALLOW_BREAKING_CHANGE !== "explicit") {
    violations.push("classification F requires ALLOW_BREAKING_CHANGE=explicit");
  }

  if (protectedChanges.length > 0) {
    if (!changed.includes(policyPath)) {
      violations.push(`${policyPath} must change whenever a protected runtime path changes`);
    }
    if (!samePaths(protectedChanges, policy.protectedChanges ?? [])) {
      violations.push(
        `protectedChanges must exactly list this change's protected paths: ${protectedChanges.join(", ")}`
      );
    }
  }

  if (binaryChanges.length > 0) {
    if (!changed.includes(policyPath)) {
      violations.push(`${policyPath} must change whenever a binary file changes`);
    }
    if (!samePaths(binaryChanges, policy.allowedBinaryChanges ?? [])) {
      violations.push(
        `allowedBinaryChanges must exactly list this change's binary paths: ${binaryChanges.join(", ")}`
      );
    }
  }

  return { base, changed, protectedChanges, binaryChanges, violations };
}

async function main() {
  const result = await checkChangePolicy();
  if (result.violations.length > 0) {
    console.error(
      "Change policy violations:\n" + result.violations.map((item) => `- ${item}`).join("\n")
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Change policy OK (${result.changed.length} changed, ${result.protectedChanges.length} protected, ` +
      `${result.binaryChanges.length} binary; base ${result.base ?? "working tree"}).`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
