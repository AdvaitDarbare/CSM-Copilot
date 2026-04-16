from __future__ import annotations

import json
import math
import random
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from faker import Faker

from csm_types import (
    AccountBrief,
    AccountContext,
    BriefArtifact,
    BriefSnapshot,
    CRMAccount,
    CSMActivity,
    ChatResponse,
    DerivedAccountFeatures,
    OnboardingMilestone,
    PrioritizedAccount,
    ProductUsageDaily,
    RenewalSignal,
    SimilarAccount,
    SimilarArtifact,
    SimilarAccountCard,
    SupportTicket,
    TriageAccountCard,
    TriageArtifact,
)


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "synthetic_sources"
HUBSPOT_PATH = ROOT / "hubspot_companies.json"
REFERENCE_TODAY = date(2026, 4, 16)

fake = Faker()
Faker.seed(42)

SEGMENT_PLAN = {
    "SMB": ["Starter", "Growth"],
    "Mid-market": ["Growth", "Pro"],
    "Enterprise": ["Pro", "Enterprise"],
}
THEME_TO_ACTION = {
    "billing": "Coordinate with finance and confirm the renewal path before the next customer touch.",
    "integration": "Schedule a technical working session and provide a workaround for the blocked integration path.",
    "adoption": "Run an adoption review and identify a narrower rollout milestone for the customer team.",
    "onboarding": "Book an onboarding rescue session and assign clear owners for stalled milestones.",
    "feature_gap": "Align on roadmap expectations and document a supported workaround for the customer.",
    "workflow": "Offer guided enablement on workflow setup and simplify the first successful use case.",
    "reporting": "Review the reporting setup with the customer and send a follow-up clarification on configuration.",
}
TICKET_SUMMARIES = {
    "billing": [
        "Finance contact flagged an unexpected renewal amount after seat changes.",
        "Customer disputed invoice alignment with the active contract.",
    ],
    "integration": [
        "CRM sync failed during automated updates and blocked the team's workflow.",
        "Authentication reconnect attempts keep failing for the primary integration.",
    ],
    "adoption": [
        "Weekly active usage dropped after the pilot and has not expanded beyond the core team.",
        "The broader user group is not adopting the product after onboarding.",
    ],
    "onboarding": [
        "Implementation stalled because the admin team did not complete the required setup steps.",
        "The rollout is partially configured and blocked on customer-side ownership.",
    ],
    "feature_gap": [
        "The customer expected deeper admin controls that are still on the roadmap.",
        "The requested use case depends on functionality that is not available yet.",
    ],
    "workflow": [
        "Power users are stuck on multi-step workflow configuration and conditional logic.",
        "The customer cannot get the advanced workflow automation to run reliably.",
    ],
    "reporting": [
        "Stakeholders cannot reconcile dashboard totals and report filters.",
        "The team is confused by reporting attribution and filter behavior.",
    ],
}


def _stable_random(seed: str) -> random.Random:
    return random.Random(seed)


