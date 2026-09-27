# خطة E2E — مسار مستقل للتحقق بالمتصفح والتكامل

> القاعدة نفسها التي تحكم النواة تحكم هذا المسار: **لا ادعاءات بدون أدلة.**
> لا تُوصف مرحلة بأنها منجزة إلا إذا وُجد لها أثر قابل لإعادة التشغيل (سكربت/اختبار/سجل CI) ونتيجة مسجَّلة في `docs/E2E_BASELINE.md`.

## 1. لماذا مسار مستقل؟

- حتى تاريخ خط الأساس لا يوجد أي اختبار متصفح في المستودع؛ بناء Next واختبارات Route Handlers لا يثبتان رحلة المستخدم ولا Pyodide worker.
- عمل E2E يجب ألا يعتمد على PR مفتوح ولا يعرقله. لذلك يُقطع من `origin/main` مباشرة ويُثبَّت على `E2E_BASE_SHA`، ويعيش تحت `e2e/` بحزمة وقفل تبعيات مستقلين وworkflow منفصل.
- قواعد الاستقلال (ملزِمة لهذا الفرع):
  - لا تعديل على كود التشغيل: `packages/*/src/**`، Route Handlers، `apps/web/lib/agent-runtime.ts`، `apps/web/app/page.tsx`.
  - لا تعديل على الملفات التي يلمسها الـPR المفتوح (`package.json` الجذري، `vitest.config.ts`، `.github/workflows/ci.yml`، `README.md`، `docs/ARCHITECTURE.md`، `docs/ROADMAP.md`، `tsconfig.base.json`).
  - `e2e/` ليست workspace ضمن `package.json` الجذري؛ لها `package.json` و`package-lock.json` خاصان.
  - أي سلوك يُكتشف في الواجهة يُسجَّل كـ **characterization** (توصيف) ولا يُصلَح هنا؛ الإصلاح مكانه فرع UI-U0 (انظر §4).

## 2. المراحل

| # | المرحلة | المخرجات | معيار الإنجاز (الدليل) |
|---|---|---|---|
| 0 | Bootstrap | `.gitattributes` + هذه الوثيقة + `E2E_FIXTURES.md` + `E2E_BASELINE.md` | commit واحد؛ `git status` نظيف؛ `git add --renormalize .` لا يغيّر شيئًا |
| 1 | تثبيت الحاوية | `e2e/baseline.json` يحمل tag + digest لصورة Playwright؛ `check-container.mjs` | نسخة `@playwright/test` == نسخة tag الحاوية؛ الـworkflow يستخدم `image@sha256:` المطابق؛ سحب الصورة في CI ينجح بالـdigest |
| 2 | أول fixture | `e2e/fixtures/events/offline-task.ndjson` مسجَّل من التطبيق الحقيقي + `SHA256SUMS` + `check-fixtures.mjs` | `git check-attr` يعيد `text: unset`؛ blob في الفهرس == بايتات الشجرة == SHA256SUMS؛ كل سطر JSON صالح وينتهي بـLF |
| 3 | Proxy مُدار بالأوامر | `e2e/proxy/fault-proxy.mjs` + اختبارات `node:test` | تمرير JSON وSSE دون تخزين مؤقت؛ `fail-next`/`delay`/`drop`/`route`/`reset` تعمل كما هو موثق؛ سجل الطلبات يثبت أن العطل حدث فعلًا |
| 4 | معايرة retry | `e2e/scripts/calibrate-retry.mjs` → `e2e/retry-calibration.json` | أرقام مقاسة (عينات + p50/p95/max) هي مصدر مهل Playwright وعتبات التأخير؛ لا أرقام مخمَّنة |
| 5 | browser-e2e-mocked-app-api | `e2e/mock-api/server.mjs` + `e2e/tests/mocked-app-api/*.spec.ts` | المتصفح الحقيقي + صفحة Next الحقيقية + API محاكى من الـfixture عبر الـproxy؛ يمر في حاوية CI المثبتة |
| 6 | application integration | `e2e/tests/integration/*.spec.ts` + job مستقل في CI | API الحقيقي بلا محاكاة؛ رحلة كاملة حتى `VERIFIED`؛ نتيجة الـjob مستقلة عن job المحاكاة |

ترتيب التنفيذ إلزامي: كل مرحلة تبني على أدوات المرحلة السابقة (الـfixture يغذي المحاكاة، والـproxy يغذي المعايرة والتكامل).

## 3. الهندسة

```text
Playwright (chromium)  ──►  fault-proxy :3100  ──►  Next app (next start) :3000
                                │                      ├─ /            الصفحة الحقيقية
                                │                      ├─ /_next/*     الأصول الحقيقية
                                │                      └─ /api/*       API الحقيقي   ← integration
                                └── قاعدة route (بأمر) ──►  mock-api :3200
                                                           ├─ /api/*            من الـfixture ← mocked-app-api
                                                           └─ /pyodide-worker.js  worker حتمي (المحاكاة فقط)
```

- **نقطة تركيب واحدة:** المتصفح يخاطب الـproxy فقط. تغيير المرحلة = أمر توجيه للـproxy، لا تغيير في التطبيق ولا في الاختبار.
- **الأوامر** تُرسل عبر `POST /__proxy/commands` و`POST /__mock/commands`، وتُقرأ الحالة والسجل عبر `GET /__proxy/state` و`GET /__mock/state`. الاختبار يثبت أن العطل/التوجيه حدث بالرجوع إلى السجل، لا بالافتراض.
- **تنفيذ متسلسل** (`workers: 1`): الـproxy والـmock حالة مشتركة واحدة؛ الحتمية أهم من السرعة في هذه المرحلة.
- **الصندوق:** الخادم لا ينفّذ كود المستخدم أبدًا. في المحاكاة يُقدَّم worker حتمي يعيد الناتج المسجَّل في الـfixture. في التكامل يعمل Pyodide الحقيقي من CDN؛ إذا كان CDN غير متاح يُعلَن ذلك صراحة بـ`test.skip` بسبب موثق بدل فشل غامض أو نجاح زائف.

