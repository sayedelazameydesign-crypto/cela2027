# حالة المشروع — ما تم إنجازه وما لم يكتمل

> **تاريخ القياس:** 2026-09-27 · **Commit المقاس:** `1d046e9` (Merge PR #1) · **الفرع:** `arena/01a0e381-cela2027`
> **بيئة القياس:** Node v22.22.3 / npm 10.9.8 / Linux · `npm ci` من `package-lock.json`
> **مصدر إضافي للأدلة:** تاريخ git بعد `git fetch origin 'refs/pull/*/head:refs/remotes/pr/*'` — 26 commit مرئياً. المستودع **shallow** عند `1d046e9` (`.git/shallow`)، فأي ادعاء تاريخي أدناه مقيّد صراحةً بما هو مرئي.
> **القاعدة:** لا يُكتب «منجز» إلا بدليل قابل لإعادة التشغيل. ما لم يُشغَّل فعلياً يبقى في قسم «غير مثبت».

---

## 0) نتيجة بوابة التوافق (مقاسة الآن، وليست منقولة من وثيقة)

| البوابة | الأمر | النتيجة |
|---|---|---|
| الاعتماديات والحدود | `node scripts/check-architecture.mjs` | ✅ `Architecture boundaries OK (6 workspaces checked).` |
| سياسة التغيير | `node scripts/check-change-policy.mjs` | ✅ `Change policy OK (0 changed, 0 protected, 0 binary; base origin/main).` |
| Lockfile | `node scripts/check-lockfile.mjs` | ✅ `Lockfile consistency OK (npm ci --dry-run).` |
| الأنواع (strict) | `npx tsc -p tsconfig.base.json --noEmit` | ✅ صفر أخطاء |
| الاختبارات | `npx vitest run --no-cache` | ✅ **53/53** في 11 ملفاً (1.22s) |
| البناء الإنتاجي | `npm run build` | ✅ `Compiled successfully in 8.0s` — 7 مسارات (1 static + 5 API + not-found) |
| **Browser E2E** | — | ⚠️ **غير موجود على `main`**. مسار E2E مستقل قيد الطيران في **PR #2 (DRAFT)** — انظر §3 |
| **تكامل حي** (OpenRouter / Supabase / Gemini) | — | ❌ **غير مُشغَّل** (بلا مفاتيح في هذه البيئة) |
| **سلوك Pyodide الحقيقي** | probe مستقل على `pyodide@0.26.4` (Node) | ❌ **فشل مقاس** — انظر §2.1 |

توزيع الاختبارات: `provider-contract` 7 · `orchestrator` 8 · `gemini-provider` 4 · `policy-workspace` 9 · `api-contract` 5 · `store-contract` 3 · `public-contract` 5 · `architecture-guard` 3 · `ledger` 4 · `change-policy` 3 · `sandbox-contract` 2.
**كل الـ53 وحدة/عقد. صفر متصفح، صفر شبكة حية، وصفر تغطية للحد الوحيد الذي كسر (Pyodide worker) — انظر §3.**

---

## 1) ما تم إنجازه (مثبت بالكود والاختبارات)

### 1.1 الهيكل والحوكمة
- **Monorepo workspaces**: `apps/web` + 5 حزم (`core`, `llm`, `store`, `sandbox`, `tools`) — كلها `private` بنسخة `0.1.0` وتُستهلك عبر `"*"` مع `main/types` يشيران إلى مصدر TS مباشرة (لا خطوة build للحزم).
- **بوابة `npm run verify`** واحدة محلياً وفي CI: architecture → change policy → lockfile → typecheck → tests → build.
- **حارس المعمارية** (`scripts/check-architecture.mjs`، 268 سطراً) بتحليل TypeScript AST يغطي: `import` / `import type` / `export ... from` / `import("literal")` / `require()` / `type T = import(...)` / aliases من `paths`، ويفشل **fail-closed** عند dynamic import محسوب، أو تبعية workspace غير معلنة في `package.json`، أو عبور workspace بمسار نسبي.
- **حارس سياسة التغيير** (`scripts/check-change-policy.mjs`، 209 أسطر): `git diff --check`، مسارات محمية (`packages/*/src/**` + Route Handlers + `apps/web/lib/agent-runtime.ts`) تتطلب تصريحاً في `.github/change-policy.json`، رفض الملفات الثنائية افتراضياً، وتصنيف إلزامي `A–F`.
- **CI** (`.github/workflows/ci.yml`): `fetch-depth: 0` + Node 20 + `npm ci` + `npm run verify` على `push:main` وكل PR، مع `OPENROUTER_API_KEY=""` كعنصر بناء فقط.
- **اتساق aliases**: حارس يقارن كل alias في `apps/web/tsconfig.json` مع الهدف canonical في `tsconfig.base.json` (معالجة قيد Next.js الذي لا يعمل له `extends`).
- **حدود الحارس المعروفة (توثيق أمانة، لا اتهام):** في مستودع shallow يقيم `origin/main` عند `HEAD`، فيعيد `check:changes` «0 changed» حتى مع وجود تغييرات غير مُعمَّلة commit. الحارس يفترض تاريخاً كاملاً (`fetch-depth: 0` في CI) — وهذا شرط يجب ألا يُنسى عند القياس المحلي.

### 1.2 النواة — حلقة الوكيل (`packages/core`، مُجمّدة افتراضياً)
| الملف | المنجز |
|---|---|
| `events.ts` (84) | نموذج البيانات: `TaskStatus` (6)، `StepStatus` (6)، `PlannedStep`/`Plan`، `Evidence`، `DecisionRecord`، `Artifact`، وunion `AgentEvent` (9 أحداث) |
| `orchestrator.ts` (156) | الحلقة كاملة: Goal → Plan → بوابة سياسة على الخطة → تنفيذ خطوة-بخطوة مع سياسة لكل خطوة → تحقق مستقل → أدلة → `task_finished`؛ بث كل حدث وختمه في السجل |
| `planner.ts` (206) | `OpenRouterPlanner` (prompt عربي صارم + `parsePlan` متسامح مع الـfences والنص المحيط) · `OfflinePlanner` (خطة حتمية: `scaffold_project` ثم `python_run`) · `FallbackPlanner` (هبوط صريح مع سبب ظاهر في الملخص) · `createDefaultPlanner` |
| `policy.ts` (130) | **fail-closed**: allowlist (فارغة = رفض الكل)، احتواء مسارات جاف قبل التنفيذ، حصص `maxSteps=40` / `maxWorkspaceBytes=5MB` / `maxFileBytes=500KB`، أوزان مخاطر لكل أداة |
| `workspace.ts` (92) | نظام ملفات افتراضي مع `resolve()` يمنع `../` والمسارات المطلقة (يعيد تأسيسها داخل الجذر)، `read/write/exists/delete/list/snapshot/totalBytes` |
| `tools-impl.ts` (93) | `read`, `ls`, `write`, `edit`, `patch` (alias لـ`edit`), `scaffold_project`, `delete_file` — كلها نقية على الـWorkspace بلا لمس القرص |
| `verifier.ts` (100) | **لا يثق بالمنفّذ**: يعيد قراءة مساحة العمل (`files_present_nonempty` / `all_present`)، ويفحص مخرجات الصندوق (`sandbox_ok`, `exit_clean`, `stdout_len`, `stdout_preview`)؛ `verifyRun` تشترط أدلة لكل خطوة تنفيذية وإلا لا `VERIFIED` |
| `ledger.ts` (75) | سجل SHA-256 مُسلسل append-only (`prev + payload → hash`) مع `verify()` يكتشف أول كسر، و`export()`/`Ledger.from()` — يعمل في Node والمتصفح عبر `crypto.subtle` |
| `executor.ts` (46) | `executeStep` + عقدا `SandboxBridge` و`ToolResult` (نقطة حقن الصندوق) |

### 1.3 HTTP API (`apps/web/app/api`) — 5 مسارات + اختبارات عقد
| المسار | السلوك المثبت |
|---|---|
| `POST /api/task` | يقبل `{goal}`، يرفض الفارغ (400 `الهدف مطلوب`) وما فوق 4000 حرف (400) — **مختبر** |
| `GET /api/task/:id/stream` | SSE: replay للمخزون ثم بث حي + heartbeat كل 15s + إغلاق بعد `task_finished` — **بلا أي اختبار** (§3.5) |
| `GET /api/task/:id/events?after=SEQ` | غلاف `{taskId, events, done}`؛ `after` غير رقمي → `-1`؛ مهمة مجهولة → `{events: [], done: true}` — **مختبر** |
| `GET /api/task/:id/files` | `{taskId, files}` من snapshot مساحة العمل — **مختبر** (الحالة الفارغة) |
| `POST /api/task/:id/sandbox` | يرفض `runId` لا يبدأ بـ`{taskId}:` (400) — **مختبر**، و404 عند عدم وجود طلب معلّق |

### 1.4 الواجهة (`apps/web`)
- `page.tsx` (470 سطراً): عربية RTL داكنة فيوتشرية — إدخال هدف + أمثلة جاهزة، خطوط زمن حية للخطوات مع الأدلة وحالات `FAILED/DENIED`، عارض ملفات مع تنزيل ملف مفرد، سجل مخرجات الصندوق.
- `NetworkGraph.tsx` (223 سطراً): شبكة Three.js بست عقد (`goal/plan/policy/execute/verify/evidence`) وحواف، تومض عند الفشل.
- `lib/agent-runtime.ts` (187 سطراً): سجل مهام في الذاكرة + ناقل أحداث + `seq` رتيب لكل حدث + جسر الصندوق (`runId` مركّب `taskId:xxxx` + مهلة 60s إن لم يرد المتصفح) + write-through اختياري لـSupabase + singleton عبر `globalThis` (يصمد أمام HMR في dev).
- `public/pyodide-worker.js` (45 سطراً): Web Worker يحمّل Pyodide v0.26.4 من jsdelivr، يلتقط stdout/stderr، ويعيد `{runId, ok, stdout, stderr, durationMs}`.

### 1.5 المزودون (`packages/llm`) — P1 + P2 منتهيان
- `ModelProvider` / `ChatRequest` / `ChatResponse` / `ProviderHealth` كعقود محايدة.
- `OpenRouterProvider`: سلسلة موديلات `:free` أولاً (deepseek → llama-3.3 → gemini-2.0-flash-exp → claude-sonnet-4.5)، `OPENROUTER_MODELS` يتجاوز السلسلة، مهلة 120s مع `AbortController`، و`attempts` يجمع أسباب الفشل؛ الأغلفة القديمة محفوظة مع إزالة حقل `provider` قبل الإعادة — **لا كسر توافق**.
- `GeminiProvider`: `system → systemInstruction`، `assistant → model`، المفتاح في `x-goog-api-key` (لا في URL)، `GEMINI_API_KEY` مع alias `GOOGLE_API_KEY`، موديل واحد بلا fallback — **4 اختبارات HTTP mock**.
- `ProviderFabric`: ترتيب صريح إلزامي `providerOrder`، بلا routing ضمني ولا فروع خاصة بمزود، ويرفض تسجيل مزود مكرر.
- `health()` = حالة إعداد فقط (`configured|unconfigured`) بلا صرف حصة.

### 1.6 التخزين (`packages/store`)
- عقد `Store` بست عمليات + `TaskRecord` / `MessageRecord`.
- `MemoryStore` كامل مع عزل النسخ — **3 اختبارات عقد**.
- `SupabaseStore` مطبّق بالكامل عبر PostgREST (بلا SDK) مع `resolution=merge-duplicates`، ويُفعَّل تلقائياً في `agent-runtime` عند وجود `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. **بلا أي اختبار** (§3.2).

### 1.7 الصندوق (`packages/sandbox`)
- عقد موحّد `SandboxExecution` / `SandboxResult` / `SandboxBridge` + `validateSandboxCode` (يرفض الفارغ وما فوق 100,000 حرف) + ثابت `SANDBOX_TIMEOUT_MS = 30_000` — **اختبارا عقد**.

### 1.8 التوثيق
`README.md` · `docs/ARCHITECTURE.md` · `docs/PROVIDERS.md` · `docs/ROADMAP.md` · `docs/SAFE_EVOLUTION.md` · `docs/SUPABASE_SETUP.md` (SQL جاهز للـtasks/messages + RLS) · `.env.example` موثّق بالعربية · وهذا الملف.

---

## 2) ما لم يكتمل

### 2.0 خرق ثابت — قدرة غير مُعلَنة (`delete_file`)

**الثابت المخترَق:** *كل ما يستطيع الوكيل فعله مُعلَن* — `TOOL_MANIFEST` ⇄ allowlist السياسة ⇄ `buildDefaultTools` يجب أن تكون ثلاث مجموعات متطابقة. هذا الثابت هو أساس نموذج الأمان كله (fail-closed)، وليس تفصيلاً تنظيمياً.

**الدليل الحالي:** `delete_file` مطبّق في `tools-impl.ts:82` (يحذف فعلاً من مساحة العمل) وله وزن مخاطر `high` في `policy.ts:28`، لكنه **غير موجود** في `TOOL_MANIFEST` ولا في allowlist السياسة الافتراضية (`policy.ts:51-53`) → قدرة حذف حقيقية تعيش في كود التشغيل دون إعلان ودون فحص سياسة يساوي وزنها.

**الدليل التاريخي (26 commit مرئياً):** السلسلة ظهرت **فقط** في ملفين عبر التاريخ كله — `packages/core/src/tools-impl.ts` (24 commit) و`packages/core/src/policy.ts` (25 commit) — ولا مرة في `packages/tools/src/index.ts`. وأول commit للنواة `4ff4d65` يملك الـallowlist الافتراضية نفسها بلا `delete_file`. **الاستنتاج: ولادة بهذا الشكل، لا انحدار.** (القيد: المستودع shallow عند `1d046e9`؛ ما قبل الحدود غير قابل للفحص، لكن `4ff4d65` هو أول commit للنواة أصلاً.)

**لماذا مرّ من البوابة:** الحرسان الحاليان **أحاديا الاتجاه**. `public-contract.test.ts` يفحص `TOOL_MANIFEST → policy` (كل أداة مُعلَنة مقبولة) و`TOOL_MANIFEST → tools` (لكل أداة معلَنة تنفيذ)، ولا يوجد أي فحص عكسي `tools → TOOL_MANIFEST`. أي أداة تُضاف إلى `buildDefaultTools` وحده تمرّ صامتة.

**الإغلاق المطلوب (عبر بوابة change-policy، تصنيف `A`/`E`):**
1. قرار صريح: إعلان `delete_file` (manifest + allowlist + verifier + اختبارات allow/deny) **أو** حذف تنفيذه. لا حالة ثالثة.
2. **حارس تناظر** في `public-contract.test.ts`: `buildDefaultTools(ws).keys()` ⊆ أسماء `TOOL_MANIFEST`، وأي أداة تنفيذية غير معلَنة تفشل البوابة برسالة تسمّيها.
3. امتداد الحارس: كل أداة في الـallowlist تُصرّح بعمليات ملفاتها (قراءة/كتابة/حذف) في الـmanifest، بحيث يصبح وزن المخاطر في `policy.ts` مشتقاً من الإعلان لا مكتوباً بجواره يدوياً.
4. تصنيف `delete_file` كـ`high` يبقى سارياً عند إعلانه، مع اختبار `DENIED` عند إخراجه من الـallowlist.

> **الفرق النوعي:** هذا البند و§2.1 ليسا «فجوتين صغيرتين» بجانب «عقدة policy لا تضيء». الأولان خرقان لثابتين يقوم عليهما النموذج (الإعلان، وعزل الصندوق عن مساحة العمل)، والثالث دين تصميم في العرض. الخلط بينها في قائمة واحدة يُخفي أيها يُغلق أولاً.

### 2.1 P0 — مكسور وظيفياً (يمنع «مهمة VERIFIED» في المتصفح الحقيقي)

**أ) الصندوق لا يرى مساحة العمل.**
`Workspace` افتراضية في ذاكرة السيرفر، و`pyodide-worker.js` يستقبل `{runId, code}` **فقط**؛ لا مزامنة ملفات إطلاقاً (`FS.writeFile` غير مستخدمة، ولا حقل `files` في رسالة العامل). أي خطوة `python_run` تستورد ملفاً بُني في الخطوات السابقة تفشل حتماً.

*دليل مقاس (2026-09-27) بتشغيل كود `OfflinePlanner` النهائي حرفياً داخل Pyodide 0.26.4 على Node:*
```json
{ "ok": false, "stdout": "", "stderr": "File \"<exec>\", line 3, in <module> | ModuleNotFoundError: No module named 'math_tools'" }
```
`ok:false` → `verifyStep` تعيد `sandbox_ok:false` → الخطوة `FAILED` → المهمة `FAILED`.

**كيف نجا من 53 اختباراً:** `orchestrator.test.ts` يحقن `okBridge` يعيد `{ok:true}` **بغضّ النظر عن الكود** — انظر §3.1. الفشل لم يكن في الصندوق فقط، بل في طبقة الاختبار التي حجبتْه.

**ب) الاعتماد على CDN خارجي.** `importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js")` — من بيئة القياس نفسها: `curl → 000 (SSL_ERROR_SYSCALL)`. لا self-hosting ولا fallback ولا خطأ مميّز للمستخدم عند فشل التحميل (يظهر كفشل python عادي). PR #2 يوثّق الظاهرة نفسها («integration stage … self-skips where the CDN is unreachable»).

**ج) Preflight مطلوب قبل أي إصلاح (لا يُحسم النموذج مسبقاً):**
```text
1. Characterize عقد رسالة العامل الحالي:
   {runId, code} → العامل، و{runId, ok, stdout, stderr, durationMs} → POST /sandbox،
   وقاعدة runId prefix. اختبار characterization يفشل عند تغيير أي حقل.
2. Characterize سلوك Workspace FS في العزلة:
   resolve/write/read/list/snapshot/totalBytes (9 اختبارات قائمة) +
   fixture لتوزيع الأحجام الحقيقي (عدد الملفات/إجمالي البايت لخطة منتَجة فعلياً).
3. قياس ثم اختيار نموذج المزامنة — لا حسم مسبق:
   (a) files داخل الرسالة      — الأبسط، بلا protocol؛ سقفه حجم الرسالة، ويعيد الإرسال كل run
   (b) mount FS في العامل       — يدعم read/write/delete من داخل Python ويفتح artifacts وdelete_file معاً؛ يحتاج protocol + إصدارات
   (c) chunked transfer         — الأمتن لمساحة حتى 5MB (سقف السياسة)؛ يحتاج ordering + checksums + resume
4. Extend + Verify خلف البوابة الكاملة.
```
**مصفوفة القرار (تُقاس، لا تُخمَّن):** توزيع أحجام مساحة العمل · عدد خطوات `python_run` لكل مهمة · هل يحتاج Python أن **يكتب** ملفات (لا أن يقرأ فقط) · أثر حجم الرسالة على حدود Vercel Hobby · قابلية النموذج لاستيعاب `delete_file`/`write_file`/`artifacts` لاحقاً.
(ب) و(ج) يفتحان الثلاثة معاً؛ (أ) يغلق P0 وحده. **القرار يستحق قياساً قبل الحسم — لا يُختار (أ) لأنه الأسهل.**

