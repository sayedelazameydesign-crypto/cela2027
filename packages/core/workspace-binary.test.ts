import { describe, expect, it } from "vitest";
import { PathEscapeError, Workspace } from "./src/workspace";

describe("Workspace binary files", () => {
  it("copies bytes on write/read and preserves text snapshot compatibility", () => {
    const ws = new Workspace();
    const source = new Uint8Array([0, 255, 23]);
    ws.writeBinary("assets/a.bin", source);
    source[0] = 5;
    expect(ws.readBinary("assets/a.bin")).toEqual(new Uint8Array([0, 255, 23]));
    const copy = ws.readBinary("assets/a.bin");
    copy[0] = 9;
    expect(ws.readBinary("assets/a.bin")[0]).toBe(0);
    ws.write("test.py", "print('ok')");
    expect(ws.snapshot()).toEqual({ "test.py": "print('ok')" });
    expect(ws.sandboxSnapshot()).toEqual({
      "assets/a.bin": { base64: "AP8X" },
      "test.py": "print('ok')",
    });
    expect(ws.totalBytes()).toBe(14);
  });

  it("rejects path escapes for binary files", () => {
    const ws = new Workspace();
    expect(() => ws.writeBinary("../outside", new Uint8Array([1]))).toThrow(PathEscapeError);
  });
});
