# governance-template — نظام الحوكمة المستخرج من cela2027

> منهج + حراس قابلون للنقل إلى أي مستودع. مستخرج من `cela2027` (MIT © 2026 sayedelazameydesign-crypto) ومُثبت باختبار تكافؤ: الحارس المُعمَّم يعيد **نفس** مجموعة الخروقات حرفياً مثل حارس المستودع المصدر (`node tools/governance-template/tests/run-tests.mjs` → 9/9).

## الفكرة في خمس قواعد

1. **لا نجاح معلَن بلا دليل مقاس.** البوابة تُشغَّل، لا تُنقل من وثيقة. «البناء نجح» ≠ «القدرة تعمل».
2. **Freeze → Characterize → Extend → Verify.** ثبّت السلوك القائم باختبار، أضف القدرة خلف عقد أو Adapter، ثم شغّل البوابة كاملة.
3. **ثبّت الاكتشاف قبل الإصلاح في التاريخ.** وإلا فقد الإصلاح مصدره: `docs/STATUS.md` يُcommit قبل فرع الإصلاح، لا معه.
4. **النطاق يُعلَن لا يُستنتَج.** عنوان الـPR ووصفه يسمّيان المكوّنات، و`.github/change-policy.json` يصرّح بالتصنيف `A–F` والمسارات المحمية.
5. **دقّق الـfakes.** fake يعزل حداً خارجياً = مشروع؛ fake يعيد نجاحاً غير مشروط لمدخلات لم يفحصها = حاجب انحدار. *الحد الوحيد غير المختبر هو الحد الوحيد الذي يكسر.*

## ما يُنقل وما لا يُنقل

| المكوّن | اللغة | النقل |
|---|---|---|
| `scripts/check-change-policy.mjs` | أي لغة (يحتاج node + git) | ✅ كما هو — المسارات المحمية تُعلَن في `change-policy.json` |
| `scripts/check-change-policy.py` | Python ≥3.10 (stdlib فقط) | ✅ نفس الدلالات حرفياً، لمشروع لا يريد node — **مُثبت باختبار تطابق مخرج بايت-ببايت** مع نسخة node |
| `scripts/check-import-boundary.py` | Python ≥3.10 | ✅ كما هو — يفرض «صفر تبعيات/stdlib فقط» ميكانيكياً بدل تركه في README |
| `scripts/check-architecture.mjs` | TypeScript/JavaScript (يحتاج `typescript` dev dep) | ✅ كما هو — الخريطة والـaliases في `.governance/project.json` |
| `scripts/check-lockfile.mjs` | npm فقط | ✅ كما هو؛ **لا معنى له في مشروع بلا lockfile** — استبدله بحارس الثبات المناسب (مثل `check-import-boundary.py` لمشروع صفر التبعيات) |
| `scripts/verify.mjs` / `scripts/verify.py` | node / python | ✅ يشغّل `verify[]` من الإعداد، يتوقف عند أول فشل ويطبع ملخصاً مقاساً |
| `templates/STATUS.md` | — | ✅ قالب التقرير: قياس، خرق ثابت، P0 مع preflight، تدقيق fakes، أولويات |
| `templates/ci/*.yml` | node / python | ✅ مع `fetch-depth: 0` **إلزامي** — بدونه حارس التغيير أعمى |
| منهج القياس (تاريخ git، تصنيف انحدار مقابل دين تصميم) | — | ✅ `docs/STATUS.md` في cela2027 هو المرجع الحي |

**ما لا يُنقل:** نواة وكيل cela2027 نفسها (`packages/*` + `apps/web`). تلك **منتج** لا منهج، وتنقلها كـstarter لمشروع وكيل آخر — ومعها P0 الموثّق في `docs/STATUS.md` §2.1 (الصندوق لا يرى مساحة العمل). أخذ المنتج دون القراءة = أخذ العطل مع العدة.

## التثبيت

### مشروع Node/TypeScript
```bash
# 1) انسخ الأدوات
mkdir -p scripts .governance .github
cp tools/governance-template/scripts/check-architecture.mjs scripts/
cp tools/governance-template/scripts/check-change-policy.mjs scripts/
cp tools/governance-template/scripts/check-lockfile.mjs   scripts/   # إن وُجد lockfile
cp tools/governance-template/scripts/verify.mjs           scripts/
cp tools/governance-template/.governance/project.json     .governance/
cp tools/governance-template/templates/change-policy.json .github/

# 2) اضبط الإعداد (هذا هو كل الشغل)
#    .governance/project.json:
#      workspaces.scopePattern        → prefix الحزم عندك (افتراضي ^(@[^/]+/[^/]+))
#      workspaces.layers              → ["packages","apps"] أو غيرهما
#      workspaces.allowedDependencies → خريطة الاتجاه؛ كل workspace لازم يظهر، [] = ورقة
#      workspaces.aliasPairs          → [{app, base, layers}] — فقط إن كان عندك إطار
#                                        يقرأ tsconfig خاص بالتطبيق (Next.js مثلاً)
#      verify[]                       → أوامر بوابتك بالترتيب
#    .github/change-policy.json:
#      protectedPatterns → regex للمسارات التشغيلية المحمية عندك
#      classification/reason → تصريح هذا التغيير

# 3) أضف البوابة لـ package.json
#    "verify": "node scripts/verify.mjs"

# 4) CI: خذ templates/ci/node.yml (تأكد من fetch-depth: 0)

# 5) قِس ثم اكتب
npm run verify
cp tools/governance-template/templates/STATUS.md docs/STATUS.md   # واملأه بقياسك أنت
```