### 2.2 P1 — المرحلة 2 (البقاء والتخزين الدائم): الخادم جاهز، الطرف الآخر مفقود

| البند | الحالة |
|---|---|
| **Polling في الواجهة** | ❌ `page.tsx` يستهلك `EventSource` فقط؛ `es.onerror` يغلق البث ويوقف `running` **بلا** تحول إلى `GET /events?after=seq`. endpoint موجود ومختبر لكن **بلا مستهلك** → على Vercel Hobby تنقطع المهمة ولا تُستأنف. PR #2 ثبّت هذا سلوكياً: «stream 503 ⇒ silent stop with stale badge, no reconnect/polling» |
| **استئناف المهام من السجل** | ❌ غير منفّذ. `Ledger.export()/from()` موجودان ومختبران لكن **لا يُستدعيان من أي كود تشغيلي** — لا endpoint لـ`replay`/`verify` ولا واجهة تعرض سلامة السلسلة |
| **متانة التخزين** | ⚠️ write-through **best-effort** (خطأ Supabase يُبتلع في `catch {}`) وبلا اختبارات تكامل. لا جداول `steps` / `artifacts` / `ledger_events` (وإنما `tasks` + `messages` فقط) رغم أن ROADMAP يعدّدها |
| **`messages` غير مستخدمة** | ❌ `addMessage` / `listMessages` **لا تُستدعى من أي مكان** خارج تعريفها واختبار العقد؛ `NEXT_PUBLIC_SUPABASE_ANON_KEY` معرّف في `.env.example` وبلا أي مستهلك في الكود |
| **سجل المهام في الواجهة** | ❌ لا تاريخ مهام ولا إعادة فتح مهمة (لا استهلاك لـ`listTasks`/`getTask` ولا endpoint لها) → إغلاق المتصفح = فقدان المهمة من الواجهة |
| **سياسة التنظيف (7 أيام)** | ❌ غير موجودة (لا cron ولا حذف artifacts قديمة) — مطلوبة للبقاء ضمن 500MB |
| **CI** | ✅ منجز (`npm ci` + `verify`) |

