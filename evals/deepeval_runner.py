from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from evals.workflow_gold_cases import load_gold_cases, prepare_case


REPORT_PATH = Path("eval_reports/deepeval_workflow_report.json")


class MetricResult(BaseModel):
    name: str
    success: bool
    score: float | None = None
    reason: str | None = None


class CaseReport(BaseModel):
    id: str
    workflow: str
    prompt: str
    passed: bool
    provenance_ok: bool
    required_signals_ok: bool
    actual_output: str
    metrics: list[MetricResult]


class EvalReport(BaseModel):
    generated_at: str
    model: str
    passed: bool
    case_count: int
    passing_case_count: int
    report_path: str
    cases: list[CaseReport]


def _load_deepeval_runtime():
    try:
        import google.generativeai as google_genai
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"google.generativeai import failed: {exc}") from exc

    try:
        from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric, HallucinationMetric
        from deepeval.models.base_model import DeepEvalBaseLLM
        from deepeval.test_case import LLMTestCase
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"DeepEval API mismatch: {exc}") from exc

    return {
        "google_genai": google_genai,
        "AnswerRelevancyMetric": AnswerRelevancyMetric,
        "FaithfulnessMetric": FaithfulnessMetric,
        "HallucinationMetric": HallucinationMetric,
        "DeepEvalBaseLLM": DeepEvalBaseLLM,
        "LLMTestCase": LLMTestCase,
    }


def _build_judge(runtime: dict[str, Any], model_name: str = "gemini-2.5-flash"):
    google_genai = runtime["google_genai"]
    DeepEvalBaseLLM = runtime["DeepEvalBaseLLM"]

    class GeminiJudge(DeepEvalBaseLLM):
        def __init__(self):
            google_genai.configure(api_key=os.environ["GEMINI_API_KEY"])
            self.model = google_genai.GenerativeModel(model_name=model_name)
            self.model_name = model_name

        def load_model(self):
            return self.model

        def generate(self, prompt: str, schema=None):
            response = self.model.generate_content(prompt)
            return response.text

        async def a_generate(self, prompt: str, schema=None):
            return self.generate(prompt, schema=schema)

        def get_model_name(self):
            return self.model_name

    return GeminiJudge()


def write_report(report: EvalReport, report_path: Path = REPORT_PATH) -> Path:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report.model_dump(mode="json"), indent=2))
    return report_path


def evaluate_gold_cases(model_name: str = "gemini-2.5-flash") -> EvalReport:
    runtime = _load_deepeval_runtime()
    judge = _build_judge(runtime, model_name=model_name)

    AnswerRelevancyMetric = runtime["AnswerRelevancyMetric"]
    FaithfulnessMetric = runtime["FaithfulnessMetric"]
    HallucinationMetric = runtime["HallucinationMetric"]
    LLMTestCase = runtime["LLMTestCase"]

    case_reports: list[CaseReport] = []

    for gold_case in load_gold_cases():
        prepared = prepare_case(gold_case)
        llm_case = LLMTestCase(
            input=gold_case.prompt,
            actual_output=prepared.actual_output,
            retrieval_context=prepared.retrieval_context,
        )
        metrics = [
            AnswerRelevancyMetric(model=judge, threshold=0.5),
            FaithfulnessMetric(model=judge, threshold=0.5),
            HallucinationMetric(model=judge, threshold=0.5),
        ]
        metric_reports: list[MetricResult] = []

        for metric in metrics:
            metric.measure(llm_case)
            metric_reports.append(
                MetricResult(
                    name=metric.__class__.__name__,
                    success=metric.success,
                    score=getattr(metric, "score", None),
                    reason=getattr(metric, "reason", None),
                )
            )

        required_signals_ok = all(signal.lower() in prepared.actual_output.lower() for signal in gold_case.required_signals)
        provenance_ok = all(source in prepared.provenance for source in gold_case.required_provenance)
        passed = required_signals_ok and provenance_ok and all(metric.success for metric in metric_reports)

        case_reports.append(
            CaseReport(
                id=gold_case.id,
                workflow=gold_case.workflow,
                prompt=gold_case.prompt,
                passed=passed,
                provenance_ok=provenance_ok,
                required_signals_ok=required_signals_ok,
                actual_output=prepared.actual_output,
                metrics=metric_reports,
            )
        )

    passing_case_count = sum(1 for case in case_reports if case.passed)
    return EvalReport(
        generated_at=datetime.now(UTC).isoformat(),
        model=model_name,
        passed=passing_case_count == len(case_reports),
        case_count=len(case_reports),
        passing_case_count=passing_case_count,
        report_path=str(REPORT_PATH),
        cases=case_reports,
    )
