import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Workspace architecture guard (governance template) — TypeScript/JavaScript.
 *
 * Generalized from cela2027 `scripts/check-architecture.mjs`.  The analysis is
 * preserved; only the repository-specific data moved into
 * `.governance/project.json`:
 *
 *   workspaces.scopePattern        regex with one capture group matching a
 *                                  workspace package name
 *                                  (default `^(@[^/]+/[^/]+)`)
 *   workspaces.layers              directories holding workspaces
 *   workspaces.tsconfigBase        root tsconfig used by the type gate
 *   workspaces.allowedDependencies directional dependency map; every workspace
 *                                  must appear in it, `[]` meaning "leaf"
 *   workspaces.aliasPairs          [{ app, base, layers }] — `app` is the
 *                                  tsconfig the framework reads (Next.js reads
 *                                  the app's own), `base` the one the root gate
 *                                  reads; every alias must resolve identically
 *                                  in both, and workspaces in `layers` resolve
 *                                  aliases through `app`
 *   workspaces.forbiddenAliasPrefixes  { layers, prefixes, message } — e.g.
 *                                  packages must never reach into the app via `@/`
 *
 * Violation classes enforced (same as the source guard):
 *   1. workspace missing a dependency classification
 *   2. undeclared or disallowed workspace dependency (via package name or alias)
 *   3. alias drift between the app tsconfig and the root tsconfig
 *   4. relative import crossing a workspace boundary, alias resolving outside
 *      its workspace, forbidden alias prefix, and a computed dynamic
 *      import/require that cannot be analyzed (fail closed)
 *
 * Requires: `typescript` as a dev dependency of the target repository.
 *
 * Usage: node check-architecture.mjs [--config path/to/project.json] [--root repoRoot]
 */

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".turbo"]);
const DEFAULT_SCOPE_PATTERN = "^(@[^/]+/[^/]+)";

function parseArgs(argv) {
  const args = { config: undefined, root: undefined };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--config") args.config = argv[++index];
    else if (argv[index] === "--root") args.root = argv[++index];
  }
  return args;
}

function repoRootFromGit(fallback) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: fallback,
      encoding: "utf8",
    }).trim();
  } catch {
    return fallback;
  }
}