**معيار إنجاز المرحلة 2 لم يتحقق بعد:** «مهمة تبدأ على النشر السحابي، تُغلق المتصفح، تُفتح من جهاز آخر وتُستأنف حتى `VERIFIED`» — يتطلب §2.1 + polling + استئناف معاً.

### 2.3 P2 — المرحلة 3 (العقل الحقيقي): البنية جاهزة، التفعيل لم يبدأ
- ❌ `ProviderFabric` و`GeminiProvider` **غير مسجّلين في runtime**؛ `planner.ts` ما زال يستورد `openRouterChat` مباشرة (قرار موثّق في `PROVIDERS.md`، لا خلل).
- ❌ المراحل المؤجلة صراحة: `P3` NVIDIA adapter · `P4` routing policy + cost evidence · `P5` حقن Planner خلف feature flag · `P6` workflow entrypoints · `P7` UI dispatch/polling.
- ❌ **حارس الحصة**: لا عدّاد طلبات يومي؛ عند نفاد الحصة يهبط `FallbackPlanner` إلى خطة المحاكاة **دون إشعار واضح في الواجهة** (يظهر فقط في نص الملخص).
- ❌ **ضغط السياق**: `maxTokens=8000` ثابت وهدف واحد حتى 4000 حرف؛ لا تقسيم للأهداف الطويلة إلى مهام متتالية.
- ❌ **اختبار الجودة المعياري**: لا وجود لـ10 أهداف عربية معيارية تُختبر (يدوياً أو في CI).

