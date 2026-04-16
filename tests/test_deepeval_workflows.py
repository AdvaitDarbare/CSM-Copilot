import os

import pytest

from evals.workflow_gold_cases import load_gold_cases, prepare_case

pytest.importorskip("deepeval")
google_genai = pytest.importorskip("google.generativeai")

if not os.getenv("GEMINI_API_KEY"):
    pytest.skip("GEMINI_API_KEY is required to run DeepEval workflow checks", allow_module_level=True)

try:
    from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric, HallucinationMetric
    from deepeval.models.base_model import DeepEvalBaseLLM
    from deepeval.test_case import LLMTestCase
except Exception as exc:  # pragma: no cover - compatibility guard
    pytest.skip(f"DeepEval API mismatch: {exc}", allow_module_level=True)


class GeminiJudge(DeepEvalBaseLLM):
    def __init__(self, model_name: str = "gemini-2.5-flash"):
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


@pytest.fixture(scope="module")
def judge():
    return GeminiJudge()


def _run_case(gold_case, judge):
    prepared = prepare_case(gold_case)
    case = LLMTestCase(
        input=gold_case.prompt,
        actual_output=prepared.actual_output,
        retrieval_context=prepared.retrieval_context,
    )

    relevancy = AnswerRelevancyMetric(model=judge, threshold=0.5)
    faithfulness = FaithfulnessMetric(model=judge, threshold=0.5)
    hallucination = HallucinationMetric(model=judge, threshold=0.5)

    relevancy.measure(case)
    faithfulness.measure(case)
    hallucination.measure(case)

    assert relevancy.success
    assert faithfulness.success
    assert hallucination.success

    for signal in gold_case.required_signals:
        assert signal.lower() in prepared.actual_output.lower()
    for source in gold_case.required_provenance:
        assert source in prepared.provenance

@pytest.mark.parametrize("gold_case", load_gold_cases(), ids=lambda case: case.id)
def test_workflow_gold_case_passes_deepeval(gold_case, judge):
    _run_case(gold_case, judge)
