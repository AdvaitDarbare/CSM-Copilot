import pytest
from fastapi import HTTPException

from main import chat_with_agent, get_account_brief
from csm_engine import get_prioritized_accounts
from csm_types import ChatMessage


def test_chat_returns_structured_morning_response():
    response = chat_with_agent(ChatMessage(message="Which accounts need attention this week?"))
    assert response.workflow == "morning"
    assert response.artifact_title == "Morning Triage"
    assert response.workflow_stages
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
