"""Change-policy guard (governance template, Python port).

Same semantics as `check-change-policy.mjs`, stdlib only, so a dependency-free
Python project does not have to install node just to enforce governance.

Enforced rules
    1. no trailing whitespace and no conflict markers in changed text files
    2. `git diff --check` clean against the comparison base
    3. any changed protected runtime path must be listed EXACTLY in
       `.github/change-policy.json` -> protectedChanges, and the policy file
       itself must be part of the same change
    4. binary files are rejected unless listed EXACTLY in allowedBinaryChanges
    5. classification must be A/B/C/D/E/F; F requires ALLOW_BREAKING_CHANGE=explicit
    6. reason must explain the change in at least 20 characters

Comparison base: $CHANGE_BASE, else origin/$GITHUB_BASE_REF, else origin/main.
NOTE: on a shallow clone the base collapses onto HEAD and the guard reports
"0 changed" - CI must use `fetch-depth: 0`.

Requires: Python >= 3.10, git. Exit codes: 0 clean, 1 violations, 2 config error.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List, Sequence, Set, Tuple

POLICY_RELPATH = ".github/change-policy.json"
VALID_CLASSIFICATIONS = {"A", "B", "C", "D", "E", "F"}
DEFAULT_PROTECTED_PATTERNS = (r"^packages/[^/]+/src/", r"^src/", r"^core/.*\.py$")
CONFLICT_MARKER = re.compile(r"^(<<<<<<<|=======|>>>>>>>)(?: |$)")
TRAILING_WS = re.compile(r"[ \t]+$")


class GitError(RuntimeError):
    pass


def repo_root(explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit).resolve()
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(out.stdout.strip()).resolve()
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        raise GitError(f"cannot determine repository root: {error}") from error


def git(root: Path, args: Sequence[str], optional: bool = False) -> str:
    run = subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True
    )
    if run.returncode != 0:
        if optional:
            return run.stdout.strip()
        raise GitError(f"git {' '.join(args)} failed: {run.stderr.strip()}")
    return run.stdout.strip()


def lines(value: str) -> List[str]:
    return [line for line in value.splitlines() if line]


def ref_exists(root: Path, ref: str) -> bool:
    run = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", ref],
        cwd=root,
        capture_output=True,
        text=True,
    )
    return run.returncode == 0


def comparison_base(root: Path) -> str | None:
    override = os.environ.get("CHANGE_BASE")
    if override and ref_exists(root, override):
        return override
    base_ref = os.environ.get("GITHUB_BASE_REF")
    if base_ref:
        remote = f"origin/{base_ref}"
        if ref_exists(root, remote):
            return remote
    return "origin/main" if ref_exists(root, "origin/main") else None


def diff_arguments(base: str | None, suffix: Sequence[str]) -> List[str]:
    return [*suffix, f"{base}...HEAD", "--"] if base else []


def changed_files(root: Path, base: str | None) -> List[str]:
    changed: Set[str] = set()
    if base:
        changed.update(
            lines(git(root, ["diff", *diff_arguments(base, ["--name-only", "--diff-filter=ACMRD"])]))
        )
    changed.update(lines(git(root, ["diff", "--name-only", "--diff-filter=ACMRD", "HEAD", "--"])))
    changed.update(lines(git(root, ["ls-files", "--others", "--exclude-standard"])))
    return sorted(changed)


def binary_files_from_diff(root: Path, base: str | None) -> Set[str]:
    binary: Set[str] = set()
    outputs = []
    if base:
        outputs.append(git(root, ["diff", *diff_arguments(base, ["--numstat"])], optional=True))
    outputs.append(git(root, ["diff", "--numstat", "HEAD", "--"], optional=True))
    for output in outputs:
        for row in lines(output):
            parts = row.split("\t")
            if len(parts) >= 3 and parts[0] == "-" and parts[1] == "-":
                binary.add("\t".join(parts[2:]))
    return binary


def protected_matchers(policy: dict) -> List[re.Pattern]:
    patterns = policy.get("protectedPatterns") or list(DEFAULT_PROTECTED_PATTERNS)
    return [re.compile(pattern) for pattern in patterns]


def is_protected(file: str, matchers: Iterable[re.Pattern]) -> bool:
    return any(matcher.search(file) for matcher in matchers)


def looks_binary(data: bytes) -> bool:
    if not data:
        return False
    sample = data[:8192]
    suspicious = sum(
        1 for byte in sample if byte != 0 and (byte < 7 or (13 < byte < 32))
    )
    if b"\x00" in sample:
        return True
    return suspicious / len(sample) > 0.1


def text_problems(text: str) -> List[str]:
    problems = []
    for index, line in enumerate(text.split("\n"), start=1):
        if TRAILING_WS.search(line):
            problems.append(f"line {index}: trailing whitespace")
        if CONFLICT_MARKER.match(line):
            problems.append(f"line {index}: unresolved conflict marker")
    return problems


def existing_binary_files(root: Path, files: Sequence[str], from_diff: Set[str]) -> List[str]:
    binary = set(from_diff)
    for file in files:
        absolute = root / file
        try:
            if not absolute.is_file():
                continue
            if looks_binary(absolute.read_bytes()):
                binary.add(file)
        except OSError:
            continue
    return sorted(binary)


def assert_changed_text(root: Path, files: Sequence[str], binary: Set[str], violations: List[str]) -> None:
    for file in files:
        if file in binary:
            continue
        try:
            content = (root / file).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for problem in text_problems(content):
            violations.append(f"{file}: {problem}")


def assert_whitespace(root: Path, base: str | None, violations: List[str]) -> None:
    checks = []
    if base:
        checks.append(diff_arguments(base, ["--check"]))
    checks.append(["--check", "HEAD", "--"])
    for args in checks:
        result = git(root, ["diff", *args], optional=True)
        if result:
            violations.append(f"git diff --check failed:\n{result}")


def same_paths(actual: Iterable[str], allowed: Iterable[str]) -> bool:
    return sorted(actual) == sorted(allowed)


def check(root: Path) -> Tuple[str | None, List[str], List[str], List[str], List[str]]:
    base = comparison_base(root)
    changed = changed_files(root, base)
    policy_path = root / POLICY_RELPATH
    if not policy_path.is_file():
        raise GitError(f"{POLICY_RELPATH} not found at repository root")
    try:
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise GitError(f"{POLICY_RELPATH} is not valid JSON: {error}") from error

    matchers = protected_matchers(policy)
    protected_changes = [file for file in changed if is_protected(file, matchers)]
    binary_changes = existing_binary_files(root, changed, binary_files_from_diff(root, base))
    violations: List[str] = []

    assert_whitespace(root, base, violations)
    assert_changed_text(root, changed, set(binary_changes), violations)

    if policy.get("classification") not in VALID_CLASSIFICATIONS:
        violations.append(
            f"change classification must be one of A/B/C/D/E/F, got {policy.get('classification')}"
        )
    reason = policy.get("reason")
    if not isinstance(reason, str) or len(reason.strip()) < 20:
        violations.append("change-policy reason must explain the change in at least 20 characters")
    if policy.get("classification") == "F" and os.environ.get("ALLOW_BREAKING_CHANGE") != "explicit":
        violations.append("classification F requires ALLOW_BREAKING_CHANGE=explicit")

    if protected_changes:
        if POLICY_RELPATH not in changed:
            violations.append(f"{POLICY_RELPATH} must change whenever a protected runtime path changes")
        if not same_paths(protected_changes, policy.get("protectedChanges") or []):
            violations.append(
                "protectedChanges must exactly list this change's protected paths: "
                + ", ".join(protected_changes)
            )

    if binary_changes:
        if POLICY_RELPATH not in changed:
            violations.append(f"{POLICY_RELPATH} must change whenever a binary file changes")
        if not same_paths(binary_changes, policy.get("allowedBinaryChanges") or []):
            violations.append(
                "allowedBinaryChanges must exactly list this change's binary paths: "
                + ", ".join(binary_changes)
            )

    return base, changed, protected_changes, binary_changes, violations


def main(argv: Sequence[str] = ()) -> int:
    explicit = argv[1] if len(argv) > 1 and argv[0] == "--root" else None
    try:
        root = repo_root(explicit)
        base, changed, protected_changes, binary_changes, violations = check(root)
    except GitError as error:
        print(f"change policy error: {error}", file=sys.stderr)
        return 2

    if violations:
        print("Change policy violations:", file=sys.stderr)
        for item in violations:
            print(f"- {item}", file=sys.stderr)
        return 1

    print(
        f"Change policy OK ({len(changed)} changed, {len(protected_changes)} protected, "
        f"{len(binary_changes)} binary; base {base or 'working tree'})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
