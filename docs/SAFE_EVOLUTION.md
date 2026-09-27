# سياسة التطوير الآمن — Freeze → Extend → Verify

هذه الوثيقة هي بوابة التغيير في `cela2027`. الغرض منها تطوير النظام تدريجيًا من دون إعادة كتابة النواة أو كسر المستهلكين الحاليين.

> القاعدة: نثبّت السلوك القائم باختبار، نضيف القدرة خلف عقد أو Adapter، ثم نشغّل بوابة التوافق كاملة.

## 1. خط الأساس المثبت

تاريخ القياس: **2026-09-27**.

### قبل إضافة الحواجز

| البوابة | النتيجة | الملاحظة |
|---|---:|---|
| `npm install` | ✅ | لم يكن هناك lockfile مثبت في المستودع |
| `npm run build` | ✅ | بناء Next.js الإنتاجي ناجح |
| `npm test -- --no-cache` | ✅ | 21/21 اختبارًا |
| `npm run typecheck` | ❌ | إعداد الجذر لم يكن يعرف alias الواجهة `@/*` |
| API contracts | ⚠️ | لا توجد اختبارات مباشرة لعقود Route Handlers |
| Browser E2E | ⚠️ | غير موجود حاليًا |
| OpenRouter/Supabase live integration | ⚠️ | غير مشغّل دون خدمات خارجية وأسرار |

فشل `typecheck` كان في بوابة الأدوات فقط؛ بناء Next.js كان ناجحًا. عولج بإضافة alias الموجود أصلًا في إعداد تطبيق الويب إلى إعداد TypeScript الجذري، من دون تغيير كود التشغيل.

### البوابة الحالية

الأمر الوحيد المطلوب محليًا وفي CI:

```bash
npm ci
npm run verify
```

وينفّذ `verify` بالتتابع:

```text
Architecture dependency + alias boundaries
  → changed-files / protected-path / binary policy
  → package-lock reproducibility
  → TypeScript strict check
  → regression + characterization contracts
  → production build
```

الحالة الحالية بعد Tracks 1+2+4 وSub-Tracks 3.1–3.3: **85/85 اختبارًا محليًا** ناجحًا. اختبارات Gemini تستخدم HTTP mock ولا يوجد اختبار مزود حي في هذه المرحلة؛ حارس lockfile يستخدم `npm ci --dry-run`، بينما CI ينفذ `npm ci` فعليًا قبل البوابة.

لا تعني هذه البوابة وجود Browser E2E أو اتصال حي بالخدمات الخارجية. لا يجوز وصف هاتين البوابتين بالنجاح قبل إضافتهما فعليًا.

## 2. خريطة الحدود الحالية

```text
apps/web
  ├─ @cela/core       تشغيل الوكيل واستهلاك الأحداث
  ├─ @cela/store      Adapter التخزين الدائم
  └─ @cela/sandbox    التحقق من طلبات الصندوق

@cela/core
  ├─ @cela/llm        Adapter المزودات (ProviderFabric: OpenRouter → Gemini) المستخدم من Planner
  └─ @cela/tools      سجل عقود الأدوات

leaf packages (لا تعتمد على Core أو Web)
  ├─ @cela/llm
  ├─ @cela/store
  ├─ @cela/sandbox
  └─ @cela/tools
```

القاعدة الاتجاهية:

- لا تستورد أي حزمة تحت `packages/` شيئًا من `apps/web`.
- لا يدخل Provider أو SDK جديد مباشرة في `Orchestrator`.
- الواجهة لا تصل إلى أسرار المزودين؛ التكاملات السرية تبقى في السيرفر.
- التحقق والسياسة واحتواء المسارات تبقى مسؤولية النواة، لا مكونات UI.

### اتساق aliases

`apps/web/tsconfig.json` لا يعمل له `extends` من `tsconfig.base.json`؛ لذلك Next.js يقرأ تعريفاته الخاصة، بينما بوابة TypeScript الجذرية تقرأ تعريفات الـbase. نجاح `next build` يختبر imports فعلية مثل `@/lib/agent-runtime` و`@/components/NetworkGraph`، ويقارن حارس المعمارية الآن كل alias يعرّفه تطبيق الويب مع الهدف canonical المقابل في إعداد الجذر. أي غياب أو اختلاف بين الهدفين يفشل CI.

## 3. العقود المجمدة افتراضيًا

هذه العقود تعتبر مستقرة. تغييرها الكاسر يحتاج قرارًا صريحًا ونسخة انتقالية، وليس refactor عاديًا.

