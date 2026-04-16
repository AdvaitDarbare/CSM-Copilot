from __future__ import annotations

import os
import sys

from evals.deepeval_runner import evaluate_gold_cases, write_report


def main() -> int:
    if not os.getenv("GEMINI_API_KEY"):
        print("GEMINI_API_KEY is required to run DeepEval workflow checks.", file=sys.stderr)
        return 1

    try:
        report = evaluate_gold_cases()
    except RuntimeError as exc:
        print(f"Unable to run DeepEval workflow checks: {exc}", file=sys.stderr)
        return 1

    report_path = write_report(report)
    print(
        f"DeepEval workflow report written to {report_path} "
        f"({report.passing_case_count}/{report.case_count} cases passed)."
    )
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