def _ensure_source_data() -> None:
    if SOURCE_DIR.exists() and all((SOURCE_DIR / name).exists() for name in [
        "support_tickets.json",
        "product_usage_daily.json",
        "csm_activities.json",
        "onboarding_milestones.json",
        "renewal_signals.json",
    ]):
        return

    SOURCE_DIR.mkdir(exist_ok=True)
    with HUBSPOT_PATH.open() as handle:
        hubspot = json.load(handle)["results"]

    support_tickets: list[dict] = []
    product_usage_daily: list[dict] = []
    csm_activities: list[dict] = []
    onboarding_milestones: list[dict] = []
    renewal_signals: list[dict] = []

    owner_pool = [fake.name() for _ in range(40)]

    for raw in hubspot:
        props = raw.get("properties", {})
        company_id = str(raw["id"])
        seed = _stable_random(company_id)
        risk = props.get("risk_level", "Medium")
        health_score = int(props.get("health_score") or 60)
        open_ticket_count = int(props.get("open_ticket_count") or 0)
        renewal_date = date.fromisoformat(props["renewal_date"])
        segment = seed.choices(["SMB", "Mid-market", "Enterprise"], weights=[0.35, 0.45, 0.2], k=1)[0]
        plan_tier = seed.choice(SEGMENT_PLAN[segment])
        arr = (
            seed.randrange(12000, 32000, 1000)
            if segment == "SMB"
            else seed.randrange(40000, 110000, 2500)
            if segment == "Mid-market"
            else seed.randrange(120000, 320000, 5000)
        )
        billing_issue = seed.random() < (0.45 if risk == "High" else 0.18)
        expansion_flag = seed.random() < (0.25 if risk != "High" else 0.08)
        renewal_signals.append({
            "company_id": company_id,
            "renewal_amount": arr,
            "confidence_flag": "At Risk" if risk == "High" else "Monitor" if risk == "Medium" else "Strong",
            "billing_issue_flag": billing_issue,
            "expansion_flag": expansion_flag,
            "renewal_owner": seed.choice(owner_pool),
        })

        base_seats = (
            seed.randrange(15, 60)
            if segment == "SMB"
            else seed.randrange(60, 180)
            if segment == "Mid-market"
            else seed.randrange(180, 420)
        )
        today_active = max(5, int(base_seats * ((health_score / 100) * 0.9 + 0.1)))
        trend = props.get("usage_trend", "Stable")
        if trend == "Decreasing":
            final_factor = seed.uniform(0.72, 0.92)
        elif trend == "Increasing":
            final_factor = seed.uniform(1.05, 1.22)
        else:
            final_factor = seed.uniform(0.94, 1.05)

        for days_back in range(35):
            current_day = REFERENCE_TODAY - timedelta(days=(34 - days_back))
            progress = days_back / 34 if 34 else 1
            seats = base_seats + seed.randint(0, 18)
            active_users = max(3, int(today_active / final_factor * (1 + (final_factor - 1) * progress)))
            active_users = min(active_users + seed.randint(-3, 3), seats)
            product_usage_daily.append({
                "company_id": company_id,
                "date": current_day.isoformat(),
                "active_users": max(active_users, 1),
                "seats_purchased": seats,
                "workflow_runs": max(1, int(active_users * seed.uniform(0.6, 2.8))),
                "integrations_connected": max(0, min(6, int(seed.uniform(1, 5)) + (1 if plan_tier in {"Pro", "Enterprise"} else 0))),
                "reports_viewed": max(1, int(active_users * seed.uniform(0.3, 1.2))),
            })

        issue_theme = _choose_theme(seed, risk, trend, open_ticket_count, billing_issue)
        issue_summaries = TICKET_SUMMARIES[issue_theme]
        ticket_total = max(open_ticket_count, 1 if risk != "Low" and seed.random() < 0.5 else 0)
        for ticket_index in range(ticket_total):
            severity = _ticket_severity(seed, risk, ticket_index, ticket_total)
            status = "Open" if ticket_index < open_ticket_count else "Resolved"
            support_tickets.append({
                "ticket_id": f"TKT-{company_id}-{ticket_index + 1}",
                "company_id": company_id,
                "severity": severity,
                "status": status,
                "created_at": (
                    datetime(2026, 4, 16, 9, 0, tzinfo=UTC) - timedelta(days=seed.randint(0, 40), hours=seed.randint(0, 23))
                ).isoformat(),
                "escalated": status == "Open" and severity in {"High", "Critical"} and risk == "High",
                "category": _theme_to_category(issue_theme),
                "summary": seed.choice(issue_summaries),
            })

        touch_count = 2 if risk == "High" else 3 if risk == "Medium" else 4
        activity_outcomes = ["At Risk", "No Response"] if risk == "High" else ["Neutral", "Positive"] if risk == "Low" else ["Neutral", "At Risk", "Positive"]
        for activity_index in range(touch_count):
            dt = datetime(2026, 4, 16, 13, 0, tzinfo=UTC) - timedelta(days=seed.randint(2, 35), hours=seed.randint(0, 36))
            csm_activities.append({
                "activity_id": f"ACT-{company_id}-{activity_index + 1}",
                "company_id": company_id,
                "date": dt.isoformat(),
                "activity_type": seed.choice(["Email", "Call", "QBR", "Exec Check-in", "Save Plan", "Slack"]),
                "contact_role": seed.choice(["Admin", "Champion", "Exec Sponsor", "Ops Lead"]),
                "note_summary": _activity_note(issue_theme, risk, seed),
                "outcome": seed.choice(activity_outcomes),
            })

        for milestone_name in ["Workspace setup", "Integration live", "Team launch"]:
            stalled = risk == "High" and seed.random() < 0.45 and milestone_name != "Workspace setup"
            partial = not stalled and risk != "Low" and seed.random() < 0.35
            status = "Stalled" if stalled else "Partial" if partial else "Complete"
            due_date = renewal_date - timedelta(days=seed.randint(45, 120))
            completed = None if status == "Stalled" else due_date + timedelta(days=seed.randint(-7, 10))
            onboarding_milestones.append({
                "company_id": company_id,
                "milestone_name": milestone_name,
                "status": status,
                "due_date": due_date.isoformat(),
                "completed_date": completed.isoformat() if completed else None,
                "blocker_flag": stalled,
            })

    for filename, payload in {
        "support_tickets.json": support_tickets,
        "product_usage_daily.json": product_usage_daily,
        "csm_activities.json": csm_activities,
        "onboarding_milestones.json": onboarding_milestones,
        "renewal_signals.json": renewal_signals,
    }.items():
        with (SOURCE_DIR / filename).open("w") as handle:
            json.dump(payload, handle, indent=2)


