import json
import os
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import google.generativeai as genai
import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="CSM Copilot API")

# ── Postgres ───────────────────────────────────────────────────────────────

DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/csm_copilot")


def get_db():
    return psycopg2.connect(DB_URL, cursor_factory=psycopg2.extras.RealDictCursor)

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


# ── Chat agent models ──────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    message: str
    account_id: str | None = None


class TriageAccountCard(BaseModel):
    id: str
    name: str
    risk_level: str
    priority_score: int
    renewal_date: str | None
    top_reason: str
    arr: float | None = None


class SimilarAccountCard(BaseModel):
    id: str
    name: str
    similarity: float
    risk_level: str | None
    health_score: str | None
    renewal_date: str | None
    top_reason: str


class ChatResponse(BaseModel):
    reply: str
    workflow: str  # "morning" | "brief" | "similar" | "freeform"
    account_id: str | None = None
    # Generative UI data — populated based on workflow
    triage_accounts: list[TriageAccountCard] | None = None
    brief_snapshot: dict | None = None   # key account fields for inline card
    similar_accounts: list[SimilarAccountCard] | None = None


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
    return {"message": "CSM Copilot API is running"}


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
    """Returns all accounts ranked by priority_score from Postgres context engine."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                hubspot_company_id,
                company_name,
                crm_snapshot,
                internal_context,
                priority_score,
                priority_reasons,
                last_refreshed
            FROM accounts
            ORDER BY priority_score DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
    finally:
        conn.close()

    results = []
    for row in rows:
        crm = row["crm_snapshot"]
        internal = row["internal_context"]
        results.append({
            "id": row["hubspot_company_id"],
            "name": row["company_name"],
            "segment": internal.get("segment"),
            "plan_tier": internal.get("plan_tier"),
            "arr": internal.get("arr"),
            "risk_level": crm.get("risk_level"),
            "health_score": crm.get("health_score"),
            "renewal_date": crm.get("renewal_date"),
            "usage_trend": crm.get("usage_trend"),
            "open_ticket_count": crm.get("open_ticket_count"),
            "renewal_confidence": internal.get("renewal_confidence"),
            "engagement_status": internal.get("engagement_status"),
            "owner_name": internal.get("owner_name"),
            "priority_score": row["priority_score"],
            "priority_reasons": row["priority_reasons"],
            "last_refreshed": row["last_refreshed"].isoformat() if row["last_refreshed"] else None,
        })

    return {"results": results}


@app.get("/accounts/high-risk")
def get_high_risk_accounts(limit: int = 100):
    """Returns accounts with risk_level = High, ranked by priority_score."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                hubspot_company_id,
                company_name,
                crm_snapshot,
                internal_context,
                priority_score,
                priority_reasons
            FROM accounts
            WHERE crm_snapshot->>'risk_level' = 'High'
            ORDER BY priority_score DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
    finally:
        conn.close()

    results = []
    for row in rows:
        crm = row["crm_snapshot"]
        internal = row["internal_context"]
        results.append({
            "id": row["hubspot_company_id"],
            "name": row["company_name"],
            "health_score": crm.get("health_score"),
            "renewal_date": crm.get("renewal_date"),
            "usage_trend": crm.get("usage_trend"),
            "open_ticket_count": crm.get("open_ticket_count"),
            "segment": internal.get("segment"),
            "arr": internal.get("arr"),
            "priority_score": row["priority_score"],
            "priority_reasons": row["priority_reasons"],
        })

    return {"results": results}


