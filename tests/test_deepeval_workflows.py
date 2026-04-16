import os

import pytest

from csm_engine import build_account_brief, build_workflow_artifact, get_prioritized_accounts

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


def test_pre_call_brief_passes_deepeval(judge):
    top = get_prioritized_accounts(limit=1)[0]
    artifact = build_workflow_artifact("brief", top.id)
    brief = build_account_brief(artifact.account)

    case = LLMTestCase(
        input=f"I have a call with {artifact.account.crm.name} in 20 minutes. What should I know?",
        actual_output=f"{brief.summary} {' '.join(brief.why_risky[:3])} Next action: {brief.recommended_next_action}",
        retrieval_context=[
            str(artifact.account.crm.model_dump(mode="json")),
            str(artifact.account.internal.model_dump(mode="json")),
            str(artifact.account.priority_reasons),
        ],
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


def test_triage_summary_passes_deepeval(judge):
    artifact = build_workflow_artifact("morning")
    summary = (
        f"The accounts needing attention are {', '.join(account.name for account in artifact.top_accounts[:3])}. "
        f"The main pressure themes are {', '.join(artifact.top_themes)}."
    )
    case = LLMTestCase(
        input="Which accounts need attention this week?",
        actual_output=summary,
        retrieval_context=[
            str([account.model_dump(mode="json") for account in artifact.top_accounts]),
            str(artifact.top_themes),
        ],
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


def test_similar_pattern_summary_passes_deepeval(judge):
    top = get_prioritized_accounts(limit=1)[0]
    artifact = build_workflow_artifact("similar", top.id)
    shared = ", ".join(artifact.shared_patterns or ["no clear shared pattern"])
    names = ", ".join(account.name for account in artifact.similar_accounts[:3]) or "no close matches"
    summary = (
        f"The closest accounts to {artifact.account.crm.name} are {names}. "
        f"The recurring pattern is {shared}."
    )
    case = LLMTestCase(
        input=f"Is {artifact.account.crm.name} an isolated problem or part of a broader pattern?",
        actual_output=summary,
        retrieval_context=[
            str(artifact.account.model_dump(mode="json")),
            str([account.model_dump(mode="json") for account in artifact.similar_accounts]),
            str(artifact.shared_patterns),
        ],
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