def materialize_source_data() -> Path:
    _ensure_source_data()
    load_workspace.cache_clear()
    return SOURCE_DIR


def _choose_theme(seed: random.Random, risk: str, usage_trend: str, tickets: int, billing_issue: bool) -> str:
    if billing_issue:
        return "billing"
    if tickets >= 8:
        return seed.choice(["integration", "workflow", "reporting"])
    if usage_trend == "Decreasing":
        return seed.choice(["adoption", "workflow", "feature_gap"])
    if risk == "High":
        return seed.choice(["integration", "adoption", "onboarding", "workflow", "reporting"])
    return seed.choice(["adoption", "reporting", "onboarding"])


def _ticket_severity(seed: random.Random, risk: str, index: int, total: int) -> str:
    if risk == "High" and index < max(1, total // 3):
        return seed.choice(["High", "Critical"])
    if risk == "Low":
        return seed.choice(["Low", "Medium"])
    return seed.choice(["Medium", "High"])


def _theme_to_category(theme: str) -> str:
    return {
        "billing": "Billing",
        "integration": "Integration",
        "adoption": "Adoption",
        "onboarding": "Onboarding",
        "feature_gap": "Feature Gap",
        "workflow": "Workflow",
        "reporting": "Reporting",
    }[theme]


def _activity_note(theme: str, risk: str, seed: random.Random) -> str:
    snippets = {
        "billing": "Customer is worried about renewal pricing and wants finance clarity.",
        "integration": "Customer cannot stabilize the key integration before expanding usage.",
        "adoption": "Champion says the broader team has not adopted the workflow yet.",
        "onboarding": "Implementation owners changed and the rollout is behind plan.",
        "feature_gap": "Customer is pushing on roadmap fit for their advanced use case.",
        "workflow": "Power users are blocked on workflow complexity and need enablement.",
        "reporting": "Stakeholders do not trust the reporting outputs yet.",
    }
    tail = {
        "High": "This account needs an active recovery motion.",
        "Medium": "This account should stay on watch.",
        "Low": "This account is stable but should be monitored through renewal.",
    }[risk]
    return f"{snippets[theme]} {tail}"


def _load_json_list(path: Path) -> list[dict]:
    with path.open() as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def load_workspace() -> dict:
    _ensure_source_data()
    with HUBSPOT_PATH.open() as handle:
        hubspot_raw = json.load(handle)["results"]
    crm_accounts = [_parse_crm_account(item) for item in hubspot_raw]
    tickets = [SupportTicket.model_validate(row) for row in _load_json_list(SOURCE_DIR / "support_tickets.json")]
    usage = [ProductUsageDaily.model_validate(row) for row in _load_json_list(SOURCE_DIR / "product_usage_daily.json")]
    activities = [CSMActivity.model_validate(row) for row in _load_json_list(SOURCE_DIR / "csm_activities.json")]
    milestones = [OnboardingMilestone.model_validate(row) for row in _load_json_list(SOURCE_DIR / "onboarding_milestones.json")]
    renewals = {
        signal.company_id: signal
        for signal in (RenewalSignal.model_validate(row) for row in _load_json_list(SOURCE_DIR / "renewal_signals.json"))
    }

    tickets_by_company = _group_by(tickets, lambda item: item.company_id)
    usage_by_company = _group_by(usage, lambda item: item.company_id)
    activities_by_company = _group_by(activities, lambda item: item.company_id)
    milestones_by_company = _group_by(milestones, lambda item: item.company_id)

    contexts: dict[str, AccountContext] = {}
    prioritized: list[PrioritizedAccount] = []
    similar_index: dict[str, list[SimilarAccount]] = {}
    vectors: dict[str, list[float]] = {}

    for crm in crm_accounts:
        features = derive_account_features(
            crm,
            renewals[crm.id],
            tickets_by_company[crm.id],
            usage_by_company[crm.id],
            activities_by_company[crm.id],
            milestones_by_company[crm.id],
        )
        score, reasons = compute_priority_score(crm, features)
        context = AccountContext(crm=crm, internal=features, priority_score=score, priority_reasons=reasons)
        contexts[crm.id] = context
        prioritized.append(_to_prioritized(context))
        vectors[crm.id] = _feature_vector(context)

    prioritized.sort(key=lambda account: account.priority_score, reverse=True)

    for company_id, context in contexts.items():
        peers: list[SimilarAccount] = []
        for other_id, other_context in contexts.items():
            if other_id == company_id:
                continue
            similarity = _cosine_similarity(vectors[company_id], vectors[other_id])
            shared = set(context.priority_reasons[:4]).intersection(other_context.priority_reasons[:4])
            if similarity < 0.72 and not shared:
                continue
            peers.append(
                SimilarAccount(
                    id=other_id,
                    name=other_context.crm.name,
                    similarity=round(similarity, 4),
                    risk_level=other_context.crm.risk_level,
                    health_score=str(other_context.crm.health_score) if other_context.crm.health_score is not None else None,
                    renewal_date=other_context.crm.renewal_date.isoformat() if other_context.crm.renewal_date else None,
                    usage_trend=other_context.crm.usage_trend,
                    segment=other_context.internal.segment,
                    arr=other_context.internal.arr,
                    priority_score=other_context.priority_score,
                    priority_reasons=other_context.priority_reasons,
                )
            )
        similar_index[company_id] = sorted(peers, key=lambda item: item.similarity, reverse=True)[:8]

    return {
        "contexts": contexts,
        "prioritized": prioritized,
        "similar": similar_index,
        "crm_accounts": crm_accounts,
    }


def _parse_crm_account(raw: dict) -> CRMAccount:
    props = raw.get("properties", {})
    return CRMAccount(
        id=str(raw["id"]),
        name=props.get("name"),
        domain=props.get("domain"),
        industry=props.get("industry"),
        health_score=int(props["health_score"]) if props.get("health_score") else None,
        risk_level=props.get("risk_level"),
        renewal_date=date.fromisoformat(props["renewal_date"]) if props.get("renewal_date") else None,
        usage_trend=props.get("usage_trend"),
        open_ticket_count=int(props["open_ticket_count"]) if props.get("open_ticket_count") else 0,
    )


def _group_by(items: Iterable, key_fn):
    grouped = defaultdict(list)
    for item in items:
        grouped[key_fn(item)].append(item)
    return grouped


def derive_account_features(
    crm: CRMAccount,
    renewal_signal: RenewalSignal,
    tickets: list[SupportTicket],
    usage: list[ProductUsageDaily],
    activities: list[CSMActivity],
    milestones: list[OnboardingMilestone],
) -> DerivedAccountFeatures:
    latest_usage = sorted(usage, key=lambda row: row.date)
    current = latest_usage[-1]
    baseline = latest_usage[0]
    usage_change_30d = round(((current.active_users - baseline.active_users) / max(baseline.active_users, 1)) * 100)
    last_touch_dt = max((activity.date for activity in activities), default=datetime(2026, 3, 1, tzinfo=UTC))
    days_since_last_touch = (REFERENCE_TODAY - last_touch_dt.date()).days
    open_tickets = [ticket for ticket in tickets if ticket.status != "Resolved"]
    latest_open = sorted(open_tickets or tickets, key=lambda ticket: ticket.created_at, reverse=True)
    latest_ticket_summary = latest_open[0].summary if latest_open else "No open support issues."
    issue_counts = Counter(ticket.category for ticket in open_tickets or tickets)
    top_issue_theme = _normalize_issue_theme(issue_counts.most_common(1)[0][0] if issue_counts else "Adoption")
    issue_severity = latest_open[0].severity if latest_open else "Low"
    engagement_status = _derive_engagement_status(activities, usage_change_30d)
    champion_status = _derive_champion_status(activities, engagement_status)
    onboarding_status = _derive_onboarding_status(milestones)
    recent_note = sorted(activities, key=lambda item: item.date, reverse=True)[0].note_summary if activities else "No recent CSM activity."
    recommended_next_action = THEME_TO_ACTION[top_issue_theme]
    segment = _segment_from_arr(renewal_signal.renewal_amount)
    plan_tier = _plan_from_arr(renewal_signal.renewal_amount)
    return DerivedAccountFeatures(
        company_id=crm.id,
        segment=segment,
        plan_tier=plan_tier,
        arr=renewal_signal.renewal_amount,
        owner_name=renewal_signal.renewal_owner,
        engagement_status=engagement_status,
        days_since_last_touch=days_since_last_touch,
        active_users=current.active_users,
        licensed_seats=current.seats_purchased,
        usage_change_30d=usage_change_30d,
        top_issue_theme=top_issue_theme,
        issue_severity=issue_severity,
        open_escalation=any(ticket.escalated for ticket in open_tickets),
        onboarding_status=onboarding_status,
        champion_status=champion_status,
        renewal_confidence=renewal_signal.confidence_flag,
        latest_ticket_summary=latest_ticket_summary,
        recent_csm_note=recent_note,
        recommended_next_action=recommended_next_action,
    )


def _normalize_issue_theme(category: str) -> str:
    return {
        "Billing": "billing",
        "Integration": "integration",
        "Adoption": "adoption",
        "Onboarding": "onboarding",
        "Feature Gap": "feature_gap",
        "Workflow": "workflow",
        "Reporting": "reporting",
    }.get(category, "adoption")


def _derive_engagement_status(activities: list[CSMActivity], usage_change_30d: int) -> str:
    outcomes = Counter(activity.outcome for activity in activities)
    if outcomes["At Risk"] >= 2 or usage_change_30d <= -12:
        return "At Risk"
    if outcomes["No Response"] >= 1 or usage_change_30d <= -5:
        return "Declining"
    if outcomes["Positive"] >= 2 and usage_change_30d >= 0:
        return "Healthy"
    return "Neutral"


def _derive_champion_status(activities: list[CSMActivity], engagement_status: str) -> str:
    if engagement_status == "At Risk":
        return "Inactive"
    if engagement_status == "Declining":
        return "Engaged but stretched"
    if any(activity.contact_role == "Exec Sponsor" and activity.outcome == "Positive" for activity in activities):
        return "Strong Champion"
    return "Engaged"


def _derive_onboarding_status(milestones: list[OnboardingMilestone]) -> str:
    if any(milestone.status == "Stalled" for milestone in milestones):
        return "Stalled"
    if any(milestone.status == "Partial" for milestone in milestones):
        return "Partial"
    return "Complete"


def _segment_from_arr(arr: int) -> str:
    if arr >= 120000:
        return "Enterprise"
    if arr >= 40000:
        return "Mid-market"
    return "SMB"


def _plan_from_arr(arr: int) -> str:
    if arr >= 200000:
        return "Enterprise"
    if arr >= 90000:
        return "Pro"
    if arr >= 30000:
        return "Growth"
    return "Starter"


def compute_priority_score(crm: CRMAccount, features: DerivedAccountFeatures) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    health = crm.health_score or 100
    health_points = min(round((100 - health) / 4), 25)
    score += health_points
    if health <= 30:
        reasons.append(f"Critical health score ({health})")
    elif health <= 50:
        reasons.append(f"Low health score ({health})")

    if crm.renewal_date:
        days = (crm.renewal_date - REFERENCE_TODAY).days
        if days <= 14:
            score += 20
            reasons.append(f"Renewal in {days} days - critical")
        elif days <= 30:
            score += 15
            reasons.append(f"Renewal in {days} days")
        elif days <= 60:
            score += 8
            reasons.append(f"Renewal in {days} days")

    delta = features.usage_change_30d
    if delta <= -15:
        score += 15
        reasons.append(f"Usage down {abs(delta)}% (30d)")
    elif delta <= -8:
        score += 10
        reasons.append(f"Usage down {abs(delta)}% (30d)")
    elif delta <= -3:
        score += 5
        reasons.append(f"Usage down {abs(delta)}% (30d)")

    tickets = crm.open_ticket_count or 0
    if features.open_escalation:
        score += min(15 + tickets, 20)
        reasons.append(f"{tickets} open tickets (escalated)")
    elif tickets >= 5:
        score += min(tickets * 2, 10)
        reasons.append(f"{tickets} open support tickets")
    else:
        score += min(tickets, 4)

    if features.engagement_status == "At Risk":
        score += 10
        reasons.append("Engagement: At Risk")
    elif features.engagement_status == "Declining":
        score += 7
        reasons.append("Engagement declining")
    elif features.engagement_status == "Neutral":
        score += 3

    if features.renewal_confidence == "At Risk":
        score += 10
        reasons.append("Renewal confidence: At Risk")
    elif features.renewal_confidence == "Monitor":
        score += 5
        reasons.append("Renewal confidence: Monitor")

    if features.days_since_last_touch > 21:
        score += 5
        reasons.append(f"No CSM touch in {features.days_since_last_touch} days")
    elif features.days_since_last_touch > 14:
        score += 3
        reasons.append(f"No CSM touch in {features.days_since_last_touch} days")

    if features.arr >= 200000:
        score += 8
        reasons.append(f"High-value account (${features.arr:,} ARR)")
    elif features.arr >= 100000:
        score += 5
        reasons.append(f"High-value account (${features.arr:,} ARR)")
    elif features.arr >= 50000:
        score += 2

    if crm.risk_level == "High":
        score += 10
    elif crm.risk_level == "Medium":
        score += 5

    if not reasons:
        reasons.append("No major risk signals detected")
    return score, reasons


def _to_prioritized(context: AccountContext) -> PrioritizedAccount:
    return PrioritizedAccount(
        id=context.crm.id,
        name=context.crm.name,
        segment=context.internal.segment,
        plan_tier=context.internal.plan_tier,
        arr=context.internal.arr,
        risk_level=context.crm.risk_level,
        health_score=str(context.crm.health_score) if context.crm.health_score is not None else None,
        renewal_date=context.crm.renewal_date.isoformat() if context.crm.renewal_date else None,
        usage_trend=context.crm.usage_trend,
        open_ticket_count=str(context.crm.open_ticket_count) if context.crm.open_ticket_count is not None else None,
        renewal_confidence=context.internal.renewal_confidence,
        engagement_status=context.internal.engagement_status,
        owner_name=context.internal.owner_name,
        priority_score=context.priority_score,
        priority_reasons=context.priority_reasons,
        last_refreshed=datetime.now(UTC).isoformat(),
    )


def _feature_vector(context: AccountContext) -> list[float]:
    renewal_days = (context.crm.renewal_date - REFERENCE_TODAY).days if context.crm.renewal_date else 120
    return [
        (100 - (context.crm.health_score or 100)) / 100,
        min(max((90 - renewal_days) / 90, 0), 1),
        min(abs(context.internal.usage_change_30d) / 30, 1),
        min((context.crm.open_ticket_count or 0) / 12, 1),
        1 if context.internal.open_escalation else 0,
        {"Healthy": 0.1, "Neutral": 0.4, "Declining": 0.7, "At Risk": 1.0}[context.internal.engagement_status],
        {"Strong": 0.1, "Monitor": 0.6, "At Risk": 1.0}[context.internal.renewal_confidence],
        min(context.internal.days_since_last_touch / 30, 1),
        {"billing": 0.1, "integration": 0.25, "adoption": 0.4, "onboarding": 0.55, "feature_gap": 0.7, "workflow": 0.85, "reporting": 1.0}[context.internal.top_issue_theme],
    ]


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(vec_a, vec_b, strict=True))
    mag_a = math.sqrt(sum(a * a for a in vec_a))
    mag_b = math.sqrt(sum(b * b for b in vec_b))
    if not mag_a or not mag_b:
        return 0.0
    return numerator / (mag_a * mag_b)


