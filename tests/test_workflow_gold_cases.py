from evals.workflow_gold_cases import load_gold_cases, prepare_case


def test_gold_cases_cover_all_three_workflows():
    workflows = {case.workflow for case in load_gold_cases()}
    assert workflows == {"morning", "brief", "similar"}


def test_prepared_gold_cases_include_required_signals_and_provenance():
    for case in load_gold_cases():
        prepared = prepare_case(case)
        assert prepared.actual_output
        assert prepared.retrieval_context
        for signal in case.required_signals:
            assert signal.lower() in prepared.actual_output.lower()
        for source in case.required_provenance:
            assert source in prepared.provenance