@app.get("/accounts/similar/{company_id}")
def get_similar_accounts(company_id: str, limit: int = 5):
    """Returns accounts with the most similar risk profile via pgvector cosine similarity."""
    conn = get_db()
    try:
        cur = conn.cursor()

        cur.execute(
            "SELECT embedding FROM account_embeddings WHERE hubspot_company_id = %s",
            (company_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No embedding found for this account — run sync first")

        embedding = row["embedding"]

        cur.execute("""
            SELECT
                ae.hubspot_company_id,
                a.company_name,
                a.crm_snapshot,
                a.internal_context,
                a.priority_score,
                a.priority_reasons,
                1 - (ae.embedding <=> %s::vector) AS similarity
            FROM account_embeddings ae
            JOIN accounts a USING (hubspot_company_id)
            WHERE ae.hubspot_company_id != %s
            ORDER BY ae.embedding <=> %s::vector
            LIMIT %s
        """, (embedding, company_id, embedding, limit))
        rows = cur.fetchall()
    finally:
        conn.close()

    results = []
    for row in rows:
        crm = row["crm_snapshot"]
        internal = row["internal_context"]
        results.append({
            "id": row["hubspot_company_id"],
            "name": row["company_name"],
            "similarity": round(float(row["similarity"]), 4),
            "risk_level": crm.get("risk_level"),
            "health_score": crm.get("health_score"),
            "renewal_date": crm.get("renewal_date"),
            "usage_trend": crm.get("usage_trend"),
            "segment": internal.get("segment"),
            "arr": internal.get("arr"),
            "priority_score": row["priority_score"],
            "priority_reasons": row["priority_reasons"],
        })

    return {"source_id": company_id, "results": results}


@app.get("/accounts/{company_id}/context")
def get_account_context(company_id: str):
    """Returns the merged CRM + internal context from Postgres."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT merged_context, priority_score, priority_reasons FROM accounts WHERE hubspot_company_id = %s",
            (company_id,)
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Account not found in context engine")

    return {
        **row["merged_context"],
        "priority_score": row["priority_score"],
        "priority_reasons": row["priority_reasons"],
    }


@app.get("/accounts/{company_id}/brief")
def get_account_brief(company_id: str) -> AccountBrief:
    """Generates a Gemini brief using pre-synced Postgres context."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT merged_context, priority_score, priority_reasons FROM accounts WHERE hubspot_company_id = %s",
            (company_id,)
        )
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Account not found in context engine")

    merged = row["merged_context"]
    crm = merged.get("crm", {})

    if not crm.get("name"):
        raise HTTPException(status_code=404, detail="Company not found")

    prompt_data = {
        "crm": crm,
        "internal": merged.get("internal", {}),
        "priority_score": row["priority_score"],
        "priority_reasons": row["priority_reasons"],
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


# ── Chat agent ─────────────────────────────────────────────────────────────

csm_agent = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    system_instruction="""You are a CSM Copilot AI agent for AccountsOps.

You have access to live account data from HubSpot and an internal context engine.

Your job is to answer questions from Customer Success Managers about their book of business.

Intent classification:
- "morning" → user wants triage/prioritization (who to focus on, what's urgent)
- "brief" → user wants info about a specific account (call prep, what's happening)
- "similar" → user wants to find accounts with matching risk profiles
- "freeform" → any other question

Rules:
- Be concise and actionable. CSMs are busy.
- Reference actual data — names, scores, dates, ARR.
- Bold the most important pieces of information using **markdown**.
- Never fabricate data. If data is missing, say so.
- For morning/triage intent, briefly summarize the top 2-3 accounts.
- For brief intent, focus on risk signals + next action.
- For similar intent, name the closest matches and the shared pattern.
- End every response by indicating which artifact was updated on the right.""",
)


def _get_account_from_db(account_id: str) -> dict | None:
    """Fetch a single account from Postgres."""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """SELECT hubspot_company_id, company_name, crm_snapshot,
                      internal_context, priority_score, priority_reasons
               FROM accounts WHERE hubspot_company_id = %s""",
            (account_id,),
        )
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception:
        return None