def get_prioritized_accounts(limit: int = 100) -> list[PrioritizedAccount]:
    return load_workspace()["prioritized"][:limit]


def get_account_context(company_id: str) -> AccountContext | None:
    return load_workspace()["contexts"].get(company_id)


def get_similar_accounts(company_id: str, limit: int = 5) -> list[SimilarAccount]:
    return load_workspace()["similar"].get(company_id, [])[:limit]


def resolve_account_from_message(message: str) -> str | None:
    lower = message.lower()
    best: tuple[int, str] | None = None
    for account in load_workspace()["prioritized"]:
        name_lower = account.name.lower()
        if name_lower in lower:
            return account.id
        tokens = [token for token in name_lower.replace("-", " ").split() if len(token) >= 4]
        if not tokens:
            continue
        hits = sum(1 for token in tokens if token in lower)
        if hits >= 2 and (best is None or hits > best[0]):
            best = (hits, account.id)
    return best[1] if best else None


def search_accounts(query: str, limit: int = 5) -> list[PrioritizedAccount]:
    if not query or not query.strip():
        return []
    lower = query.lower().strip()
    matches: list[tuple[int, PrioritizedAccount]] = []
    for account in load_workspace()["prioritized"]:
        name_lower = account.name.lower()
        if lower == name_lower:
            score = 1000
        elif name_lower.startswith(lower):
            score = 500 + len(lower)
        elif lower in name_lower:
            score = 100 + len(lower)
        else:
            tokens = [token for token in name_lower.replace("-", " ").split() if len(token) >= 3]
            hits = sum(1 for token in tokens if token in lower or lower in token)
            if not hits:
                continue
            score = hits * 10
        matches.append((score, account))
    matches.sort(key=lambda pair: (-pair[0], -pair[1].priority_score))
    return [account for _, account in matches[:limit]]


