import json
import os
from datetime import date
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
    model_name="gemini-2.5-flash",
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


# ── Priority scoring ───────────────────────────────────────────────────────

def priority_score(crm: dict, internal: dict) -> tuple[int, list[str]]:
    """
    Return (score, reasons) — higher score = more urgent.

    Weighted across CRM + operational signals. risk_level is intentionally
    low-weight since it is already a derived field — raw signals drive the score.
    """
    score = 0
    reasons = []

    # ── Health score (25 pts) ─────────────────────────────────────────────
    try:
        hs = int(crm.get("health_score") or 100)
        pts = min(round((100 - hs) / 4), 25)
        score += pts
        if hs <= 30:
            reasons.append(f"Critical health score ({hs})")
        elif hs <= 50:
            reasons.append(f"Low health score ({hs})")
    except (ValueError, TypeError):
        hs = None

    # ── Renewal urgency (20 pts, non-linear) ──────────────────────────────
    renewal = crm.get("renewal_date")
    if renewal:
        try:
            days = (date.fromisoformat(renewal) - date.today()).days
            if days <= 14:
                score += 20
                reasons.append(f"Renewal in {days} days — critical")
            elif days <= 30:
                score += 15
                reasons.append(f"Renewal in {days} days")
            elif days <= 60:
                score += 8
                reasons.append(f"Renewal in {days} days")
            elif days <= 90:
                score += 4
                reasons.append(f"Renewal in {days} days")
        except ValueError:
            pass

    # ── Usage change 30d (15 pts) ─────────────────────────────────────────
    delta = internal.get("usage_change_30d", 0)
    if delta < -15:
        score += 15
        reasons.append(f"Usage down {abs(delta)}% (30d)")
    elif delta < -8:
        score += 10
        reasons.append(f"Usage down {abs(delta)}% (30d)")
    elif delta < -3:
        score += 5
        reasons.append(f"Usage down {abs(delta)}% (30d)")

    # ── Escalation + ticket amplification (15 pts base) ──────────────────
    escalation = internal.get("open_escalation", False)
    try:
        tickets = int(crm.get("open_ticket_count") or 0)
    except (ValueError, TypeError):
        tickets = 0

    if escalation:
        pts = min(15 + tickets, 20)
        score += pts
        reasons.append(f"{tickets} open tickets (escalated)")
    elif tickets >= 5:
        score += min(tickets * 2, 10)
        reasons.append(f"{tickets} open support tickets")
    elif tickets > 0:
        score += min(tickets * 2, 10)

    # ── Engagement status (10 pts) ────────────────────────────────────────
    engagement = internal.get("engagement_status", "")
    if engagement == "At Risk":
        score += 10
        reasons.append("Engagement: At Risk")
    elif engagement == "Declining":
        score += 7
        reasons.append("Engagement declining")
    elif engagement == "Neutral":
        score += 3

    # ── Renewal confidence (10 pts) ───────────────────────────────────────
    confidence = internal.get("renewal_confidence", "")
    if confidence == "At Risk":
        score += 10
        reasons.append("Renewal confidence: At Risk")
    elif confidence == "Monitor":
        score += 5
        reasons.append("Renewal confidence: Monitor")

    # ── Days since last touch (5 pts) ─────────────────────────────────────
    last_touch = internal.get("days_since_last_touch", 0)
    if last_touch > 21:
        score += 5
        reasons.append(f"No CSM touch in {last_touch} days")
    elif last_touch > 14:
        score += 3
        reasons.append(f"No CSM touch in {last_touch} days")

    # ── ARR weighting — revenue-aware boost ───────────────────────────────
    arr = internal.get("arr", 0)
    if arr >= 200000:
        score += 8
        reasons.append(f"High-value account (${arr:,} ARR)")
    elif arr >= 100000:
        score += 5
        reasons.append(f"High-value account (${arr:,} ARR)")
    elif arr >= 50000:
        score += 2

    # ── Risk level (5–10 pts, light signal only) ──────────────────────────
    risk = crm.get("risk_level", "")
    if risk == "High":
        score += 10
    elif risk == "Medium":
        score += 5

    # ── Fallback — always surface at least one reason ─────────────────────
    if not reasons:
        signals = []
        if hs is not None:
            signals.append(f"Health score {hs}")
        usage_trend = crm.get("usage_trend", "")
        if usage_trend:
            signals.append(f"{usage_trend.lower()} usage")
        reasons.append(", ".join(signals) if signals else "No major risk signals detected")

    return score, reasons


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


@app.get("/accounts/prioritized")
def get_prioritized_accounts(limit: int = 100):
    data = fetch_companies(limit=limit)
    context_map = load_account_context()
    results = []

    for item in data.get("results", []):
        props = item.get("properties", {})
        company_id = item.get("id")
        internal = context_map.get(company_id, {})

        crm = {
            "id": company_id,
            "name": props.get("name"),
            "health_score": props.get("health_score"),
            "risk_level": props.get("risk_level"),
            "renewal_date": props.get("renewal_date"),
            "open_ticket_count": props.get("open_ticket_count"),
        }

        # Normalise usage_trend
        delta = internal.get("usage_change_30d", 0)
        if delta > 4:
            crm["usage_trend"] = "Increasing"
        elif delta < -4:
            crm["usage_trend"] = "Decreasing"
        else:
            crm["usage_trend"] = props.get("usage_trend", "Stable")

        score, reasons = priority_score(crm, internal)

        results.append({
            "id": company_id,
            "name": props.get("name"),
            "segment": internal.get("segment"),
            "plan_tier": internal.get("plan_tier"),
            "arr": internal.get("arr"),
            "risk_level": props.get("risk_level"),
            "health_score": props.get("health_score"),
            "renewal_date": props.get("renewal_date"),
            "usage_trend": crm["usage_trend"],
            "open_ticket_count": props.get("open_ticket_count"),
            "renewal_confidence": internal.get("renewal_confidence"),
            "engagement_status": internal.get("engagement_status"),
            "owner_name": internal.get("owner_name"),
            "priority_score": score,
            "priority_reasons": reasons,
        })

    results.sort(key=lambda x: x["priority_score"], reverse=True)
    return {"results": results}


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

    score, reasons = priority_score(crm, internal)

    prompt_data = {
        "crm": crm,
        "internal": internal,
        "priority_score": score,
        "priority_reasons": reasons,
    }
    account_data = json.dumps(prompt_data, indent=2)

    response = gemini.generate_content(
        (
            "Generate an account brief for the following account data.\n"
            "The priority_reasons field contains pre-computed risk signals — "
            "use them directly in why_risky rather than re-deriving them.\n\n"
            f"{account_data}"
        ),
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=AccountBrief,
        ),
    )

    return AccountBrief.model_validate_json(response.text)