### Core

- `Planner.plan(goal, context?)`
- `SandboxBridge.requestRun(taskId, code)`
- `Store` وعملياته الست الحالية
- `AgentEvent` وأسماء الأحداث والحقول المطلوبة الحالية
- حالات `TaskStatus` و`StepStatus` الحالية
- صادرات `@cela/core` العامة المستخدمة في الاختبارات
- Fail-closed allowlist واحتواء `Workspace`
- شرط أن `VERIFIED` لا تصدر من دون أدلة تحقق مستقلة

إضافة حقل **اختياري** ممكنة. حذف حقل، إعادة تسميته، أو تغيير معناه ممنوع افتراضيًا. إضافة event جديد تحتاج فحص مستهلكي الـunion لأن المستهلك exhaustive قد يعتبرها تغييرًا كاسرًا.

### HTTP API

| العقد الحالي | السلوك المثبت |
|---|---|
| `POST /api/task` | يقبل `{ goal }` ويرفض الفارغ أو أكثر من 4000 حرف |
| `GET /api/task/:id/stream` | Replay ثم أحداث SSE حية |
| `GET /api/task/:id/events?after=SEQ` | يعيد `{ taskId, events, done }` والأحداث ذات `seq > after` |
| `GET /api/task/:id/files` | يعيد `{ taskId, files }` |
| `POST /api/task/:id/sandbox` | لا يقبل `runId` لا يبدأ بمعرّف المهمة |

أي شكل استجابة جديد يضاف إلى endpoint جديد أو كحقل اختياري. لا يتغير status code أو معنى حقل قائم بلا اختبار انتقال وتوثيق.

### البيانات

- `TaskRecord` و`MessageRecord` هما عقدا التطبيق مع التخزين.
- Backend جديد يطبّق `Store` بدل أن يتسرّب إلى Core أو Route Handlers.
- تغييرات قاعدة البيانات Additive أولًا: أعمدة nullable/default، ثم backfill، ثم قراءة مزدوجة عند الحاجة.
- الحذف وإعادة التسمية لا يحدثان في migration واحدة.

## 4. Frozen مقابل Extendable

### Frozen افتراضيًا

- ملفات التشغيل تحت `packages/*/src/`، وبالأخص `core/orchestrator` والعقود العامة.
- Route Handlers الحالية وأشكال/status codes استجاباتها.
- `apps/web/lib/agent-runtime.ts` وتتابع الأحداث الحالي.
- دلالات `VERIFIED`، وسياسة fail-closed، واحتواء المسارات.

### Extendable افتراضيًا

- Adapters جديدة تطبق العقود القائمة.
- اختبارات characterization/regression والعقد.
- وثائق المعمارية وCI والحراس.
- صفحات ومكونات UI لا تنقل منطق Core إلى React.
- Endpoints إضافية بعقد مستقل واختبارات مستقلة.

| الجزء | القرار الافتراضي | طريقة التوسعة الآمنة |
|---|---|---|
| `core/orchestrator` | **Freeze + Extend** | خيارات اختيارية (`maxRetriesPerStep`) أو Interfaces محقونة؛ لا شروط خاصة بالمزود |
| `core/planner` | **Extend** | Planner جديد يطبّق `Planner` أو Adapter مزود جديد؛ `replanStep` اختياري |
| `core/policy` | **Freeze + Extend** | قواعد إضافية محافظة مع اختبارات allow/deny |
| `core/tools-impl` | **Extend** | Tool contract + Policy + implementation + verifier معًا |
| `core/verifier` | **Freeze** | Verifier جديد أو check إضافي؛ لا تخفيف الأدلة القائمة |
| `core/workspace` | **Freeze** | لا تخفيف احتواء المسار أو الحصص |
| `llm` | **Adapter** | Provider implementation خلف عقد؛ لا Provider branches في Orchestrator |
| `sandbox` | **Adapter** | Bridge/Backend جديد بنفس النتيجة؛ لا تنفيذ غير موثوق في web server |
| `store` | **Adapter + Migration** | تطبيق `Store` وmigrations تراكمية قابلة للرجوع |
| `apps/web/api` | **Version/Extend** | endpoint جديد أو حقول اختيارية فقط |
| `apps/web/UI` | **Extend** | مكونات جديدة تستهلك العقود الحالية؛ لا منطق Core في React |

## 5. اختبار التوافق والحراس الحالية

