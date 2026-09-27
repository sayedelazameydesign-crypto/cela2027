// Shared helpers for the E2E guard scripts. No dependencies beyond Node.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const e2eRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(e2eRoot, "..");

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function baseline() {
  return readJson(path.join(e2eRoot, "baseline.json"));
}

/** Run git in the repository root; returns trimmed stdout ("" on failure when optional). */
export function git(args, { optional = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (optional) return "";
    throw new Error(`git ${args.join(" ")} failed: ${String(error?.stderr ?? error?.message ?? error).trim()}`);
  }
}

export function isSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

/** Minimal reporter: collects violations, prints a summary, sets exit code. */
export function reporter(title) {
  const violations = [];
  const notes = [];
  return {
    fail(message) {
      violations.push(message);
    },
    note(message) {
      notes.push(message);
    },
    finish() {
      for (const note of notes) console.log(`  · ${note}`);
      if (violations.length > 0) {
        console.error(`${title}: FAIL\n${violations.map((v) => `  - ${v}`).join("\n")}`);
        process.exitCode = 1;
        return false;
      }
      console.log(`${title}: OK`);
      return true;
    },
  };
}
