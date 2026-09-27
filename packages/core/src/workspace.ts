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
  private binary = new Map<string, Uint8Array>();

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
    this.binary.delete(p);
    this.files.set(p, String(content));
  }

  /** Store opaque bytes without converting through UTF-8. */
  writeBinary(path: string, content: Uint8Array): void {
    const p = this.resolve(path);
    this.files.delete(p);
    this.binary.set(p, new Uint8Array(content));
  }

  readBinary(path: string): Uint8Array {
    const p = this.resolve(path);
    const bytes = this.binary.get(p);
    if (!bytes) throw new Error(`File not found: ${p}`);
    return new Uint8Array(bytes);
  }

  read(path: string): string {
    const p = this.resolve(path);
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`File not found: ${p}`);
    return c;
  }

  exists(path: string): boolean {
    try {
      const p = this.resolve(path);
      return this.files.has(p) || this.binary.has(p);
    } catch {
      return false;
    }
  }

  delete(path: string): boolean {
    const p = this.resolve(path);
    const textDeleted = this.files.delete(p);
    const binaryDeleted = this.binary.delete(p);
    return textDeleted || binaryDeleted;
  }

  /** list files, optionally filtered by directory prefix */
  list(dir = ""): string[] {
    const prefix = dir ? this.resolve(dir) + "/" : "";
    return [...this.files.keys(), ...this.binary.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();
  }

  all(): Map<string, string> {
    return new Map(this.files);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  /** JSON-safe representation for the browser worker; snapshot() remains text-only. */
  sandboxSnapshot(): Record<string, string | { base64: string }> {
    const result: Record<string, string | { base64: string }> = Object.fromEntries(this.files);
    for (const [path, bytes] of this.binary) {
      result[path] = { base64: Buffer.from(bytes).toString("base64") };
    }
    return result;
  }

  totalBytes(): number {
    let n = 0;
    for (const c of this.files.values()) n += new TextEncoder().encode(c).length;
    for (const c of this.binary.values()) n += c.length;
    return n;
  }
}
