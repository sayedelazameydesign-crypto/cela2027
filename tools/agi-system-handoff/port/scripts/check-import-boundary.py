"""Import-boundary guard (governance template).

The Python counterpart of the TypeScript workspace-dependency guard.  It makes
a *claim* mechanically enforceable instead of leaving it in the README:

    "dependency-free" / "stdlib only" / "no SDK leaks into core"

What it does
    Parses every ``.py`` file under the configured directories with ``ast`` and
    classifies each imported root module as:

    local            inside ``localPackages`` (or a relative import)
    stdlib           in ``sys.stdlib_module_names``
    declared         listed in ``declaredThirdParty``
    undeclared       anything else  -> violation

    Undeclared imports fail the guard, so a new third-party dependency cannot
    enter the codebase without an explicit config change in the same commit.

What it is not
    Not a layering/dependency-direction guard.  For intra-package direction
    rules use ``import-linter``; this guard only enforces the outer boundary.

Requires: Python >= 3.10 (``sys.stdlib_module_names``), git not needed.
Exit codes: 0 clean, 1 violations, 2 configuration error.
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set, Tuple

CONFIG_RELPATH = ".governance/project.json"
SKIP_DIRS = {"__pycache__", ".git", ".venv", "venv", "build", "dist", ".mypy_cache", ".ruff_cache"}


def load_config(root: Path) -> Dict:
    path = root / CONFIG_RELPATH
    if not path.is_file():
        raise SystemExit(f"config error: {CONFIG_RELPATH} not found at repository root")
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"config error: {CONFIG_RELPATH} is not valid JSON: {error}")
    scan = (config.get("scans") or {}).get("python") or {}
    include = scan.get("include") or []
    if not include:
        raise SystemExit(f"config error: scans.python.include is empty; nothing to guard")
    return {
        "include": [Path(item) for item in include],
        "localPackages": set(scan.get("localPackages") or []),
        "declaredThirdParty": set(scan.get("declaredThirdParty") or []),
    }


def python_files(root: Path, include: Sequence[Path]) -> List[Path]:
    files: List[Path] = []
    for entry in include:
        target = root / entry
        if target.is_file() and target.suffix == ".py":
            files.append(target)
            continue
        if not target.is_dir():
            continue
        for candidate in sorted(target.rglob("*.py")):
            if SKIP_DIRS.intersection(candidate.relative_to(root).parts):
                continue
            files.append(candidate)
    return files


def imported_roots(tree: ast.AST) -> Iterable[Tuple[str, int, bool]]:
    """Yield (root_module, lineno, is_relative) for every import in the file.

    Walks the whole tree, so imports inside functions, ``try`` blocks and
    conditional branches are counted too - a hidden import is still a
    dependency.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name.split(".")[0], node.lineno, False
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                yield "", node.lineno, True
                continue
            if node.module:
                yield node.module.split(".")[0], node.lineno, False


def classify(
    root: str, local_packages: Set[str], declared: Set[str]
) -> str:
    if root in local_packages:
        return "local"
    if root in sys.stdlib_module_names:
        return "stdlib"
    if root in declared:
        return "declared"
    return "undeclared"


def scan(root: Path, config: Dict) -> Tuple[List[str], Dict[str, int]]:
    violations: List[str] = []
    counts = {"files": 0, "imports": 0, "local": 0, "stdlib": 0, "declared": 0}
    for file in python_files(root, config["include"]):
        counts["files"] += 1
        relative = str(file.relative_to(root))
        try:
            tree = ast.parse(file.read_text(encoding="utf-8"), filename=relative)
        except SyntaxError as error:
            violations.append(f"{relative}:{error.lineno}: cannot parse ({error.msg})")
            continue
        for module, lineno, is_relative in imported_roots(tree):
            counts["imports"] += 1
            if is_relative:
                counts["local"] += 1
                continue
            kind = classify(module, config["localPackages"], config["declaredThirdParty"])
            if kind == "undeclared":
                violations.append(
                    f"{relative}:{lineno}: undeclared third-party import `{module}` "
                    f"(add it to scans.python.declaredThirdParty or remove it)"
                )
            else:
                counts[kind] += 1
    return violations, counts


def main(argv: Sequence[str] = ()) -> int:
    root = Path(argv[0]) if argv else Path.cwd()
    root = root.resolve()
    config = load_config(root)
    violations, counts = scan(root, config)
    if violations:
        print("Import boundary violations:", file=sys.stderr)
        for item in violations:
            print(f"- {item}", file=sys.stderr)
        return 1
    print(
        "Import boundary OK "
        f"({counts['files']} files, {counts['imports']} imports: "
        f"{counts['stdlib']} stdlib, {counts['local']} local, "
        f"{counts['declared']} declared third-party)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
