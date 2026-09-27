/**
 * Task workspace — a virtual, contained file system.
 * Every path is resolved and must stay inside the workspace root
 * (same containment rule as agi-system: Path.resolve + relative_to).
 */

export class PathEscapeError extends Error {
  constructor(path: string) {
    super(`Path escapes workspace sandbox: ${path}`);
    this.name = "PathEscapeError";
  }
}

function normalize(p: string): string[] {
  const parts = p.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) throw new PathEscapeError(p);
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

export class Workspace {
  private files = new Map<string, string>();

  /** normalized relative path or throw */
  resolve(path: string): string {
    if (typeof path !== "string" || path.length === 0) {
      throw new PathEscapeError(String(path));
    }
    if (/^[a-zA-Z]:/.test(path) || path.startsWith("/")) {
      // absolute paths are re-based into the workspace root
      path = path.replace(/^([a-zA-Z]:)?[\\/]+/, "");
    }
    const parts = normalize(path);
    if (parts.length === 0) throw new PathEscapeError(path);
    return parts.join("/");
  }

  write(path: string, content: string): void {
    const p = this.resolve(path);
    this.files.set(p, String(content));
  }

  read(path: string): string {
    const p = this.resolve(path);
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`File not found: ${p}`);
    return c;
  }

  exists(path: string): boolean {
    try {
      return this.files.has(this.resolve(path));
    } catch {
      return false;
    }
  }

  delete(path: string): boolean {
    const p = this.resolve(path);
    return this.files.delete(p);
  }

  /** list files, optionally filtered by directory prefix */
  list(dir = ""): string[] {
    const prefix = dir ? this.resolve(dir) + "/" : "";
    return [...this.files.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();
  }

  all(): Map<string, string> {
    return new Map(this.files);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  totalBytes(): number {
    let n = 0;
    for (const c of this.files.values()) n += c.length;
    return n;
  }
}
