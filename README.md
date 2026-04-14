# CSM Copilot

A chat-first AI workspace for business account review. Combines HubSpot CRM data with an internal enrichment layer to identify risky accounts, explain why they are at risk, and generate structured account briefs with recommended next actions.

---

## What it does

Customer success and account teams need to prepare for renewals, escalations, and account reviews — but the context they need is fragmented across multiple systems. CSM Copilot compresses that workflow:

- **List accounts** from HubSpot CRM
- **Prioritize by risk** using health score, renewal date, ticket load, and usage signals
- **Merge CRM + internal context** into one account intelligence object
- **Generate a structured brief** — summary, risk signals, key issues, recommended next action

---

## Architecture

```
HubSpot CRM (companies)
        │
        ▼
  FastAPI backend  ◄──  Internal enrichment layer (account_context.json)
        │
        ▼
  /accounts/{id}/context   →  merged account object
  /accounts/{id}/brief     →  LLM-generated structured brief
```

### Data sources

**HubSpot CRM** — external source of truth for company/account records. Each company has custom properties:

| Property | Description |
|---|---|
| `name` | Company name |
| `domain` | Domain |
| `industry` | Industry |
| `health_score` | Account health (0–100) |
| `risk_level` | High / Medium / Low |
| `renewal_date` | Upcoming renewal date |
| `usage_trend` | Increasing / Stable / Decreasing |
| `open_ticket_count` | Open support tickets |

**Internal enrichment layer** — synthetic operational context keyed by `hubspot_company_id`, simulating signals a startup would typically keep outside the CRM:

| Field | Description |
|---|---|
| `segment` | SMB / Mid-market / Enterprise |
| `plan_tier` | Starter / Growth / Pro / Enterprise |
| `arr` | Annual recurring revenue |
| `owner_name` | CSM owner |
| `engagement_status` | Healthy / Neutral / Declining / At Risk |
| `days_since_last_touch` | Days since last CSM contact |
| `active_users` | Active user count |
| `licensed_seats` | Total licensed seats |
| `usage_change_30d` | 30-day usage delta (%) |
| `top_issue_theme` | Primary issue category |
| `issue_severity` | Low / Medium / High / Critical |
| `open_escalation` | Active escalation flag |
| `onboarding_status` | Complete / Partial / Stalled |
| `champion_status` | Champion relationship status |
| `renewal_confidence` | Strong / Monitor / At Risk |
| `latest_ticket_summary` | Most recent support ticket summary |
| `recent_csm_note` | Latest CSM note |
| `recommended_next_action` | Suggested next step |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /accounts` | List accounts from HubSpot |
| `GET /accounts/high-risk` | Accounts with `risk_level = High` |
| `GET /accounts/{id}/context` | Merged CRM + internal context for one account |
| `GET /accounts/{id}/brief` | LLM-generated structured account brief |
| `GET /hubspot/raw` | Raw HubSpot API response (debug) |

### Example brief response

```json
{
  "summary": "Acme Corp is a high-risk mid-market Pro account with renewal on 2026-05-15.",
  "why_risky": [
    "Health score is 22",
    "5 open support tickets",
    "Usage declined 16% over 30 days",
    "Renewal confidence is At Risk"
  ],
  "key_issues": [
    "Customer got stuck building multi-step automation.",
    "Champion is inactive and engagement is declining."
  ],
  "recommended_next_action": "Offer guided enablement for advanced workflow setup."
}
```

---

## Tech Stack

- **HubSpot** — CRM source of truth (developer test account)
- **FastAPI** — backend API
- **Python** — data generation and backend logic
- **Gemini API** — structured brief generation
- **JSON** — internal enrichment store (`account_context.json`)

---

## Setup

### 1. Clone and install dependencies

```bash
pip install fastapi uvicorn requests python-dotenv google-generativeai faker
```

### 2. Configure environment

Create a `.env` file:

```
HUBSPOT_ACCESS_TOKEN=your_hubspot_token
GEMINI_API_KEY=your_gemini_key
```

### 3. Generate internal enrichment data

First fetch your HubSpot companies:

```bash
curl http://localhost:8000/hubspot/raw > hubspot_companies.json
```

Then generate the enrichment layer:

```bash
python3 generate_account_context.py
```

This produces `account_context.json` with synthetic internal signals correlated to each HubSpot company's risk level and usage trend.

### 4. Run the backend

```bash
uvicorn main:app --reload
```

API available at `http://localhost:8000`
Interactive docs at `http://localhost:8000/docs`

---

## Project Structure

```
.
├── main.py                     # FastAPI backend
├── generate_account_context.py # Synthetic enrichment generator
├── account_context.json        # Generated internal enrichment data
├── hubspot_companies.json      # HubSpot raw export
└── .env                        # API keys (not committed)
```

---

## Data positioning

This project uses:

- **Real CRM structure** via HubSpot's API
- **Synthetic business account records** imported into a HubSpot developer test account
- **Synthetic internal enrichment** keyed by HubSpot company ID

The synthetic data is intentionally structured — internal signals are correlated with CRM risk fields so account narratives are coherent. High-risk accounts consistently show negative usage trends, weak champion status, and low renewal confidence.

> No public dataset cleanly combines CRM, support, renewal, and account-health context for the same B2B accounts. The goal of this project is to demonstrate the workflow, system design, and reasoning layer — not to rely on real customer data.

---

## Roadmap

- [ ] `/accounts/prioritized` — ranked account queue with urgency scoring
- [ ] `/accounts/report` — cohort summary, risk breakdown, issue theme distribution
- [ ] Chat UI — account list, side panel, brief display
- [ ] Streaming brief generation
- [ ] Contact and deal context from HubSpot
- [ ] Exportable renewal briefs
