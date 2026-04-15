import { differenceInCalendarDays, formatISO, parseISO } from "date-fns";

export type PrioritizedAccount = {
  id: string;
  name: string;
  segment?: string | null;
  plan_tier?: string | null;
  arr?: number | null;
  risk_level?: string | null;
  health_score?: string | null;
  renewal_date?: string | null;
  usage_trend?: string | null;
  open_ticket_count?: string | null;
  renewal_confidence?: string | null;
  engagement_status?: string | null;
  owner_name?: string | null;
  priority_score: number;
  priority_reasons: string[];
  last_refreshed?: string | null;
};

export type AccountContext = {
  crm: {
    id: string;
    name: string;
    domain?: string | null;
    industry?: string | null;
    health_score?: string | null;
    risk_level?: string | null;
    renewal_date?: string | null;
    usage_trend?: string | null;
    open_ticket_count?: string | null;
  };
  internal: {
    segment?: string | null;
    plan_tier?: string | null;
    arr?: number | null;
    owner_name?: string | null;
    engagement_status?: string | null;
    days_since_last_touch?: number | null;
    active_users?: number | null;
    licensed_seats?: number | null;
    usage_change_30d?: number | null;
    top_issue_theme?: string | null;
    issue_severity?: string | null;
    open_escalation?: boolean | null;
    onboarding_status?: string | null;
    champion_status?: string | null;
    renewal_confidence?: string | null;
    latest_ticket_summary?: string | null;
    recent_csm_note?: string | null;
    recommended_next_action?: string | null;
  };
  priority_score: number;
  priority_reasons: string[];
};

export type AccountBrief = {
  summary: string;
  why_risky: string[];
  key_issues: string[];
  recommended_next_action: string;
};

export type SimilarAccount = {
  id: string;
  name: string;
  similarity: number;
  risk_level?: string | null;
  health_score?: string | null;
  renewal_date?: string | null;
  usage_trend?: string | null;
  segment?: string | null;
  arr?: number | null;
  priority_score: number;
  priority_reasons: string[];
};

export type RiskTheme = {
  label: string;
  count: number;
  tone: "critical" | "warning" | "watch";
};

export type WorkspaceBootstrap = {
  source: "live" | "fallback";
  generatedAt: string;
  portfolio: {
    prioritized: PrioritizedAccount[];
    totalAccounts: number;
    highRiskCount: number;
    renewingSoonCount: number;
    topSavePlanCount: number;
    riskThemes: RiskTheme[];
  };
  featuredAccount: {
    id: string;
    context: AccountContext;
    brief: AccountBrief;
    similar: SimilarAccount[];
  };
};

export type WorkspaceAccountData = {
  source: "live" | "fallback";
  accountId: string;
  context: AccountContext;
  brief: AccountBrief;
  similar: SimilarAccount[];
};

type PrioritizedResponse = {
  results: PrioritizedAccount[];
};

type AccountContextResponse = AccountContext;
type AccountBriefResponse = AccountBrief;
type SimilarResponse = {
  source_id: string;
  results: SimilarAccount[];
};

const API_BASE_URL =
  process.env.CSM_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000";