def classify_workflow(message: str, account_name: str | None = None) -> str:
    lower = message.lower()
    if any(signal in lower for signal in ["similar", "pattern", "isolated", "other accounts", "compare", "cluster"]):
        return "similar"
    if any(signal in lower for signal in ["call", "brief", "prep", "what should i know", "tell me about", "status of", "update on"]) or (
        account_name and account_name.lower() in lower
    ):
        return "brief"
    return "morning"


def _account_provenance(context: AccountContext, source_dir: Path = SOURCE_DIR) -> list[str]:
    sources = ["CRM"]
    if context.internal.latest_ticket_summary and context.internal.latest_ticket_summary != "No open support issues.":
        sources.append("support")
    if context.internal.usage_change_30d is not None:
        sources.append("usage")
    if context.internal.recent_csm_note and context.internal.recent_csm_note != "No recent CSM activity.":
        sources.append("CSM activity")
    sources.append("renewal")
    sources.append("derived")
    return sources


def build_account_brief(context: AccountContext) -> AccountBrief:
    renewal_display = context.crm.renewal_date.strftime("%B %d, %Y") if context.crm.renewal_date else "an unknown renewal date"
    key_issues = [
        context.internal.latest_ticket_summary,
        context.internal.recent_csm_note,
    ]
    return AccountBrief(
        summary=(
            f"{context.crm.name} is a {context.crm.risk_level or 'Medium'} risk {context.internal.segment} account "
            f"on {context.internal.plan_tier}, renewing on {renewal_display}."
        ),
        why_risky=context.priority_reasons[:5],
        key_issues=key_issues,
        recommended_next_action=context.internal.recommended_next_action,
        provenance=_account_provenance(context),
    )


