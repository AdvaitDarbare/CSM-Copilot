from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


RiskLevel = Literal["High", "Medium", "Low"]
TicketSeverity = Literal["Low", "Medium", "High", "Critical"]
TicketStatus = Literal["Open", "Pending", "Resolved"]
TicketCategory = Literal[
    "Billing",
    "Integration",
    "Adoption",
    "Onboarding",
    "Feature Gap",
    "Workflow",
    "Reporting",
]
ActivityType = Literal["Email", "Call", "QBR", "Exec Check-in", "Save Plan", "Slack"]
ActivityOutcome = Literal["Positive", "Neutral", "At Risk", "No Response"]
MilestoneStatus = Literal["Complete", "Partial", "Stalled"]
RenewalConfidence = Literal["Strong", "Monitor", "At Risk"]
EngagementStatus = Literal["Healthy", "Neutral", "Declining", "At Risk"]
ChampionStatus = Literal["Strong Champion", "Engaged", "Engaged but stretched", "Inactive", "No clear champion"]
WorkflowId = Literal["morning", "brief", "similar"]


class CRMAccount(BaseModel):
    id: str
    name: str
    domain: str | None = None
    industry: str | None = None
    health_score: int | None = None
    risk_level: RiskLevel | None = None
    renewal_date: date | None = None
    usage_trend: Literal["Increasing", "Stable", "Decreasing"] | None = None
    open_ticket_count: int | None = None


class SupportTicket(BaseModel):
    ticket_id: str
    company_id: str
    severity: TicketSeverity
    status: TicketStatus
    created_at: datetime
    escalated: bool
    category: TicketCategory
    summary: str


class ProductUsageDaily(BaseModel):
    company_id: str
    date: date
    active_users: int
    seats_purchased: int
    workflow_runs: int
    integrations_connected: int
    reports_viewed: int


class CSMActivity(BaseModel):
    activity_id: str
    company_id: str
    date: datetime
    activity_type: ActivityType
    contact_role: str
    note_summary: str
    outcome: ActivityOutcome


class OnboardingMilestone(BaseModel):
    company_id: str
    milestone_name: str
    status: MilestoneStatus
    due_date: date
    completed_date: date | None = None
    blocker_flag: bool


class RenewalSignal(BaseModel):
    company_id: str
    renewal_amount: int
    confidence_flag: RenewalConfidence
    billing_issue_flag: bool
    expansion_flag: bool
    renewal_owner: str


class DerivedAccountFeatures(BaseModel):
    company_id: str
    segment: str
    plan_tier: str
    arr: int
    owner_name: str
    engagement_status: EngagementStatus
    days_since_last_touch: int
    active_users: int
    licensed_seats: int
    usage_change_30d: int
    top_issue_theme: str
    issue_severity: TicketSeverity
    open_escalation: bool
    onboarding_status: MilestoneStatus
    champion_status: ChampionStatus
    renewal_confidence: RenewalConfidence
    latest_ticket_summary: str
    recent_csm_note: str
    recommended_next_action: str


class AccountContext(BaseModel):
    crm: CRMAccount
    internal: DerivedAccountFeatures
    priority_score: int
    priority_reasons: list[str]


class PrioritizedAccount(BaseModel):
    id: str
    name: str
    segment: str | None = None
    plan_tier: str | None = None
    arr: int | None = None
    risk_level: str | None = None
    health_score: str | None = None
    renewal_date: str | None = None
    usage_trend: str | None = None
    open_ticket_count: str | None = None
    renewal_confidence: str | None = None
    engagement_status: str | None = None
    owner_name: str | None = None
    priority_score: int
    priority_reasons: list[str]
    last_refreshed: str | None = None


class SimilarAccount(BaseModel):
    id: str
    name: str
    similarity: float
    risk_level: str | None = None
    health_score: str | None = None
    renewal_date: str | None = None
    usage_trend: str | None = None
    segment: str | None = None
    arr: int | None = None
    priority_score: int
    priority_reasons: list[str]


class AccountBrief(BaseModel):
    summary: str
    why_risky: list[str]
    key_issues: list[str]
    recommended_next_action: str
    provenance: list[str] = Field(default_factory=list)


class WorkflowArtifact(BaseModel):
    workflow: WorkflowId
    title: str
    provenance: list[str]
    stages: list[str]


class TriageArtifact(WorkflowArtifact):
    workflow: Literal["morning"] = "morning"
    top_accounts: list[PrioritizedAccount]
    top_themes: list[str]


class BriefArtifact(WorkflowArtifact):
    workflow: Literal["brief"] = "brief"
    account: AccountContext
    brief: AccountBrief


class SimilarArtifact(WorkflowArtifact):
    workflow: Literal["similar"] = "similar"
    account: AccountContext
    similar_accounts: list[SimilarAccount]
    shared_patterns: list[str]


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


class BriefSnapshot(BaseModel):
    id: str
    name: str
    risk_level: str | None = None
    health_score: str | None = None
    renewal_date: str | None = None
    arr: int | None = None
    open_tickets: str | None = None
    engagement: str | None = None
    owner: str | None = None
    segment: str | None = None
    priority_score: int
    recommended_next_action: str | None = None
    top_reason: str


class ChatMessage(BaseModel):
    message: str
    account_id: str | None = None


class ChatResponse(BaseModel):
    reply: str
    workflow: WorkflowId
    account_id: str | None = None
    workflow_stages: list[str] = Field(default_factory=list)
    artifact_title: str | None = None
    provenance: list[str] = Field(default_factory=list)
    triage_accounts: list[TriageAccountCard] | None = None
    brief_snapshot: BriefSnapshot | None = None
    similar_accounts: list[SimilarAccountCard] | None = None
