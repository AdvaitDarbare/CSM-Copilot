import os
import subprocess
import sys


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
