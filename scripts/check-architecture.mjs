import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const allowedWorkspaceDependencies = new Map([
  ["@cela/core", new Set(["@cela/llm", "@cela/tools"])],
  ["@cela/llm", new Set()],
  ["@cela/sandbox", new Set()],
  ["@cela/store", new Set()],
  ["@cela/tools", new Set()],
  ["@cela/web", new Set(["@cela/core", "@cela/llm", "@cela/sandbox", "@cela/store"])],
]);

function scriptKind(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".mjs", ".cjs"].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Parse module references with TypeScript's AST instead of regular expressions. */
export function collectModuleReferences(source, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName)
  );
  const references = [];
  const diagnostics = [];

  const addLiteral = (node, kind) => {
    if (node && ts.isStringLiteralLike(node)) {
      references.push({ specifier: node.text, kind });
      return;
    }
    diagnostics.push(`${kind} must use a static string literal so its boundary can be verified`);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      addLiteral(node.moduleSpecifier, node.importClause?.isTypeOnly ? "import type" : "import");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      addLiteral(node.moduleSpecifier, node.isTypeOnly ? "export type" : "re-export");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addLiteral(node.moduleReference.expression, "import equals");
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      addLiteral(ts.isLiteralTypeNode(argument) ? argument.literal : undefined, "import type expression");
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
    if (["node_modules", ".next"].includes(entry.name)) continue;
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

function workspacePackageName(specifier) {
  const match = specifier.match(/^(@cela\/[^/]+)/);
  return match?.[1];
}

function readTsConfig(configPath) {
  const result = ts.readConfigFile(configPath, ts.sys.readFile);
  if (result.error) {
    throw new Error(ts.flattenDiagnosticMessageText(result.error.messageText, "\n"));
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
    return replacements.map((replacement) =>
      path.resolve(config.base, replacement.replace("*", wildcard))
    );
  }
  return [];
}

function canonicalAlias(config, pattern) {
  return (config.paths[pattern] ?? []).map((replacement) =>
    path.resolve(config.base, replacement.replace("*", "__WILDCARD__"))
  );
}

async function workspaceConfigs(parent) {
  const directory = path.join(root, parent);
  const entries = await readdir(directory, { withFileTypes: true });
  const configs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspaceRoot = path.join(directory, entry.name);
    const packageJson = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
    configs.push({
      name: packageJson.name,
      layer: parent,
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

function validateDependency(workspace, dependency, relativeFile, violations) {
  if (!dependency || dependency === workspace.name) return;
  if (!workspace.declared.has(dependency)) {
    addViolation(violations, `${relativeFile} imports undeclared workspace dependency ${dependency}`);
  }
  if (!allowedWorkspaceDependencies.get(workspace.name)?.has(dependency)) {
    addViolation(violations, `${relativeFile} imports disallowed workspace dependency ${dependency}`);
  }
}

export async function checkArchitecture() {
  const rootConfig = readTsConfig(path.join(root, "tsconfig.base.json"));
  const webConfig = readTsConfig(path.join(root, "apps/web/tsconfig.json"));
  const workspaces = [
    ...(await workspaceConfigs("packages")),
    ...(await workspaceConfigs("apps")),
  ];
  const violations = new Set();

  // Next reads apps/web/tsconfig.json while the root gate reads tsconfig.base.json.
  // Every alias declared by the app must therefore resolve identically in both.
  for (const pattern of Object.keys(webConfig.paths)) {
    if (!(pattern in rootConfig.paths)) {
      addViolation(violations, `root tsconfig is missing the web alias ${pattern}`);
      continue;
    }
    const rootTargets = canonicalAlias(rootConfig, pattern);
    const webTargets = canonicalAlias(webConfig, pattern);
    if (JSON.stringify(rootTargets) !== JSON.stringify(webTargets)) {
      addViolation(
        violations,
        `tsconfig alias drift for ${pattern}: root=${rootTargets.join(",")} web=${webTargets.join(",")}`
      );
    }
  }

  for (const workspace of workspaces) {
    if (!allowedWorkspaceDependencies.has(workspace.name)) {
      addViolation(violations, `${workspace.name} is missing an architecture dependency classification`);
    }

    const aliases = workspace.layer === "apps" ? webConfig : rootConfig;
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
          workspacePackageName(specifier),
          relativeFile,
          violations
        );

        if (workspace.layer === "packages" && specifier.startsWith("@/")) {
          addViolation(
            violations,
            `${relativeFile} crosses from a package into the web app via ${specifier}`
          );
        }

        if (specifier.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), specifier);
          if (!isInside(resolved, workspace.workspaceRoot)) {
            addViolation(
              violations,
              `${relativeFile} crosses its workspace with relative import ${specifier}`
            );
          }
        }

        for (const resolved of resolveAlias(aliases, specifier)) {
          const targetWorkspace = workspaces.find((candidate) =>
            isInside(resolved, candidate.workspaceRoot)
          );
          if (targetWorkspace && targetWorkspace.name !== workspace.name) {
            validateDependency(workspace, targetWorkspace.name, relativeFile, violations);
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
  const { workspaces, violations } = await checkArchitecture();
  if (violations.length > 0) {
    console.error(
      "Architecture boundary violations:\n" + violations.map((item) => `- ${item}`).join("\n")
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Architecture boundaries OK (${workspaces.length} workspaces checked).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}