الاختبارات المضافة لا تستبدل الاختبارات القديمة؛ بل تحيط بها.

### حارس الاعتماديات

التحليل يستخدم TypeScript AST ويغطي:

- `import` و`import type`؛ كلاهما اعتماد معماري لأن العقد النوعي coupling حقيقي.
- `export ... from` و`export type ... from`؛ re-export داخل نفس workspace مسموح، والعبور يخضع لنفس allowlist.
- `import("literal")` و`require("literal")`.
- `type T = import("...").T` و`import x = require("...")`.
- aliases المعرفة في `paths` بعد حلها إلى filesystem targets.
- dynamic import/require المحسوب يفشل fail-closed بدل المرور من دون تحليل.

كما يفشل الحارس عند استخدام workspace dependency غير معلنة في `package.json`، أو غير مسموحة في خريطة الاتجاه، أو عند عبور workspace باستيراد نسبي.

### حارس التغيير

`check:changes` يقارن التغيير مع `origin/main` محليًا أو فرع أساس الـPR في CI، ويتحقق من:

- `git diff --check` وعدم وجود whitespace errors.
- عدم تعديل مسارات التشغيل المحمية دون تصريح مطابق في `.github/change-policy.json`.
- رفض الملفات الثنائية افتراضيًا؛ السماح يتطلب إدراج المسارات صراحة في ملف السياسة المتغير في نفس التغيير.
- تصنيف التغيير `A/B/C/D/E/F` وسبب موثق؛ التصنيف `F` يحتاج إقرارًا صريحًا إضافيًا.

المسارات المحمية حاليًا: `packages/*/src/**`، وRoute Handlers، و`apps/web/lib/agent-runtime.ts`. ملفات characterization المجاورة ليست محمية كي نستطيع تثبيت السلوك قبل لمس التنفيذ.

### عقود مثبتة

- ثبات صادرات `@cela/core` ونقاط الحقن `Planner` و`SandboxBridge`.
- تطابق `TOOL_MANIFEST` مع سياسة الأدوات والتنفيذ المحلي.
- عقد `MemoryStore`: الإنشاء/القراءة/التحديث/الترتيب وعزل النسخ.
- عقد Sandbox: المهلة وحدود الإدخال الحالية.
- أغلفة API ورسائل/status codes للتحقق، polling، الملفات، وربط `runId` بالمهمة.

عند إضافة Backend جديد للتخزين يجب تشغيل نفس Store contract عليه. وعند إضافة Sandbox backend يجب إنشاء contract suite مشتركة بدل نسخ توقعات مختلفة.

## 6. تسلسل أي Feature جديدة

```text
1. وصف العقد القديم المتأثر
2. Characterization test للسلوك الموجود
3. Interface أو Adapter عند الحد المناسب
4. تنفيذ Additive خلف default آمن أو feature flag
5. اختبارات الوحدة والعقد والانحدار
6. npm run verify
7. rollout تدريجي مع إمكانية تعطيل القدرة الجديدة
8. مراقبة ثم إزالة flag فقط بعد الاستقرار
```

قالب مراجعة التغيير:

```text
التصنيف: [A ADD | B EXTEND | C ADAPTER | D MIGRATION | E REFACTOR]
العقود المتأثرة:
السلوك القديم المثبت باختبار:
Default عند غياب الإعداد الجديد:
خطة rollback:
نتيجة npm run verify:
```

التصنيف `[F BREAKING]` محظور افتراضيًا. إذا كان ضروريًا، يتطلب نسخة عقد جديدة وفترة توافق مزدوجة وخطة ترحيل معلنة.

### مثال: إضافة endpoint دون كسر الموجود

لإضافة `GET /api/task/:id/diagnostics`:

1. لا تعدّل أي route حالي أو شكل استجابته.
2. أضف `apps/web/app/api/task/[id]/diagnostics/route.ts` بعقد استجابة مستقل.
3. اجعل غياب البيانات يعيد default آمنًا موثقًا، لا يغيّر حالة المهمة.
4. أضف contract test للحالات الناجحة والفارغة والخاطئة.
5. حدّث `.github/change-policy.json` بتصنيف `A` وأدرج ملف route الجديد ضمن `protectedChanges` لأنه يقع تحت حد API محمي.
6. شغّل `npm run verify`. المستهلك القديم لا يعرف endpoint الجديد ويستمر بلا تغيير.