## 4. علاقة المسار بفرع UI-U0

- هذا الفرع **يوصّف** سلوك الواجهة الحالي. هذه الاختبارات هي خط الأساس الذي سيقيس تغييرات الواجهة لاحقًا؛ عندما يغيّر UI-U0 سلوكًا منها يجب تعديل الاختبار عمدًا (وسيفشل حتى يحدث ذلك).
- التوصيفات المسجَّلة فعلًا في `e2e/tests/mocked-app-api/` (كلها مثبتة بسجل الـproxy/الـmock لا بالافتراض):
  - `POST /api/task` → 503 مرة ⇒ شارة «فشل»، لا إعادة محاولة تلقائية داخل نافذة جدول retry المُعايَر، ونص الخطأ لا يُعرض في أي مكان؛ الضغط مجددًا ينجح.
  - `GET /stream` → 503 ⇒ الواجهة تغلق `EventSource` وتُظهر «اكتملت المهمة — ابدأ هدفًا جديدًا» بينما الشارة باقية على «جارٍ التخطيط»؛ لا اتصال ثانٍ ولا `events?after=`، والمهمة تكتمل على الخادم دون أن يراها المستخدم.
  - قطع اتصال SSE **مرة واحدة** لا يصل إلى الواجهة أصلًا: Chromium يعيد الطلب تلقائيًا (طلبان في سجل الـproxy) وتكتمل المهمة. القطع المستمر ⇒ نفس التوقف الصامت.
  - `POST /api/task` بطيء (تأخير تحت عتبة المعايرة) ⇒ ينتظر بلا مهلة من جهة الواجهة ويكتمل؛ أثناء الانتظار يبقى الإدخال ظاهرًا مع تعطيل الزر.
  - `POST /sandbox` → 500 ⇒ مخرجات العامل تُعرض لكن النتيجة لا تُعاد، وتبقى المهمة «قيد التنفيذ» حتى مهلة الخادم.
  - **بدون WebGL** (مثل عدّاءات بلا GPU أو متصفحات مقيّدة) ⇒ `THREE.WebGLRenderer` يرمي خطأً غير مُلتقط داخل `useEffect` فتُفكَّك شجرة React كاملة وتصبح الصفحة فارغة. اختبار `render-without-webgl.spec.ts` يعيد إنتاجه حتميًا بإرجاع `null` من `canvas.getContext("webgl*")`.
- توصيف من مرحلة التكامل (`e2e/tests/integration/browser-offline-task.spec.ts`، اكتُشف في أول تشغيل داخل الحاوية المثبتة): **الرحلة الحقيقية في المتصفح تنتهي `FAILED`**. خطوة `python_run` تستورد ملفات الخطوة الأولى (`sys.path.insert(0, 'celia_app')`) لكن `SandboxBridge.requestRun()` يرسل `{runId, code}` فقط؛ مساحة العمل لا تصل إلى عامل Pyodide أبدًا، فيرمي `ModuleNotFoundError: No module named 'math_tools'` ويسجّل الخادم الخطوة `FAILED` والمهمة `FAILED`. الـfixture المسجَّل يُظهر `VERIFIED` لأن المسجِّل أنشأ الملفات على القرص قبل تشغيل الكود بـCPython. الاختبار الأول يثبّت السلوك الحالي بالأدلة (واجهة + أحداث الخادم + سجل الـproxy)، والثاني يُبقي الرحلة المقصودة ظاهرة كـ`test.fail()` حتى يُصلَح التطبيق (نجاحه غير المتوقع يُفشل التشغيل عمدًا).
- فرع `UI-U0` يُنشأ لاحقًا من `origin/main` وقتها، ويُثبَّت له `UI_U0_BASE_SHA` **عند إنشائه فقط** (لا يُخمَّن الآن). حقل `UI_U0_BASE_SHA` في `e2e/baseline.json` يبقى `null` حتى ذلك الحين، و`check-baseline.mjs` يرفض أي قيمة ليست `null` أو SHA سلفًا لـHEAD.

## 5. أوامر التشغيل

```bash
# تثبيت (مستقل عن الجذر)
npm ci --prefix e2e

# حراس E2E (بدون متصفح)
npm run check --prefix e2e          # baseline + fixtures + container
npm run test:proxy --prefix e2e     # اختبارات الـproxy بـ node:test

# بناء التطبيق ثم E2E (يشغّل next start + proxy + mock تلقائيًا)
npm install && (cd apps/web && npx next build)
npm run test:mocked --prefix e2e
npm run test:integration --prefix e2e
```

في CI تعمل المرحلتان 5 و6 كـjobين مستقلين داخل حاوية Playwright المثبتة بالـdigest (`.github/workflows/e2e.yml`).

## 6. ما لا تعنيه هذه الخطة

- لا تعني تفعيل أي مزود نماذج أو خدمة خارجية؛ كل شيء يعمل بوضع المحاكاة المحلية (`OfflinePlanner`).
- لا تعني تغيير عقد API أو شكل الأحداث؛ الـmock يطبّق العقد الحالي حرفيًا، وأي انحراف يُكتشف في مرحلة التكامل.
- لا تعني أن `E2E ✅` تُضاف إلى تعريف الإنجاز قبل أن يمر job المتصفح فعليًا في CI ويُسجَّل رابطه في `docs/E2E_BASELINE.md`.