### 2.4 P3 — المرحلة 4 (الأيدي الأوسع): لم تبدأ
- ❌ تصفح الويب (جلب صفحات / HTML→نص / Jina Reader) + قواعد نطاقات في `PolicyEngine` + حد حجم الصفحة.
- ❌ الأدوات المخططة: `list_dir` شجري، `rename_file`، `search_in_files`، `download_to_workspace` (2MB/ملف).
- ❌ **تصدير ZIP**: غير موجود. الموجود فعلياً: تنزيل ملف مفرد (Blob نصي) و«تنزيل المشروع» كـ**JSON واحد** يحوي `{taskId, files}` — لا أرشيف بمسارات.

### 2.5 P4 — المرحلة 5 (SICA والوكلاء المتعددون): لم تبدأ
- ❌ حلقة النقد الذاتي وجدول `lessons` وحقن الدروس في سياق التخطيط · ❌ وكلاء فرعيون متوازيون مع طابور إرسال (احترام 20 طلب/دقيقة) · ❌ Vercel Cron لفحص صحة الوكيل.

### 2.6 P5 — جودة الاختبار والأمان
| البند | الحالة |
|---|---|
| Browser E2E | ⚠️ غير موجود على `main`؛ قيد الطيران في PR #2 (§3). بناء Next واختبارات Route Handlers وحدها **لا تثبت** worker ولا NetworkGraph ولا رحلة المستخدم — ولهذا مرّت §2.1 |
| تكامل حي OpenRouter/Supabase | ❌ خارج CI (الاختبارات الحالية تثبت الفصل والعقود فقط) |
| مهلة الصندوق الفعلية | ⚠️ `SANDBOX_TIMEOUT_MS = 30_000` ثابت **غير مفروض** في العامل (لا `AbortSignal`/`terminate`)؛ الاختبار يثبت قيمة الثابت لا تطبيقه. المهلة المطبقة الوحيدة 60s على جسر السيرفر |
| احتواء Pyodide | ⚠️ العزل عملية/WASM حقيقي، لكن `validateSandboxCode` يفحص الطول فقط — لا سياسة على مستوى الكود (لا حظر `open()`/`os`/حلقات لا نهائية) |
| نسخة API | ❌ لا version prefix؛ أي عقد غير متوافق مستقبلاً يحتاج مساراً جديداً (موثّق كمخاطرة) |
| Lint | ⚠️ `next build` يمرر فحص types؛ لا ESLint config مستقل في المستودع |

