#!/usr/bin/env node
/**
 * check-fixtures — proves fixture files are stored byte-exactly and declared
 * correctly in .gitattributes (docs/E2E_FIXTURES.md §3).
 *
 *   node e2e/scripts/check-fixtures.mjs                 # verify
 *   node e2e/scripts/check-fixtures.mjs --write-manifest # regenerate SHA256SUMS
 *
 * Per fixture file (everything under e2e/fixtures/ except SHA256SUMS):
 *   attributes  git check-attr text            → "unset"
 *   bytes       git hash-object --no-filters  == git hash-object (filters)
 *               == blob recorded in the index (when tracked)
 *   manifest    sha256(file)                  == SHA256SUMS entry
 *   encoding    valid UTF-8, no BOM             (text fixtures)
 *   eol         no CR bytes, ends with one LF   (text fixtures)
 *   ndjson      every line parses; `seq` strictly increasing when present
 *   json        parses
 * The manifest itself must be LF-terminated, sorted, and cover exactly the
 * fixture set (no missing, no stale entries).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { e2eRoot, git, reporter, repoRoot } from "./lib.mjs";

const fixturesRoot = path.join(e2eRoot, "fixtures");
const manifestPath = path.join(fixturesRoot, "SHA256SUMS");
const writeManifest = process.argv.includes("--write-manifest");
const binaryExtensions = new Set([".bin", ".png", ".zip"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function relFixture(file) {
  return path.relative(fixturesRoot, file).split(path.sep).join("/");
}

function relRepo(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

const files = existsSync(fixturesRoot) ? walk(fixturesRoot).filter((f) => f !== manifestPath) : [];

if (writeManifest) {
  const lines = files.map((f) => `${sha256(readFileSync(f))}  ${relFixture(f)}`).sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
  writeFileSync(manifestPath, lines.join("\n") + "\n", "utf8");
  console.log(`wrote ${relRepo(manifestPath)} (${lines.length} entries)`);
}

const report = reporter("E2E fixtures");

if (files.length === 0) {
  report.fail("no fixture files found under e2e/fixtures/");
}

// manifest parsing
let manifest = new Map();
if (!existsSync(manifestPath)) {
  report.fail("e2e/fixtures/SHA256SUMS is missing (run with --write-manifest)");
} else {
  const raw = readFileSync(manifestPath);
  if (raw.includes(0x0d)) report.fail("SHA256SUMS contains CR bytes");
  if (raw.length === 0 || raw[raw.length - 1] !== 0x0a) report.fail("SHA256SUMS must end with LF");
  const lines = raw.toString("utf8").split("\n").filter(Boolean);
  const names = [];
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) {
      report.fail(`SHA256SUMS malformed line: ${JSON.stringify(line)}`);
      continue;
    }
    manifest.set(match[2], match[1]);
    names.push(match[2]);
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(names) !== JSON.stringify(sorted)) report.fail("SHA256SUMS entries are not sorted by path");
  for (const name of names) {
    if (!files.some((f) => relFixture(f) === name)) report.fail(`SHA256SUMS lists ${name} but the file does not exist`);
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true });

for (const file of files) {
  const rel = relFixture(file);
  const repoRel = relRepo(file);
  const buffer = readFileSync(file);
  const isBinary = binaryExtensions.has(path.extname(file).toLowerCase());

  // attributes
  const attr = git(["check-attr", "text", "--", repoRel], { optional: true });
  const textAttr = attr.split(":").pop()?.trim();
  if (textAttr !== "unset") report.fail(`${rel}: git attribute text must be "unset" (got "${textAttr || "n/a"}") — check .gitattributes`);
  if (isBinary) {
    const diffAttr = git(["check-attr", "diff", "--", repoRel], { optional: true }).split(":").pop()?.trim();
    if (diffAttr !== "unset") report.fail(`${rel}: binary fixture must have diff unset (got "${diffAttr}")`);
  }

  // bytes: filters must be identity; index blob must match the working tree
  const rawHash = git(["hash-object", "--no-filters", "--", repoRel], { optional: true });
  const filteredHash = git(["hash-object", "--", repoRel], { optional: true });
  if (rawHash && filteredHash && rawHash !== filteredHash) report.fail(`${rel}: git filters would rewrite this file (${rawHash.slice(0, 12)} → ${filteredHash.slice(0, 12)})`);
  const indexLine = git(["ls-files", "-s", "--", repoRel], { optional: true });
  if (indexLine) {
    const indexBlob = indexLine.split(/\s+/)[1];
    if (indexBlob !== rawHash) report.fail(`${rel}: index blob ${indexBlob.slice(0, 12)} != working-tree bytes ${rawHash.slice(0, 12)}`);
  } else {
    report.note(`${rel}: not tracked yet — index blob comparison skipped`);
  }

  // manifest
  const actual = sha256(buffer);
  const expected = manifest.get(rel);
  if (!expected) report.fail(`${rel}: missing from SHA256SUMS`);
  else if (expected !== actual) report.fail(`${rel}: sha256 ${actual.slice(0, 16)}… != manifest ${expected.slice(0, 16)}…`);

  if (isBinary) continue;

  // encoding + eol
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) report.fail(`${rel}: UTF-8 BOM present`);
  let text;
  try {
    text = decoder.decode(buffer);
  } catch {
    report.fail(`${rel}: not valid UTF-8`);
    continue;
  }
  if (buffer.includes(0x0d)) report.fail(`${rel}: contains CR bytes (CRLF or bare CR)`);
  if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) report.fail(`${rel}: must end with a single LF`);
  if (buffer.length >= 2 && buffer[buffer.length - 2] === 0x0a) report.fail(`${rel}: ends with more than one LF`);

  const ext = path.extname(file).toLowerCase();
  if (ext === ".ndjson") {
    const lines = text.split("\n");
    lines.pop(); // trailing LF
    let lastSeq = -Infinity;
    lines.forEach((line, index) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        report.fail(`${rel}: line ${index + 1} is not valid JSON`);
        return;
      }
      if (typeof parsed?.seq === "number") {
        if (!(parsed.seq > lastSeq)) report.fail(`${rel}: line ${index + 1} seq ${parsed.seq} is not > previous ${lastSeq}`);
        lastSeq = parsed.seq;
      }
      if (parsed && typeof parsed === "object" && "e" in parsed && typeof parsed.e?.type !== "string") {
        report.fail(`${rel}: line ${index + 1} event has no string type`);
      }
    });
    report.note(`${rel}: ${lines.length} NDJSON lines, ${buffer.length} bytes, sha256 ${actual.slice(0, 16)}…`);
  } else if (ext === ".json") {
    try {
      JSON.parse(text);
    } catch {
      report.fail(`${rel}: not valid JSON`);
    }
  }
}

const statInfo = existsSync(manifestPath) ? statSync(manifestPath) : null;
if (statInfo) report.note(`SHA256SUMS: ${manifest.size} entries`);
report.finish();
