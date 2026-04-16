# CSM Copilot

A workflow-first AI workspace for customer success managers. A CSM types a question about their book of business and gets a structured, grounded answer backed by deterministic account intelligence — not a dashboard they have to interpret themselves.

---

## Problem

A CSM managing 20–50 accounts spends significant time each week doing the same manual work: scanning CRM records, checking support tickets, reviewing notes, and trying to figure out which accounts need attention and why. The information exists — it's just fragmented across HubSpot, support tools, internal notes, and product data.

CSM Copilot compresses that workflow into a single conversational interface backed by a structured account-intelligence layer that merges CRM, support, usage, onboarding, and renewal signals and then explains its conclusions.

---

## Who this is for

**Primary user: Customer Success Manager**

Their real daily jobs:
- Morning scan — which accounts need my attention today?
- Pre-call prep — I have a call with Acme in 20 minutes, what do I need to know?
- Renewal prep — Acme renews in 2 weeks, are we in good shape?
- Escalation handling — something just broke, what's the full context on this account?

**Secondary: CS Manager / Revenue Ops** — portfolio-level view across the team's book.

---

## What it does

```
"Which accounts need attention this week?"
→ Returns prioritized list with risk signals and scores

"Give me a brief on Acme Corp"
→ Returns structured account card: summary, risk signals, key issue, next action

"I have a call with Acme in 20 minutes. What should I know?"
→ Same brief, framed as pre-call prep

"Why is Acme flagged as high risk?"
→ Returns the specific signals driving the risk classification

"Are there other accounts with the same issues as Acme?"
→ Returns similar accounts via vector similarity search

"Who's renewing in the next 30 days?"
→ Returns filtered list sorted by renewal date and priority score
```

---

## Architecture

```
User (conversational bar)
         │
         ▼
   Workflow Router             ← classifies request into one of three workflows
    ├── Morning Triage          ← portfolio ranking and pressure themes
    ├── Pre-call Prep           ← one-account brief with supporting evidence
    └── Similar Pattern         ← peer account analysis with shared signals
         │
         ▼
   Account Intelligence Layer  ← deterministic feature derivation + scoring
    ├── HubSpot CRM export      ← account anchor dataset
    ├── Structured source data  ← support, usage, CSM, onboarding, renewal
    └── Workflow artifacts      ← validated brief, triage, and pattern outputs
```

### Workflow responsibilities

**Workflow Router**
Reads user intent and routes to the right workflow. No autonomous planning loop and no agent framework.

**Morning Triage**
Answers questions about the whole book:
- Prioritized account queue ranked by `priority_score`
- Accounts by renewal window, risk level, segment
- Common issue themes across at-risk cohort

Uses deterministic ranking over derived account intelligence.

**Pre-call Prep**
Answers questions about one account:
- Full merged context (CRM + derived source signals)
- Structured brief generated from validated evidence
- Recommended next action tied to the strongest current risk

**Similar Pattern**
Answers questions about comparable accounts:
- Returns nearest peer accounts from structured risk shape matching
- Highlights shared patterns only when evidence is sufficient

### Account Intelligence Layer

The structural backbone. Maintains one canonical, derived account record per company so workflows never re-fetch and re-derive the same data.

- Keeps `hubspot_companies.json` as the CRM anchor
- Generates structured synthetic source datasets for support, usage, CSM activity, onboarding, and renewal
- Derives one validated account-intelligence record per company
- Computes and stores `priority_score` and `priority_reasons` per account
- Powers similarity analysis using structured feature comparison

---

## Current State vs Planned Experience

**Current state**
- FastAPI backend is live
- `hubspot_companies.json` is retained as the CRM anchor
- Structured synthetic source datasets are generated locally in `synthetic_sources/`
- `/accounts/prioritized`, `/accounts/{id}/context`, `/accounts/{id}/brief`, and `/accounts/similar/{id}` are served from deterministic workflow logic
- Next.js frontend prototype is live locally in `blocks-main`
- DeepEval and pytest scaffolding are included for workflow-grounding checks

