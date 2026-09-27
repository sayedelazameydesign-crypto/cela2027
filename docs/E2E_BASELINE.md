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
| الملف | `e2e/fixtures/events/offline-task.ndjson` |
| الحالة | **يُسجَّل في المرحلة 2** — تُملأ القيم من `offline-task.meta.json` بعد التسجيل |

## 6. معايرة retry

| المفتاح | القيمة |
|---|---|
| الحالة | **غير مُقاس بعد** — المرحلة 4 تكتب `e2e/retry-calibration.json` وتُلخَّص النتائج هنا |

## 7. سجل تشغيل CI

| التاريخ | Job | النتيجة | الرابط |
|---|---|---|---|
| — | — | لا تشغيل بعد | — |

## 8. البيئة التي أُنشئ فيها الفرع

- Node `v22.22.3`، npm `10.9.8`، Git `2.39.5`، Debian 12.
- الشبكة المتاحة: `registry.npmjs.org`، `github.com`. غير المتاح: `mcr.microsoft.com`، CDNs المتصفحات (`cdn.playwright.dev`)، `cdn.jsdelivr.net` (Pyodide).
- نتيجة ذلك: اختبارات المتصفح تُشغَّل محليًا بمتصفح Chromium بديل من نفس الإصدار الرئيسي عند توفره (`E2E_CHROMIUM_EXECUTABLE`)، والمرجع النهائي هو التشغيل داخل الحاوية المثبتة في CI.
