from __future__ import annotations

import json
import os
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from csm_engine import (
    HUBSPOT_PATH,
    build_account_brief,
    build_workflow_artifact,
    classify_workflow,
    derive_shared_patterns,
    get_account_context as engine_get_account_context,
    get_prioritized_accounts,
    get_similar_accounts as engine_get_similar_accounts,
    resolve_account_from_message,
    to_chat_response,
    top_risk_themes,
)
from csm_types import AccountBrief, ChatMessage, ChatResponse

load_dotenv()

app = FastAPI(title="CSM Copilot API")

GEMINI_KEY = os.getenv("GEMINI_API_KEY")

if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)
    brief_model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=(
            "You are a Customer Success analyst. Use only the provided structured evidence. "
            "Do not invent facts. Return valid JSON matching the schema."
        ),
    )
    response_model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=(
            "You are a workflow-first CSM copilot. Write a concise answer grounded only in the provided evidence. "
            "Never mention hidden tools or speculation."
        ),
    )
else:
    brief_model = None
    response_model = None


@app.get("/")
def root():
    return {"message": "CSM Copilot API is running"}


@app.get("/hubspot/raw")
def get_raw():
    with HUBSPOT_PATH.open() as handle:
        return json.load(handle)


@app.get("/accounts")
def get_accounts(limit: int = 20):
    results = []
    for account in get_prioritized_accounts(limit=limit):
        results.append(
            {
                "id": account.id,
                "name": account.name,
                "health_score": account.health_score,
                "risk_level": account.risk_level,
                "renewal_date": account.renewal_date,
                "usage_trend": account.usage_trend,
                "open_ticket_count": account.open_ticket_count,
            }
        )
    return {"results": results}


@app.get("/accounts/prioritized")
def get_prioritized_accounts_endpoint(limit: int = 100):
    return {"results": [account.model_dump(mode="json") for account in get_prioritized_accounts(limit=limit)]}


@app.get("/accounts/high-risk")
def get_high_risk_accounts(limit: int = 100):
    results = [account for account in get_prioritized_accounts(limit=limit) if account.risk_level == "High"]
    return {"results": [account.model_dump(mode="json") for account in results[:limit]]}


@app.get("/accounts/{company_id}/context")
def get_account_context(company_id: str):
    context = engine_get_account_context(company_id)
    if not context:
        raise HTTPException(status_code=404, detail="Account not found")
    return context.model_dump(mode="json")


@app.get("/accounts/{company_id}/brief")
def get_account_brief(company_id: str) -> AccountBrief:
    context = engine_get_account_context(company_id)
    if not context:
        raise HTTPException(status_code=404, detail="Account not found")

    deterministic_brief = build_account_brief(context)
    if not brief_model:
        return deterministic_brief

    prompt_payload = {
        "workflow": "pre_call_prep",
        "crm": context.crm.model_dump(mode="json"),
        "internal": context.internal.model_dump(mode="json"),
        "priority_score": context.priority_score,
        "priority_reasons": context.priority_reasons,
    }
    try:
        response = brief_model.generate_content(
            (
                "Generate a compact account brief from the structured evidence below. "
                "Use the existing priority reasons directly. Keep key issues tied to the source evidence.\n\n"
                f"{json.dumps(prompt_payload, indent=2)}"
            ),
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                response_schema=AccountBrief,
            ),
        )
        return AccountBrief.model_validate_json(response.text)
    except Exception:
        return deterministic_brief


@app.get("/accounts/similar/{company_id}")
def get_similar_accounts(company_id: str, limit: int = 5):
    context = engine_get_account_context(company_id)
    if not context:
        raise HTTPException(status_code=404, detail="Account not found")
    results = engine_get_similar_accounts(company_id, limit=limit)
    return {
        "source_id": company_id,
        "shared_patterns": derive_shared_patterns(results),
        "results": [result.model_dump(mode="json") for result in results],
    }


def _fallback_reply(workflow: str, artifact: Any, question: str | None = None) -> str:
    if workflow == "brief" and artifact:
        return (
            f"{artifact.brief.summary} "
            f"The immediate next move is {artifact.brief.recommended_next_action.lower()}."
        )
    if workflow == "similar" and artifact:
        if not artifact.similar_accounts:
            return f"I could not find enough peer evidence for {artifact.account.crm.name} yet."
        names = ", ".join(account.name for account in artifact.similar_accounts[:3])
        patterns = ", ".join(artifact.shared_patterns or ["a broader risk pattern"])
        return f"The closest peer accounts are {names}. They share {patterns}."
    if artifact and question:
        lower = question.lower()
        if any(signal in lower for signal in ["renew", "renewing", "renewal", "30 days", "this month"]):
            renewal_lines = []
            for account in artifact.top_accounts[:5]:
                if account.renewal_date:
                    renewal_lines.append(
                        f"{account.name} ({account.renewal_date}, score {account.priority_score})"
                    )
            if renewal_lines:
                return "The nearest renewals are " + ", ".join(renewal_lines) + "."

    top_names = ", ".join(account.name for account in artifact.top_accounts[:3])
    themes = ", ".join(artifact.top_themes or top_risk_themes(artifact.top_accounts))
    return f"The accounts needing attention are {top_names}. The main pressure themes are {themes}."


def _generate_reply(workflow: str, artifact: Any, question: str) -> str:
    if not response_model or not artifact:
        return _fallback_reply(workflow, artifact, question)

    payload = artifact.model_dump(mode="json")
    try:
        response = response_model.generate_content(
            (
                f"Workflow: {workflow}\n"
                f"Question: {question}\n"
                "Write 2-4 concise sentences using only this structured evidence.\n\n"
                f"{json.dumps(payload, indent=2)}"
            )
        )
        return response.text
    except Exception:
        return _fallback_reply(workflow, artifact, question)


@app.post("/chat")
def chat_with_agent(body: ChatMessage) -> ChatResponse:
    resolved_account_id = body.account_id or resolve_account_from_message(body.message)
    account_name = None
    if resolved_account_id:
        context = engine_get_account_context(resolved_account_id)
        account_name = context.crm.name if context else None

    workflow = classify_workflow(body.message, account_name)
    if workflow in {"brief", "similar"} and not resolved_account_id:
        raise HTTPException(status_code=404, detail="Could not resolve an account from the request")

    artifact = build_workflow_artifact(workflow, resolved_account_id, body.message)
    if not artifact:
        raise HTTPException(status_code=404, detail="Unable to build workflow artifact")

    if workflow == "brief":
        try:
            artifact.brief = get_account_brief(resolved_account_id)
        except ValidationError:
            artifact.brief = build_account_brief(artifact.account)

    reply = _generate_reply(workflow, artifact, body.message)
    return to_chat_response(workflow, artifact, reply, resolved_account_id)
