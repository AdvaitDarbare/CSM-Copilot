"""
sync_context_engine.py

Optional local materialization step:
  1. Generates structured synthetic source datasets from hubspot_companies.json
  2. Derives structured account intelligence records
  3. Writes a local snapshot for inspection or downstream loading

The serving API now reads directly from the structured local engine and no
longer depends on account_context.json.
"""

from __future__ import annotations

import json
from pathlib import Path

from csm_engine import get_account_context, get_prioritized_accounts, materialize_source_data

SNAPSHOT_PATH = Path("structured_account_snapshot.json")


def sync():
    materialize_source_data()
    prioritized = get_prioritized_accounts(limit=100)
    snapshot = []
    for account in prioritized:
        context = get_account_context(account.id)
        if not context:
            continue
        snapshot.append(
            {
                "hubspot_company_id": account.id,
                "company_name": account.name,
                "priority_score": account.priority_score,
                "priority_reasons": account.priority_reasons,
                "context": context.model_dump(mode="json"),
            }
        )

    with SNAPSHOT_PATH.open("w") as handle:
        json.dump(snapshot, handle, indent=2)

    print(f"Wrote {len(snapshot)} structured account records to {SNAPSHOT_PATH}")


if __name__ == "__main__":
    sync()
