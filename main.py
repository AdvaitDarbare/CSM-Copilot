import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import google.generativeai as genai
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="AccountsOps API")

# ── HubSpot ────────────────────────────────────────────────────────────────

TOKEN = os.getenv("HUBSPOT_ACCESS_TOKEN")
if not TOKEN:
    raise RuntimeError("Missing HUBSPOT_ACCESS_TOKEN in .env")

BASE_URL = "https://api.hubapi.com/crm/v3/objects/companies"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}

PROPERTIES = [
    "name",
    "domain",
    "industry",
    "health_score",
    "risk_level",
    "renewal_date",
    "usage_trend",
    "open_ticket_count",
]

# ── Gemini ─────────────────────────────────────────────────────────────────

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_KEY:
    raise RuntimeError("Missing GEMINI_API_KEY in .env")

genai.configure(api_key=GEMINI_KEY)
gemini = genai.GenerativeModel(
    model_name="gemini-2.0-flash-lite",
    system_instruction="""You are an expert Customer Success analyst for AccountsOps.

You receive merged account data — CRM fields from HubSpot plus internal enrichment signals — and produce a concise, grounded account brief.

Rules:
- Be specific. Reference actual numbers and field values from the data.
- Do not speculate beyond what the data shows.
- why_risky should list concrete signals, not generic statements.
- key_issues should reflect the latest ticket summary and CSM note.
- recommended_next_action should be actionable and immediate.
- summary must be one sentence covering: company name, risk level, segment, plan, and renewal date.""",
)


class AccountBrief(BaseModel):
    summary: str
    why_risky: list[str]
    key_issues: list[str]
    recommended_next_action: str


# ── Internal context ───────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def load_account_context() -> dict[str, dict]:
    path = Path("account_context.json")
    if not path.exists():
        return {}
    with path.open() as f:
        records = json.load(f)
    return {str(r["hubspot_company_id"]): r for r in records}


# ── Shared helpers ─────────────────────────────────────────────────────────

def fetch_companies(limit: int = 20) -> dict[str, Any]:
    params = {
        "limit": limit,
        "properties": ",".join(PROPERTIES),
    }
    resp = requests.get(BASE_URL, headers=HEADERS, params=params, timeout=20)
    if not resp.ok:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


def build_context(company_id: str) -> dict[str, Any]:
    """Fetch HubSpot CRM record and merge with internal enrichment."""
    url = f"{BASE_URL}/{company_id}"
    params = {"properties": ",".join(PROPERTIES)}
    resp = requests.get(url, headers=HEADERS, params=params, timeout=20)
    if not resp.ok:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    item = resp.json()
    props = item.get("properties", {})

    crm = {
        "id": item.get("id"),
        "name": props.get("name"),
        "domain": props.get("domain"),
        "industry": props.get("industry"),
        "health_score": props.get("health_score"),
        "risk_level": props.get("risk_level"),
        "renewal_date": props.get("renewal_date"),
        "usage_trend": props.get("usage_trend"),
        "open_ticket_count": props.get("open_ticket_count"),
    }

    internal = load_account_context().get(company_id, {})

    # Normalise usage_trend using the more granular internal delta
    if internal:
        delta = internal.get("usage_change_30d", 0)
        if delta > 4:
            crm["usage_trend"] = "Increasing"
        elif delta < -4:
            crm["usage_trend"] = "Decreasing"
        else:
            crm["usage_trend"] = "Stable"

    return {"crm": crm, "internal": internal}


# ── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "AccountsOps API is running"}


@app.get("/accounts")
def get_accounts(limit: int = 20):
    data = fetch_companies(limit=limit)
    results = []

    for item in data.get("results", []):
        props = item.get("properties", {})
        results.append({
            "id": item.get("id"),
            "name": props.get("name"),
            "domain": props.get("domain"),
            "industry": props.get("industry"),
            "health_score": props.get("health_score"),
            "risk_level": props.get("risk_level"),
            "renewal_date": props.get("renewal_date"),
            "usage_trend": props.get("usage_trend"),
            "open_ticket_count": props.get("open_ticket_count"),
        })

    return {"results": results}


@app.get("/hubspot/raw")
def get_raw():
    params = {
        "limit": 100,
        "properties": "name,health_score,risk_level,renewal_date,usage_trend,open_ticket_count",
    }
    res = requests.get(BASE_URL, headers=HEADERS, params=params, timeout=20)
    return res.json()


@app.get("/accounts/high-risk")
def get_high_risk_accounts(limit: int = 100):
    data = fetch_companies(limit=limit)
    results = []

    for item in data.get("results", []):
        props = item.get("properties", {})
        if props.get("risk_level") == "High":
            results.append({
                "id": item.get("id"),
                "name": props.get("name"),
                "health_score": props.get("health_score"),
                "renewal_date": props.get("renewal_date"),
                "usage_trend": props.get("usage_trend"),
                "open_ticket_count": props.get("open_ticket_count"),
            })

    return {"results": results}


@app.get("/accounts/{company_id}/context")
def get_account_context(company_id: str):
    return build_context(company_id)


@app.get("/accounts/{company_id}/brief")
def get_account_brief(company_id: str) -> AccountBrief:
    ctx = build_context(company_id)
    crm = ctx["crm"]
    internal = ctx["internal"]

    if not crm.get("name"):
        raise HTTPException(status_code=404, detail="Company not found")

    account_data = json.dumps({"crm": crm, "internal": internal}, indent=2)

    response = gemini.generate_content(
        f"Generate an account brief for the following account data:\n\n{account_data}",
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=AccountBrief,
        ),
    )

    return AccountBrief.model_validate_json(response.text)
