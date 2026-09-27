/**
 * Default tool implementations operating on the task Workspace.
 * Every tool is pure against the virtual FS — no real disk access,
 * full containment (mirrors agi-system's filesystem.* capabilities).
 */

import type { ToolImpl, ToolResult } from "./executor";
import { Workspace } from "./workspace";

const ok = (output: string, data?: Record<string, unknown>): ToolResult => ({ ok: true, output, data });
const bad = (output: string): ToolResult => ({ ok: false, output });

export function buildDefaultTools(ws: Workspace): Map<string, ToolImpl> {
  const tools = new Map<string, ToolImpl>();

  tools.set("read", (async (args) => {
    const path = String(args.path ?? "");
    try {
      const content = ws.read(path);
      return ok(`محتوى ${path}:\n${content}`, { path, size: content.length });
    } catch (e: any) {
      return bad(`تعذر القراءة: ${e?.message ?? e}`);
    }
  }) as ToolImpl);

  tools.set("ls", (async (args) => {
    const dir = typeof args.dir === "string" ? args.dir : "";
    const files = ws.list(dir);
    return ok(files.length ? files.join("\n") : "(مساحة العمل فارغة)", { files });
  }) as ToolImpl);

  tools.set("write", (async (args) => {
    const path = String(args.path ?? "");
    const content = String(args.content ?? "");
    try {
      ws.write(path, content);
      return ok(`تمت كتابة ${path} (${content.length} بايت)`, { path, size: content.length });
    } catch (e: any) {
      return bad(`تعذر الكتابة: ${e?.message ?? e}`);
    }
  }) as ToolImpl);

  tools.set("edit", (async (args) => {
    const path = String(args.path ?? "");
    const find = String(args.find ?? "");
    const replace = String(args.replace ?? "");
    try {
      const content = ws.read(path);
      if (!content.includes(find)) {
        return bad(`المقطع غير موجود في ${path}`);
      }
      ws.write(path, content.replace(find, replace));
      return ok(`تم تعديل ${path}`);
    } catch (e: any) {
      return bad(`تعذر التعديل: ${e?.message ?? e}`);
    }
  }) as ToolImpl);

  tools.set("patch", (async (args) => {
    // alias of edit with explicit semantic
    const edit = tools.get("edit")!;
    return edit(args, { taskId: "", bridge: null as any });
  }) as ToolImpl);

  tools.set("scaffold_project", (async (args) => {
    const files = Array.isArray(args.files) ? (args.files as any[]) : [];
    if (files.length === 0) return bad("لا ملفات في طلب إنشاء المشروع");
    let written = 0;
    try {
      for (const f of files) {
        if (typeof f?.path === "string") {
          ws.write(f.path, String(f.content ?? ""));
          written++;
        }
      }
    } catch (e: any) {
      return bad(`فشل إنشاء المشروع: ${e?.message ?? e}`);
    }
    return ok(`تم إنشاء ${written} ملفاً`, { files: ws.list() });
  }) as ToolImpl);

  tools.set("delete_file", (async (args) => {
    const path = String(args.path ?? "");
    try {
      const deleted = ws.delete(path);
      return deleted ? ok(`تم حذف ${path}`) : bad(`الملف غير موجود: ${path}`);
    } catch (e: any) {
      return bad(`تعذر الحذف: ${e?.message ?? e}`);
    }
  }) as ToolImpl);

  return tools;
}
