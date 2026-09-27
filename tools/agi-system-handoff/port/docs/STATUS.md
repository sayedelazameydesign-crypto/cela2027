# حالة المشروع — ما تم إنجازه وما لم يكتمل

> **تاريخ القياس:** 2026-09-27 · **Commit المقاس:** `e08611d` (+ طبقة الحوكمة من هذا الفرع) · **الفرع:** `governance-template`
> **بيئة القياس:** Python 3.11.2 / Linux · بلا تثبيت (`python3` مباشرة) + venv معزول لاختبار التعبئة
> **التاريخ:** 5 commits، المستودع **ليس shallow** (`git rev-parse --is-shallow-repository` → `false`) — لكن النسخة المحلية بُدئت بـ`--depth 50`، والحدود هنا ليست مشكلة لأن كل التاريخ مرئي
> **القاعدة:** لا يُكتب «منجز» إلا بدليل قابل لإعادة التشغيل. المنهج مُستورد من [cela2027 `docs/STATUS.md`](https://github.com/sayedelazameydesign-crypto/cela2027/blob/main/docs/STATUS.md).

---

## 0) بوابة التوافق (مقاسة الآن)

`python3 scripts/verify.py` → **6 بوابات، 3168ms، كلها PASS**:

| # | البوابة | الأمر | النتيجة المقاسة |
|---|---|---|---|
| 1 | سياسة التغيير | `python3 scripts/check-change-policy.py` | ✅ `Change policy OK (7 changed, 0 protected, 0 binary; base origin/main).` |
| 2 | حدود الاستيراد («صفر تبعيات») | `python3 scripts/check-import-boundary.py .` | ✅ `Import boundary OK (19 files, 154 imports: 110 stdlib, 44 local, 0 declared third-party).` |
| 3 | اختبارات الوحدة | `python3 -m unittest discover -s tests -t .` | ✅ **86 اختباراً OK** (2442ms) |
| 4 | demo (6 سيناريوهات) | `python3 demo.py` | ✅ `ALL EXPECTATIONS MET: True` (140ms) |
| 5 | compileall | `python3 -m compileall -q core demo.py tests scripts` | ✅ (43ms) |
| 6 | CLI smoke | `doctor → run → verify → replay` | ✅ `finished: VERIFIED` (365ms) |

**قياس إضافي للتعبئة (خارج البوابة، في venv معزول):** `python3 -m venv` → `pip install -e . --no-deps` → `agi-kernel doctor --json` → **exit 0** و`chain_valid: true`. إذن ادعاء README «التثبيت الاختياري كحزمة» **صحيح ومقاس**، لا مفترض.

**ما لا تثبته البوابة أعلاه:** فحص أنواع ثابت (mypy غير موجود) · lint/format · coverage · E2E لعملية وكيل حقيقية · أي تكامل بخدمات خارجية (لا يوجد بحكم صفر التبعيات) · منصات غير Linux (CI يغطي 3.10–3.13 على ubuntu فقط).

---

## 1) ما تم إنجازه (مثبت بالكود والاختبارات)

**الحجم:** `core` 3,526 سطراً + `tests` 1,016 + `demo.py` 205 = **4,747 سطراً** قبل طبقة الحوكمة، و+512 سطراً حراساً جديدة.

| المكوّن | الأسطر | المنجز المثبت |
|---|---|---|
| `core/kernel.py` | 618 | الحلقة كاملة `Goal → Planner → Policy → Executor → Verifier → Evidence → DecisionRecord → EventLedger` + `replay()` و`resume` |
| `core/cli.py` | 415 | `doctor / run / verify / replay / resume / metrics / rotate` + رموز خروج 0–6 + `--json` |
| `core/event_ledger.py` | 412 | سجل append-only مُهاش + `verify` (fsck) + `--quarantine` للذيل التالف + `rotate --keep` |
| `core/executor.py` | 349 | تنفيذ القدرات على filesystem حقيقي مع احتواء المسار |
| `core/models.py` | 308 | نماذج البيانات (`Goal`, `Action`, `PolicyDecision`, `ExecStatus`, …) |
| `core/config.py` | 304 | إعدادات + `agi-kernel.example.json` |
| `core/policy.py` | 231 | **المصرّح الوحيد**: allowlist قدرات، `max_risk=0.85`، denylist، وبوابة صريحة `allow_delete` على `filesystem.delete` (سطر 87) |
| `core/verifier.py` | — | تحقق مستقل: لا يثق بالـExecutor → **`INCONCLUSIVE`** عند تعارض الادعاء مع العالم |
| `core/clock.py` `errors.py` `metrics.py` `logging_setup.py` | — | Phase 0 hardening: ساعة قابلة للحقن، أخطاء مصنّفة، عدّادات ومدد، إعداد logging |
| `tests/` | 1,016 | **86 اختباراً** (47 + 39) على `tempfile` حقيقي — **صفر mocks** (§3) |
| `demo.py` | 205 | 6 سيناريوهات منها خصمان: happy/path-traversal/lying-executor/unknown-goal/interrupted-resumed/ledger-replay |
| `.github/workflows/ci.yml` | — | مصفوفة Python 3.10–3.13 · unit tests · demo smoke · CLI smoke · compileall — **والآن + البوابة الموحّدة و`fetch-depth: 0`** |
| `docs/` | — | `ARCHITECTURE.md` (5.2KB) · `OPERATIONS.md` (3.5KB) · `README.md` (11.6KB) · وهذا الملف |

### ثوابت مفروضة الآن ميكانيكياً (كانت ادعاءات في README)
1. **«بدون أي اعتمادات خارجية»** ← بوابة 2: 154 استيراداً في 19 ملفاً، كلها stdlib أو محلية، وصفر خارجي مُعلَن. أي تبعية جديدة تفشل البوابة ما لم تُعلَن في `.governance/project.json` **في نفس التغيير**.
2. **«لا ادعاءات بدون أدلة»** ← `demo.py` يشغّل executor كاذباً (يدّعي النجاح دون فعل) فينتج `INCONCLUSIVE`، و`ALL EXPECTATIONS MET: True` مشروط بذلك + بـ`chain_valid` + بعدم وجود ملف هارب من الاحتواء.
3. **`filesystem.delete` مُعلَنة** ← في `DEFAULT_ALLOWLIST` مع وزن مخاطر وبوابة `allow_delete` صريحة. **مقارنة مباشرة:** في cela2027 الأداة نفسها مطبّقة في النواة وغير مُعلَنة في الـmanifest ولا الـallowlist (خرق ثابت موثّق هناك في §2.0). الثابت الذي خُرق هناك **سليم هنا**.
4. **احتواء المسار** ← سيناريو `path traversal → DENIED` + `escaped.exists()` في شرط النجاح.
5. **استئناف الانقطاع** ← سيناريو `interrupted run → resumed and VERIFIED`، وهو ما يفتقده cela2027 (مؤجل لمرحلة 2 هناك).

### صحة ادعاءات README (فحصت، لا افترضت)
| الادعاء | القياس | الحكم |
|---|---|---|
| «86 اختبار وحدة» | `Ran 86 tests … OK` | ✅ دقيق |
| «demo: عرض تجريبي كامل (6 سيناريوهات)» | docstring يعدّد 6، والكود ينفّذ 6 ويؤكد `state.chain_valid` | ✅ دقيق (مع ملاحظة عرض في §2.1) |
| «بدون أي اعتمادات خارجية» | 154 استيراداً، صفر خارجي | ✅ دقيق — وصار مفروضاً ببوابة |
| «رموز الخروج 0–6» | `core/cli.py:36-43` يعرّفها | ✅ دقيق |
| «`pip install -e .` ثم `agi-kernel doctor`» | نُفّذ في venv معزول → exit 0 | ✅ دقيق |

---

## 2) ما لم يكتمل

### 2.1 دين تصميم في العرض — `SUMMARY` يعرض 5 من 6
سيناريو `ledger replay` **يُنفَّذ ويُؤكد** (`state.chain_valid` داخل شرط `ALL EXPECTATIONS MET`، `demo.py:186-197`) لكنه **غير مدرج** في قاموس `outcomes` الذي يطبعه `SUMMARY` (`demo.py:180-185`) → القارئ يرى خمسة أسطر ويظن السادس ناقصاً. **تصنيف: عرض لا سلوك.** العلاج سطر واحد + تأكيد على المخرج المطبوع.

### 2.2 لا فحص أنواع ثابت — والحزمة تشحن `py.typed`
`pyproject.toml` يعلن `core = ["py.typed"]`، أي أن الحزمة **تَعِد المستهلكين بدعم الأنواع**، بينما لا mypy ولا أي فحص أنواع في البوابة أو CI. **هذا وعد غير مُختبَر** — وهو نفس نوع الفجوة التي يسميها منهج cela2027 «ادعاء بلا دليل». المطلوب: `mypy --strict core` كبوابة، أو سحب `py.typed` حتى يوجد الفحص. (لا يُضاف mypy كتبعية وقت تشغيل؛ dev-only، وحارس الحدود يستثني dev extras أو يُعلنها.)

### 2.3 لا قياس تغطية
لا `coverage` في البوابة → **86 اختباراً لا تعني 86% تغطية**، ولا يجوز اشتقاق أي ادعاء تغطية من عدد الاختبارات. المطلوب: قياس مرة، تثبيت الرقم في هذا الملف، ثم بوابة على الانحدار (لا على رقم مطلق).

### 2.4 لا lint/format
لا ruff/flake8/black؛ `compileall` يثبت الصحة النحوية فقط لا الأسلوب. الفجوة صغيرة لكنها تُترك عمداً: أي أداة تُضاف يجب أن تُعلَن في حارس الحدود.

### 2.5 CI كان أعمى أمام حارس التغيير (عولج في هذا التغيير)
`actions/checkout@v4` بلا `fetch-depth: 0` → base الحارس ينهار على HEAD فيمرّ بـ«0 changed». أُضيف `fetch-depth: 0` + خطوة `Compatibility gate`. **مقاس في cela2027:** نفس الحارس على مستودع shallow أعاد `Change policy OK (0 changed…)` بينما الشجرة فيها تغييرات فعلية.

### 2.6 نظافة آثار التشغيل (عولجت جزئياً)
`.ci-sandbox/` التي ينتجها CLI smoke **لم تكن في `.gitignore`** (الموجود `agi-sandbox*/` و`sandbox/` فقط) → تظهر untracked بعد أي تشغيل محلي. أُضيفت، وأُضيف `rm -rf` في نهاية خطوة الـsmoke.

### 2.7 التعبئة غير مقاسة داخل CI
`pip install -e .` + `agi-kernel` قِيسا يدوياً هنا (venv معزول) لكن **لا خطوة CI** تثبتهما؛ كما لا فحص لاتساق `version = "0.3.0"` مع أي مصدر آخر.

### 2.8 لا docs/PROVIDERS ولا سياسة تطور مكتوبة
`docs/` فيه المعمارية والتشغيل فقط. لا يوجد هنا ما يعادل `SAFE_EVOLUTION.md` (Freeze → Extend → Verify، العقود المُجمّدة، تصنيف `A–F`) — مع أن `change-policy.json` يفرض التصنيف فعلاً. الفجوة توثيقية: الآلية موجودة والمنهج غير مكتوب.

---

## 3) تدقيق الـfakes

**المعيار:** fake يعزل حداً خارجياً = مشروع. fake **خصم** هو موضوع الاختبار نفسه = مشروع بل مرغوب. fake يعيد نجاحاً غير مشروط بدل حدّ حقيقي = **حاجب انحدار**.

| # | الـfake | الموضع | التصنيف | التفصيل |
|---|---|---|---|---|
| 3.1 | `LyingExecutor` | `demo.py:44` — «يدّعي النجاح دون أن يفعل شيئاً (اختبار خصم)» | ✅ **خصم مشروع** | ليس بديلاً عن Executor بل **موضوع** الاختبار: يثبت أن Verifier يمسك الادعاء الكاذب → `INCONCLUSIVE` |
| 3.2 | `CrashingExecutor` | `demo.py:56` — «يفشل مرة (محاكاة انهيار عملية) ثم يعمل طبيعياً» | ✅ **خصم مشروع** | يثبت مسار الاستئناف فعلياً |
| 3.3 | mocks/patches في الاختبارات | `tests/*.py` | ✅ **غير موجودة إطلاقاً** | `grep -rn "Mock|MagicMock|patch|monkeypatch|fake|stub" tests/*.py` → **صفر نتائج**؛ كل الاختبارات على `tempfile.mkdtemp` حقيقي مع `addCleanup` |
| 3.4 | بدائل لحدود خارجية (شبكة/قاعدة/ساعة) | — | ✅ **لا حاجة** | صفر تبعيات = لا حدود خارجية؛ `core/clock.py` قابل للحقن وهو عزل مشروع للزمن |

**الخلاصة:** لا يوجد في agi-system أي fake من النوع الحاجب. **ولهذا السبب بالذات** لم تظهر فيه فجوة مماثلة لـP0 في cela2027: هناك استُبدل حد المتصفح+Pyodide بـ`okBridge` يعيد `ok:true` **دون قراءة الكود**، فنجا عطل حقيقي من 53 اختباراً. هنا نفس السيناريوهات تُنفَّذ على ملفات حقيقية، فلا مكان يختبئ فيه العطل.

> **الدرس المحمول بين المستودعين:** السؤال ليس «هل عندك fakes؟» بل «هل الـfake **موضوع** الاختبار أم **بديل** عن الحد الحقيقي؟». الأول يقوّي الدليل، والثاني يسرقه.

---

## 4) أعمال متزامنة — إحالات مرجعية

- **cela2027** (نظام الوكيل المبني على فلسفة هذا المستودع): طبقة الحوكمة هنا مستخرجة منه، وتقريره `docs/STATUS.md` يوثّق P0 حقيقياً (الصندوق لا يرى مساحة العمل) وخرق ثابت `delete_file`. **لا يُحتسب أي من ذلك منجزاً هنا.**
- **مصدر القالب:** `cela2027/tools/governance-template/` — الحراس نفسها مع اختبارات تكافؤ (9/9) تثبت أن النسخة المُعمَّمة تطابق نسخة المستودع المصدر، وأن نسخة Python من حارس السياسة تطابق نسخة node **بايت-ببايت**.

---

## 5) أولوية التنفيذ (كل بند Additive خلف `python3 scripts/verify.py`)

| # | المهمة | التصنيف | معيار القبول |
|---|---|---|---|
| 1 | سطر `ledger replay` في `SUMMARY` + تأكيد على المخرج المطبوع | `A` | 6 أسطر معروضة، واختبار يفشل لو سقط أحدها |
| 2 | `mypy --strict core` كبوابة (أو سحب `py.typed`) | `A` | صفر أخطاء، أو الحزمة لا تعد بما لا تفحصه |
| 3 | قياس coverage مرة وتثبيته هنا، ثم بوابة انحدار | `A` | رقم مقاس في §0 + فشل عند النزول عنه |
| 4 | خطوة CI للتعبئة: `pip install -e .` ثم `agi-kernel doctor --json` | `A` | exit 0 في CI لا محلياً فقط |
| 5 | ruff (lint+format) معلَن في حارس الحدود | `B` | البوابة تمر، والحارس يعرف الأداة |
| 6 | `docs/SAFE_EVOLUTION.md`: العقود المُجمّدة + `A–F` + تسلسل أي ميزة | `A` | الآلية الموجودة في `change-policy.json` تصير منهجاً مكتوباً |
| 7 | فحص اتساق `version` بين `pyproject.toml` وأي مصدر آخر | `B` | حارس يفشل عند التباعد |

**قواعد صارمة:** `core/**.py` و`demo.py` **مسارات محمية** (معلَنة في `.github/change-policy.json` → `protectedPatterns`)؛ أي تغيير فيها يستلزم تعديل ملف السياسة في نفس التغيير وسرداً حرفياً في `protectedChanges`. · `classification: F` محظور افتراضياً (يتطلب `ALLOW_BREAKING_CHANGE=explicit`). · لا تبعية جديدة دون إعلانها في `.governance/project.json`. · البوابة تُشغَّل قبل الإعلان، لا بعد.

---

## 6) ملحق الأرقام وإعادة القياس

- 5 commits · 27 ملفاً (+6 ملفات حوكمة جديدة) · 4,747 سطراً منتج/اختبار + 512 سطراً حراس.
- 86 اختباراً · صفر mocks · 6 سيناريوهات demo · 154 استيراداً (110 stdlib + 44 محلي + 0 خارجي).
- CI: Python 3.10/3.11/3.12/3.13 على ubuntu-latest.

```bash
# إعادة القياس (بوابة واحدة)
python3 scripts/verify.py

# أو يدوياً
python3 scripts/check-change-policy.py
python3 scripts/check-import-boundary.py .
python3 -m unittest discover -s tests -t .
python3 demo.py
python3 -m compileall -q core demo.py tests scripts

# قياس التعبئة (خارج البوابة)
python3 -m venv /tmp/agi-venv && /tmp/agi-venv/bin/pip install -e . --no-deps
/tmp/agi-venv/bin/agi-kernel doctor --sandbox /tmp/agi-sbx --json; echo "exit=$?"

# أدلة §3
grep -rn "Mock\|MagicMock\|patch\|monkeypatch\|fake\|stub" tests/*.py   # → صفر نتائج
```
