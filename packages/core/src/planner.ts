/**
 * Planner — converts a goal into a structured Plan.
 * Two implementations:
 *  - OpenRouterPlanner: LLM-backed (Claude/GPT/Gemini via OpenRouter)
 *  - OfflinePlanner: deterministic simulation used when no API key is set
 *    (same spirit as Celia v2.5's "Offline Simulation" mode)
 */

import { openRouterChat, isOpenRouterConfigured } from "@cela/llm";
import type { Plan, PlannedStep } from "./events";

export interface Planner {
  plan(goal: string, context?: string): Promise<Plan>;
}

const SYSTEM_PROMPT = `أنت مخطِّط وكيل برمجي ذكي (cela2027).
حوّل هدف المستخدم إلى خطة خطوات صارمة بصيغة JSON فقط — دون أي نص خارج JSON.

الأدوات المتاحة (استخدم الأسماء كما هي):
- read      { path }                      قراءة ملف من مساحة العمل
- ls        { dir? }                      قائمة الملفات
- write     { path, content }             كتابة ملف (أنشئ دائماً المسارات الكاملة)
- edit      { path, find, replace }       تعديل مقطع داخل ملف موجود
- scaffold_project { name, files: [{ path, content }] }  إنشاء مشروع متعدد الملفات دفعة واحدة
- python_run { code }                     تنفيذ كود Python في صندوق معزول (Pyodide: stdlib فقط، لا pip)

قواعد إلزامية:
1. ابدأ ببناء الملفات ثم أنهِ دائماً بخطوة python_run تُشغِّل اختبارات أو مثالاً يثبت صحة العمل.
2. مسارات الملفات نسبية داخل مساحة العمل (لا .. ولا مسارات مطلقة).
3. كل خطوة تحمل عنواناً عربياً قصيراً واضحاً في title.
4. 3 إلى 15 خطوة كحد أقصى.
5. أعد JSON فقط بهذا الشكل:
{"summary":"...","steps":[{"tool":"write","args":{"path":"...","content":"..."},"title":"..."}]}`;

export class OpenRouterPlanner implements Planner {
  constructor(private models?: string[]) {}

  async plan(goal: string, context?: string): Promise<Plan> {
    const userMsg = context
      ? `الهدف: ${goal}\n\nسياق إضافي:\n${context}`
      : `الهدف: ${goal}`;
    const text = await openRouterChat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      { models: this.models, temperature: 0.2, maxTokens: 8000 }
    );
    return parsePlan(text);
  }
}

/** tolerant JSON extraction from an LLM reply */
export function parsePlan(text: string): Plan {
  const trimmed = text.trim();
  const candidates: string[] = [];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(trimmed);

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && Array.isArray(obj.steps)) {
        const steps: PlannedStep[] = obj.steps
          .filter((s: any) => s && typeof s.tool === "string")
          .map((s: any) => ({
            tool: s.tool,
            args: (s.args && typeof s.args === "object") ? s.args : {},
            title: typeof s.title === "string" ? s.title : s.tool,
          }));
        return {
          summary: typeof obj.summary === "string" ? obj.summary : "خطة تنفيذ",
          steps,
        };
      }
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("Planner returned unparseable plan:\n" + trimmed.slice(0, 500));
}

/**
 * OfflinePlanner — deterministic demo plan.
 * Builds a small Python project (math tools + tests) and runs the tests.
 * Lets the whole UI/loop be demoed with zero API keys.
 */
export class OfflinePlanner implements Planner {
  async plan(goal: string): Promise<Plan> {
    const safeName =
      goal.replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 40) || "celia_task";
    const steps: PlannedStep[] = [
      {
        tool: "scaffold_project",
        title: "إنشاء هيكل المشروع",
        args: {
          name: "celia_app",
          files: [
            {
              path: "celia_app/math_tools.py",
              content: [
                "def add(a, b):",
                "    return a + b",
                "",
                "def fib(n):",
                "    a, b = 0, 1",
                "    for _ in range(n):",
                "        a, b = b, a + b",
                "    return a",
                "",
                "def mean(xs):",
                "    return sum(xs) / len(xs) if xs else 0.0",
                "",
                "if __name__ == '__main__':",
                "    print('add(2,3) =', add(2, 3))",
                "    print('fib(10) =', fib(10))",
                "    print('mean([1,2,3,4]) =', mean([1, 2, 3, 4]))",
                "",
              ].join("\n"),
            },
            {
              path: "celia_app/test_math_tools.py",
              content: [
                "from math_tools import add, fib, mean",
                "",
                "def test_all():",
                "    assert add(2, 3) == 5",
                "    assert fib(10) == 55",
                "    assert mean([1, 2, 3, 4]) == 2.5",
                "",
                "if __name__ == '__main__':",
                "    test_all()",
                "    print('ALL TESTS PASSED')",
                "",
              ].join("\n"),
            },
            {
              path: "celia_app/README.md",
              content: `# ${safeName}\n\nمشروع تم إنشاؤه بواسطة cela2027 (وضع المحاكاة المحلية).\n`,
            },
          ],
        },
      },
      {
        tool: "python_run",
        title: "تشغيل الاختبارات داخل الصندوق",
        args: {
          code: [
            "import sys",
            "sys.path.insert(0, 'celia_app')",
            "from math_tools import add, fib, mean",
            "assert add(2, 3) == 5",
            "assert fib(10) == 55",
            "assert abs(mean([1, 2, 3, 4]) - 2.5) < 1e-9",
            "print('add(2,3) =', add(2, 3))",
            "print('fib(10) =', fib(10))",
            "print('mean =', mean([1, 2, 3, 4]))",
            "print('ALL TESTS PASSED')",
          ].join("\n"),
        },
      },
    ];
    return {
      summary: `وضع المحاكاة المحلية: بناء مشروع "celia_app" وتشغيل اختباراته داخل صندوق Python (بدون مفتاح OpenRouter). الهدف الأصلي: ${goal}`,
      steps,
    };
  }
}

export function createDefaultPlanner(models?: string[]): Planner {
  if (isOpenRouterConfigured()) return new OpenRouterPlanner(models);
  return new OfflinePlanner();
}
