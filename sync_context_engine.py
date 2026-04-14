"""
sync_context_engine.py

Syncs the CSM Copilot context engine:
  1. Fetches live company records from HubSpot
  2. Merges with internal enrichment (account_context.json)
  3. Computes priority score + reasons
  4. Writes to Postgres accounts table
  5. Generates Gemini embeddings → stores in account_embeddings (pgvector)

Run:
    python3 sync_context_engine.py
"""

import json
import os
import time
from datetime import date
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

# ── Config ─────────────────────────────────────────────────────────────────

HUBSPOT_TOKEN = os.getenv("HUBSPOT_ACCESS_TOKEN")
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/csm_copilot")

HUBSPOT_URL = "https://api.hubapi.com/crm/v3/objects/companies"
HUBSPOT_HEADERS = {
    "Authorization": f"Bearer {HUBSPOT_TOKEN}",
    "Content-Type": "application/json",
}
HUBSPOT_PROPERTIES = [
    "name", "domain", "industry",
    "health_score", "risk_level", "renewal_date",
    "usage_trend", "open_ticket_count",
]

genai.configure(api_key=GEMINI_KEY)

# ── Priority scoring (mirrors main.py) ─────────────────────────────────────

def priority_score(crm: dict, internal: dict) -> tuple[int, list[str]]:
    score = 0
    reasons = []

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

    engagement = internal.get("engagement_status", "")
    if engagement == "At Risk":
        score += 10
        reasons.append("Engagement: At Risk")
    elif engagement == "Declining":
        score += 7
        reasons.append("Engagement declining")
    elif engagement == "Neutral":
        score += 3

    confidence = internal.get("renewal_confidence", "")
    if confidence == "At Risk":
        score += 10
        reasons.append("Renewal confidence: At Risk")
    elif confidence == "Monitor":
        score += 5
        reasons.append("Renewal confidence: Monitor")

    last_touch = internal.get("days_since_last_touch", 0)
    if last_touch > 21:
        score += 5
        reasons.append(f"No CSM touch in {last_touch} days")
    elif last_touch > 14:
        score += 3
        reasons.append(f"No CSM touch in {last_touch} days")

    arr = internal.get("arr", 0)
    if arr >= 200000:
        score += 8
        reasons.append(f"High-value account (${arr:,} ARR)")
    elif arr >= 100000:
        score += 5
        reasons.append(f"High-value account (${arr:,} ARR)")
    elif arr >= 50000:
        score += 2

    risk = crm.get("risk_level", "")
    if risk == "High":
        score += 10
    elif risk == "Medium":
        score += 5

    if not reasons:
        signals = []
        if hs is not None:
            signals.append(f"Health score {hs}")
        usage_trend = crm.get("usage_trend", "")
        if usage_trend:
            signals.append(f"{usage_trend.lower()} usage")
        reasons.append(", ".join(signals) if signals else "No major risk signals detected")

    return score, reasons


# ── HubSpot fetch ───────────────────────────────────────────────────────────

def fetch_all_companies() -> list[dict]:
    params = {
        "limit": 100,
        "properties": ",".join(HUBSPOT_PROPERTIES),
    }
    resp = requests.get(HUBSPOT_URL, headers=HUBSPOT_HEADERS, params=params, timeout=20)
    resp.raise_for_status()
    return resp.json().get("results", [])


# ── Embedding ───────────────────────────────────────────────────────────────

def embed_account(merged: dict) -> list[float] | None:
    """Embed a text summary of the merged account context."""
    internal = merged.get("internal", {})
    crm = merged.get("crm", {})

    text = (
        f"Company: {crm.get('name')}. "
        f"Segment: {internal.get('segment')}. "
        f"Plan: {internal.get('plan_tier')}. "
        f"ARR: {internal.get('arr')}. "
        f"Risk: {crm.get('risk_level')}. "
        f"Health score: {crm.get('health_score')}. "
        f"Renewal: {crm.get('renewal_date')}. "
        f"Usage change 30d: {internal.get('usage_change_30d')}%. "
        f"Engagement: {internal.get('engagement_status')}. "
        f"Champion: {internal.get('champion_status')}. "
        f"Renewal confidence: {internal.get('renewal_confidence')}. "
        f"Top issue: {internal.get('top_issue_theme')}. "
        f"Latest ticket: {internal.get('latest_ticket_summary')}. "
        f"CSM note: {internal.get('recent_csm_note')}."
    )

    try:
        result = genai.embed_content(
            model="models/gemini-embedding-001",
            content=text,
            task_type="RETRIEVAL_DOCUMENT",
        )
        return result["embedding"]
    except Exception as e:
        print(f"  Embedding failed: {e}")
        return None


# ── Main sync ───────────────────────────────────────────────────────────────

def sync():
    print("Loading internal enrichment...")
    enrichment_path = Path("account_context.json")
    if not enrichment_path.exists():
        raise FileNotFoundError("account_context.json not found — run generate_account_context.py first")

    with enrichment_path.open() as f:
        records = json.load(f)
    internal_map = {str(r["hubspot_company_id"]): r for r in records}
    print(f"  {len(internal_map)} internal records loaded")

    print("Fetching HubSpot companies...")
    companies = fetch_all_companies()
    print(f"  {len(companies)} companies fetched")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    synced = 0
    embedded = 0

    for company in companies:
        cid = company["id"]
        props = company.get("properties", {})
        internal = internal_map.get(cid, {})

        crm = {
            "id": cid,
            "name": props.get("name"),
            "domain": props.get("domain"),
            "industry": props.get("industry"),
            "health_score": props.get("health_score"),
            "risk_level": props.get("risk_level"),
            "renewal_date": props.get("renewal_date"),
            "usage_trend": props.get("usage_trend"),
            "open_ticket_count": props.get("open_ticket_count"),
        }

        # Normalise usage_trend with internal delta
        if internal:
            delta = internal.get("usage_change_30d", 0)
            if delta > 4:
                crm["usage_trend"] = "Increasing"
            elif delta < -4:
                crm["usage_trend"] = "Decreasing"
            else:
                crm["usage_trend"] = "Stable"

        merged = {"crm": crm, "internal": internal}
        score, reasons = priority_score(crm, internal)

        cur.execute("""
            INSERT INTO accounts (
                hubspot_company_id, company_name, crm_snapshot,
                internal_context, merged_context,
                priority_score, priority_reasons, last_refreshed
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (hubspot_company_id) DO UPDATE SET
                company_name     = EXCLUDED.company_name,
                crm_snapshot     = EXCLUDED.crm_snapshot,
                internal_context = EXCLUDED.internal_context,
                merged_context   = EXCLUDED.merged_context,
                priority_score   = EXCLUDED.priority_score,
                priority_reasons = EXCLUDED.priority_reasons,
                last_refreshed   = NOW()
        """, (
            cid,
            props.get("name"),
            json.dumps(crm),
            json.dumps(internal),
            json.dumps(merged),
            score,
            json.dumps(reasons),
        ))
        synced += 1

        # Generate and store embedding
        embedding = embed_account(merged)
        if embedding:
            cur.execute("""
                INSERT INTO account_embeddings (hubspot_company_id, embedding, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (hubspot_company_id) DO UPDATE SET
                    embedding  = EXCLUDED.embedding,
                    updated_at = NOW()
            """, (cid, embedding))
            embedded += 1
            time.sleep(0.1)  # stay within Gemini embedding rate limit

    conn.commit()
    cur.close()
    conn.close()

    print(f"\nSync complete")
    print(f"  {synced} accounts written to Postgres")
    print(f"  {embedded} embeddings stored in pgvector")


if __name__ == "__main__":
    sync()
