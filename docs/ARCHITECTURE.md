# cela2027 — البنية المعمارية

## الفلسفة

منقولة من `agi-system`: **لا ادعاءات بدون أدلة.**
كل خطوة تمر عبر بوابات متتالية، ولا تُعلن حالة `VERIFIED` إلا بعد أن يفحص المُتحقِّق مساحة العمل بنفسه — هو لا يثق أبداً بما يقوله المنفّذ أو النموذج اللغوي.

```
Goal → Planner → Policy Gate → Executor → Verifier → Evidence → DecisionRecord → Ledger
```

## المكونات

| المكوّن | المسؤولية | ما لا يفعله |
|---|---|---|
| `packages/core/orchestrator` | تنسيق الحلقة كاملة + بث الأحداث | لا ينفّذ أدوات بنفسه |
| `packages/core/planner` | هدف → خطة JSON مُهيكلة (OpenRouter أو محاكاة محلية) | لا يلمس مساحة العمل |
| `packages/core/policy` | allowlist + احتواء مسارات + حصص حجم (fail-closed) | لا يقرأ الملفات |
| `packages/core/tools-impl` | تنفيذ الأدوات على Workspace الافتراضي | لا يتحقق من الصلاحيات |
| `packages/core/verifier` | إعادة قراءة مساحة العمل + فحص مخرجات الصندوق | لا يثق بـ ToolResult |
| `packages/core/ledger` | سجل SHA-256 مُسلسل (append-only + replay) | لا يخزّن حالة خفية |
| `packages/llm` | `ModelProvider` + `ProviderFabric` + OpenRouter/Gemini adapters | لا يكشف المفاتيح للمتصفح ولا يقرر دورة Core |
| `packages/sandbox` | عقد Sandbox الموحد + قواعد السلامة | لا ينفّذ كوداً على السيرفر |
| `apps/web` | واجهة مانوس-ستايل + SSE + Pyodide worker | لا يرى مفتاح API |

## حد مزودي النماذج

`@cela/llm` يصدّر `ModelProvider` و`ProviderFabric` كعقدين إضافيين. يطبّق OpenRouter الحالي العقد عبر `OpenRouterProvider`، ويضيف P2 `GeminiProvider` كـAdapter معزول. تبقى دوال OpenRouter العامة وشكل نتائجها كما هي، ويبقى `planner.ts` دون تعديل ويستعمل OpenRouter مع `OfflinePlanner` fallback. الـFabric يتطلب ترتيبًا صريحًا ولم يُفعّل في runtime؛ NVIDIA مرحلة لاحقة منفصلة.

## تدفق مهمة واحدة

1. `POST /api/task {goal}` → يبدأ Orchestrator في الخلفية ويعيد `taskId`.
2. `GET /api/task/:id/stream` (SSE) → إعادة الأحداث المخزّنة ثم البث الحي.
3. المخطِّط (OpenRouter، أو OfflinePlanner بلا مفتاح) يُنتج `Plan` من خطوات أدوات.
4. لكل خطوة: بوابة سياسة → تنفيذ → تحقق مستقل → أدلة → حدث SSE + ختم في السجل.
5. خطوات `python_run`: السيرفر يبث `sandbox_request`، المتصفح ينفّذ الكود في Pyodide worker ويعيد الناتج إلى `POST /api/task/:id/sandbox`. السيرفر **لا ينفّذ كود المستخدم أبداً**.
6. كل ملف يُنتَج يُبث فوراً كـ `artifact` ليظهر في عارض الملفات.
7. النهاية: `task_finished` بحالة `VERIFIED` (كل الخطوات التنفيذية موثقة) أو `FAILED`/`DENIED`.

## الأمان

- **احتواء مساحة العمل:** كل مسار يمر عبر `Workspace.resolve()` — يمنع `../` والمسارات المطلقة، ويعيد تأسيس المسارات المطلقة داخل الجذر. فحص جاف في السياسة قبل التنفيذ، وفحص فعلي في الأدوات.
- **Fail-closed:** أداة غير مدرجة في الـ allowlist تُرفض؛ allowlist فارغة ترفض كل شيء.
- **سجل محصّن:** `prev + payload → SHA-256`؛ أي تعديل بأثر رجعي يكسر السلسلة ويكشفه `verify()`.
- **المفاتيح:** `OpenRouterProvider` يقرأ `OPENROUTER_API_KEY` و`GeminiProvider` يقرأ `GEMINI_API_KEY`/`GOOGLE_API_KEY` من بيئة السيرفر فقط. وجود Adapter أو Secret لا يعني تفعيله في runtime.
- **الصندوق:** WASM داخل Web Worker بالمتصفح — عزل عملية كامل عن صفحة التطبيق وعن السيرفر.

## حدود v1 المعروفة

- التخزين في الذاكرة (لكل عملية سيرفر) — يكافئ التطوير والعرض؛ التبديل إلى Supabase عبر واجهة `@cela/store`.
- Pyodide يشغّل stdlib فقط (لا pip) — ممتاز للاختبارات والتحليل؛ Docker backend لاحقاً عبر نفس العقد.
- بلا تصفح ويب/صوت/وكلاء متعددين (خريطة الطريق للمرحلة 2).