def build_workflow_artifact(workflow: str, account_id: str | None = None):
    if workflow == "brief":
        context = get_account_context(account_id) if account_id else None
        if not context:
            return None
        brief = build_account_brief(context)
        return BriefArtifact(
            title="Pre-Call Brief",
            provenance=["CRM", "support", "usage", "CSM activity", "renewal", "derived"],
            stages=workflow_stages("brief"),
            account=context,
            brief=brief,
        )
    if workflow == "similar":
        context = get_account_context(account_id) if account_id else None
        if not context:
            return None
        similar = get_similar_accounts(account_id, limit=5)
        shared_patterns = derive_shared_patterns(similar)
        return SimilarArtifact(
            title="Similar Risk Pattern Analysis",
            provenance=["CRM", "support", "usage", "derived"],
            stages=workflow_stages("similar"),
            account=context,
            similar_accounts=similar,
            shared_patterns=shared_patterns,
        )
    prioritized = get_prioritized_accounts(limit=8)
    return TriageArtifact(
        title="Morning Triage",
        provenance=["CRM", "support", "usage", "CSM activity", "renewal", "derived"],
        stages=workflow_stages("morning"),
        top_accounts=prioritized[:5],
        top_themes=top_risk_themes(prioritized),
    )


def derive_shared_patterns(similar: list[SimilarAccount]) -> list[str]:
    pattern_counts = Counter()
    for account in similar:
        for reason in account.priority_reasons:
            if "Renewal in" in reason:
                pattern_counts["Renewal urgency"] += 1
            if "Usage down" in reason:
                pattern_counts["Usage decline"] += 1
            if "ticket" in reason.lower():
                pattern_counts["Support load"] += 1
            if "Engagement" in reason or "Renewal confidence" in reason or "No CSM touch" in reason:
                pattern_counts["Engagement pressure"] += 1
    return [label for label, count in pattern_counts.most_common(3) if count > 0]


