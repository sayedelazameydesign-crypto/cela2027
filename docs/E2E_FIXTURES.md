# سياسة Fixtures في E2E — السمات (attributes) والبايتات (bytes)

> الـfixture دليل. الدليل الذي تتغير بايتاته بصمت ليس دليلًا.

## 1. أين تعيش

```text
e2e/fixtures/
├── SHA256SUMS                  # بصمة كل ملف (ما عدا نفسه) — يُولَّد ولا يُحرَّر يدويًا
└── events/
    ├── offline-task.ndjson     # أحداث مهمة كاملة كما بثّها التطبيق الحقيقي
    └── offline-task.meta.json  # كيف سُجِّل: الالتزام، الهدف، منفّذ الصندوق، العدادات
```

كل fixture له ملف `*.meta.json` مجاور يجيب عن: من أين جاء، متى، بأي commit من التطبيق، وبأي دور تم لعب «الصندوق».

## 2. السمات في `.gitattributes`

```gitattributes
e2e/fixtures/**            -text diff
e2e/fixtures/**/*.bin      binary
e2e/fixtures/**/*.png      binary
e2e/fixtures/SHA256SUMS    -text diff -merge
```

- `-text`: لا تحويل لنهايات الأسطر في أي اتجاه على أي نظام تشغيل. ما في الشجرة هو ما في الـblob حرفيًا.
- `diff` يبقى مفعّلًا للـfixtures النصية كي تُراجع التغييرات في الـPR بدل أن تختفي كـ«binary».
- `-merge` على المانيفست: أي تعارض يُحل بإعادة التوليد لا بالدمج اليدوي.
- لا `eol=` للـfixtures: `eol` لا معنى له مع `-text`، والتحقق من LF يتم بالبايتات لا بالسمات.

طريقة التحقق اليدوية:

```bash
git check-attr text eol diff merge -- e2e/fixtures/events/offline-task.ndjson
# المتوقع: text: unset  |  diff: set
```

## 3. عقد البايتات

يُطبَّق على كل ملف تحت `e2e/fixtures/` ماعدا `SHA256SUMS`:

| الفحص | الوسيلة | لماذا |
|---|---|---|
| السمة `text` غير مفعّلة | `git check-attr text` == `unset` | يمنع أي normalisation مستقبلي |
| بايتات الشجرة == blob الفهرس | `git hash-object --no-filters` == `git ls-files -s` | يثبت أن Git لم يمرّر الملف عبر أي filter |
| البصمة == المانيفست | SHA-256 مقابل `SHA256SUMS` | يكشف أي تعديل صامت أو نسخ خاطئ |
| لا BOM | أول 3 بايتات ≠ `EF BB BF` | BOM يكسر NDJSON ويخفي فرقًا غير مرئي |
| UTF-8 صالح | فك ترميز صارم | fixture غير قابل للقراءة ليس دليلًا |
| لا `CR` في الملفات النصية | مسح بايت `0x0D` | LF فقط؛ CRLF يعني أن نظامًا ما عبث بالملف |
| ينتهي بـ LF واحد | آخر بايت `0x0A` | سطر NDJSON الأخير يجب أن يكون كاملًا |
| كل سطر JSON صالح (`.ndjson`) | `JSON.parse` لكل سطر | fixture الأحداث يُستهلك سطرًا سطرًا |
| `seq` تصاعدي صارم (`.ndjson` للأحداث) | مقارنة متتالية | يطابق عقد `GET /api/task/:id/events?after=SEQ` |

السكربت: `node e2e/scripts/check-fixtures.mjs` — يفشل بأي انتهاك ويطبع الملف والفحص. يعمل داخل checkout فعلي لأن نصف الفحوصات تسأل Git نفسه.

## 4. كيف يُضاف fixture جديد

```bash
# 1) سجّل من التطبيق الحقيقي (لا تكتبه يدويًا)
node e2e/scripts/record-fixture.mjs --name my-case --goal "…" --out e2e/fixtures/events

# 2) أعد توليد المانيفست
node e2e/scripts/check-fixtures.mjs --write-manifest

# 3) تحقق
node e2e/scripts/check-fixtures.mjs
git check-attr text -- e2e/fixtures/events/my-case.ndjson   # unset
```

قواعد:

- الـfixture النصي يُسجَّل من تشغيل فعلي؛ التعديل اليدوي ممنوع (عدّل المسجِّل ثم أعد التسجيل).
- الملفات الثنائية تُضاف فقط بامتداد مدرج في `.gitattributes` كـ`binary`، وتُذكر في `*.meta.json` بسبب وجودها.
- عند دمج سياسة التغيير (`.github/change-policy.json` في PR #1) يجب إدراج أي fixture ثنائي في `allowedBinaryChanges` في التغيير نفسه؛ الـfixtures النصية لا تحتاج ذلك.
- تغيير fixture قائم = تغيير في الدليل: يوثَّق السبب في الـcommit وفي `*.meta.json`.

## 5. صيغة fixture الأحداث

سطر لكل حدث بالشكل الذي يعيده endpoint الاستئناف تمامًا:

```json
{"seq":0,"e":{"type":"task_started","taskId":"…","goal":"…"}}
```

- `seq`: من المخزن المؤقت للخادم (قد تكون به فجوات عند إعادة بث `artifact` لنفس المسار — هذا سلوك التطبيق الحقيقي ويُحفظ كما هو).
- `e`: `AgentEvent` كما عرّفته `@cela/core` بلا إعادة تشكيل.
- التسجيل **تدريجي** عبر `?after=<آخر seq>`؛ لذلك يحتوي الملف على الخط الزمني الحي كما رآه عميل مباشر، لا لقطة نهائية.
- **المنضمّون المتأخرون** (إعادة بث SSE لمهمة منتهية، أو `events?after=-1` بعد الانتهاء) يرون المخزن بعد حذف النسخ القديمة من `artifact` لكل مسار (15 حدثًا بدل 18 في `offline-task` مع فجوات في `seq`). اختبار `tests/integration/api-contract.spec.ts` يثبت هذا العقد؛ الـmock يعيد الخط الزمني الحي لأن الواجهة تفتح البث فور `POST`.