def _get_prioritized_from_db(limit: int = 8) -> list[dict]:
    """Fetch top prioritized accounts from Postgres."""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """SELECT hubspot_company_id, company_name, crm_snapshot,
                      internal_context, priority_score, priority_reasons
               FROM accounts ORDER BY priority_score DESC LIMIT %s""",
            (limit,),
        )
        rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _classify_intent(message: str, account_name: str | None = None) -> str:
    lower = message.lower()
    brief_signals = ["call", "brief", "prep", "what should i know", "tell me about",
                     "what's happening", "status of", "how is", "update on"]
    similar_signals = ["similar", "same pattern", "like ", "compare", "other accounts",
                       "cluster", "isolated", "pattern"]
    morning_signals = ["morning", "focus", "today", "priority", "triage", "urgent",
                       "should i focus", "start", "first"]

    if any(s in lower for s in similar_signals):
        return "similar"
    if any(s in lower for s in brief_signals) or (account_name and account_name.lower() in lower):
        return "brief"
    if any(s in lower for s in morning_signals):
        return "morning"
    return "freeform"


def _resolve_account_from_message(message: str, accounts: list[dict]) -> str | None:
    lower = message.lower()
    for a in accounts:
        name = a.get("company_name", "")
        if name.lower() in lower:
            return a["hubspot_company_id"]
        # token match (e.g. "Alexander" matches "Alexander-Jordan")
        tokens = [t for t in name.lower().split() if len(t) >= 4]
        if sum(1 for t in tokens if t in lower) >= 2:
            return a["hubspot_company_id"]
    return None


