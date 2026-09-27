/**
 * Coding-agent toolset documentation of record.
 * The concrete implementations live in @cela/core/src/tools-impl.ts
 * (they operate on the core Workspace to keep containment in one place).
 *
 * Tool contract (JSON args):
 *   read            { path }
 *   ls              { dir? }
 *   write           { path, content }
 *   edit            { path, find, replace }
 *   patch           { path, find, replace }
 *   scaffold_project{ name, files: [{ path, content }] }
 *   python_run      { code }   ← routed through the SandboxBridge (Pyodide)
 */

export const TOOL_MANIFEST = [
  { name: "read", mutation: false, args: ["path"] },
  { name: "ls", mutation: false, args: ["dir?"] },
  { name: "write", mutation: true, args: ["path", "content"] },
  { name: "edit", mutation: true, args: ["path", "find", "replace"] },
  { name: "patch", mutation: true, args: ["path", "find", "replace"] },
  { name: "scaffold_project", mutation: true, args: ["name", "files"] },
  { name: "python_run", mutation: false, args: ["code"], sandbox: true },
] as const;
