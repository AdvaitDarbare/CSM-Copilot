from __future__ import annotations

import os
import subprocess
import sys


def main() -> int:
    if not os.getenv("GEMINI_API_KEY"):
        print("GEMINI_API_KEY is required to run DeepEval workflow checks.", file=sys.stderr)
        return 1

    cmd = [sys.executable, "-m", "pytest", "tests/test_deepeval_workflows.py", "-q"]
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