### 2.7 P6 — دين تصميم في النموذج والعرض (مثبت بالدليل)

**أ) `AWAITING_SANDBOX` — دين تصميم، لا انحدار.**
الفحص المطلوب `git log -S AWAITING_SANDBOX --oneline` **لا يفصل وحده** في هذا المستودع: التاريخ shallow عند `1d046e9`، فيظهر الإدخال كأنه حدث في الـmerge commit. بعد جلب رؤوس الـPRs (`refs/pull/*/head`) أصبح الفحص ممكناً:

| الدليل | النتيجة |
|---|---|
| أول ظهور للسلسلة | `4ff4d65` (02:22:44) في `packages/core/src/events.ts:10` — داخل تعريف الـunion فقط |
| ثاني ظهور | `b0ff8c3` (02:27:34، بعد 5 دقائق) في `page.tsx:26,35` — تسمية عربية + لون |
| البحث عن أي إصدار لها عبر **كل** الـ26 commit المرئية (`orchestrator.ts` / `agent-runtime.ts` / `app/api`) | **صفر نتائج** |

**الخلاصة:** الحالة **لم تُصدَر قط** → **design debt** (نُمذجت الحالة ولُوّنت في الواجهة ثم لم تُوصَل)، وليست regression. **القيد المعلن:** الفحص يغطي 26 commit مرئياً فقط؛ ما قبل حدود الـshallow غير قابل للإثبات، غير أن `4ff4d65` هو أول commit للنواة أصلاً. المطلوب: إما إصدارها قبل `sandbox_request` وإزالتها بعده، أو حذفها من الـunion مع فحص المستهلكين (تغيير في عقد مُجمّد → `[F]` أو فترة توافق).

**ب) `DecisionRecord` نموذج غير مُعبّأ.** `orchestrator.ts` يستخدم `DecisionRecord["evidence"]` كنوع فقط؛ الحقول `policyDecision`/`risk`/`seq`/`stepId` لا تُبنى ولا تُخزَّن ولا تُبث → «سجل القرارات» المذكور في ARCHITECTURE غير محقق فعلياً.

**ج) عقدة `policy` في الشبكة 3D لا تضيء أبداً.** `setActiveNode` يُستدعى بـ`goal/plan/execute/verify/evidence/null` فقط (13 موضعاً) ولا مرة بـ`policy` — لا يوجد حدث سياسة مخصص (القرار يُستهلك داخلياً).

**د) بث `artifact` تربيعي + إخفاء في المخزون.** بعد **كل** خطوة يُعاد بث كل ملفات مساحة العمل (`for (const p of ws.list())`) → أحداث O(steps×files). والمخزون يحذف النسخ الأقدم لكل مسار، فـ**المنضم المتأخر يرى ملفات أقل من عدد الأحداث** — PR #2 قاسها: «replay buffer de-duplicates artifacts by path (late joiners see 15/18 events)». السلوك مقصود في الـbuffer لكنه غير موثّق كعقد.

---

## 3) تدقيق الـfakes — البند الذي كشفه P0

**المعيار:** الـfake المشروع **يعزل حداً خارجياً** (شبكة، متصفح، ساعة) مع تمثيل أمين لسلوكه. الـfake المضر **يستبدل منطقاً داخلياً** أو يعيد نجاحاً مفترضاً بغضّ النظر عن المدخلات — فيُخفي الانحدار بدل أن يعزله. `okBridge` من النوع الثاني، ولهذا نجا P0.

