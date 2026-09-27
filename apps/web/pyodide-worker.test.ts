import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./public/pyodide-worker.js", import.meta.url), "utf8");

describe("Pyodide worker file synchronization", () => {
  it("writes text and binary under a fresh per-run directory before Python executes", async () => {
    const writes: Array<[string, number[]]> = [];
    const directories = new Set<string>();
    const py = {
      FS: {
        mkdir: vi.fn((dir: string) => { if (directories.has(dir)) throw { code: "EEXIST" }; directories.add(dir); }),
        writeFile: vi.fn((path: string, bytes: Uint8Array) => writes.push([path, [...bytes]])),
        chdir: vi.fn(),
      },
      setStdout: vi.fn(), setStderr: vi.fn(), runPythonAsync: vi.fn().mockResolvedValue(undefined),
    };
    const messages: any[] = [];
    const self: any = { postMessage: (value: any) => messages.push(value) };
    runInNewContext(source, { self, importScripts: vi.fn(), loadPyodide: async () => py, Date, TextEncoder, Uint8Array, atob });
    await self.onmessage({ data: { runId: "r1", code: "print(1)", files: { "pkg/a.py": "print('ok')", "pkg/pic.bin": { base64: "AP8X" } } } });
    expect(messages[0].ok).toBe(true);
    expect(writes).toEqual([
      ["/tmp/cela-run-1/pkg/a.py", [...new TextEncoder().encode("print('ok')")]],
      ["/tmp/cela-run-1/pkg/pic.bin", [0, 255, 23]],
    ]);
    expect(py.FS.chdir).toHaveBeenCalledWith("/tmp/cela-run-1");
    expect(py.runPythonAsync).toHaveBeenCalledWith("print(1)");
    await self.onmessage({ data: { runId: "r2", code: "print(2)", files: {} } });
    expect(py.FS.chdir).toHaveBeenCalledWith("/tmp/cela-run-2");
  });

  it("rejects traversal before executing Python", async () => {
    const py = { FS: { mkdir: vi.fn(), writeFile: vi.fn(), chdir: vi.fn() }, setStdout: vi.fn(), setStderr: vi.fn(), runPythonAsync: vi.fn() };
    const messages: any[] = [];
    const self: any = { postMessage: (v: any) => messages.push(v) };
    runInNewContext(source, { self, importScripts: vi.fn(), loadPyodide: async () => py, Date, TextEncoder, Uint8Array, atob });
    await self.onmessage({ data: { runId: "bad", code: "print(1)", files: { "../bad": "x" } } });
    expect(messages[0].ok).toBe(false);
    expect(py.runPythonAsync).not.toHaveBeenCalled();
  });
});