إذا احتاجت القدرة تغيير معنى استجابة قائمة، فلا تُعدّلها مباشرة؛ أضف endpoint/version جديدًا، شغّل النسختين خلال فترة الترحيل، ثم أزل القديمة فقط بقرار `[F]` معلن.

### Versioning للحزم الداخلية

الحزم حاليًا private وفي مرحلة `0.x`، لكن العقد العام يعامل وفق SemVer:

- **Patch:** إصلاح داخلي مع السلوك والعقد نفسيهما.
- **Minor:** export أو capability اختيارية جديدة متوافقة.
- **Breaking:** حذف/إعادة تسمية/تغيير معنى، أو إضافة عضو مطلوب إلى Interface ينفذه آخرون. خلال `0.x` يرفع minor مع فترة توافق؛ وبعد `1.0` يرفع major.

أي تغيير عقد يحدّث نسخة الحزمة المالكة، واختبارات العقد، وتبعيات المستهلكين والـlockfile في التغيير نفسه. استخدام `"*"` الحالي لا يُعد بديلًا عن versioning عند بدء نشر الحزم خارج الـmonorepo.

## 7. حلقة ReAct وتكامل المزودات (Tracks 1+2)

أضيفت القدرة عبر خيارات اختيارية وواجهات محقونة، من دون كسر أي عقد سابق:

### Core — `Planner.replanStep?(failedStep, error, context?)`

- **اختياري بالكامل:** أي `Planner` قديم (بما فيه `OfflinePlanner`) يستمر في العمل. غياب `replanStep` يعني صفر استدراك، وهو السلوك الافتراضي.
- **`OrchestratorOptions.maxRetriesPerStep`** قيمته الافتراضية `2` عند وجود `planner.replanStep`، و`0` للـ Planner القديم الذي لا يدعم التصحيح. يمكن تمرير `0` صراحةً لتعطيل الإعادة.
- عند التكرار يُسجَّل حدث `step_retrying` في الـ Ledger بترتيب `append` متسلسل، لذا لا تنكسر سلسلة `prev`/`hash`. الاختبار `react-orchestrator.test.ts` يتحقق من `Ledger.verify().valid === true` بعد إعادة واحدة وبعد استنفاد المحاولات.
- فشل `replanStep` نفسه لا يُسقط المهمة: تُحتفظ الخطوة الحالية وتُستهلك المحاولة.
- السياسة (PolicyEngine) تُقيَّم قبل كل محاولة، بما في ذلك الخطوات المصححة؛ لا تتجاوز أي خطوة مصححة البوابة. ونجاح التنفيذ لا يكفي إن كانت الأدلة المستقلة تُظهر فشلًا.

### LLM/Core — `ProviderFabric` داخل `FabricPlanner`

- `FabricPlanner` هو المسار الوحيد للمزودات داخل Core: لا شروط خاصة بمزود في `Orchestrator`، والترتيب يمرَّر صراحةً (`providerOrder`).
- الترتيب الافتراضي: `openrouter` ثم `gemini`، ويُبنى ديناميكيًا من `isOpenRouterConfigured()` و`isGeminiConfigured()`. عند غياب المفتاحين يبقى `OfflinePlanner` هو الافتراضي (وضع المحاكاة يعمل بلا مفاتيح).
- `FallbackPlanner` يُبقي السلوك التاريخي: فشل كل المزودات ⇒ هبوط إلى الخطة الحتمية مع سبب مفصح عنه في `summary`.
- `OpenRouterPlanner` بقي موجودًا ويُفوَّض إلى `FabricPlanner` بترتيب `["openrouter"]` فقط، حفاظًا على التوافق المصدري.
- لا يوجد اختبار مزود حي: الاختبارات تحاكي `ModelProvider` بالكامل (`vi.fn()`)، ولا شبكة حقيقية في CI.

### اختبارات مثبتة لهذه المرحلة

- `packages/llm/provider-fallback.test.ts` و`packages/core/fabric-planner.test.ts`: التحول التلقائي OpenRouter → Gemini مع توثيق `providerAttempts` ووصول الخطة إلى Core؛ وضع Offline عند غياب المفاتيح.
- `packages/core/react-orchestrator.test.ts`: الفشل ⇒ `replanStep` ⇒ النجاح، واستنفاد المحاولات ⇒ `FAILED`، وفحص السياسة والأدلة والملفات المزامنة، مع اتساق تجزئة الـ Ledger.

### Track 4 — ملفات ثنائية ومزامنة Pyodide FS

