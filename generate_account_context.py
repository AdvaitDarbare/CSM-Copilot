import json
import random
from pathlib import Path
from faker import Faker

fake = Faker()
random.seed(42)
Faker.seed(42)

OWNERS = [fake.name() for _ in range(35)]

SEGMENTS = ["SMB", "Mid-market", "Enterprise"]
PLAN_TIERS = {
    "SMB": ["Starter", "Growth"],
    "Mid-market": ["Growth", "Pro"],
    "Enterprise": ["Pro", "Enterprise"],
}

THEMES = {
    "billing_dispute": [
        "Customer reported invoice mismatch after seat changes.",
        "Finance contact flagged unexpected renewal amount.",
        "Team questioned duplicate charges on latest invoice."
    ],
    "integration_failure": [
        "CRM sync failed during bulk updates.",
        "Customer hit repeated auth failures reconnecting integration.",
        "Field mapping broke during automated sync setup."
    ],
    "low_adoption": [
        "Broader team adoption is still low outside the pilot group.",
        "Account activity dropped after initial onboarding.",
        "Customer is not expanding usage beyond core users."
    ],
    "onboarding_stall": [
        "Customer never completed key setup steps.",
        "Workspace configured partially but rollout stalled.",
        "Implementation slowed after initial admin handoff."
    ],
    "feature_gap": [
        "Customer expected advanced capabilities not yet shipped.",
        "Team requested deeper reporting and admin controls.",
        "Use case requires functionality still on the roadmap."
    ],
    "workflow_complexity": [
        "Customer got stuck building multi-step automation.",
        "Power users hit complexity limits in advanced workflows.",
        "Conditional logic setup caused repeated confusion."
    ],
    "reporting_confusion": [
        "Customer could not reconcile dashboard totals.",
        "Stakeholders questioned reporting consistency.",
        "Team flagged confusion around filters and attribution."
    ],
}

def choose_segment() -> str:
    return random.choices(
        population=SEGMENTS,
        weights=[0.35, 0.45, 0.20],
        k=1,
    )[0]

def choose_arr(segment: str) -> int:
    if segment == "Enterprise":
        return random.randrange(100000, 350001, 5000)
    if segment == "Mid-market":
        return random.randrange(30000, 100001, 2500)
    return random.randrange(5000, 30001, 1000)

def engagement_from_risk(risk: str, usage: str) -> str:
    if risk == "High":
        return random.choice(["Declining", "At Risk"])
    if usage == "Decreasing":
        return random.choice(["Neutral", "Declining"])
    if risk == "Medium":
        return random.choice(["Neutral", "Healthy"])
    return "Healthy"

def usage_change_from_trend(usage: str, risk: str) -> int:
    if risk == "High":
        return random.randint(-20, -3)
    if usage == "Increasing":
        return random.randint(5, 30)
    if usage == "Stable":
        return random.randint(-4, 4)
    return random.randint(-30, -5)

def choose_theme(risk: str, usage: str, tickets: int) -> str:
    if tickets >= 8:
        return random.choice(["billing_dispute", "integration_failure", "workflow_complexity"])
    if usage == "Decreasing":
        return random.choice(["low_adoption", "onboarding_stall", "feature_gap"])
    if risk == "High":
        return random.choice(list(THEMES.keys()))
    if risk == "Medium":
        return random.choice(["low_adoption", "integration_failure", "reporting_confusion"])
    return random.choice(["low_adoption", "reporting_confusion", "onboarding_stall"])

def issue_severity(risk: str, tickets: int) -> str:
    if risk == "High" or tickets >= 8:
        return random.choice(["High", "Critical"])
    if risk == "Medium":
        return random.choice(["Medium", "High"])
    return random.choice(["Low", "Medium"])

def renewal_confidence(risk: str) -> str:
    if risk == "High":
        return "At Risk"
    if risk == "Medium":
        return "Monitor"
    return "Strong"

def champion_status(risk: str, usage: str) -> str:
    if risk == "High":
        return random.choice(["Inactive", "Engaged but stretched", "No clear champion"])
    if risk == "Medium":
        return random.choice(["Engaged", "Engaged but stretched"])
    return random.choice(["Strong Champion", "Engaged"])

def next_action(theme: str, risk: str) -> str:
    if theme == "billing_dispute":
        return "Coordinate with finance ops and resolve billing confusion before renewal."
    if theme == "integration_failure":
        return "Schedule technical working session and provide workaround for sync issues."
    if theme == "low_adoption":
        return "Run adoption review and identify broader rollout opportunities."
    if theme == "onboarding_stall":
        return "Book onboarding rescue session and complete setup checklist."
    if theme == "feature_gap":
        return "Align on roadmap expectations and provide supported workaround."
    if theme == "workflow_complexity":
        return "Offer guided enablement for advanced workflow setup."
    return "Review reporting configuration and send follow-up explanation."

def main():
    input_path = Path("hubspot_companies.json")
    if not input_path.exists():
        raise FileNotFoundError("hubspot_companies.json not found")

    with input_path.open() as f:
        data = json.load(f)

    companies = data["results"]
    output = []

    for company in companies:
        props = company.get("properties", {})
        company_id = company["id"]
        company_name = props.get("name", "")
        risk = props.get("risk_level", "Medium")
        usage = props.get("usage_trend", "Stable")
        tickets = int(props.get("open_ticket_count") or 0)
        health_score = int(props.get("health_score") or 50)

        segment = choose_segment()
        arr = choose_arr(segment)
        plan_tier = random.choice(PLAN_TIERS[segment])
        owner_name = random.choice(OWNERS)
        engagement_status = engagement_from_risk(risk, usage)
        usage_change_30d = usage_change_from_trend(usage, risk)
        top_issue_theme = choose_theme(risk, usage, tickets)
        latest_ticket_summary = random.choice(THEMES[top_issue_theme])
        active_users = random.randint(5, 250)
        licensed_seats = max(active_users, active_users + random.randint(5, 80))

        recent_csm_note = (
            f"{company_name} is currently {risk.lower()} risk. "
            f"Primary concern is {top_issue_theme.replace('_', ' ')}. "
            f"Health score is {health_score} with {tickets} open tickets and usage trend marked as {usage.lower()}."
        )

        output.append({
            "hubspot_company_id": company_id,
            "company_name": company_name,
            "segment": segment,
            "plan_tier": plan_tier,
            "arr": arr,
            "owner_name": owner_name,
            "engagement_status": engagement_status,
            "days_since_last_touch": random.randint(2, 35),
            "active_users": active_users,
            "licensed_seats": licensed_seats,
            "usage_change_30d": usage_change_30d,
            "top_issue_theme": top_issue_theme,
            "issue_severity": issue_severity(risk, tickets),
            "open_escalation": True if risk == "High" and tickets >= 6 else False,
            "onboarding_status": random.choice(["Complete", "Partial", "Stalled"]) if risk != "Low" else random.choice(["Complete", "Partial"]),
            "champion_status": champion_status(risk, usage),
            "renewal_confidence": renewal_confidence(risk),
            "latest_ticket_summary": latest_ticket_summary,
            "recent_csm_note": recent_csm_note,
            "recommended_next_action": next_action(top_issue_theme, risk),
            "synthetic_data_note": (
                "Generated to simulate internal support, product, and customer-success context "
                "not typically stored directly in CRM."
            )
        })

    with open("account_context.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"Generated account_context.json with {len(output)} records")

if __name__ == "__main__":
    main()