@app.post("/chat")
def chat_with_agent(body: ChatMessage) -> ChatResponse:
    """
    Agent endpoint — uses Gemini + live data to answer CSM questions.
    Returns a structured response with reply text + generative UI data.
    """
    # 1. Load prioritized accounts for context
    prioritized = _get_prioritized_from_db(limit=10)

    # Try to resolve account from message
    resolved_account_id = body.account_id
    if not resolved_account_id and prioritized:
        resolved_account_id = _resolve_account_from_message(body.message, prioritized)
    if not resolved_account_id and prioritized:
        resolved_account_id = prioritized[0]["hubspot_company_id"]

    # 2. Classify intent
    featured_name = None
    if resolved_account_id:
        for a in prioritized:
            if a["hubspot_company_id"] == resolved_account_id:
                featured_name = a.get("company_name")
                break
    intent = _classify_intent(body.message, featured_name)

    # 3. Gather relevant data
    account_row = _get_account_from_db(resolved_account_id) if resolved_account_id else None
    account_brief_data = None
    similar_rows = []

    if intent == "brief" and resolved_account_id:
        # Try to get Gemini-generated brief
        try:
            account_brief_data = get_account_brief(resolved_account_id).model_dump()
        except Exception:
            if account_row:
                crm = account_row.get("crm_snapshot", {})
                internal = account_row.get("internal_context", {})
                account_brief_data = {
                    "summary": f"{account_row['company_name']} is a risk account.",
                    "why_risky": account_row.get("priority_reasons", [])[:3],
                    "key_issues": [internal.get("latest_ticket_summary", "")],
                    "recommended_next_action": internal.get("recommended_next_action", "Review account."),
                }

    if intent == "similar" and resolved_account_id:
        try:
            similar_resp = get_similar_accounts(resolved_account_id, limit=4)
            similar_rows = similar_resp.get("results", [])
        except Exception:
            pass

    # 4. Build context string for Gemini
    context_parts = []

    if prioritized:
        top_accounts_summary = "\n".join([
            f"- {a['company_name']}: score={a['priority_score']}, "
            f"risk={a.get('crm_snapshot',{}).get('risk_level','?')}, "
            f"renewal={a.get('crm_snapshot',{}).get('renewal_date','?')}, "
            f"reasons={'; '.join(a.get('priority_reasons',[])[:2])}"
            for a in prioritized[:5]
        ])
        context_parts.append(f"TOP PRIORITY ACCOUNTS:\n{top_accounts_summary}")

    if account_row:
        crm = account_row.get("crm_snapshot", {})
        internal = account_row.get("internal_context", {})
        context_parts.append(
            f"\nFEATURED ACCOUNT: {account_row['company_name']}\n"
            f"Risk: {crm.get('risk_level')} | Health: {crm.get('health_score')} | "
            f"Renewal: {crm.get('renewal_date')} | ARR: {internal.get('arr')}\n"
            f"Tickets: {crm.get('open_ticket_count')} | Engagement: {internal.get('engagement_status')}\n"
            f"Owner: {internal.get('owner_name')} | Segment: {internal.get('segment')}\n"
            f"Latest issue: {internal.get('latest_ticket_summary','none')}\n"
            f"CSM note: {internal.get('recent_csm_note','none')}\n"
            f"Priority score: {account_row['priority_score']}\n"
            f"Reasons: {'; '.join(account_row.get('priority_reasons',[]))}"
        )

    if account_brief_data:
        context_parts.append(
            f"\nACCOUNT BRIEF:\n"
            f"Summary: {account_brief_data['summary']}\n"
            f"Why risky: {', '.join(account_brief_data['why_risky'])}\n"
            f"Next action: {account_brief_data['recommended_next_action']}"
        )

    if similar_rows:
        sim_summary = "\n".join([
            f"- {s['name']}: similarity={s['similarity']}, risk={s.get('risk_level','?')}, "
            f"reasons={'; '.join(s.get('priority_reasons',[])[:2])}"
            for s in similar_rows[:3]
        ])
        context_parts.append(f"\nSIMILAR ACCOUNTS:\n{sim_summary}")

    full_context = "\n\n".join(context_parts)
    prompt = f"Context:\n{full_context}\n\nCSM question: {body.message}"

    # 5. Generate reply with Gemini
    try:
        response = csm_agent.generate_content(prompt)
        reply_text = response.text
    except Exception as e:
        reply_text = f"I encountered an error generating the response: {str(e)}"

    # 6. Build generative UI data
    triage_accounts = None
    brief_snapshot = None
    similar_accounts_out = None

    if intent == "morning" or intent == "freeform":
        triage_accounts = []
        for a in prioritized[:4]:
            crm = a.get("crm_snapshot", {})
            internal = a.get("internal_context", {})
            triage_accounts.append(TriageAccountCard(
                id=a["hubspot_company_id"],
                name=a["company_name"],
                risk_level=crm.get("risk_level", "Unknown"),
                priority_score=a["priority_score"],
                renewal_date=crm.get("renewal_date"),
                top_reason=a.get("priority_reasons", [""])[0],
                arr=internal.get("arr"),
            ))

    if (intent == "brief") and account_row:
        crm = account_row.get("crm_snapshot", {})
        internal = account_row.get("internal_context", {})
        brief_snapshot = {
            "id": resolved_account_id,
            "name": account_row["company_name"],
            "risk_level": crm.get("risk_level"),
            "health_score": crm.get("health_score"),
            "renewal_date": crm.get("renewal_date"),
            "arr": internal.get("arr"),
            "open_tickets": crm.get("open_ticket_count"),
            "engagement": internal.get("engagement_status"),
            "owner": internal.get("owner_name"),
            "segment": internal.get("segment"),
            "priority_score": account_row["priority_score"],
            "recommended_next_action": account_brief_data.get("recommended_next_action") if account_brief_data else None,
            "top_reason": account_row.get("priority_reasons", [""])[0],
        }

    if intent == "similar" and similar_rows:
        similar_accounts_out = []
        for s in similar_rows[:4]:
            similar_accounts_out.append(SimilarAccountCard(
                id=s["id"],
                name=s["name"],
                similarity=s["similarity"],
                risk_level=s.get("risk_level"),
                health_score=s.get("health_score"),
                renewal_date=s.get("renewal_date"),
                top_reason=s.get("priority_reasons", [""])[0],
            ))

    return ChatResponse(
        reply=reply_text,
        workflow=intent if intent != "freeform" else "morning",
        account_id=resolved_account_id,
        triage_accounts=triage_accounts,
        brief_snapshot=brief_snapshot,
        similar_accounts=similar_accounts_out,
    )
