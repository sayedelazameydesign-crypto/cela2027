# خط أساس E2E — الثوابت المثبتة والأدلة

هذه الوثيقة سجل حقائق، لا سجل نوايا. كل قيمة هنا إما مثبتة بأمر يمكن إعادة تشغيله أو موسومة صراحة بـ«غير مُقاس بعد».

## 1. الفرع وخط الأساس

| المفتاح | القيمة |
|---|---|
| `E2E_BASE_SHA` | `eff05290adc648aa09e4e51b53d48a7d32313882` |
| المرجع | `origin/main` وقت القطع (`feat: seq-tracked event buffer + polling resume endpoint`) |
| تاريخ التثبيت | 2026-09-27 |
| فرع العمل | `arena/01a0e34e-cela2027` |
| `UI_U0_BASE_SHA` | **غير مثبت** — يُثبَّت عند إنشاء فرع `UI-U0` نفسه، لا قبل ذلك |

التحقق:

```bash
git merge-base --is-ancestor eff05290adc648aa09e4e51b53d48a7d32313882 HEAD && echo ancestor-ok
node e2e/scripts/check-baseline.mjs
```

المصدر الآلي الوحيد لهذه القيم هو `e2e/baseline.json`؛ هذه الوثيقة يجب أن تطابقه ويفشل `check-baseline.mjs` إن اختلفا.

## 2. حالة المستودع عند خط الأساس (مقاسة على `E2E_BASE_SHA`)

| البوابة | النتيجة | الأمر |
|---|---|---|
| تثبيت التبعيات (بلا lockfile في الجذر) | ✅ 159 حزمة | `npm install --no-package-lock` |
| اختبارات النواة | ✅ 21/21 | `npx vitest run --no-cache` |
| بناء الإنتاج | ✅ (`/` ثابتة + 5 مسارات API ديناميكية) | `cd apps/web && npx next build` |
| نهايات أسطر CRLF في الملفات المتتبعة | 0 ملفات | `git ls-files -z \| xargs -0 grep -l $'\r'` |
| ملفات بـBOM | 0 ملفات | فحص أول 3 بايتات |
| `git add --renormalize .` بعد إضافة `.gitattributes` | لا تغييرات | — |
| اختبار متصفح | **لا يوجد** قبل هذا المسار | — |

## 3. قرار PR #1

- الحالة: **Ready for review** (رُفعت من Draft في 2026-09-27) — **لم يُدمج**؛ قرار الدمج للمالك.
- لذلك لا يتوفر على هذا الفرع `npm run verify` ولا `.github/change-policy.json`؛ حراس E2E مستقلة تحت `e2e/scripts/`.
- عند دمج PR #1 لاحقًا: الملفات هنا لا تتقاطع معه (انظر قواعد الاستقلال في `E2E_PLAN.md` §1).

## 4. حاوية Playwright

| المفتاح | القيمة |
|---|---|
| الصورة | `mcr.microsoft.com/playwright:v1.63.0-noble` |
| digest (OCI image index) | `sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27` |
| manifest `linux/amd64` | `sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7` |
| manifest `linux/arm64` | `sha256:a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717` |
| تاريخ إنشاء الصورة (MCR) | 2026-09-04T23:48:51Z |
| مصدر القيم | كتالوج MCR: `https://mcr.microsoft.com/api/v1/catalog/playwright/tags?reg=mar` (قُرئ 2026-09-27) |
| `@playwright/test` | `1.63.0` (مثبتة بلا `^`) — Chromium المتوقع `153.0.8010.12` |

حدود الدليل:

- بيئة إعداد هذا الفرع لا تملك Docker ولا وصولًا شبكيًا إلى `mcr.microsoft.com`؛ لذلك **لم تُسحب الصورة محليًا**. القيم أُخذت من كتالوج MCR عبر مسار شبكة بديل.
- التحقق الفعلي = نجاح سحب الصورة بالـdigest داخل job في CI (`container.image: …@sha256:…`)؛ إن كان الـdigest خاطئًا يفشل الـjob قبل أي خطوة. يُسجَّل رابط أول تشغيل ناجح في §7.
- `node e2e/scripts/check-container.mjs` يضمن محليًا وفي CI: نسخة الحزمة == نسخة الـtag، والـworkflow يستخدم الـdigest المثبت نفسه؛ ومع `--online` يقارن الـdigest مع `Docker-Content-Digest` من السجل.

## 5. Fixture الأول

| المفتاح | القيمة |
|---|---|
| الملف | `e2e/fixtures/events/offline-task.ndjson` (+ `offline-task.meta.json`) |
| المصدر | تسجيل حي من التطبيق الحقيقي (`next start`) بعد `POST /api/task` عبر `GET /api/task/:id/events?after=<seq>` تدريجيًا |
| الهدف | `ابنِ لي مشروع Python فيه أدوات رياضية مع اختبارات وشغّلها` (`OfflinePlanner`) |
| `taskId` | `21435480` |
| الأحداث | 18 حدثًا، `seq` 0..17 بلا فجوات (`artifact` ×6 لأن المسجِّل التقط بث الخطوة 1 قبل إعادة البث في الخطوة 2) |
| الحالة النهائية | `VERIFIED` — «كل الخطوات التنفيذية موثقة بالأدلة» |
| دور الصندوق | المسجِّل نفسه (CPython 3.11.2 على الملفات المُنتَجة) → `ALL TESTS PASSED`؛ الخادم قبِل النتيجة (`serverAccepted: true`) ولم ينفّذ أي كود |
| الملفات النهائية | 3 (`celia_app/math_tools.py` 326B، `test_math_tools.py` 216B، `README.md` 163B) — تطابق `artifact` events |
| البايتات | 6240 بايت، `sha256 8338b5d00481f08bdc9dae3431e95398f5cde4dfd0fbda4b47142f0458186387` |
| السمات (فعلي) | `git check-attr text` → `unset`؛ `diff` → `set`؛ blob الفهرس `6c88b080…` == `git hash-object --no-filters` |
| التحقق | `node e2e/scripts/check-fixtures.mjs` ✅؛ اختبار سلبي: حقن `CRLF` + سطر إضافي ⇒ فشل بثلاثة انتهاكات (blob، sha256، CR) ثم استُعيد الملف |