def top_risk_themes(prioritized: list[PrioritizedAccount]) -> list[str]:
    counts = Counter()
    for account in prioritized[:8]:
        for reason in account.priority_reasons:
            if "Renewal in" in reason:
                counts["Renewal urgency"] += 1
            elif "Usage down" in reason:
                counts["Usage decline"] += 1
            elif "ticket" in reason.lower():
                counts["Ticket pressure"] += 1
            elif "Engagement" in reason or "No CSM touch" in reason:
                counts["Weak engagement"] += 1
    return [label for label, _ in counts.most_common(3)]


def workflow_stages(workflow: str) -> list[str]:
    base = ["Classify workflow", "Resolve account", "Gather evidence"]
    if workflow == "morning":
        return [*base, "Rank portfolio", "Assemble triage artifact", "Generate grounded summary"]
    if workflow == "brief":
        return [*base, "Assemble account brief", "Validate structured output", "Generate grounded summary"]
    return [*base, "Retrieve peer accounts", "Verify shared patterns", "Generate grounded summary"]


def to_chat_response(workflow: str, artifact, reply: str, account_id: str | None) -> ChatResponse:
    triage_cards = None
    brief_snapshot = None
    similar_cards = None

    if isinstance(artifact, TriageArtifact):
        triage_cards = [
            TriageAccountCard(
                id=account.id,
                name=account.name,
                risk_level=account.risk_level or "Unknown",
                priority_score=account.priority_score,
                renewal_date=account.renewal_date,
                top_reason=account.priority_reasons[0],
                arr=float(account.arr) if account.arr is not None else None,
            )
            for account in artifact.top_accounts[:4]
        ]
    elif isinstance(artifact, BriefArtifact):
        context = artifact.account
        brief_snapshot = BriefSnapshot(
            id=context.crm.id,
            name=context.crm.name,
            risk_level=context.crm.risk_level,
            health_score=str(context.crm.health_score) if context.crm.health_score is not None else None,
            renewal_date=context.crm.renewal_date.isoformat() if context.crm.renewal_date else None,
            arr=context.internal.arr,
            open_tickets=str(context.crm.open_ticket_count) if context.crm.open_ticket_count is not None else None,
            engagement=context.internal.engagement_status,
            owner=context.internal.owner_name,
            segment=context.internal.segment,
            priority_score=context.priority_score,
            recommended_next_action=artifact.brief.recommended_next_action,
            top_reason=context.priority_reasons[0],
        )
    elif isinstance(artifact, SimilarArtifact):
        similar_cards = [
            SimilarAccountCard(
                id=account.id,
                name=account.name,
                similarity=account.similarity,
                risk_level=account.risk_level,
                health_score=account.health_score,
                renewal_date=account.renewal_date,
                top_reason=account.priority_reasons[0] if account.priority_reasons else "No signal available",
            )
            for account in artifact.similar_accounts[:4]
        ]

    return ChatResponse(
        reply=reply,
        workflow=workflow,
        account_id=account_id,
        workflow_stages=artifact.stages if artifact else workflow_stages(workflow),
        artifact_title=artifact.title if artifact else None,
        provenance=artifact.provenance if artifact else [],
        triage_accounts=triage_cards,
        brief_snapshot=brief_snapshot,
        similar_accounts=similar_cards,
    )