| # | الـfake | الموضع | التصنيف | التفصيل |
|---|---|---|---|---|
| 3.1 | `okBridge` / `failBridge` | `packages/core/orchestrator.test.ts:38-45` | ❌ **حاجب** | `requestRun: async () => ({ok:true, stdout:"ALL TESTS PASSED"})` — **لا يقرأ `code` إطلاقاً**. يفترض نجاح أي كود، بينما كود `OfflinePlanner` الحقيقي يستورد ملفات لا يملكها الصندوق. نجح الاختبار لأن الـfake طُبّق على «جسر مجرد»، لا على الحد الحقيقي (متصفح + Pyodide + FS). المطلوب ليس حذفه (لا متصفح في unit test) بل ألا يكون **الوحيد**: characterization لعقد رسالة العامل + fixture يثبت أن كود الخطة يعتمد على ملفات مساحة العمل + مرحلة integration تشغّل Pyodide فعلياً مع حقن FS |
| 3.2 | `MemoryStore` كمرجع لعقد `Store` | `packages/store/store-contract.test.ts` (3 اختبارات) | ⚠️ **مريح لا مرآة** | العقد مُثبت على `MemoryStore` وحدها؛ **`SupabaseStore` — الـbackend الذي سيُفعَّل في الإنتاج — صفر اختبارات** (ولا حتى fetch mock). السلوكيات المتباعدة غير المفحوصة: تحديث id غير موجود (صامت محلياً مقابل `PATCH` على صف غير موجود)، تحويل الأسماء `created_at↔createdAt` و`summary:null→undefined`، ترتيب `listTasks` بين `localeCompare` و`order=created_at.desc`، رمي الخطأ مقابل إعادته، وعزل النسخ عبر PostgREST. كما أن `addMessage`/`listMessages` غير مستدعاة تشغيلياً، فاختبار العقد يثبت مساراً ميتاً. **الإصلاح:** تجريد مجموعة العقد كدالة تُشغَّل على أي تطبيق (MockedPostgREST في CI + تكامل حقيقي في staging)، وهو ما تُلزمه `SAFE_EVOLUTION.md` §5 أصلاً ولم يُنفَّذ |
| 3.3 | `vi.stubGlobal("fetch")` | `provider-contract.test.ts` (7) · `gemini-provider.test.ts` (4) | ✅ **مشروع** | يعزل حداً HTTP خارجياً حقيقياً، ويثبت شكل الطلب لا الاستجابة فقط: URL، `Authorization`، `x-goog-api-key`، مسارات الخطأ (429/مفتاح مفقوع)، وسلسلة البدائل. **الخطر الوحيد المتبقي:** الـfixture يمثّل wire حسب فهمنا، وقد ينحرف عن الواقع دون أن نلاحظ (لا fixture مسجّلة من استجابة حية) |
| 3.4 | doubles لمزودين في `ProviderFabric` | `provider-contract.test.ts` | ✅ **مشروع** | `unconfigured`/`failing`/`healthy` هي **موضوع الاختبار نفسه** (عقد المزود)، لا بديل عن منطق داخلي |
| 3.5 | اختبارات API | `apps/web/app/api/api-contract.test.ts` (5) | ⚠️ **ناقص التغطية** | لا fakes (يستدعي Route Handlers الحقيقية بـ`Request` حقيقي) — لكن **كل الحالات الخمس مسارات خطأ/فارغة**. المسار السعيد لـ`POST /api/task` (إنشاء مهمة + تشغيل orchestrator في الخلفية) غير مُختبر، و`stream/route.ts` **غير مستورد إطلاقاً** (لا replay، لا done، لا heartbeat). كما أن `runtime()` singleton على `globalThis` = حالة مشتركة بين الاختبارات بلا عزل أو تصفير |
| 3.6 | `policy-workspace` (9) · `ledger` (4) · `architecture-guard` (3) · `change-policy` (3) | — | ✅ **حقيقية** | بلا fakes؛ تشغّل المنطق الفعلي. ملاحظة أمانة: `ledger.test.ts` يختبر `verify()` على نسخة مُعدَّلة يدوياً (تزوير محاكى)، لا على عبث حقيقي عبر runtime — مقبول كعزل، لكنه لا يثبت أن سلسلة الإنتاج تُكسر فعلاً عند تعديل event مخزّن |
| 3.7 | `sandbox-contract` (2) | `packages/sandbox` | ⚠️ **قشرة** | يثبت قيمة الثابت `30_000` وسلوك `validateSandboxCode` — لا يثبت **تطبيق** المهلة في أي مكان (§2.6) |
| 3.8 | **الحد الذي بلا fake إطلاقاً** | Pyodide worker / المتصفح | ❌ **الثغرة** | لا بديل ولا اختبار حقيقي → **الحد الوحيد غير المختبر هو الحد الوحيد الذي كسر**. هذه هي القاعدة العامة المستخلصة: غياب الـfake المشروع عن حد خارجي ليس أماناً، بل عمى |

**خلاصة قابلة للتعميم:** كل fake في المستودع إما مشروع (3.3، 3.4، 3.6) أو ناقص/حاجب (3.1، 3.2، 3.5، 3.7). لا يُقبل بعد اليوم fake يعيد نجاحاً غير مشروط لمدخلات لم يفحصها، ولا عقد يُثبت على تطبيق واحد بينما التطبيق الإنتاجي بلا تغطية.

---

## 4) أعمال متزامنة — إحالات مرجعية (لا تُحتسب منجزاً هنا)

**PR #2 — «E2E track» (DRAFT، مفتوح وقت القياس، 9 commits، فرع `arena/01a0e34e-cela2027`):**
- Playwright مثبّت بـcontainer digest + fixtures مسجّلة من التطبيق الحقيقي + fault proxy (`fail-next/delay/drop/route/reset`) + معايرة مهلات → `e2e/retry-calibration.json` + مرحلتا `mocked-app-api` و`integration`.
- **يؤكد قياسنا مستقلاً** لفجوة الـpolling: «stream 503 ⇒ silent stop with stale badge, no reconnect/polling».
- **يضيف ما لم نرصد:** «no WebGL ⇒ whole React tree unmounts» (هشاشة `NetworkGraph` تسقط الصفحة كلها) · «no retry on `POST /api/task` failure and the error text is not surfaced».
- **لا يغلق P0:** مرحلة الـintegration تشغّل Pyodide حقيقياً لكنها **تتخطى نفسها تلقائياً عند تعذّر CDN** — أي أن §2.1 لن يُكشف فيها داخل بيئة sandbox (وCDN متعذّر هنا فعلاً: `curl → 000`).
- **الأثر على الأولويات:** بند «إضافة E2E» في §5 صار «دمج PR #2 ثم **البناء عليه** حالة مزامنة الملفات»، لا إنشاء مسار جديد. و`E2E_BASE_SHA` المذكور فيه (`eff05290`) **غير موجود محلياً** — لا يمكن التحقق من نقطة أساسه في هذه البيئة.

### 4.1 ما استُخرج من هذا المستودع وصار قابلاً للنقل (مقيس)

نظام الحوكمة نفسه — لا نواة الوكيل — استُخرج إلى قالب محمول، ثم طُبّق على مستودع ثانٍ:

