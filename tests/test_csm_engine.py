from csm_engine import (
    SOURCE_DIR,
    build_account_brief,
    build_workflow_artifact,
    compute_priority_score,
    derive_account_features,
    get_account_context,
    get_prioritized_accounts,
    get_similar_accounts,
    load_workspace,
    materialize_source_data,
)


def test_structured_source_files_exist():
    materialize_source_data()
    expected = {
        "support_tickets.json",
        "product_usage_daily.json",
        "csm_activities.json",
        "onboarding_milestones.json",
        "renewal_signals.json",
    }
    assert expected.issubset({path.name for path in SOURCE_DIR.iterdir()})


def test_prioritized_accounts_are_ranked_descending():
    accounts = get_prioritized_accounts(limit=10)
    assert len(accounts) == 10
    assert accounts[0].priority_score >= accounts[-1].priority_score
    assert all(account.priority_reasons for account in accounts)


def test_account_context_contains_structured_derived_fields():
    account = get_prioritized_accounts(limit=1)[0]
    context = get_account_context(account.id)
    assert context is not None
    assert context.internal.usage_change_30d is not None
    assert context.internal.engagement_status in {"Healthy", "Neutral", "Declining", "At Risk"}
    assert context.internal.recommended_next_action
    assert context.priority_reasons


def test_brief_uses_computed_priority_reasons():
    account = get_prioritized_accounts(limit=1)[0]
    context = get_account_context(account.id)
    brief = build_account_brief(context)
    assert brief.why_risky[0] == context.priority_reasons[0]
    assert brief.recommended_next_action == context.internal.recommended_next_action


def test_similar_accounts_have_shared_evidence_or_strong_similarity():
    account = get_prioritized_accounts(limit=1)[0]
    context = get_account_context(account.id)
    similar = get_similar_accounts(account.id, limit=5)
    assert similar
    for peer in similar:
        overlap = set(context.priority_reasons[:4]).intersection(peer.priority_reasons[:4])
        assert peer.similarity >= 0.72 or overlap


def test_workflow_artifacts_are_typed_and_complete():
    top = get_prioritized_accounts(limit=1)[0]
    triage_artifact = build_workflow_artifact("morning")
    brief_artifact = build_workflow_artifact("brief", top.id)
    similar_artifact = build_workflow_artifact("similar", top.id)

    assert triage_artifact.workflow == "morning"
    assert brief_artifact.workflow == "brief"
    assert similar_artifact.workflow == "similar"
    assert brief_artifact.brief.summary
    assert similar_artifact.stages