## 6. معايرة retry

المصدر: `node e2e/scripts/calibrate-retry.mjs --samples 15` على `next start` (بناء إنتاجي، `OfflinePlanner`) عبر الـproxy، 2026-09-27، Node v22.22.3، 2 vCPU. الملف الكامل: `e2e/retry-calibration.json`.

| القياس (ms) | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| تحميل الصفحة `/` عبر الـproxy | 15 | 3 | 15.4 | 15.4 |
| API مباشر / عبر الـproxy | 15 | 2.5 / 3.3 | 5.2 / 7.1 | 5.2 / 7.1 |
| عبء الـproxy (فرق لكل عينة) | 15 | 0.7 | 2.5 | 2.5 |
| `POST /api/task` | 15 | 4 | 8 | 8 |
| مهمة كاملة حتى `task_finished` (polling، إجابة صندوق فورية) | 15 | 40 | 71 | 71 |
| من `sandbox_request` المُجاب حتى النهاية | 15 | 29 | 29 | 29 |
| أول حدث SSE | 15 | 3 | 4 | 4 |
| الفجوة بين أحداث SSE المتتالية (بدون فجوة الصندوق) | 240 | 0 | 0 | 1 |
| إقلاع `next start` حتى أول 200 | 3 | 822 | 954 | 954 |

استرداد الأعطال عبر الـproxy (`POST /api/task`):

| العطل | الجدول | محاولات حتى النجاح | الزمن الكلي |
|---|---|---:|---:|
| `fail-next 1` (503) | `[250, 500, 1000]` | 2 | 258 ms |
| `drop 1` | `[250, 500, 1000]` | 2 | 258 ms |
| `fail-next 1` (503) | `[500, 1000, 2000]` | 2 | 507 ms |
| `drop 1` | `[500, 1000, 2000]` | 2 | 507 ms |

مسبار التأخير: `delay 1000` مع مهلة عميل 2000 ⇒ اكتمل (1008 ms)؛ `delay 4000` ⇒ انتهت المهلة (2002 ms). العتبتان مشتقتان ثم **مُختبرتان** في نفس التشغيل.

القيم المشتقة (كل قيمة مع معادلتها في الملف):

| القيمة | الناتج | الأساس |
|---|---:|---|
| `mockInterEventDelayMs` | 10 | أرضية 10 لأن الفجوة الحقيقية p50 = 0 |
| `pollIntervalMs` | 25 | `clamp(p50 gap, 25, 250)` |
| `apiRequestTimeoutMs` | 2000 | `ceil500(max(2000, 10 × p95 API))` |
| `proxyDelayBelow/AboveTimeoutMs` | 1000 / 4000 | نصف/ضعف مهلة الطلب — مُتحققان بالمسبار |
| `retrySchedule` | `[250, 500, 1000]` | `base = ceil50(max(250, 2 × p95 create))`؛ يسترد في محاولتين |
| `expectTimeoutMs` | 5000 | `max(5000, 3 × (18 حدثًا × 10 + p95 صفحة))` |
| `taskCompletionTimeoutMs` | 75000 | ثابت التطبيق (انتظار الصندوق في `agent-runtime.ts` = 60000، يُقرأ من المصدر) + 15000 |
| `testTimeoutMs` | 95000 | `taskCompletion + expect + 15000` |
| `webServerTimeoutMs` | 30000 | `ceil5000(max(30000, 10 × max(serverStart)))` |
| `playwrightRetries` | محلي 0 / CI 1 | ابتدائي؛ يُراجَع من تشغيلات `repeat_each` في §7 |

**غير مُقاس هنا:** زمن تحميل Pyodide من CDN داخل المتصفح (الشبكة محجوبة في بيئة الإعداد) — لذلك مهلة التكامل مبنية على ثابت التطبيق لا على تخمين، وتُراجَع بعد أول تشغيل في CI.

## 7. سجل تشغيل CI

| التاريخ | Job | النتيجة | الرابط |
|---|---|---|---|
| — | — | لا تشغيل بعد | — |

## 8. البيئة التي أُنشئ فيها الفرع

- Node `v22.22.3`، npm `10.9.8`، Git `2.39.5`، Debian 12.
- الشبكة المتاحة: `registry.npmjs.org`، `github.com`. غير المتاح: `mcr.microsoft.com`، CDNs المتصفحات (`cdn.playwright.dev`)، `cdn.jsdelivr.net` (Pyodide).
- نتيجة ذلك: اختبارات المتصفح تُشغَّل محليًا بمتصفح Chromium بديل من نفس الإصدار الرئيسي عند توفره (`E2E_CHROMIUM_EXECUTABLE`)، والمرجع النهائي هو التشغيل داخل الحاوية المثبتة في CI.