### مشروع Python
```bash
mkdir -p scripts .governance .github
cp tools/governance-template/scripts/check-change-policy.mjs  scripts/   # يحتاج node
#   أو انقل منطقه إلى Python — المنطق git-only ولا يرتبط بلغة
cp tools/governance-template/scripts/check-import-boundary.py scripts/
cp tools/governance-template/scripts/verify.py                scripts/
cp tools/governance-template/.governance/project.json         .governance/
cp tools/governance-template/templates/change-policy.json     .github/

# .governance/project.json:
#   language: "python"
#   scans.python.include            → ["core", "demo.py", "tests"]
#   scans.python.localPackages      → ["core"]
#   scans.python.declaredThirdParty → [] إن كان المشروع صفر تبعيات
#   verify[]                        → الحراس + unittest + demo + compileall
# .github/change-policy.json:
#   protectedPatterns → ["^core/.*\\.py$"] مثلاً

python3 scripts/verify.py
cp tools/governance-template/templates/STATUS.md docs/STATUS.md
```

### مشروع غير TS وغير Python
المنهج والحراس git-based (`check-change-policy`, `verify`, تصنيف `A–F`, `STATUS.md`, CI بـ`fetch-depth: 0`) تنقل كما هي. حارس الاعتماديات يحتاج معادل اللغة (Python: `check-import-boundary.py` أو `import-linter`؛ Go: `go list -deps` + قائمة مسموحة؛ إلخ). **لا تدّعِ أن حارس TS يعمل في غير TS.**

## شكل `.governance/project.json`

| المفتاح | المعنى |
|---|---|
| `language` | `node` أو `python` (للقارئ البشري؛ الحراس يقرؤون ما يخصهم) |
| `scans.python.include` | ملفات/مجلدات يفحصها حارس الحدود |
| `scans.python.localPackages` | جذور الاستيراد المحلية المسموحة |
| `scans.python.declaredThirdParty` | التبعيات الخارجية المعلنة؛ أي استيراد خارجها = خرق |
| `workspaces.scopePattern` | regex بمجموعة التقاط واحدة لاسم حزمة الـworkspace |
| `workspaces.layers` | المجلدات التي تحوي workspaces |
| `workspaces.tsconfigBase` | إعداد TS الجذري الذي تقرأه بوابة الأنواع |
| `workspaces.allowedDependencies` | خريطة الاتجاه الإلزامية (كل workspace لازم يظهر) |
| `workspaces.aliasPairs` | `[{app, base, layers}]` لتطابق الـaliases بين إعدادين |
| `workspaces.forbiddenAliasPrefixes` | `[{layers, prefixes, message}]` — منع عبور طبقة عبر alias |
| `verify[]` | `[{name, command}]` بالترتيب؛ `verify.mjs`/`verify.py` يشغّلها |

## شكل `.github/change-policy.json`

| المفتاح | المعنى |
|---|---|
| `classification` | `A` إضافة · `B` توسعة · `C` Adapter · `D` Migration · `E` Refactor · `F` Breaking (محظور افتراضياً؛ يحتاج `ALLOW_BREAKING_CHANGE=explicit`) |
| `reason` | ≥20 حرفاً: ما تغيّر ولماذا آمن |
| `protectedPatterns` | regex للمسارات التشغيلية المحمية. غيابها → default محافظ (`^packages/[^/]+/src/`, `^src/`, وفي نسخة Python يضاف `^core/.*\.py$`). **الأفضل إعلانها صراحة** حتى لا يعتمد المعنى على الافتراضي |
| `protectedChanges` | يجب أن يسرد **بالضبط** المسارات المحمية التي لمسها هذا التغيير |
| `allowedBinaryChanges` | يجب أن يسرد **بالضبط** الملفات الثنائية؛ الرفض افتراضي |

## تعريف الإنجاز (لا يُعلن بدونه)

```text
BUILD ✅  TYPECHECK ✅  OLD TESTS ✅  NEW CONTRACT TESTS ✅
API COMPATIBILITY ✅  SAFE DEFAULT ✅  ROLLBACK PATH ✅
```
وتُضاف `E2E ✅` فقط بعد تشغيل اختبار متصفح فعلي، و`LIVE INTEGRATION ✅` فقط بعد تشغيل بيئة اختبار للخدمة الخارجية. **لا يُكتب أيهما قبل وجوده.**

## اختبار القالب نفسه

```bash
node tools/governance-template/tests/run-tests.mjs     # 9 اختبارات، node:test، بلا تبعيات
```
أهمها:
- **اختبار التكافؤ المعماري** — الحارس المُعمَّم مقابل حارس المستودع المصدر على نفس الشجرة: يجب أن تتطابق مجموعة الخروقات حرفياً.
- **اختبار تطابق حارس السياسة** — نسخة Python مقابل نسخة node على نفس المستودع: نفس السطر حرفياً.
- **اختبار إعلان المسارات المحمية** — `protectedPatterns` المعلَنة في `change-policy.json` تُنتج نفس قرار الحماية الذي ينتجه الحارس المثبّت في الكود، على 12 مساراً نموذجياً.

إن عدّلت أي حارس، عدّل اختبار التكافؤ معه — وإلا فقد القالب دليله.

> القالب **خامل** في cela2027: لا `package.json` خاص به (وإلا ابتلعه `workspaces: ["tools/*"]` في الجذر)، واسم ملف اختباره `run-tests.mjs` حتى لا يلتقطه `vitest` ولا `node --test` تلقائياً. بوابة المستودع `npm run verify` تبقى 53/53 بلا تغيير.
