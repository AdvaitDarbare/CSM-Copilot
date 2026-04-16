from csm_engine import build_account_brief, get_account_context, get_prioritized_accounts


def test_brief_provenance_starts_with_crm_and_ends_with_derived():
    account = get_prioritized_accounts(limit=1)[0]
    context = get_account_context(account.id)
    brief = build_account_brief(context)
    assert brief.provenance[0] == "CRM"
    assert brief.provenance[-1] == "derived"
    assert "renewal" in brief.provenance


def test_brief_provenance_includes_support_when_open_tickets_exist():
    for account in get_prioritized_accounts(limit=10):
        context = get_account_context(account.id)
        brief = build_account_brief(context)
        if context.crm.open_ticket_count and context.crm.open_ticket_count > 0:
            assert "support" in brief.provenance, (
                f"{context.crm.name} has tickets but no support provenance"
            )


def test_every_account_brief_can_render_safely():
    for account in get_prioritized_accounts(limit=100):
        context = get_account_context(account.id)
        brief = build_account_brief(context)
        assert brief.summary
        assert brief.recommended_next_action
        assert brief.why_risky
