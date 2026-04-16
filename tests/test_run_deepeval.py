import os
import json
import subprocess
import sys
from pathlib import Path

from evals.deepeval_runner import EvalReport, write_report


def test_run_deepeval_requires_api_key():
    env = dict(os.environ)
    env.pop("GEMINI_API_KEY", None)

    result = subprocess.run(
        [sys.executable, "run_deepeval.py"],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    assert result.returncode == 1
    assert "GEMINI_API_KEY is required to run DeepEval workflow checks." in result.stderr


def test_write_report_persists_json_payload(tmp_path: Path):
    report = EvalReport(
        generated_at="2026-04-16T00:00:00+00:00",
        model="gemini-2.5-flash",
        passed=True,
        case_count=3,
        passing_case_count=3,
        report_path="eval_reports/deepeval_workflow_report.json",
        cases=[],
    )

    output_path = write_report(report, tmp_path / "deepeval_report.json")
    saved = json.loads(output_path.read_text())

    assert output_path.exists()
    assert saved["model"] == "gemini-2.5-flash"
    assert saved["passing_case_count"] == 3