| المخرج | الموضع | الدليل |
|---|---|---|
| قالب الحوكمة | `tools/governance-template/` | **9/9** اختبارات تكافؤ (`node tools/governance-template/tests/run-tests.mjs`): الحارس المعماري المُعمَّم يعيد نفس مجموعة الخروقات حرفياً مثل `scripts/check-architecture.mjs`؛ نسخة Python من حارس السياسة تطابق نسخة node **بايت-ببايت** على نفس الشجرة؛ حارس حدود الاستيراد يفشل fail-closed على تبعية غير معلَنة (حتى المستوردة داخل جسم دالة) |
| `protectedPatterns` معلَنة | `.github/change-policy.json` | المسارات المحمية صارت **إعلاناً** لا كوداً مثبّتاً، واختبار تكافؤ يثبت أن الإعلان يُنتج نفس قرار `isProtectedPath` المثبّت في الحارس على 12 مساراً نموذجياً |
| port إلى `agi-system` | `tools/agi-system-handoff/port/` (9 ملفات نصية) | `python3 scripts/verify.py` → **6 بوابات PASS في ~3.0s**: سياسة التغيير · حارس «صفر تبعيات» (19 ملفاً، 154 استيراداً: 110 stdlib + 44 محلي + **0 خارجي**) · 86 اختباراً OK · demo `ALL EXPECTATIONS MET: True` · compileall · CLI smoke `finished: VERIFIED`. والتعبئة قِيست في venv معزول: `pip install -e . --no-deps` → `agi-kernel doctor --json` exit 0 |
| سبب كون التسليم نصاً لا patch/bundle | — | الحارس رفض `git format-patch` (7 مواضع مسافات ذيلية داخل نص مُولَّد) ورفض `git bundle` (ثنائي غير مصرّح). المولّدات لا تدخل Git؛ `port/` شجرة نصية قابلة للحراسة والمراجعة |
| عائق الدفع | — | `403 Permission … denied to arena-ai-coding-agent[bot]` على `agi-system` → التسليم يُدفَع بيد مالك المستودع عبر `apply-to-agi-system.sh` (‏`apply`/`commit` مُختبران على clone نظيف) |

**أهم ما كشفه التطبيق على `agi-system`:** نفس الثابت المخترق هنا (§2.0 `delete_file` غير معلَنة) **سليم هناك** — `filesystem.delete` في `DEFAULT_ALLOWLIST` مع وزن مخاطر وبوابة `allow_delete` صريحة (`core/policy.py:87`). وكذلك لا يوجد هناك fake من النوع الحاجب: **صفر mocks** في 86 اختباراً (كلها على `tempfile` حقيقي)، والـfakes الوحيدة **خصوم مقصودة** (`LyingExecutor` و`CrashingExecutor` في `demo.py`) — أي أن الـfake **موضوع** الاختبار لا **بديل** عن الحد الحقيقي. هذه هي القاعدة المحمولة من §3.

---

## 5) الادعاءات التي صُحّحت في README (فجوة توثيق/واقع)

الروابط وحدها لا تُصحّح ادعاءً؛ لذلك وُسِم كل ادعاء **inline بـ⚠ في سياقه** داخل `README.md` في نفس هذا التغيير، لا بالإحالة فقط:

| النص السابق | ما ثبَت | الإجراء في README |
|---|---|---|
| «وضع محاكاة محلية: يعمل كامل الواجهة والحلقة بدون أي مفتاح» | الحلقة تعمل حتى `python_run` ثم **تفشل** (`ModuleNotFoundError` مقاسة) | ⚠ وسم inline + ربط §2.1 |
| «صندوق Python: تنفيذ داخل متصفح المستخدم عبر Pyodide» | صحيح كعزل، لكنه **لا يرى ملفات مساحة العمل** | ⚠ وسم inline |
| «سجل أحداث مُهاش — `replay` و`verify` لكل مهمة» | الدالتان في النواة ومختبرتان، **بلا مسار HTTP ولا واجهة** | ⚠ وسم inline |
| «تنزيل المشروع المُنتَج» | تنزيل **JSON واحد**، لا ZIP بمسارات | ⚠ تصحيح الصياغة |
| جدول «حالة المشروع (v1)»: «صندوق Pyodide ✓ يعمل» | يعمل كآلية، يفشل كقدرة | ⚠ تفصيل الحالة |

بنود إضافية لا تخص README وحده:
- `ROADMAP` المرحلة 2 «Polling كل 2 ثانية»: الـendpoint منفّذ ومختبر، **الواجهة لا تستهلكه**.
- `ROADMAP` المرحلة 2 جداول `steps, artifacts, ledger_events`: الكود و`SUPABASE_SETUP.md` يغطيان `tasks` + `messages` فقط.
- `ARCHITECTURE` «كل خطوة تمر عبر … DecisionRecord»: `DecisionRecord` غير مُعبّأ (§2.7ب).
- `docs/SAFE_EVOLUTION.md` دقيق أصلاً في هذا الانضباط («لا يجوز وصف E2E أو التكامل الحي بالنجاح قبل إضافتهما») — الجدول أعلاه يمدّ القاعدة نفسها إلى README/ROADMAP/ARCHITECTURE.

---

## 6) أولوية التنفيذ المقترحة (كل بند = تغيير Additive خلف بوابة `verify`)