### Local evaluation

Deterministic tests:

```bash
python3 -m pytest tests/test_csm_engine.py
```

DeepEval workflow checks:

```bash
export GEMINI_API_KEY=your_key_here
python3 run_deepeval.py
```

The DeepEval suite covers the three user-facing workflows:
- morning triage
- pre-call prep
- similar-account pattern analysis

**Planned experience**
- richer workflow artifacts
- stronger eval coverage
- optional deployment once local workflow quality is stable

The current product is a working workflow-first CSM intelligence layer and API. The focus is reliability, structured data, and defensible workflow behavior rather than autonomous agent complexity.

---

## Priority Scoring

Accounts are ranked using a weighted combination of CRM and operational signals. `risk_level` is intentionally low-weight — it is a derived field. Raw signals drive the score.

To keep the UI and interviews clear:
- `health_score` = account condition metric
- `priority_score` = ranking score for what the CSM should look at first
- `risk_level` = coarse category such as High / Medium / Low
- `priority_reasons` = human-readable explanations for why the account is ranked highly

| Signal | Max pts |
|---|---|
| `health_score` | 25 |
| `renewal_date` urgency (non-linear) | 20 |
| `usage_change_30d` | 15 |
| `open_escalation` + ticket amplification | 20 |
| `engagement_status` | 10 |
| `renewal_confidence` | 10 |
| `arr` weighting (revenue-aware) | 8 |
| `days_since_last_touch` | 5 |
| `risk_level` | 10 |

Every account surfaces at least one human-readable `priority_reason`. Phrasing is standardized and product-like: `"Usage down 16% (30d)"`, `"Renewal in 14 days — critical"`, `"9 open tickets (escalated)"`.

---

## Output formats

**Account card** — brief, context, pre-call prep

```
┌─────────────────────────────────────────┐
│  Acme Corp                   HIGH RISK  │
│  Mid-market · Pro · $75k ARR            │
│  Renewal: May 15 (14 days)              │
├─────────────────────────────────────────┤
│  Risk signals                           │
│  · Critical health score (22)           │
│  · Usage down 16% (30d)                 │
│  · 9 open tickets (escalated)           │
│  · No CSM touch in 26 days              │
├─────────────────────────────────────────┤
│  Key issue                              │
│  Customer stuck on multi-step           │
│  automation. Champion inactive.         │
├─────────────────────────────────────────┤
│  Next action                            │
│  Book guided enablement session         │
│  before renewal on May 15               │
└─────────────────────────────────────────┘
```

**Prioritized list** — portfolio view

```
#   Account              Risk    Score   Renewal     Top Signal
1   Acme Corp            HIGH    106     14 days     Escalation + low health
2   Burns & Ryan         HIGH    101     7 days      Critical renewal window
3   Spencer-Garcia       HIGH    97      13 days     Usage down 15%
4   Diaz Inc             MEDIUM  71      59 days     Engagement declining
```

**Conversational response** — follow-up questions, short answers

Plain text, 2–4 sentences. Sounds like a knowledgeable coworker, not a report generator.

---

## Product Experience Plan

### Interaction model

The UX should follow a two-pane workflow workspace rather than a plain chatbot or a static dashboard.

```text
Left side  = request + progress + short answer
Right side = durable artifact the CSM can use immediately
```

The right pane is the persistent artifact area for the same account or workflow session represented in chat, so the conversation and the output stay linked rather than feeling like separate products.

```text
User Ask
  -> Workflow Router
     -> Morning Triage
     -> Pre-call Prep
     -> Similar Pattern
  -> Account Intelligence Layer
  -> Right-side artifact
```

### Request flow

Each request moves through one clear path: the user asks in chat, the workflow router classifies the request, the appropriate workflow gathers structured evidence from the Account Intelligence Layer, and the result is returned in two forms at once: a short conversational answer on the left and a durable artifact on the right.

### Why this model fits CSM work

- CSMs ask open-ended questions, not rigid dashboard filters
- The answer needs evidence, not just prose
- The result should persist as a useful object: a brief, watchlist, renewal review, or save plan
- The system should feel like it is doing work on the user's behalf, not just generating text

