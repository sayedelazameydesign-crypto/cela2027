"""Single compatibility gate runner for Python projects (governance template).

Runs `verify[]` from .governance/project.json in order, stops at the first
failure, prints a measured summary.  Stdlib only - no runner dependency.

    python3 scripts/verify.py            # from the repository root
    python3 scripts/verify.py --root .   # explicit root

Exit codes: 0 all gates passed, 1..n the failing gate's code, 2 config error.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List

CONFIG_RELPATH = ".governance/project.json"


def repo_root(explicit: str | None) -> Path:
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
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path.cwd().resolve()


def load_steps(root: Path) -> List[Dict]:
    path = root / CONFIG_RELPATH
    if not path.is_file():
        print(f"config error: {CONFIG_RELPATH} not found at {root}", file=sys.stderr)
        raise SystemExit(2)
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        print(f"config error: {CONFIG_RELPATH} is not valid JSON: {error}", file=sys.stderr)
        raise SystemExit(2)
    steps = config.get("verify") or []
    if not steps:
        print("config error: verify[] is empty; nothing to gate", file=sys.stderr)
        raise SystemExit(2)
    return steps


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help="repository root (default: git toplevel)")
    args = parser.parse_args()

    root = repo_root(args.root)
    steps = load_steps(root)
    started = time.time()
    results: List[tuple[str, bool, float]] = []

    for step in steps:
        label = step.get("name") or step["command"]
        command = step["command"]
        print(f"\n-- {label}\n   $ {command}", flush=True)
        began = time.time()
        run = subprocess.run(command, shell=True, cwd=root)
        elapsed = (time.time() - began) * 1000
        results.append((label, run.returncode == 0, elapsed))
        if run.returncode != 0:
            print(f'\nverify FAILED at "{label}" (exit {run.returncode}).', file=sys.stderr)
            for name, ok, ms in results:
                print(f'  {"PASS" if ok else "FAIL"}  {name}  ({ms:.0f}ms)', file=sys.stderr)
            return run.returncode

    total = (time.time() - started) * 1000
    print(f"\nverify OK - {len(results)} gates in {total:.0f}ms:")
    for name, _, ms in results:
        print(f"  PASS  {name}  ({ms:.0f}ms)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