| # | المهمة | التصنيف | معيار القبول |
|---|---|---|---|
| 1 | **P0 preflight** (§2.1ج): characterize عقد رسالة العامل + سلوك Workspace، قياس مصفوفة القرار، **ثم** اختيار نموذج المزامنة (a/b/c) | `A` characterization → `C` adapter | عقد العامل مثبّت باختبار يفشل عند تغيير أي حقل؛ قرار النموذج مبرَّر بأرقام لا بأفضلية |
| 2 | تنفيذ نموذج المزامنة المختار + حقن FS | `B/C` | اختبار عقد: `write` ثم `python_run:import` → `ok:true`؛ ومهمة Offline تصبح `VERIFIED` في متصفح حقيقي |
| 3 | **حارس تناظر الأدوات** (§2.0) + قرار `delete_file` | `A`/`E` | `buildDefaultTools.keys()` ⊆ `TOOL_MANIFEST` مفروض باختبار؛ لا قدرة غير معلَنة |
| 4 | Polling fallback في الواجهة (2s، `after=seq`) | `B` | قطع SSE يدوياً → المهمة تكمل حتى `task_finished` بلا فقدان حدث (يُقاس عبر fault proxy من PR #2) |
| 5 | E2E: **دمج PR #2 أولاً**، ثم إضافة حالة مزامنة الملفات + حالة CDN غير متاح | `A` | `verify` يشمل E2E ويُثبت `VERIFIED` في متصفح حقيقي؛ لا حالة skip صامتة على P0 |
| 6 | مجموعة عقد `Store` قابلة لإعادة التشغيل على `SupabaseStore` (mocked PostgREST) | `C` | نفس الاختبارات تمر على التطبيقين؛ التبديلات السلوكية موثّقة |
| 7 | endpoint + لوحة للسجل (`GET /api/task/:id/ledger` → `{entries, valid, brokenAt}`) | `A` | يطابق مثال `SAFE_EVOLUTION` §6 + تحديث `change-policy.json` |
| 8 | تفعيل `AWAITING_SANDBOX` + حدث سياسة + إضاءة عقدة `policy` | `B` | حالة تُصدر فعلاً قبل `sandbox_request` وتختفي بعده؛ فحص مستهلكي الـunion |
| 9 | تخزين دائم حقيقي (`steps/artifacts/ledger_events`) + استئناف من آخر حدث | `D` | إغلاق المتصفح وإعادة الفتح من جهاز آخر يستأنف المهمة |
| 10 | تصدير ZIP | `A` | أرشيف يحافظ على المسارات |
| 11 | حارس الحصة + إشعار الواجهة | `B` | اقتراب من الحد → `OfflinePlanner` + لافتة واضحة |
| 12 | تنظيف `NEXT_PUBLIC_SUPABASE_ANON_KEY` و`messages` غير المستخدمة | `E` | لا متغير بيئة ولا عملية Store بلا مستهلك |
| 13 | ✅ **تم في هذه الجلسة:** استخراج الحوكمة كقالب محمول + تطبيقه مقاساً على `agi-system` | `A` | 9/9 تكافؤ في القالب؛ 6 بوابات PASS في الهدف؛ التسليم نصاً في `tools/agi-system-handoff/` (§4.1) |

**قواعد صارمة لأي تنفيذ:** لا تعديل Route Handler قائم أو شكل استجابته · لا فروع مزودين في `Orchestrator`/`Planner` · لا تخفيف `VERIFIED` أو احتواء المسارات · `npm run verify` قبل الإعلان · التصنيف `[F BREAKING]` محظور افتراضياً · **لا fake يعيد نجاحاً غير مشروط** (§3).

---

## 7) ملحق الأرقام وإعادة القياس

- **4,163 سطراً** من TS/TSX/JS/MJS/CSS (خارج `node_modules`) في 47 ملفاً.
- أكبر الملفات: `page.tsx` 470 · `check-architecture.mjs` 268 · `NetworkGraph.tsx` 223 · `check-change-policy.mjs` 209 · `planner.ts` 206 · `agent-runtime.ts` 187 · `store/src/index.ts` 181.
- **11 ملف اختبارات / 53 اختباراً** — وحدات وعقود فقط؛ **صفر** متصفح وصفر شبكة حية على `main`.
- 6 workspaces يفحصها حارس المعمارية؛ 5 مسارات API ديناميكية + صفحة static واحدة.
- حزم الإنتاج في `apps/web`: `next@^15.1.6`, `react@^19`, `three@^0.169`؛ التطوير: `typescript@^5.6.3`, `vitest@^2.1.9`, `tailwindcss@^3.4.17`. **لا SDK خارجياً** لمزود أو قاعدة بيانات (PostgREST/SSE يدويان) — مقصود للبقاء ضمن الحدود المجانية.
- تاريخ مرئي: 26 commit بعد جلب رؤوس الـPRs؛ `main` عند `1d046e9`؛ PR #1 مدموج (P1/P2 providers)؛ PR #2 مسودة (E2E).
- **30 ملفاً متغيراً مقابل `origin/main`، 0 محمي، 0 ثنائي** (مقاس بالحارس نفسه).
- قالب الحوكمة: 4 حراس + مشغّلا بوابة + 3 قوالب (STATUS/change-policy/CI) + 9 اختبارات تكافؤ تُشغَّل **خارج** vitest الجذر عمداً (`run-tests.mjs`) كي يبقى القالب خاملاً وبوابة المستودع 53/53.

### إعادة القياس
```bash
npm ci --no-fund --no-audit
npm run check:architecture && npm run check:changes && npm run check:lockfile
npx tsc -p tsconfig.base.json --noEmit
npx vitest run --no-cache        # المتوقع: 53/53
npm run build                    # المتوقع: ✓ Compiled successfully
# أو باختصار:
npm run verify
```

### إعادة قياس الأدلة الجديدة في هذا التقرير
```bash
# P0 — سلوك Pyodide الحقيقي (خارج المستودع، بلا تلويث تبعياته)
mkdir -p /tmp/pyotest && cd /tmp/pyotest && npm init -y && npm i pyodide@0.26.4
#   ثم تشغيل كود OfflinePlanner النهائي حرفياً → ok:false / ModuleNotFoundError: math_tools
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 \
  https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js          # → 000 في بيئة القياس

# التاريخ (يتطلب جلب رؤوس الـPRs؛ المستودع shallow)
git fetch origin 'refs/pull/*/head:refs/remotes/pr/*'
git rev-parse --is-shallow-repository && git rev-list --all --count  # → true / 26
git log -S AWAITING_SANDBOX --all --reverse --format='%h %ad %s' --date=iso   # → 4ff4d65 ثم b0ff8c3
git log -S delete_file --all --reverse --format='%h %ad %s' --date=iso        # → 4ff4d65 ثم e638eb4
for sha in $(git rev-list --all); do git grep -l AWAITING_SANDBOX $sha; done | sed 's/^[0-9a-f]*://' | sort -u
#   → events.ts وpage.tsx فقط، ولا مرة orchestrator/agent-runtime/api
```