- `Workspace.writeBinary/readBinary` يخزنان `Uint8Array` بنسخ دفاعية؛ `snapshot()` و`all()` يحتفظان بعقد الملفات النصية، بينما `sandboxSnapshot()` يصدر ملفات ثنائية بصيغة `{ base64 }` بجانب النصوص. `totalBytes()` يقيس البايتات الفعلية.
- عند `python_run` تُرسل لقطة مساحة العمل عبر الوسيط الاختياري الثالث لـ `SandboxBridge.requestRun`، وحقل `files?` الاختياري في `sandbox_request`. يمررها Web UI إلى عامل Pyodide. لا يلزم تعديل جسور Sandbox القديمة.
- العامل ينشئ مجلدًا منفصلًا لكل تشغيل ويكتب محتويات الملفات عبر `py.FS.writeFile` ثم `py.FS.chdir` قبل التنفيذ؛ يرفض المسارات الخارجة ويمتنع عن التنفيذ إذا فشل التزامن. حد الملفات 1000 وحد الحمولة 5 MB، دون مزامنة عكسية من العامل إلى الخادم.
- اختبارات `workspace-binary.test.ts` و`pyodide-worker.test.ts` تغطي بايتات ثنائية، احتواء المسارات، وترتيب المزامنة مع التنفيذ. لا Browser E2E فعلي بعد.

## 8. Track 3 — حفظ سجل الأحداث عبر مثيلات الخادم

- `EventJournal` عقد إضافي مستقل عن واجهة `Store` ذات العمليات الست. `MemoryEventJournal` للاختبار، و`SupabaseEventJournal` يخزن `(task_id, seq, event)` بترتيب ثابت في جدول `task_events`، وSQL الإعداد في `packages/store/task-events.sql` (يُشغّل بعد إنشاء `tasks`). لا يُستخدم مفتاح الخدمة في المتصفح.
- قبل بدء المهمة يُنتظر `createTask`؛ فشل التخزين يرد بـ503 بدل إعادة taskId غير موجود. أحداث المهمة تُكتب بالتتابع؛ polling وSSE يقرآن من Journal عند توفره، و`/files` يُعيد آخر محتوى لكل مسار من تاريخ الأحداث. تستمر عقود أغلفة HTTP السابقة.
- `GET /stream` يستعيد الأحداث المخزنة أولًا ثم يستعلم كل ثانية عن الأحداث الجديدة، ما يسمح لمثيل مختلف بعرض نتيجة مثيل التنفيذ. اختبار `agent-runtime.test.ts` ينشئ مثيلَي Runtime يشتركان في مخزن وجريدة ويختبر `after` و`done` والملفات؛ واختبار REST يستخدم fetch mock لا Supabase حيًا.
- **حدود صريحة:** لا يجعل هذا تنفيذ `Orchestrator` أو انتظار `pendingSandbox` قابلين للاستئناف إذا مات مثيل التنفيذ؛ ستنتهي مهلة الطلبات المعلّقة. لا تُدعَى المهمة VERIFIED بسبب مجرد استمرار التاريخ. يلزم عامل خارجي دائم، طابور مهام وlease/fencing للانتقال إلى تنفيذ serverless موزع حقيقي. SSE طويل العمر ليس مضمونًا على جميع منصات serverless؛ استخدم polling للاستعادة.

### Sub-Tracks 3.1–3.2 — لقطات فحص قابلة للاستعادة

- `packages/core/src/checkpoint.ts` يحفظ `workspace` (نص + base64 للبايتات) وLedger كاملًا مع `lastLedgerHash`؛ الاستعادة ترفض السلسلة الناقصة أو المعدّلة والمسارات غير الآمنة، ولا تعيد حساب التجزئات على مواد معدّلة. `currentStepIndex` يصف عدد الخطوات التي انتهت فقط، ولا يعني أن التشغيل سيُستأنف منه.
- `packages/store/src/types.ts` يعرّف `SnapshotStore` مستقلًا عن Core، و`persistent_store.ts` يقدّم Memory/Supabase REST adapters؛ لا تعتمد الحزمة Store على Core أو SDK جديد. SQL الإضافي في `packages/store/src/schema.sql` يضيف `task_snapshots` **بعد** جدول `tasks` الموجود، ولا يعيد تسمية الجداول الحالية.
- الخادم يحفظ لقطة المهمة **بعد انتهاء التشغيل**، ويمكن لمثيل آخر تحميلها للفحص فقط (`loadCheckpoint`). لا تُحفَظ لقطة لكل خطوة، ولا تستعاد listeners أو sandbox resolvers أو الاستمرار التلقائي لـ Orchestrator. فشل حفظ اللقطة بعد إصدار الحالة النهائية لا يزوّر حالة المهمة؛ يسجَّل الخطأ على الخادم.
- لتفادي إغراق `jsonb`، يرفض محوّل Supabase JSON أكبر من 512 KB صراحةً. ملفات Binary الأكبر تحتاج adapter تخزين كائنات خارجية مع checksum وmanifest وchunking؛ لا يوجد Redis adapter أو `cela_blobs` مُفعّل، ولا يُدَّعى خلاف ذلك. اختبارات `checkpoint.test.ts` و`snapshot-contract.test.ts` و`checkpoint-runtime.test.ts` تتحقق من البايتات، وسلامة التجزئة، والتحويل بين مثيلين، وإخفاق المحول.

