#!/usr/bin/env bash
# تسليم طبقة الحوكمة إلى agi-system.
#
# لماذا تسليم وليس دفعاً مباشراً: اتصال GitHub في جلسة Arena مصرّح له على
# cela2027 فقط، والدفع إلى agi-system أعاد:
#   remote: Permission to sayedelazameydesign-crypto/agi-system.git denied to
#           arena-ai-coding-agent[bot].  (403)
# لذلك التغيير مُعدّ ومقيس هنا، وأنت الذي تدفعه.
#
# لماذا ملفات نصية لا patch/bundle: حارس سياسة التغيير في cela2027 رفض
# الـpatch (مسافات ذيلية داخل نص مُولَّد) والـbundle (ملف ثنائي غير مصرّح)،
# وهو محق — المولّدات لا تدخل Git. `port/` تحوي الشجرة الكاملة نصاً، فتبقى
# قابلة للحراسة وللمراجعة ولإعادة الإنتاج.
#
# القياس المسجّل قبل التصدير: `python3 scripts/verify.py` → 6 بوابات PASS (~3.0s)،
# منها 86 اختباراً و`ALL EXPECTATIONS MET: True` وحارس «صفر تبعيات»
# (19 ملفاً، 154 استيراداً، 0 خارجي).
#
# الاستخدام:
#   bash apply-to-agi-system.sh apply  /path/to/agi-system-clone   # انسخ + قِس (بلا commit)
#   bash apply-to-agi-system.sh commit /path/to/agi-system-clone   # انسخ + قِس + commit بهوية المستودع
#   bash apply-to-agi-system.sh pr                                 # clone + انسخ + قِس + commit + push + PR
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="$HERE/port"
BRANCH="governance-template"
REPO="https://github.com/sayedelazameydesign-crypto/agi-system.git"
TITLE="Governance layer: enforced dependency-free gate, change policy, single verify command, measured status"

usage() { sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 2; }

copy_port() {
  local target="$1"
  echo "── نسخ شجرة التسليم إلى $target"
  ( cd "$PORT" && find . -type f | sed 's|^\./||' | while read -r file; do
      mkdir -p "$target/$(dirname "$file")"
      cp "$PORT/$file" "$target/$file"
    done )
}

verify_in() {
  local target="$1"
  echo "── قياس البوابة في $target"
  ( cd "$target" && python3 scripts/verify.py )
}

commit_in() {
  local target="$1"
  ( cd "$target"
    git checkout -B "$BRANCH"
    git add -A
    git commit -F "$HERE/COMMIT_MESSAGE.txt"
    git log --oneline -2
  )
}

case "${1:-}" in
  apply)
    TARGET="${2:?usage: apply-to-agi-system.sh apply /path/to/clone}"
    copy_port "$TARGET"
    verify_in "$TARGET"
    echo "── نُسخ وقِيس بلا commit. راجع ثم: git add -A && git commit"
    ;;
  commit)
    TARGET="${2:?usage: apply-to-agi-system.sh commit /path/to/clone}"
    copy_port "$TARGET"
    verify_in "$TARGET"
    commit_in "$TARGET"
    echo "── جاهز. ادفع بـ: git push -u origin $BRANCH"
    ;;
  pr)
    WORK="$(mktemp -d)"
    git clone "$REPO" "$WORK/agi-system"
    TARGET="$WORK/agi-system"
    copy_port "$TARGET"
    verify_in "$TARGET"
    commit_in "$TARGET"
    ( cd "$TARGET" && git push -u origin "$BRANCH" )
    ( cd "$TARGET" && gh pr create --base main --head "$BRANCH" \
        --title "$TITLE" --body-file "$HERE/PR_DESCRIPTION.md" )
    echo "── تم. رابط الـPR أعلاه."
    ;;
  *)
    usage
    ;;
esac