async function loadConfig(root, configArg) {
  const candidates = [
    configArg ? (path.isAbsolute(configArg) ? configArg : path.join(root, configArg)) : undefined,
    path.join(root, ".governance", "project.json"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".governance", "project.json"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return { config: JSON.parse(await readFile(candidate, "utf8")), path: candidate };
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(`no governance config found; looked at:\n${candidates.map((c) => `  - ${c}`).join("\n")}`);
}

export function collectModuleReferences(source, filePath) {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const references = [];
  const diagnostics = [];

  const addLiteral = (node, kind) => {
    if (node && ts.isStringLiteral(node)) references.push({ specifier: node.text, kind });
    else if (node) diagnostics.push(`${kind} with a computed specifier cannot be analyzed (fail closed)`);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      if (node.moduleSpecifier) addLiteral(node.moduleSpecifier, "import/export declaration");
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) addLiteral(argument.literal, "import type");
      else diagnostics.push("import type with a computed specifier cannot be analyzed (fail closed)");
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addLiteral(node.arguments[0], "dynamic import");
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      addLiteral(node.arguments[0], "require");
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { references, diagnostics };
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(fullPath)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function isInside(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function workspacePackageName(specifier, scopePattern) {
  return specifier.match(new RegExp(scopePattern))?.[1];
}

function readTsConfig(configPath) {
  const result = ts.readConfigFile(configPath, ts.sys.readFile);
  if (result.error) {
    throw new Error(`${configPath}: ${ts.flattenDiagnosticMessageText(result.error.messageText, "\n")}`);
  }
  const compilerOptions = result.config.compilerOptions ?? {};
  const base = path.resolve(path.dirname(configPath), compilerOptions.baseUrl ?? ".");
  return { configPath, base, paths: compilerOptions.paths ?? {} };
}

function matchAlias(pattern, specifier) {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === specifier ? "" : undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return undefined;
  return specifier.slice(prefix.length, specifier.length - suffix.length || undefined);
}

export function resolveAlias(config, specifier) {
  for (const [pattern, replacements] of Object.entries(config.paths)) {
    const wildcard = matchAlias(pattern, specifier);
    if (wildcard === undefined) continue;
    return replacements.map((replacement) => path.resolve(config.base, replacement.replace("*", wildcard)));
  }
  return [];
}

function canonicalAlias(config, pattern) {
  return (config.paths[pattern] ?? []).map((replacement) =>
    path.resolve(config.base, replacement.replace("*", "__WILDCARD__"))
  );
}

async function workspaceConfigs(root, layer) {
  const directory = path.join(root, layer);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const configs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspaceRoot = path.join(directory, entry.name);
    let packageJson;
    try {
      packageJson = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
    } catch {
      continue;
    }
    configs.push({
      name: packageJson.name,
      layer,
      workspaceRoot,
      declared: new Set([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {}),
        ...Object.keys(packageJson.peerDependencies ?? {}),
      ]),
    });
  }
  return configs;
}

function addViolation(violations, message) {
  violations.add(message);
}

function validateDependency(workspace, dependency, relativeFile, violations, allowed) {
  if (!dependency || dependency === workspace.name) return;
  if (!workspace.declared.has(dependency)) {
    addViolation(violations, `${relativeFile} imports undeclared workspace dependency ${dependency}`);
  }
  if (!allowed.get(workspace.name)?.has(dependency)) {
    addViolation(violations, `${relativeFile} imports disallowed workspace dependency ${dependency}`);
  }
}

export async function checkArchitecture(root, config) {
  const settings = config.workspaces ?? {};
  const scopePattern = settings.scopePattern ?? DEFAULT_SCOPE_PATTERN;
  const layers = settings.layers ?? ["packages", "apps"];
  const allowed = new Map(
    Object.entries(settings.allowedDependencies ?? {}).map(([name, deps]) => [name, new Set(deps)])
  );
  const aliasPairs = settings.aliasPairs ?? [];
  const forbidden = settings.forbiddenAliasPrefixes ?? [];
  const violations = new Set();

  const workspaces = [];
  for (const layer of layers) workspaces.push(...(await workspaceConfigs(root, layer)));

  const baseConfigs = new Map();
  const readBase = (relativePath) => {
    if (!baseConfigs.has(relativePath)) {
      baseConfigs.set(relativePath, readTsConfig(path.join(root, relativePath)));
    }
    return baseConfigs.get(relativePath);
  };
  const rootConfig = settings.tsconfigBase ? readBase(settings.tsconfigBase) : undefined;

  // Alias parity: the framework's tsconfig and the root gate's tsconfig must
  // resolve every alias to the same canonical target.
  for (const pair of aliasPairs) {
    const appConfig = readBase(pair.app);
    const pairBaseConfig = readBase(pair.base);
    for (const pattern of Object.keys(appConfig.paths)) {
      if (!(pattern in pairBaseConfig.paths)) {
        addViolation(violations, `${pair.base} is missing the alias ${pattern} declared in ${pair.app}`);
        continue;
      }
      const baseTargets = canonicalAlias(pairBaseConfig, pattern);
      const appTargets = canonicalAlias(appConfig, pattern);
      if (JSON.stringify(baseTargets) !== JSON.stringify(appTargets)) {
        addViolation(
          violations,
          `tsconfig alias drift for ${pattern}: ${pair.base}=${baseTargets.join(",")} ${pair.app}=${appTargets.join(",")}`
        );
      }
    }
  }

  const aliasesFor = (workspace) => {
    const pair = aliasPairs.find((candidate) => (candidate.layers ?? []).includes(workspace.layer));
    return pair ? readBase(pair.app) : rootConfig;
  };

  for (const workspace of workspaces) {
    if (!allowed.has(workspace.name)) {
      addViolation(violations, `${workspace.name} is missing an architecture dependency classification`);
    }
    const aliases = aliasesFor(workspace);
    const workspaceForbidden = forbidden.filter((rule) => (rule.layers ?? []).includes(workspace.layer));

    for (const file of await sourceFiles(workspace.workspaceRoot)) {
      const relativeFile = path.relative(root, file);
      const source = await readFile(file, "utf8");
      const parsed = collectModuleReferences(source, file);
      for (const diagnostic of parsed.diagnostics) {
        addViolation(violations, `${relativeFile}: ${diagnostic}`);
      }

      for (const { specifier } of parsed.references) {
        validateDependency(
          workspace,
          workspacePackageName(specifier, scopePattern),
          relativeFile,
          violations,
          allowed
        );

        for (const rule of workspaceForbidden) {
          for (const prefix of rule.prefixes ?? []) {
            if (specifier.startsWith(prefix)) {
              addViolation(violations, `${relativeFile} ${rule.message} via ${specifier}`);
            }
          }
        }

        if (specifier.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), specifier);
          if (!isInside(resolved, workspace.workspaceRoot)) {
            addViolation(violations, `${relativeFile} crosses its workspace with relative import ${specifier}`);
          }
        }

        if (!aliases) continue;
        for (const resolved of resolveAlias(aliases, specifier)) {
          const targetWorkspace = workspaces.find((candidate) => isInside(resolved, candidate.workspaceRoot));
          if (targetWorkspace && targetWorkspace.name !== workspace.name) {
            validateDependency(workspace, targetWorkspace.name, relativeFile, violations, allowed);
          } else if (!isInside(resolved, workspace.workspaceRoot)) {
            addViolation(
              violations,
              `${relativeFile} alias ${specifier} resolves outside its workspace to ${path.relative(root, resolved)}`
            );
          }
        }
      }
    }
  }

  return { workspaces, violations: [...violations].sort() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = args.root ? path.resolve(args.root) : repoRootFromGit(path.resolve(here, ".."));
  const { config } = await loadConfig(root, args.config);
  const { workspaces, violations } = await checkArchitecture(root, config);
  if (violations.length > 0) {
    console.error("Architecture boundary violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Architecture boundaries OK (${workspaces.length} workspaces checked).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