### Left-pane behavior

The left pane should show:
- The user's natural-language request
- Short progress updates in product language
- A concise final answer

Do not show raw tool traces or bash output to end users.

Use statuses like:
- `Pulling account context`
- `Ranking renewal risk`
- `Reviewing support signals`
- `Finding similar accounts`
- `Drafting recommended next step`

### Right-pane artifact design

The right pane should be the primary output surface.

For account-specific questions:
- Account header: name, risk, segment, plan, ARR, renewal date
- Summary
- Why flagged
- Current situation
- Recommended next step
- Similar accounts
- Quick actions

For portfolio questions:
- Overview metrics
- Priority queue
- Renewal watchlist
- Risk-theme breakdown
- Recommended manager actions

For workflow/action questions:
- Draft follow-up email
- Save plan
- Escalation summary
- Manager update

### Frontend prototype status

The current frontend prototype already implements the core interaction model locally:
- Left pane: prompt input, starter prompts, progress states, and short grounded answers
- Right pane: portfolio artifact, account artifact, similarity artifact, and action outputs
- Live account loading through same-origin workspace API routes backed by the FastAPI service

The current local frontend URL is:

```text
http://localhost:3000
```

### Core screens

```text
1. Portfolio Workspace
   - morning triage
   - prioritized queue
   - renewals in next 30/60/90 days
   - risk theme breakdown

2. Account Workspace
   - account brief
   - risk signals
   - ticket / note context
   - next action
   - similar accounts

3. Renewal Review
   - renewal-critical accounts
   - grouped by renewal window
   - manager-ready summary

4. Save Plan / Draft Panel
   - email draft
   - action checklist
   - owner + due date
   - reminder / automation trigger
```

### Example user asks and routing

```text
"What should I focus on this morning?"
  -> Workflow Router -> Morning Triage
  -> /accounts/prioritized
  -> Priority queue artifact

"I have a call with Acme in 20 minutes. What should I know?"
  -> Workflow Router -> Pre-call Prep
  -> /accounts/{id}/context + /accounts/{id}/brief
  -> Pre-call brief artifact

"Are there other accounts with the same issues as Acme?"
  -> Workflow Router -> Similar Pattern
  -> /accounts/similar/{id}
  -> Similar accounts artifact

"Who renews in the next 30 days and is at risk?"
  -> Workflow Router -> Morning Triage
  -> accounts query filtered by renewal window
  -> Renewal watchlist artifact
```

### Account artifact target

```text
[Account Header]
Acme Corp
High Risk · Mid-market · Pro · $75k ARR
Renewal: May 15, 2026

[Summary]
This account is at immediate renewal risk due to low health, declining usage,
ticket pressure, and weak engagement.

[Why Flagged]
- Critical health score (22)
- Usage down 16% (30d)
- 9 open tickets (escalated)
- No CSM touch in 26 days

[Current Situation]
- Latest ticket summary
- Recent CSM note
- Champion status
- Renewal confidence

[Recommended Next Step]
One clear action the CSM should take now

[Related]
- Similar accounts
- Draft email
- Create save plan
- Set follow-up reminder
```

### Portfolio artifact target

```text
[Portfolio Overview]
Accounts reviewed: 100
High risk: 29
Renewing in 30 days: 19
Top save-plan accounts: 8

[Priority Queue]
table

[Risk Theme Breakdown]
- Integration failure
- Billing dispute
- Workflow complexity
- Low adoption

[Recommended Manager Actions]
- Escalate renewal-critical accounts
- Review ticket-heavy cohort with support
- Assign save plans to owners
```

### Product rules

- Left side is process, right side is decision-ready output
- Short answer first, evidence second
- Narrative fields support the answer; structured signals carry the truth
- Every high-risk answer should end with a concrete next step
- Similar-account search should be a first-class workflow, not a hidden debug feature
- The UI should feel operational, not analytical-only

---

## Data model

### HubSpot CRM (external source of truth)

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

