import pytest
from fastapi import HTTPException

from main import chat_with_agent, get_account_brief
from csm_engine import get_prioritized_accounts, workflow_stages
from csm_types import ChatMessage


def test_chat_returns_structured_morning_response():
    response = chat_with_agent(ChatMessage(message="Which accounts need attention this week?"))
    assert response.workflow == "morning"
    assert response.artifact_title == "Morning Triage"
    assert response.workflow_stages
    assert response.provenance
    assert response.triage_accounts


def test_chat_rejects_unresolved_account_specific_request():
    with pytest.raises(HTTPException) as exc:
        chat_with_agent(ChatMessage(message="Tell me about a made up account named Foo Bar Baz"))

    assert exc.value.status_code == 404
    assert exc.value.detail == "Could not resolve an account from the request"


def test_brief_endpoint_returns_valid_brief_without_model_key_requirement():
    account_id = get_prioritized_accounts(limit=1)[0].id
    brief = get_account_brief(account_id)
    assert brief.summary
    assert brief.why_risky
    assert brief.recommended_next_action


def test_chat_returns_structured_brief_response_for_resolved_account():
    account = get_prioritized_accounts(limit=1)[0]
    response = chat_with_agent(ChatMessage(message=f"Tell me about {account.name}"))

    assert response.workflow == "brief"
    assert response.account_id == account.id
    assert response.artifact_title == "Pre-Call Brief"
    assert response.workflow_stages == workflow_stages("brief")
    assert response.provenance == ["CRM", "support", "usage", "CSM activity", "renewal", "derived"]
    assert response.brief_snapshot is not None
    assert response.brief_snapshot.id == account.id
    assert response.brief_snapshot.recommended_next_action
    assert response.similar_accounts is None
    assert response.triage_accounts is None


def test_chat_returns_structured_similar_response_for_resolved_account():
    account = get_prioritized_accounts(limit=1)[0]
    response = chat_with_agent(ChatMessage(message=f"Is {account.name} an isolated problem or part of a broader pattern?"))

    assert response.workflow == "similar"
    assert response.account_id == account.id
    assert response.artifact_title == "Similar Risk Pattern Analysis"
    assert response.workflow_stages == workflow_stages("similar")
    assert response.provenance == ["CRM", "support", "usage", "derived"]
    assert response.similar_accounts
    assert response.brief_snapshot is None
    assert response.triage_accounts is None
    assert response.similar_accounts[0].top_reason
