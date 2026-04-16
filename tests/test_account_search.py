from csm_engine import get_prioritized_accounts, search_accounts


def test_search_returns_exact_match_first():
    target = get_prioritized_accounts(limit=1)[0]
    results = search_accounts(target.name)
    assert results
    assert results[0].id == target.id


def test_search_matches_substring_fragment():
    target = get_prioritized_accounts(limit=1)[0]
    fragment = target.name.split()[0]
    results = search_accounts(fragment)
    assert any(account.id == target.id for account in results)


def test_search_returns_empty_for_unknown_query():
    assert search_accounts("zzzz-no-such-company-zzzz") == []


def test_search_returns_empty_for_blank_query():
    assert search_accounts("") == []
    assert search_accounts("   ") == []


def test_search_respects_limit():
    results = search_accounts("a", limit=3)
    assert len(results) <= 3