### Structured source datasets

Structured synthetic data is keyed by `hubspot_company_id` and mirrors the non-CRM systems a real CSM team uses:

- `support_tickets.json`
- `product_usage_daily.json`
- `csm_activities.json`
- `onboarding_milestones.json`
- `renewal_signals.json`

These datasets are combined deterministically into one derived account-intelligence record containing fields such as:
- `segment`
- `plan_tier`
- `arr`
- `engagement_status`
- `days_since_last_touch`
- `usage_change_30d`
- `top_issue_theme`
- `open_escalation`
- `champion_status`
- `renewal_confidence`
- `recommended_next_action`

---

## Tech stack

| Layer | Technology |
|---|---|
| Workflow API | FastAPI (Python) |
| LLM | Gemini 2.5 Flash |
| CRM anchor | HubSpot-shaped JSON export |
| Structured source data | Local JSON datasets |
| App store / dev DB | Local Postgres-compatible workflow, optional |
| Frontend | Next.js / React |
| Evals | pytest + DeepEval |

---

## Current API endpoints

| Endpoint | Description |
|---|---|
| `GET /accounts` | List accounts from HubSpot |
| `GET /accounts/prioritized` | All accounts ranked by priority score with reasons |
| `GET /accounts/high-risk` | Accounts with `risk_level = High` |
| `GET /accounts/similar/{id}` | Similar accounts by structured risk-shape comparison |
| `GET /accounts/{id}/context` | Merged CRM + derived account context |
| `GET /accounts/{id}/brief` | Structured brief grounded in derived evidence |
| `GET /hubspot/raw` | Raw HubSpot response (debug) |

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment

```env
GEMINI_API_KEY=your_gemini_key
```

### 3. Generate enrichment data

```bash
# Generate structured source datasets
python3 generate_account_context.py
```

### 4. Materialize an inspection snapshot

```bash
python3 sync_context_engine.py
```

### 5. Run the backend

```bash
uvicorn main:app --reload
```

API: `http://localhost:8000`
Docs: `http://localhost:8000/docs`

### 6. Run the frontend prototype

```bash
cd blocks-main
bun install
bun run dev --hostname 0.0.0.0 --port 3000
```

Frontend: `http://localhost:3000`

---

## Project structure

```
.
├── main.py                      # FastAPI backend + scoring logic
├── csm_engine.py                # Structured source loading + derivation + workflow logic
├── csm_types.py                 # Shared schemas for sources, artifacts, and chat responses
├── generate_account_context.py  # Structured source dataset generator
├── sync_context_engine.py       # Local snapshot writer for inspection
├── blocks-main/                 # Next.js frontend workspace prototype
├── hubspot_companies.json       # HubSpot raw export
├── synthetic_sources/           # Generated structured source datasets
└── .env                         # API keys (not committed)
```

---

## Data positioning

This project uses HubSpot-shaped CRM records as the anchor account layer, then simulates the non-CRM systems a CSM actually depends on: support, product usage, CSM activity, onboarding, and renewal signals.

> No public dataset cleanly combines CRM, support, renewal, and account-health context for the same B2B accounts. The goal is to demonstrate the workflow, system design, and reasoning layer against a realistic data model.

---

## Build order

- [x] HubSpot CRM integration
- [x] Structured source datasets + deterministic derivation
- [x] `/accounts` and `/accounts/high-risk`
- [x] `/accounts/{id}/context` — merged CRM + derived account object
- [x] `/accounts/prioritized` — scored and ranked queue
- [x] `/accounts/{id}/brief` — structured brief with bounded generation
- [x] `/accounts/similar/{id}` — structured peer-pattern analysis
- [x] Conversational frontend (Next.js prototype)
- [x] Two-pane workspace UI: conversation + artifact panel
- [x] Portfolio workspace
- [x] Account workspace
- [x] DeepEval + pytest evaluation scaffolding
- [ ] Full frontend provenance and artifact polish
- [ ] Renewal review view
- [ ] Production app shell cleanup and route migration away from the blocks gallery