const FALLBACK_DATA: WorkspaceBootstrap = {
  source: "fallback",
  generatedAt: "2026-04-14T22:10:00.000Z",
  portfolio: {
    totalAccounts: 100,
    highRiskCount: 29,
    renewingSoonCount: 19,
    topSavePlanCount: 8,
    riskThemes: [
      { label: "Renewal urgency", count: 8, tone: "critical" },
      { label: "Ticket pressure", count: 7, tone: "critical" },
      { label: "Usage decline", count: 6, tone: "warning" },
      { label: "Weak engagement", count: 4, tone: "watch" },
    ],
    prioritized: [
      {
        id: "318093496024",
        name: "Mullen Brewer and Hernandez",
        segment: "Enterprise",
        plan_tier: "Pro",
        arr: 255000,
        risk_level: "High",
        health_score: "47",
        renewal_date: "2026-04-21",
        usage_trend: "Decreasing",
        open_ticket_count: "12",
        renewal_confidence: "At Risk",
        engagement_status: "At Risk",
        owner_name: "Zachary Hicks",
        priority_score: 106,
        priority_reasons: [
          "Low health score (47)",
          "Renewal in 7 days - critical",
          "Usage down 9% (30d)",
          "12 open tickets (escalated)",
          "Engagement: At Risk",
          "Renewal confidence: At Risk",
          "No CSM touch in 26 days",
          "High-value account ($255,000 ARR)",
        ],
        last_refreshed: "2026-04-14T22:00:00.000Z",
      },
      {
        id: "318093496016",
        name: "Hicks-Hill",
        segment: "Mid-market",
        plan_tier: "Pro",
        arr: 100000,
        risk_level: "High",
        health_score: "23",
        renewal_date: "2026-04-30",
        usage_trend: "Decreasing",
        open_ticket_count: "8",
        renewal_confidence: "At Risk",
        engagement_status: "At Risk",
        owner_name: "Margaret Hawkins DDS",
        priority_score: 104,
        priority_reasons: [
          "Critical health score (23)",
          "Renewal in 16 days",
          "Usage down 20% (30d)",
          "8 open tickets (escalated)",
          "Engagement: At Risk",
          "Renewal confidence: At Risk",
          "High-value account ($100,000 ARR)",
        ],
        last_refreshed: "2026-04-14T22:00:00.000Z",
      },
      {
        id: "317967706850",
        name: "Burns Hernandez and Ryan",
        segment: "Mid-market",
        plan_tier: "Growth",
        arr: 60000,
        risk_level: "High",
        health_score: "36",
        renewal_date: "2026-04-28",
        usage_trend: "Decreasing",
        open_ticket_count: "9",
        renewal_confidence: "At Risk",
        engagement_status: "At Risk",
        owner_name: "Lisa Jackson",
        priority_score: 101,
        priority_reasons: [
          "Low health score (36)",
          "Renewal in 14 days - critical",
          "Usage down 14% (30d)",
          "9 open tickets (escalated)",
          "Engagement: At Risk",
          "Renewal confidence: At Risk",
          "No CSM touch in 20 days",
        ],
        last_refreshed: "2026-04-14T22:00:00.000Z",
      },
      {
        id: "318093496030",
        name: "Alexander-Jordan",
        segment: "SMB",
        plan_tier: "Growth",
        arr: 7000,
        risk_level: "High",
        health_score: "41",
        renewal_date: "2026-05-06",
        usage_trend: "Decreasing",
        open_ticket_count: "10",
        renewal_confidence: "At Risk",
        engagement_status: "Declining",
        owner_name: "Jenna Ford",
        priority_score: 100,
        priority_reasons: [
          "Low health score (41)",
          "Renewal in 22 days",
          "Usage down 18% (30d)",
          "10 open tickets (escalated)",
          "Engagement declining",
        ],
        last_refreshed: "2026-04-14T22:00:00.000Z",
      },
      {
        id: "317967706852",
        name: "Williams Logan and Camacho",
        segment: "Mid-market",
        plan_tier: "Growth",
        arr: 80000,
        risk_level: "High",
        health_score: "26",
        renewal_date: "2026-04-25",
        usage_trend: "Decreasing",
        open_ticket_count: "7",
        renewal_confidence: "At Risk",
        engagement_status: "At Risk",
        owner_name: "Jamie Santos",
        priority_score: 97,
        priority_reasons: [
          "Critical health score (26)",
          "Renewal in 11 days - critical",
          "Usage down 12% (30d)",
          "7 open tickets (escalated)",
        ],
        last_refreshed: "2026-04-14T22:00:00.000Z",
      },
      {
        id: "318050881270",
        name: "Best-Townsend",
        segment: "Mid-market",
        plan_tier: "Pro",
        arr: 82500,
        risk_level: "High",
        health_score: "41",
        renewal_date: "2026-05-11",
        usage_trend: "Decreasing",
        open_ticket_count: "8",
        renewal_confidence: "At Risk",
        engagement_status: "Declining",
        owner_name: "Morgan Rose",
        priority_score: 97,
        priority_reasons: [
          "Low health score (41)",
          "Renewal in 27 days",
          "Usage down 10% (30d)",
          "8 open tickets (escalated)",
        ],
        last_refreshed: "2026-04-14T22:00:00.000Z",
      },
    ],
  },
  featuredAccount: {
    id: "318093496024",
    context: {
      crm: {
        id: "318093496024",
        name: "Mullen Brewer and Hernandez",
        domain: "mullenbrewerandhernandez.co",
        industry: "INFORMATION_TECHNOLOGY_AND_SERVICES",
        health_score: "47",
        risk_level: "High",
        renewal_date: "2026-04-21",
        usage_trend: "Decreasing",
        open_ticket_count: "12",
      },
      internal: {
        segment: "Enterprise",
        plan_tier: "Pro",
        arr: 255000,
        owner_name: "Zachary Hicks",
        engagement_status: "At Risk",
        days_since_last_touch: 26,
        active_users: 200,
        licensed_seats: 274,
        usage_change_30d: -9,
        top_issue_theme: "integration_failure",
        issue_severity: "Critical",
        open_escalation: true,
        onboarding_status: "Partial",
        champion_status: "Inactive",
        renewal_confidence: "At Risk",
        latest_ticket_summary: "Field mapping broke during automated sync setup.",
        recent_csm_note:
          "Mullen Brewer and Hernandez is currently high risk. Primary concern is integration failure. Health score is 47 with 12 open tickets and usage trend marked as decreasing.",
        recommended_next_action:
          "Schedule technical working session and provide workaround for sync issues.",
      },
      priority_score: 106,
      priority_reasons: [
        "Low health score (47)",
        "Renewal in 7 days - critical",
        "Usage down 9% (30d)",
        "12 open tickets (escalated)",
        "Engagement: At Risk",
        "Renewal confidence: At Risk",
        "No CSM touch in 26 days",
        "High-value account ($255,000 ARR)",
      ],
    },
    brief: {
      summary:
        "Mullen Brewer and Hernandez is a high risk Enterprise account on Pro, renewing on April 21, 2026.",
      why_risky: [
        "Low health score (47)",
        "Renewal in 7 days - critical",
        "Usage down 9% (30d)",
        "12 open tickets (escalated)",
        "No CSM touch in 26 days",
      ],
      key_issues: [
        "Field mapping broke during automated sync setup.",
        "Primary concern is integration failure with a shrinking champion footprint.",
      ],
      recommended_next_action:
        "Schedule technical working session and provide workaround for sync issues.",
    },
    similar: [
      {
        id: "318050881267",
        name: "Herman-Walker",
        similarity: 0.9432,
        risk_level: "High",
        health_score: "31",
        renewal_date: "2026-05-24",
        usage_trend: "Stable",
        segment: "Mid-market",
        arr: 50000,
        priority_score: 87,
        priority_reasons: [
          "Low health score (31)",
          "Renewal in 40 days",
          "Usage down 4% (30d)",
          "11 open tickets (escalated)",
          "Engagement: At Risk",
        ],
      },
      {
        id: "318050881266",
        name: "Baker Mason and White",
        similarity: 0.9405,
        risk_level: "High",
        health_score: "22",
        renewal_date: "2026-05-16",
        usage_trend: "Decreasing",
        segment: "Mid-market",
        arr: 32500,
        priority_score: 83,
        priority_reasons: [
          "Critical health score (22)",
          "Renewal in 32 days",
          "Usage down 6% (30d)",
          "8 open tickets (escalated)",
          "Engagement declining",
        ],
      },
      {
        id: "317967706850",
        name: "Burns Hernandez and Ryan",
        similarity: 0.9381,
        risk_level: "High",
        health_score: "36",
        renewal_date: "2026-04-28",
        usage_trend: "Decreasing",
        segment: "Mid-market",
        arr: 60000,
        priority_score: 101,
        priority_reasons: [
          "Low health score (36)",
          "Renewal in 14 days - critical",
          "Usage down 14% (30d)",
          "9 open tickets (escalated)",
          "Engagement: At Risk",
        ],
      },
    ],
  },
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function daysUntil(renewalDate?: string | null): number | null {
  if (!renewalDate) {
    return null;
  }

  try {
    return differenceInCalendarDays(parseISO(renewalDate), new Date());
  } catch {
    return null;
  }
}

function classifyThemes(accounts: PrioritizedAccount[]): RiskTheme[] {
  const themeMap = {
    "Renewal urgency": {
      count: 0,
      tone: "critical" as const,
      match: (reason: string) => reason.includes("Renewal in"),
    },
    "Ticket pressure": {
      count: 0,
      tone: "critical" as const,
      match: (reason: string) => reason.includes("ticket"),
    },
    "Usage decline": {
      count: 0,
      tone: "warning" as const,
      match: (reason: string) => reason.includes("Usage down"),
    },
    "Weak engagement": {
      count: 0,
      tone: "watch" as const,
      match: (reason: string) =>
        reason.includes("Engagement") ||
        reason.includes("No CSM touch") ||
        reason.includes("Renewal confidence"),
    },
  };

  for (const account of accounts) {
    const seen = new Set<string>();
    for (const reason of account.priority_reasons) {
      for (const [label, descriptor] of Object.entries(themeMap)) {
        if (!seen.has(label) && descriptor.match(reason)) {
          descriptor.count += 1;
          seen.add(label);
        }
      }
    }
  }

  return Object.entries(themeMap)
    .map(([label, descriptor]) => ({
      label,
      count: descriptor.count,
      tone: descriptor.tone,
    }))
    .sort((a, b) => b.count - a.count);
}

function normalizeAccounts(accounts: PrioritizedAccount[]): PrioritizedAccount[] {
  return accounts.map((account) => ({
    ...account,
    priority_reasons: account.priority_reasons ?? [],
  }));
}

function withComputedPortfolio(
  prioritized: PrioritizedAccount[],
  context: AccountContext,
  brief: AccountBrief,
  similar: SimilarAccount[],
  source: "live" | "fallback"
): WorkspaceBootstrap {
  const normalized = normalizeAccounts(prioritized);

  return {
    source,
    generatedAt: formatISO(new Date()),
    portfolio: {
      prioritized: normalized.slice(0, 8),
      totalAccounts: normalized.length,
      highRiskCount: normalized.filter(
        (account) => account.risk_level === "High"
      ).length,
      renewingSoonCount: normalized.filter((account) => {
        const days = daysUntil(account.renewal_date);
        return days !== null && days <= 30;
      }).length,
      topSavePlanCount: normalized.filter(
        (account) => account.priority_score >= 90
      ).length,
      riskThemes: classifyThemes(normalized),
    },
    featuredAccount: {
      id: context.crm.id,
      context,
      brief,
      similar,
    },
  };
}

function buildFallbackBootstrap(): WorkspaceBootstrap {
  return withComputedPortfolio(
    FALLBACK_DATA.portfolio.prioritized,
    FALLBACK_DATA.featuredAccount.context,
    FALLBACK_DATA.featuredAccount.brief,
    FALLBACK_DATA.featuredAccount.similar,
    "fallback"
  );
}

function buildFallbackAccountData(accountId?: string): WorkspaceAccountData {
  const fallbackId = accountId || FALLBACK_DATA.featuredAccount.id;
  const fallbackAccount =
    fallbackId === FALLBACK_DATA.featuredAccount.id
      ? FALLBACK_DATA.featuredAccount
      : FALLBACK_DATA.featuredAccount;

  return {
    source: "fallback",
    accountId: fallbackAccount.id,
    context: fallbackAccount.context,
    brief: fallbackAccount.brief,
    similar: fallbackAccount.similar,
  };
}

export async function getWorkspaceBootstrapData(): Promise<WorkspaceBootstrap> {
  try {
    const prioritizedResponse = await fetchJson<PrioritizedResponse>(
      "/accounts/prioritized?limit=100"
    );
    const prioritized = normalizeAccounts(prioritizedResponse.results ?? []);

    if (!prioritized.length) {
      return FALLBACK_DATA;
    }

    const featuredId = prioritized[0].id;
    const [context, brief, similarResponse] = await Promise.all([
      fetchJson<AccountContextResponse>(`/accounts/${featuredId}/context`),
      fetchJson<AccountBriefResponse>(`/accounts/${featuredId}/brief`),
      fetchJson<SimilarResponse>(`/accounts/similar/${featuredId}?limit=5`),
    ]);

    return withComputedPortfolio(
      prioritized,
      context,
      brief,
      similarResponse.results ?? [],
      "live"
    );
  } catch {
    return buildFallbackBootstrap();
  }
}

export async function getAccountWorkspaceData(
  accountId: string
): Promise<WorkspaceAccountData> {
  try {
    const [context, brief, similarResponse] = await Promise.all([
      fetchJson<AccountContextResponse>(`/accounts/${accountId}/context`),
      fetchJson<AccountBriefResponse>(`/accounts/${accountId}/brief`),
      fetchJson<SimilarResponse>(`/accounts/similar/${accountId}?limit=5`),
    ]);

    return {
      source: "live",
      accountId,
      context,
      brief,
      similar: similarResponse.results ?? [],
    };
  } catch {
    return buildFallbackAccountData(accountId);
  }
}
