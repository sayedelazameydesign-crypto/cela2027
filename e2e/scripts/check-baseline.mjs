#!/usr/bin/env node
/**
 * check-baseline — proves the E2E branch really descends from the pinned
 * E2E_BASE_SHA and that docs/E2E_BASELINE.md agrees with e2e/baseline.json.
 *
 *   node e2e/scripts/check-baseline.mjs
 *
 * Fails when:
 *   - E2E_BASE_SHA is malformed or unknown to this repository
 *   - E2E_BASE_SHA is not an ancestor of HEAD
 *   - UI_U0_BASE_SHA is neither null nor an ancestor SHA (it must be pinned
 *     only when the UI-U0 branch itself is created)
 *   - docs/E2E_BASELINE.md does not contain the exact pinned SHA
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { baseline, git, isSha, reporter, repoRoot } from "./lib.mjs";

const report = reporter("E2E baseline");
const pins = baseline();
const head = git(["rev-parse", "HEAD"]);

if (!isSha(pins.E2E_BASE_SHA)) {
  report.fail(`E2E_BASE_SHA must be a 40-hex SHA, got ${JSON.stringify(pins.E2E_BASE_SHA)}`);
} else {
  const type = git(["cat-file", "-t", pins.E2E_BASE_SHA], { optional: true });
  if (type !== "commit") {
    report.fail(`E2E_BASE_SHA ${pins.E2E_BASE_SHA} is not a commit in this repository (fetch depth too shallow?)`);
  } else {
    // merge-base --is-ancestor prints nothing; success is signalled by the exit code.
    try {
      git(["merge-base", "--is-ancestor", pins.E2E_BASE_SHA, "HEAD"]);
      report.note(`E2E_BASE_SHA ${pins.E2E_BASE_SHA.slice(0, 12)} is an ancestor of HEAD ${head.slice(0, 12)}`);
    } catch {
      report.fail(`E2E_BASE_SHA ${pins.E2E_BASE_SHA} is not an ancestor of HEAD ${head}`);
    }
  }
}

if (pins.UI_U0_BASE_SHA !== null) {
  if (!isSha(pins.UI_U0_BASE_SHA)) {
    report.fail(`UI_U0_BASE_SHA must be null until the UI-U0 branch exists, got ${JSON.stringify(pins.UI_U0_BASE_SHA)}`);
  } else {
    try {
      git(["merge-base", "--is-ancestor", pins.UI_U0_BASE_SHA, "HEAD"]);
      report.note(`UI_U0_BASE_SHA ${pins.UI_U0_BASE_SHA.slice(0, 12)} is pinned and reachable`);
    } catch {
      report.fail(`UI_U0_BASE_SHA ${pins.UI_U0_BASE_SHA} is not an ancestor of HEAD`);
    }
  }
} else {
  report.note("UI_U0_BASE_SHA is intentionally unpinned (pinned only when branch UI-U0 is created)");
}

const docPath = path.join(repoRoot, "docs", "E2E_BASELINE.md");
let doc = "";
try {
  doc = readFileSync(docPath, "utf8");
} catch {
  report.fail("docs/E2E_BASELINE.md is missing");
}
if (doc && !doc.includes(`\`${pins.E2E_BASE_SHA}\``)) {
  report.fail(`docs/E2E_BASELINE.md does not contain the pinned E2E_BASE_SHA ${pins.E2E_BASE_SHA}`);
}
if (doc && pins.UI_U0_BASE_SHA === null && !/UI_U0_BASE_SHA[^\n]*غير مثبت/.test(doc)) {
  report.fail("docs/E2E_BASELINE.md must state that UI_U0_BASE_SHA is unpinned (\"غير مثبت\") while baseline.json has null");
}

const originMain = git(["rev-parse", "--verify", "--quiet", "origin/main"], { optional: true });
if (originMain) {
  report.note(
    originMain === pins.E2E_BASE_SHA
      ? "origin/main is still at E2E_BASE_SHA"
      : `origin/main moved to ${originMain.slice(0, 12)} (informational; the pin stays at the cut point)`
  );
}

report.finish();
