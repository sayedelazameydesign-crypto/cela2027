> **النطاق مُعلَن لا مُستنتَج:** (1) طبقة حوكمة إضافية (حارسان + بوابة واحدة + إعداد) · (2) حالة مشروع مقيسة `docs/STATUS.md` · (3) إصلاح `fetch-depth` في CI ونظافة آثار التشغيل.
> **لا ملف تحت `core/` مِلْمَس، ولا تبعية أُضيفت.** `check:changes` يعيد `0 protected` لأن `protectedPatterns` المعلَنة هي `^core/.*\.py$` و`^demo\.py$`.

## لماذا

طبقة الحوكمة مستخرجة من [cela2027](https://github.com/sayedelazameydesign-crypto/cela2027) — نفس فلسفة هذا المستودع («لا ادعاءات بدون أدلة») — ومُثبتة هناك باختبارات تكافؤ (9/9):
- الحارس المعماري المُعمَّم يعيد **نفس** مجموعة الخروقات حرفياً مثل نسخة المستودع المصدر.
- نسخة Python من حارس سياسة التغيير تطابق نسخة node **بايت-ببايت** على نفس الشجرة.

## ما يُثبته هذا التغيير ميكانيكياً بدل تركه ادعاءً في README

| الادعاء | قبل | بعد |
|---|---|---|
| «بدون أي اعتمادات خارجية» | نص في README | بوابة: `Import boundary OK (19 files, 154 imports: 110 stdlib, 44 local, 0 declared third-party).` — أي تبعية جديدة تفشل ما لم تُعلَن في `.governance/project.json` **في نفس التغيير** |
| «البوابة تُشغَّل قبل الإعلان» | خطوات متفرقة في CI | أمر واحد `python3 scripts/verify.py` → **6 بوابات، ~3.0s، كلها PASS** |
| «حجم التغيير مصرّح» | لا شيء | `check-change-policy.py` بتصنيف `A–F` ومسارات محمية معلَنة، و`F` يتطلب `ALLOW_BREAKING_CHANGE=explicit` |
| «CI يقيس التغيير كله» | `checkout@v4` بلا `fetch-depth` → الحارس ينهار على HEAD ويمرّ بـ«0 changed» | `fetch-depth: 0` + خطوة `Compatibility gate` |

## القياس (لا الافتراض)

```text
verify OK - 6 gates in 2954ms:
  PASS  change policy  (68ms)
  PASS  import boundary (dependency-free claim)  (106ms)
  PASS  unit tests  (2272ms)          → Ran 86 tests ... OK
  PASS  demo smoke (6 scenarios incl. adversarial)  (124ms)   → ALL EXPECTATIONS MET: True
  PASS  compile check  (40ms)
  PASS  cli smoke (doctor/run/verify/replay)  (344ms)         → finished: VERIFIED
```

وب خارج البوابة: **التعبئة** قِيست في venv معزول — `pip install -e . --no-deps` ثم `agi-kernel doctor --json` → exit 0 و`chain_valid: true`. ادعاء README صحيح ومقاس.

## تدقيق الـfakes — النتيجة التي تستحق القراءة

`grep -rn "Mock|MagicMock|patch|monkeypatch|fake|stub" tests/*.py` → **صفر نتائج**. كل الاختبارات على `tempfile.mkdtemp` حقيقي مع `addCleanup`. والـfakes الوحيدة في المستودع **خصوم مقصودة**: `LyingExecutor` (`demo.py:44`) و`CrashingExecutor` (`demo.py:56`) — أي أن الـfake هنا **موضوع** الاختبار لا **بديل** عن الحد الحقيقي.

ولهذا السبب بالذات لم تظهر هنا فجوة مماثلة لـP0 في cela2027: هناك استُبدل حد المتصفح+Pyodide بـ`okBridge` يعيد `ok:true` **دون قراءة الكود**، فنجا عطل حقيقي من 53 اختباراً (`ModuleNotFoundError` عند تشغيل خطة العرض في Pyodide فعلياً). هنا نفس السيناريوهات تُنفَّذ على ملفات حقيقية فلا مكان يختبئ فيه العطل. الدرس محمول في `docs/STATUS.md` §3.

## ما سُجّل كدين ولم يُصلَح هنا (عن قصد)

1. `SUMMARY` في `demo.py` يعرض **5 من 6** سيناريوهات — السادس (`ledger replay`) يُنفَّذ ويُؤكد (`state.chain_valid`) لكنه غير مدرج في قاموس `outcomes` (سطور 180-185). عرض لا سلوك.
2. `py.typed` **يُشحن بلا أي بوابة أنواع ثابتة** — وعد غير مُختبَر. إما `mypy --strict core` أو سحب `py.typed`.
3. لا قياس coverage → «86 اختباراً» لا تعني أي نسبة تغطية، ولا يُشتق منها ادعاء.
4. لا lint/format · لا خطوة CI للتعبئة · لا `docs/SAFE_EVOLUTION.md` (الآلية موجودة في `change-policy.json` والمنهج غير مكتوب).

كل بند بأولويته ومعيار قبوله في `docs/STATUS.md` §5.

## الملفات

| الملف | التغيير |
|---|---|
| `scripts/check-change-policy.py` | جديد — حارس سياسة التغيير (stdlib فقط) |
| `scripts/check-import-boundary.py` | جديد — حارس «صفر تبعيات» |
| `scripts/verify.py` | جديد — مشغّل البوابة الواحدة |
| `.governance/project.json` | جديد — إعداد الحراس + `verify[]` |
| `.github/change-policy.json` | جديد — تصنيف `A` + `protectedPatterns` |
| `docs/STATUS.md` | جديد — الحالة المقيسة |
| `.github/workflows/ci.yml` | `fetch-depth: 0` + خطوة البوابة |
| `.gitignore` | `.ci-sandbox/` |
| `README.md` | أمر البوابة + رابط الحالة المقيسة |

## قاعدة الدمج

لا يُدمج قبل أن تُشغَّل البوابة في CI وتظهر `verify OK - 6 gates`. وأي تغيير لاحق في `core/**.py` أو `demo.py` يستلزم تعديل `.github/change-policy.json` في نفس الـcommit مع سرد حرفي في `protectedChanges` — وإلا فشلت البوابة.
