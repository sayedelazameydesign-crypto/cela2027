# تسليم الحوكمة إلى agi-system — مقيس، غير مدفوع

## لماذا هذا المجلد موجود

اتصال GitHub في هذه الجلسة مصرّح له على `cela2027` فقط. الدفع إلى `agi-system` أعاد حرفياً:

```text
remote: Permission to sayedelazameydesign-crypto/agi-system.git denied to arena-ai-coding-agent[bot].
fatal: unable to access '.../agi-system.git/': The requested URL returned error: 403
```

فالتغيير أُعدّ وقِيس وصُنع له commit محلي بهوية مالك المستودع، ثم سُلم هنا **كنص** لتدفعه أنت.

## لماذا `port/` وليس patch أو bundle

الحارس في `cela2027` رفض الشكلين، وهو محق:

```text
Change policy violations:
- tools/agi-system-handoff/0001-governance-template.patch: line 91: trailing whitespace
  (+ 6 مواضع أخرى داخل نص مُولَّد)
- allowedBinaryChanges must exactly list this change's binary paths:
  tools/agi-system-handoff/governance-template.bundle
```

`git format-patch` يولّد نصاً بمسافات ذيلية لا تصلح أن تُحرس، و`git bundle` ثنائي. الاثنان **مولّدات**، والمولّدات لا تدخل Git. `port/` هي الشجرة الكاملة نصاً: قابلة للحراسة، قابلة للمراجعة سطر-بسطر، وقابلة لإعادة الإنتاج.

## المحتوى

```text
port/                        شجرة agi-system كاملة (9 ملفات) — تُنسخ كما هي في جذر المستودع
  .governance/project.json     إعداد الحراس + verify[] (6 بوابات)
  .github/change-policy.json   تصنيف A + protectedPatterns (^core/.*\.py$, ^demo\.py$)
  .github/workflows/ci.yml     + fetch-depth: 0 + خطوة Compatibility gate
  .gitignore                   + .ci-sandbox/
  README.md                    + أمر البوابة ورابط الحالة المقيسة
  docs/STATUS.md               الحالة المقيسة (6 بوابات، 86 اختباراً، تدقيق fakes، ديون)
  scripts/check-change-policy.py
  scripts/check-import-boundary.py
  scripts/verify.py
apply-to-agi-system.sh       apply | commit | pr
COMMIT_MESSAGE.txt           نص الـcommit المُعدّ
PR_DESCRIPTION.md            وصف الـPR بنطاق مُعلَن
```

## التطبيق

```bash
# أ) انسخ وقِس بلا commit — للمراجعة أولاً
bash tools/agi-system-handoff/apply-to-agi-system.sh apply /path/to/agi-system

# ب) انسخ + قِس + commit بهوية المستودع
bash tools/agi-system-handoff/apply-to-agi-system.sh commit /path/to/agi-system
git -C /path/to/agi-system push -u origin governance-template

# ج) كل شيء تلقائياً (يتطلب gh مسجّلاً بهويتك، لا بهوية الـbot)
bash tools/agi-system-handoff/apply-to-agi-system.sh pr
```

الطريقتان `apply` و`commit` **مُختبرتان فعلياً** على clone نظيف من `agi-system`: النسخ ثم `python3 scripts/verify.py` → `verify OK - 6 gates`.

## القياس الذي يحمله التسليم

```text
verify OK - 6 gates in 2954ms:
  PASS  change policy  (68ms)          → Change policy OK (7 changed, 0 protected, 0 binary)
  PASS  import boundary (106ms)        → 19 files, 154 imports: 110 stdlib, 44 local, 0 third-party
  PASS  unit tests  (2272ms)           → Ran 86 tests ... OK
  PASS  demo smoke  (124ms)            → ALL EXPECTATIONS MET: True
  PASS  compile check  (40ms)
  PASS  cli smoke  (344ms)             → finished: VERIFIED
```

وخارج البوابة: التعبئة في venv معزول — `pip install -e . --no-deps` ثم `agi-kernel doctor --json` → exit 0 و`chain_valid: true`.

## ما لا يفعله هذا التسليم

- لا يلمس `core/` ولا `tests/` ولا `demo.py` — المساران المحميان المعلَنان هما `^core/.*\.py$` و`^demo\.py$`، والتغيير يعيد `0 protected`.
- لا يضيف أي تبعية: الحراس الثلاثة stdlib خالص، فيبقى ثابت «صفر اعتماديات» سليماً ويُفرض الآن ميكانيكياً.
- لا يُصلح الديون المسجّلة في `docs/STATUS.md` §2 (عرض 5 من 6 سيناريوهات، `py.typed` بلا بوابة أنواع، لا coverage، لا lint، لا خطوة CI للتعبئة) — تلك بنود بأولوياتها في §5، وتحتاج قرارات لا نسخ ملفات.
