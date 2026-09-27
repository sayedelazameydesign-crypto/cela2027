import { describe, it, expect } from "vitest";
import { Workspace, PathEscapeError } from "./src/workspace";
import { PolicyEngine } from "./src/policy";

describe("Workspace containment (احتواء الصندوق)", () => {
  it("normalizes relative paths", () => {
    const ws = new Workspace();
    expect(ws.resolve("a/b/c.txt")).toBe("a/b/c.txt");
    expect(ws.resolve("./a//b/./c.txt")).toBe("a/b/c.txt");
  });

  it("blocks ../ escape attempts", () => {
    const ws = new Workspace();
    expect(() => ws.resolve("../evil.txt")).toThrow(PathEscapeError);
    ws.write("a/b.txt", "x");
    expect(() => ws.resolve("a/../../evil.txt")).toThrow(PathEscapeError);
  });

  it("re-bases absolute paths into the sandbox", () => {
    const ws = new Workspace();
    expect(ws.resolve("C:\\Users\\evil\\file.txt")).toBe("Users/evil/file.txt");
    expect(ws.resolve("/tmp/x.py")).toBe("tmp/x.py");
  });

  it("write/read/list/delete round-trip", () => {
    const ws = new Workspace();
    ws.write("proj/a.py", "print(1)");
    ws.write("proj/sub/b.py", "print(2)");
    expect(ws.read("proj/a.py")).toBe("print(1)");
    expect(ws.list("proj")).toEqual(["proj/a.py", "proj/sub/b.py"]);
    expect(ws.delete("proj/a.py")).toBe(true);
    expect(ws.exists("proj/a.py")).toBe(false);
  });
});

describe("PolicyEngine (fail-closed)", () => {
  it("denies tools outside the allowlist", () => {
    const p = new PolicyEngine({ allowedTools: ["read"] });
    const r = p.evaluate({ tool: "write", args: {}, title: "" }, new Workspace());
    expect(r.allowed).toBe(false);
  });

  it("empty allowlist denies everything", () => {
    const p = new PolicyEngine({ allowedTools: [] });
    const r = p.evaluate({ tool: "read", args: {}, title: "" }, new Workspace());
    expect(r.allowed).toBe(false);
  });

  it("denies path-escaping steps", () => {
    const p = new PolicyEngine();
    const r = p.evaluate(
      { tool: "write", args: { path: "../outside.txt", content: "x" }, title: "" },
      new Workspace()
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("escapes workspace");
  });

  it("rejects over-long plans", () => {
    const p = new PolicyEngine({ maxSteps: 3 });
    const steps = Array.from({ length: 4 }, (_, i) => ({
      tool: "write",
      args: { path: `f${i}.txt`, content: "x" },
      title: "",
    }));
    expect(p.checkPlan(steps).allowed).toBe(false);
  });

  it("accepts a sane plan", () => {
    const p = new PolicyEngine();
    const r = p.checkPlan([
      { tool: "write", args: { path: "a.py", content: "print(1)" }, title: "كتابة" },
      { tool: "python_run", args: { code: "print(1)" }, title: "تشغيل" },
    ]);
    expect(r.allowed).toBe(true);
  });
});
