from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from csm_engine import build_account_brief, build_workflow_artifact, get_prioritized_accounts


WorkflowId = Literal["morning", "brief", "similar"]
AccountSelector = Literal["top_priority"]

EVAL_DIR = Path(__file__).resolve().parent
GOLD_CASES_PATH = EVAL_DIR / "workflow_gold_cases.json"


class WorkflowGoldCase(BaseModel):
    id: str
    workflow: WorkflowId
    prompt: str
    account_selector: AccountSelector | None = None
    required_signals: list[str]
    required_provenance: list[str]


class PreparedWorkflowCase(BaseModel):
    case: WorkflowGoldCase
    actual_output: str
    retrieval_context: list[str]
    provenance: list[str]


def load_gold_cases() -> list[WorkflowGoldCase]:
    return [WorkflowGoldCase.model_validate(raw) for raw in json.loads(GOLD_CASES_PATH.read_text())]


def _resolve_account_id(case: WorkflowGoldCase) -> str | None:
    if case.account_selector == "top_priority":
        return get_prioritized_accounts(limit=1)[0].id
    return None


def prepare_case(case: WorkflowGoldCase) -> PreparedWorkflowCase:
    account_id = _resolve_account_id(case)
    artifact = build_workflow_artifact(case.workflow, account_id)
    if artifact is None:  # pragma: no cover - defensive guard
        raise ValueError(f"Unable to build workflow artifact for case {case.id}")

    if case.workflow == "brief":
        brief = build_account_brief(artifact.account)
        actual_output = f"{brief.summary} {' '.join(brief.why_risky[:3])} Next action: {brief.recommended_next_action}"
        retrieval_context = [
            str(artifact.account.crm.model_dump(mode="json")),
            str(artifact.account.internal.model_dump(mode="json")),
            str(artifact.account.priority_reasons),
        ]
        provenance = brief.provenance
    elif case.workflow == "similar":
        shared = ", ".join(artifact.shared_patterns or ["no clear shared pattern"])
        names = ", ".join(account.name for account in artifact.similar_accounts[:3]) or "no close matches"
        actual_output = (
            f"The closest accounts to {artifact.account.crm.name} are {names}. "
            f"The recurring pattern is {shared}."
        )
        retrieval_context = [
            str(artifact.account.model_dump(mode="json")),
            str([account.model_dump(mode="json") for account in artifact.similar_accounts]),
            str(artifact.shared_patterns),
        ]
        provenance = artifact.provenance
    else:
        actual_output = (
            f"The accounts needing attention are {', '.join(account.name for account in artifact.top_accounts[:3])}. "
            f"The main pressure themes are {', '.join(artifact.top_themes)}."
        )
        retrieval_context = [
            str([account.model_dump(mode="json") for account in artifact.top_accounts]),
            str(artifact.top_themes),
        ]
        provenance = artifact.provenance

    return PreparedWorkflowCase(
        case=case,
        actual_output=actual_output,
        retrieval_context=retrieval_context,
        provenance=provenance,
    )