### Sub-Track 3.3 — استعادة بث SSE دون استئناف التنفيذ

- المسار الموجود `GET /api/task/:id/stream` يصدر الآن `id: <seq>` قبل `data:` لكل حدث، ويقرأ `Last-Event-ID` عند إعادة الاتصال؛ يمكن أيضًا تمرير `?after=<seq>` عند إنشاء اتصال جديد. ترويسة إعادة الاتصال لها الأولوية، وتُرفض القيم السالبة أو غير الصحيحة بـ400. الاتصال الأول دون cursor يبدأ من أول حدث (`seq=0`).
- `seq` مأخوذ من Journal أحداث المهمة `task_events`، **وليس** من `LedgerEntry.seq` أو معرف SQL عالمي. يُعرض فقط ما يأتي بعد cursor دون إعادة إرسال الحدث السابق. تختبر `stream-resume.test.ts` الاتصال الأول، والأولوية، وإعادة الاتصال من مثيل مختلف، وإغلاق المهمة، وتعذّر قراءة المخزن.
- `EventSource` في الواجهة يترك المتصفح يعيد الاتصال تلقائيًا بدل إغلاق المهمة عند خطأ SSE، ويمنع تشغيل `sandbox_request` ذي `runId` نفسه مرتين داخل الجلسة. ما زالت حالة `pendingSandbox` حصرية لمثيل التنفيذ الأصلي؛ استئناف عرض البث لا يستأنف Orchestrator بعد موته.

## 9. سجل المخاطر الحالي

هذه ملاحظات معمارية وليست مبررًا لإعادة البناء:

1. **تنفيذ Runtime وانتظار Sandbox لا يزالان داخل الذاكرة:** سجل المهمة يمكن قراءته عبر المثيلات عند تفعيل Supabase، لكن لا يوجد نقل لملكية تنفيذ المهمة عند موت مثيلها.
2. **SSE ليس ضمان نقل دائم:** polling endpoint متاح لاستعادة أحداث Journal من مثيل آخر؛ على منصات serverless يظل حد مدة الاتصال قائمًا.
3. **التخزين الخارجي اختياري:** إعداد جدول `task_events` ومفاتيح Supabase شرط للاستعادة بين المثيلات، ويلزم integration tests حقيقية قبل الاعتماد عليه تشغيليًا.
4. **لا Browser E2E حاليًا:** بناء Next واختبارات Route Handlers لا يثبتان Pyodide worker أو رحلة المستخدم كاملة.
5. **مسارات المزودات الحية (OpenRouter/Gemini) غير داخل CI:** الاختبارات الحالية تثبت الفصل والعقود وسلوك التحول بين المزودات عبر محاكاة، لا توافر مزود خارجي فعلي.
6. **لا version prefix للـAPI الحالي:** الميزات المتوافقة تضاف حاليًا، أما أي عقد غير متوافق مستقبلًا فيوضع تحت نسخة جديدة.

## 10. تعريف الإنجاز

لا تعتبر القدرة مكتملة لمجرد أن البناء نجح. الحد الأدنى:

```text
BUILD ✅
TYPECHECK ✅
OLD TESTS ✅
NEW CONTRACT TESTS ✅
API COMPATIBILITY ✅
SAFE DEFAULT ✅
ROLLBACK PATH ✅
```

وتضاف `E2E ✅` فقط بعد وجود وتشغيل اختبار متصفح فعلي، و`LIVE INTEGRATION ✅` فقط بعد تشغيل بيئة اختبار للخدمة الخارجية.
