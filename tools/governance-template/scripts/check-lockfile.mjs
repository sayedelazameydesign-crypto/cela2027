import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npm,
  ["ci", "--ignore-scripts", "--dry-run", "--no-audit", "--no-fund", "--loglevel=error"],
  { encoding: "utf8" }
);

if (result.status !== 0) {
  console.error("package-lock.json is not reproducible with package.json.");
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

console.log("Lockfile consistency OK (npm ci --dry-run).");
