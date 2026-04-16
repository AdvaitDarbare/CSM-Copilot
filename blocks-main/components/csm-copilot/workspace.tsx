"use client";

import type { ChatStatus } from "ai";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  RefreshCcwIcon,
  RadarIcon,
  SparklesIcon,
  TicketIcon,
  UsersRoundIcon,
} from "lucide-react";
import { startTransition, useCallback, useMemo, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import {
  type PrioritizedAccount,
  type SimilarAccount,
  type WorkspaceAccountData,
  type WorkspaceBootstrap,
} from "@/lib/csm-data";
import { cn } from "@/lib/utils";

type WorkflowId = "morning" | "brief" | "similar";

type TriageAccountCard = {
  id: string;
  name: string;
  risk_level: string;
  priority_score: number;
  renewal_date?: string | null;
  top_reason: string;
  arr?: number | null;
};

type BriefSnapshot = {
  id: string;
  name: string;
  risk_level?: string | null;
  health_score?: string | null;
  renewal_date?: string | null;
  arr?: number | null;
  open_tickets?: string | null;
  engagement?: string | null;
  owner?: string | null;
  segment?: string | null;
  priority_score: number;
  recommended_next_action?: string | null;
  top_reason: string;
};

type SimilarAccountCard = {
  id: string;
  name: string;
  similarity: number;
  risk_level?: string | null;
  health_score?: string | null;
  renewal_date?: string | null;
  top_reason: string;
};

type AgentResponse = {
  reply: string;
  workflow: WorkflowId;
  account_id?: string | null;
  workflow_stages?: string[];
  artifact_title?: string | null;
  provenance?: string[] | null;
  triage_accounts?: TriageAccountCard[] | null;
  brief_snapshot?: BriefSnapshot | null;
  similar_accounts?: SimilarAccountCard[] | null;
};

type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  workflow?: WorkflowId;
  artifactTitle?: string | null;
  triageAccounts?: TriageAccountCard[] | null;
  briefSnapshot?: BriefSnapshot | null;
  similarAccounts?: SimilarAccountCard[] | null;
};

export function CopilotWorkspace({
  initialData,
}: {
  initialData: WorkspaceBootstrap;
}) {
  const [workspaceData, setWorkspaceData] = useState(initialData);
  const [accountData, setAccountData] = useState<WorkspaceAccountData>(() =>
    bootstrapToAccountData(initialData)
  );
  const [accountCache, setAccountCache] = useState<
    Record<string, WorkspaceAccountData>
  >(() => ({
    [initialData.featuredAccount.id]: bootstrapToAccountData(initialData),
  }));
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [isThinking, setIsThinking] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const portfolio = workspaceData.portfolio;
  const featuredAccountName = accountData.context.crm.name;
  const hasConversation = messages.length > 0;

  const loadAccount = useCallback(
    async (accountId: string) => {
      if (accountCache[accountId]) {
        setAccountData(accountCache[accountId]);
      }

      try {
        const response = await fetch(`/api/workspace/account/${accountId}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Failed to load account ${accountId}`);
        }
        const data = (await response.json()) as WorkspaceAccountData;
        startTransition(() => {
          setAccountData(data);
          setAccountCache((current) => ({ ...current, [accountId]: data }));
        });
        return data;
      } catch {
        const fallback =
          accountCache[accountId] ??
          (accountId === accountData.accountId ? accountData : null);
        if (fallback) {
          setAccountData(fallback);
          return fallback;
        }
        return accountData;
      }
    },
    [accountCache, accountData]
  );

  const refreshWorkspace = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/workspace/bootstrap", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to refresh workspace");
      }

      const data = (await response.json()) as WorkspaceBootstrap;
      const featured = bootstrapToAccountData(data);

      startTransition(() => {
        setWorkspaceData(data);
        setAccountCache((current) => ({
          ...current,
          [featured.accountId]: featured,
        }));
        if (accountData.accountId === featured.accountId || !hasConversation) {
          setAccountData(featured);
        }
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [accountData.accountId, hasConversation]);

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status !== "ready") {
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, role: "user", content: trimmed },
      ]);
      setInputValue("");
      setStatus("submitted");
      setIsThinking(true);

      const localWorkflowId = inferWorkflowFromPrompt(
        trimmed,
        featuredAccountName
      );
      const localAccountId = resolveAccountFromPrompt(
        trimmed,
        portfolio.prioritized,
        accountData
      );

      if (localAccountId !== accountData.accountId) {
        void loadAccount(localAccountId);
      }

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            account_id: localAccountId ?? undefined,
          }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(errorText || `Request failed: ${res.status}`);
        }

        const agentResp: AgentResponse = await res.json();

        if (
          agentResp.account_id &&
          agentResp.account_id !== accountData.accountId
        ) {
          void loadAccount(agentResp.account_id);
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: agentResp.reply,
            workflow: agentResp.workflow,
            artifactTitle: agentResp.artifact_title,
            triageAccounts: agentResp.triage_accounts,
            briefSnapshot: agentResp.brief_snapshot,
            similarAccounts: agentResp.similar_accounts,
          },
        ]);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.replace(/^"|"$/g, "")
            : buildWorkflowAnswer(
                localWorkflowId,
                trimmed,
                workspaceData,
                accountData
              );

        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: message,
            workflow: localWorkflowId,
          },
        ]);
      } finally {
        setIsThinking(false);
        setStatus("ready");
      }
    },
    [
      accountData,
      featuredAccountName,
      loadAccount,
      portfolio.prioritized,
      status,
      workspaceData,
    ]
  );

  const starterPrompts = useMemo(
    () => [
      {
        label: "Morning triage",
        description:
          "Rank today’s urgent accounts, renewal deadlines, and repeated risk themes.",
        prompt: "What should I focus on this morning?",
        icon: RadarIcon,
      },
      {
        label: "Pre-call brief",
        description: `Pull the latest account context for ${featuredAccountName}.`,
        prompt: `I have a call with ${featuredAccountName} in 20 minutes. What should I know?`,
        icon: BriefcaseBusinessIcon,
      },
      {
        label: "Pattern analysis",
        description:
          "Check whether the current account fits a broader portfolio risk pattern.",
        prompt: `Is ${featuredAccountName} an isolated problem or part of a broader pattern?`,
        icon: UsersRoundIcon,
      },
    ],
    [featuredAccountName]
  );

  const portfolioStats = useMemo(
    () => [
      {
        label: "High risk",
        value: portfolio.highRiskCount,
        icon: CircleAlertIcon,
        tone: "critical" as const,
      },
      {
        label: "Renewing in 30d",
        value: portfolio.renewingSoonCount,
        icon: CalendarClockIcon,
        tone: "warning" as const,
      },
      {
        label: "Save-plan range",
        value: portfolio.topSavePlanCount,
        icon: AlertTriangleIcon,
        tone: "watch" as const,
      },
    ],
    [portfolio]
  );

  const resetSession = useCallback(() => {
    setMessages([]);
    setInputValue("");
    setStatus("ready");
    setIsThinking(false);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#f4efe6] text-slate-900">
      <header className="border-b border-black/6 bg-[#f8f4ed]/90 px-4 py-3 backdrop-blur lg:px-6">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-2xl bg-[#171717] shadow-sm">
              <SparklesIcon className="size-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">
                CSM Copilot
              </div>
              <div className="text-xs text-slate-500">
                Workflow-first renewal intelligence
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 shadow-sm ring-1 ring-black/5">
              <span
                className={cn(
                  "size-2 rounded-full",
                  workspaceData.source === "live"
                    ? "bg-emerald-500"
                    : "bg-amber-400"
                )}
              />
              {featuredAccountName}
            </span>
            <button
              className="rounded-xl bg-white/80 p-2 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-white"
              disabled={isRefreshing}
              onClick={refreshWorkspace}
              title="Refresh data"
              type="button"
            >
              <RefreshCcwIcon
                className={cn("size-4", isRefreshing && "animate-spin")}
              />
            </button>
            <button
              className="rounded-xl bg-white px-3 py-2 text-[12px] font-medium text-slate-700 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-slate-50"
              onClick={resetSession}
              type="button"
            >
              New session
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-5 lg:p-5">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-black/6 bg-white shadow-[0_24px_80px_-40px_rgba(15,23,42,0.32)]">
          <Conversation className="min-h-0 flex-1 bg-white">
            <ConversationContent className="mx-auto flex w-full max-w-[860px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
              {!hasConversation && (
                <div className="flex flex-col gap-8">
                  <div className="overflow-hidden rounded-[28px] border border-black/6 bg-[linear-gradient(135deg,#fff9ef_0%,#f7f2e9_48%,#f2ede5_100%)] p-6 shadow-sm">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                      <div className="max-w-[540px] space-y-3">
                        <Badge
                          className="border-0 bg-[#171717] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white"
                          variant="outline"
                        >
                          Live workspace
                        </Badge>
                        <div>
                          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                            Make the next customer move obvious.
                          </h1>
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            Start with morning triage, pull a pre-call brief, or
                            pressure-test whether an account is part of a wider
                            renewal pattern.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {portfolioStats.map((stat) => {
                          const Icon = stat.icon;
                          return (
                            <div
                              className="min-w-[150px] rounded-2xl border border-black/6 bg-white/90 p-4 shadow-sm"
                              key={stat.label}
                            >
                              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                                <Icon className="size-3.5" />
                                {stat.label}
                              </div>
                              <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                                {stat.value}
                              </div>
                              <div
                                className={cn(
                                  "mt-2 text-xs",
                                  stat.tone === "critical" &&
                                    "text-rose-600",
                                  stat.tone === "warning" &&
                                    "text-amber-600",
                                  stat.tone === "watch" &&
                                    "text-slate-500"
                                )}
                              >
                                {stat.tone === "critical" &&
                                  "Immediate intervention candidates"}
                                {stat.tone === "warning" &&
                                  "Near-term renewal pressure"}
                                {stat.tone === "watch" &&
                                  "High-score rescue motions"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    {starterPrompts.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          className="group flex h-full flex-col gap-3 rounded-[24px] border border-black/6 bg-[#fcfaf6] p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-md"
                          key={item.label}
                          onClick={() => void handleSubmit(item.prompt)}
                          type="button"
                        >
                          <div className="grid size-10 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                            <Icon className="size-4 text-slate-700" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-950">
                              {item.label}
                            </div>
                            <p className="mt-1 text-sm leading-6 text-slate-500">
                              {item.description}
                            </p>
                          </div>
                          <div className="mt-auto flex items-center gap-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-400 transition-colors group-hover:text-slate-600">
                            Launch workflow
                            <ArrowRightIcon className="size-3.5" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <Message
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  from={message.role}
                  key={message.id}
                >
                  <MessageContent
                    className={cn(
                      message.role === "user"
                        ? "ml-auto max-w-[75%] rounded-[24px] bg-[#1b1b1b] px-4 py-3 text-white shadow-sm"
                        : "w-full"
                    )}
                  >
                    {message.role === "assistant" ? (
                      <AssistantPayload
                        message={message}
                        onSelectAccount={(id) => void loadAccount(id)}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-[13.5px] leading-6">
                        {message.content}
                      </p>
                    )}
                  </MessageContent>
                </Message>
              ))}

              {isThinking && (
                <Message
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  from="assistant"
                >
                  <ThinkingDots />
                </Message>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="shrink-0 border-t border-black/6 bg-[#fcfaf6] px-4 py-4 sm:px-6 lg:px-8">
            <PromptInput
              className="[&>[data-slot=input-group]]:rounded-[28px] [&>[data-slot=input-group]]:border-black/10 [&>[data-slot=input-group]]:bg-white [&>[data-slot=input-group]]:shadow-sm"
              onSubmit={(message) => handleSubmit(message.text)}
            >
              <PromptInputTextarea
                onChange={(e) => setInputValue(e.currentTarget.value)}
                placeholder={`Ask about ${featuredAccountName}, renewals, or risk patterns…`}
                value={inputValue}
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <PromptInputButton
                    aria-label="Morning triage"
                    onClick={() =>
                      void handleSubmit("What should I focus on this morning?")
                    }
                    title="Morning triage"
                    type="button"
                  >
                    <RadarIcon className="size-4" />
                  </PromptInputButton>
                  <PromptInputButton
                    aria-label="Pre-call brief"
                    onClick={() =>
                      void handleSubmit(
                        `I have a call with ${featuredAccountName} in 20 minutes. What should I know?`
                      )
                    }
                    title="Pre-call brief"
                    type="button"
                  >
                    <BriefcaseBusinessIcon className="size-4" />
                  </PromptInputButton>
                  <PromptInputButton
                    aria-label="Pattern analysis"
                    onClick={() =>
                      void handleSubmit(
                        `Is ${featuredAccountName} an isolated problem or part of a broader pattern?`
                      )
                    }
                    title="Pattern analysis"
                    type="button"
                  >
                    <UsersRoundIcon className="size-4" />
                  </PromptInputButton>
                </PromptInputTools>
                <PromptInputSubmit
                  disabled={!inputValue.trim() || status !== "ready"}
                  status={status}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[380px]">
          <AccountRadarPanel
            accountData={accountData}
            portfolio={portfolio}
            onSelectAccount={(id) => void loadAccount(id)}
          />
        </aside>
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-black/6 bg-[#fcfaf6] px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          className="size-1.5 animate-bounce rounded-full bg-slate-400"
          key={i}
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function AssistantPayload({
  message,
  onSelectAccount,
}: {
  message: ChatEntry;
  onSelectAccount: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {(message.artifactTitle || message.workflow) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">
          {message.artifactTitle && (
            <Badge className="border-0 bg-slate-900 px-2 py-0.5 text-white">
              {message.artifactTitle}
            </Badge>
          )}
          {message.workflow && <span>{workflowLabel(message.workflow)}</span>}
        </div>
      )}
      <MessageResponse className="prose prose-slate max-w-none text-[14px] leading-7">
        {message.content}
      </MessageResponse>
      {message.triageAccounts && message.triageAccounts.length > 0 && (
        <InlineTriageCard
          accounts={message.triageAccounts}
          onSelect={onSelectAccount}
        />
      )}
      {message.briefSnapshot && (
        <InlineBriefCard snapshot={message.briefSnapshot} />
      )}
      {message.similarAccounts && message.similarAccounts.length > 0 && (
        <InlineSimilarCard
          accounts={message.similarAccounts}
          onSelect={onSelectAccount}
        />
      )}
    </div>
  );
}

function InlineTriageCard({
  accounts,
  onSelect,
}: {
  accounts: TriageAccountCard[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-black/6 bg-[#fcfaf6] shadow-sm">
      {accounts.map((account, index) => (
        <button
          className="flex w-full items-center gap-3 border-b border-black/5 px-4 py-3 text-left transition-colors last:border-0 hover:bg-white"
          key={account.id}
          onClick={() => onSelect(account.id)}
          type="button"
        >
          <span className="w-4 shrink-0 text-[12px] font-medium text-slate-400">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-slate-900">
                {account.name}
              </span>
              <RiskBadge value={account.risk_level} />
            </div>
            <p className="mt-0.5 truncate text-[12px] text-slate-500">
              {account.top_reason}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[13px] font-semibold text-slate-700">
              {account.priority_score}
            </div>
            {account.renewal_date && (
              <div className="text-[11px] text-slate-400">
                {formatDateShort(account.renewal_date)}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function InlineBriefCard({ snapshot }: { snapshot: BriefSnapshot }) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-black/6 bg-[#fcfaf6] shadow-sm">
      <div className="border-b border-black/5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{snapshot.name}</span>
          <RiskBadge value={snapshot.risk_level} />
          <span className="text-[12px] text-slate-400">
            Score {snapshot.priority_score}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate-500">
          {snapshot.arr && <span>{formatCurrency(snapshot.arr)} ARR</span>}
          {snapshot.renewal_date && (
            <span>{formatRenewalWindow(snapshot.renewal_date)}</span>
          )}
          {snapshot.segment && <span>{snapshot.segment}</span>}
          {snapshot.engagement && <span>{snapshot.engagement}</span>}
          {snapshot.open_tickets && (
            <span>{snapshot.open_tickets} tickets open</span>
          )}
        </div>
      </div>
      <div className="border-b border-black/5 bg-amber-50/70 px-4 py-3">
        <p className="text-[12.5px] leading-5 text-slate-700">
          {snapshot.top_reason}
        </p>
      </div>
      {snapshot.recommended_next_action && (
        <div className="bg-slate-950 px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-slate-400">
            <SparklesIcon className="size-3" />
            Recommended move
          </div>
          <p className="text-[12.5px] leading-5 text-white">
            {snapshot.recommended_next_action}
          </p>
        </div>
      )}
    </div>
  );
}

function InlineSimilarCard({
  accounts,
  onSelect,
}: {
  accounts: SimilarAccountCard[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-black/6 bg-[#fcfaf6] shadow-sm">
      {accounts.map((account) => (
        <button
          className="w-full border-b border-black/5 px-4 py-3 text-left transition-colors last:border-0 hover:bg-white"
          key={account.id}
          onClick={() => onSelect(account.id)}
          type="button"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold text-slate-900">
                  {account.name}
                </span>
                <RiskBadge value={account.risk_level} />
              </div>
              <p className="mt-0.5 truncate text-[12px] text-slate-500">
                {account.top_reason}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[13px] font-semibold text-slate-700">
                {Math.round(account.similarity * 100)}%
              </div>
              <div className="text-[11px] text-slate-400">match</div>
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/6">
            <div
              className="h-full rounded-full bg-slate-800 transition-all duration-500"
              style={{ width: `${account.similarity * 100}%` }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

function AccountRadarPanel({
  accountData,
  portfolio,
  onSelectAccount,
}: {
  accountData: WorkspaceAccountData;
  portfolio: WorkspaceBootstrap["portfolio"];
  onSelectAccount: (id: string) => void;
}) {
  const context = accountData.context;
  const brief = accountData.brief;
  const renewalDate = context.crm.renewal_date;
  const recommendedAction =
    brief?.recommended_next_action || context.internal.recommended_next_action;

  return (
    <>
      <div className="overflow-hidden rounded-[28px] border border-black/6 bg-[#131313] text-white shadow-[0_24px_80px_-40px_rgba(15,23,42,0.42)]">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-0 bg-white/10 text-white" variant="outline">
              Active account
            </Badge>
            <RiskBadge value={context.crm.risk_level} inverted />
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            {context.crm.name}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {brief?.summary ||
              `${context.crm.name} is currently in focus because it carries one of the highest priority scores in the portfolio.`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-px bg-white/10">
          <MetricTile
            label="Priority score"
            value={String(context.priority_score)}
            subtle="Weighted urgency"
          />
          <MetricTile
            label="Renewal window"
            value={renewalDate ? daysLabel(renewalDate) : "Unknown"}
            subtle={renewalDate ? formatDateShort(renewalDate) : "No date"}
          />
          <MetricTile
            label="Health score"
            value={context.crm.health_score || "n/a"}
            subtle={context.crm.usage_trend || "No usage trend"}
          />
          <MetricTile
            label="Open tickets"
            value={context.crm.open_ticket_count || "0"}
            subtle={
              context.internal.open_escalation ? "Escalation active" : "No live escalation"
            }
          />
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
              Why this account is bubbling up
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {context.priority_reasons.slice(0, 5).map((reason) => (
                <span
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-slate-200"
                  key={reason}
                >
                  {reason}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
              Key issue
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-200">
              {context.internal.latest_ticket_summary}
            </p>
          </div>

          <div className="rounded-[22px] border border-emerald-400/20 bg-emerald-400/10 p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-200">
              Next action
            </div>
            <p className="mt-2 text-sm leading-6 text-white">
              {recommendedAction}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-black/6 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">
              Portfolio pulse
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Current pressure themes across the book of business.
            </p>
          </div>
          <Badge className="border-black/10 bg-slate-50 text-slate-600">
            {portfolio.totalAccounts} accounts
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <PanelStat
            icon={CircleAlertIcon}
            label="High risk"
            value={portfolio.highRiskCount}
          />
          <PanelStat
            icon={CalendarClockIcon}
            label="Renewing in 30 days"
            value={portfolio.renewingSoonCount}
          />
          <PanelStat
            icon={TicketIcon}
            label="Top save-plan range"
            value={portfolio.topSavePlanCount}
          />
        </div>

        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
            Repeated risk themes
          </div>
          <div className="mt-3 space-y-2">
            {portfolio.riskThemes.slice(0, 4).map((theme) => (
              <div
                className="flex items-center justify-between rounded-2xl bg-[#f8f4ed] px-3 py-2.5"
                key={theme.label}
              >
                <span className="text-sm text-slate-700">{theme.label}</span>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500">
                  {theme.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-black/6 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">
              Nearby accounts
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Peer accounts with similar risk shape or shared evidence.
            </p>
          </div>
          <Badge className="border-black/10 bg-slate-50 text-slate-600">
            {accountData.similar.length}
          </Badge>
        </div>

        <div className="mt-4 space-y-2">
          {(accountData.similar.length
            ? accountData.similar.slice(0, 4)
            : portfolio.prioritized
                .filter((account) => account.id !== context.crm.id)
                .slice(0, 4)
          ).map((account) => (
            <button
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-black/6 px-3 py-3 text-left transition-colors hover:bg-slate-50"
              key={account.id}
              onClick={() => onSelectAccount(account.id)}
              type="button"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {account.name}
                  </span>
                  <RiskBadge value={account.risk_level} />
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {account.priority_reasons?.[0] || "Review peer context"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {"similarity" in account ? (
                  <div className="text-sm font-semibold text-slate-700">
                    {Math.round(account.similarity * 100)}%
                  </div>
                ) : (
                  <div className="text-sm font-semibold text-slate-700">
                    {account.priority_score}
                  </div>
                )}
                <div className="text-[11px] text-slate-400">
                  {"similarity" in account ? "match" : "score"}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function MetricTile({
  label,
  value,
  subtle,
}: {
  label: string;
  value: string;
  subtle: string;
}) {
  return (
    <div className="bg-[#181818] px-5 py-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{subtle}</div>
    </div>
  );
}

function PanelStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleAlertIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-[22px] bg-[#f8f4ed] p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </div>
    </div>
  );
}

function RiskBadge({
  value,
  inverted = false,
}: {
  value?: string | null;
  inverted?: boolean;
}) {
  const normalized = value || "Unknown";
  return (
    <Badge
      className={cn(
        "border-0 px-2 py-0.5 text-[11px]",
        !inverted && normalized === "High" && "bg-rose-100 text-rose-700",
        !inverted && normalized === "Medium" && "bg-amber-100 text-amber-700",
        !inverted && normalized === "Low" && "bg-emerald-100 text-emerald-700",
        inverted && normalized === "High" && "bg-rose-500/20 text-rose-100",
        inverted && normalized === "Medium" && "bg-amber-500/20 text-amber-100",
        inverted && normalized === "Low" && "bg-emerald-500/20 text-emerald-100",
        normalized !== "High" &&
          normalized !== "Medium" &&
          normalized !== "Low" &&
          (inverted ? "bg-white/10 text-slate-200" : "bg-slate-100 text-slate-600")
      )}
      variant="outline"
    >
      {normalized}
    </Badge>
  );
}

function inferWorkflowFromPrompt(
  prompt: string,
  currentAccountName: string
): WorkflowId {
  const lower = prompt.toLowerCase();
  if (
    lower.includes("similar") ||
    lower.includes("same pattern") ||
    lower.includes("same issues") ||
    lower.includes("pattern") ||
    lower.includes("isolated")
  ) {
    return "similar";
  }
  if (
    lower.includes("call") ||
    lower.includes("brief") ||
    lower.includes("prep") ||
    lower.includes("customer") ||
    lower.includes(currentAccountName.toLowerCase())
  ) {
    return "brief";
  }
  return "morning";
}

function resolveAccountFromPrompt(
  prompt: string,
  prioritized: PrioritizedAccount[],
  currentAccountData: WorkspaceAccountData
): string {
  const lower = prompt.toLowerCase();
  const candidates = [
    {
      id: currentAccountData.accountId,
      name: currentAccountData.context.crm.name,
    },
    ...prioritized.map((account) => ({ id: account.id, name: account.name })),
  ];

  const directMatch = candidates.find((candidate) =>
    lower.includes(candidate.name.toLowerCase())
  );
  if (directMatch) {
    return directMatch.id;
  }

  const tokenMatch = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: candidate.name
        .toLowerCase()
        .split(/[\s-]+/)
        .filter((token) => token.length >= 4 && lower.includes(token)).length,
    }))
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score)[0];

  return tokenMatch?.id ?? currentAccountData.accountId;
}

function buildWorkflowAnswer(
  workflowId: WorkflowId,
  prompt: string,
  workspaceData: WorkspaceBootstrap,
  accountData: WorkspaceAccountData
): string {
  if (workflowId === "brief") {
    return buildBriefAnswer(accountData);
  }
  if (workflowId === "similar") {
    return buildSimilarityAnswer(prompt, accountData);
  }
  return buildPortfolioAnswer(workspaceData);
}

function buildPortfolioAnswer(workspaceData: WorkspaceBootstrap): string {
  const focusAccounts = workspaceData.portfolio.prioritized.slice(0, 3);
  const topTheme = workspaceData.portfolio.riskThemes[0];
  return `The first accounts I would work are **${focusAccounts
    .map((account) => account.name)
    .join("**, **")}**.\n\nAcross the portfolio there are **${workspaceData.portfolio.highRiskCount}** high-risk accounts and **${workspaceData.portfolio.topSavePlanCount}** accounts already in rescue range. The strongest repeated theme is **${topTheme?.label.toLowerCase() || "renewal pressure"}**.`;
}

function buildBriefAnswer(accountData: WorkspaceAccountData): string {
  const brief = accountData.brief;
  if (!brief) {
    return `Here is the current context for **${accountData.context.crm.name}**. Ask a more specific question if you want the full pre-call brief.`;
  }

  const topWhy = brief.why_risky.slice(0, 3).join(", ");
  return `**${accountData.context.crm.name}** is a **${(accountData.context.crm.risk_level || "high").toLowerCase()}-risk** account ${accountData.context.crm.renewal_date ? `renewing ${formatRenewalWindow(accountData.context.crm.renewal_date).toLowerCase()}` : "with no confirmed renewal date"}.\n\nThe main drivers are ${topWhy.toLowerCase()}.\n\nThe next move is **${brief.recommended_next_action.toLowerCase()}**.`;
}

function buildSimilarityAnswer(
  prompt: string,
  accountData: WorkspaceAccountData
): string {
  const closest = accountData.similar.slice(0, 3);
  const closestNames = closest.map((account) => account.name);
  const shared = deriveSharedPatterns(accountData.similar)
    .filter((pattern) => pattern.count > 0)
    .map((pattern) => pattern.label.toLowerCase())
    .slice(0, 3);

  if (closestNames.length === 0) {
    return `I could not find close peer matches for **${accountData.context.crm.name}** yet.`;
  }

  if (prompt.toLowerCase().includes("isolated")) {
    return `No, **${accountData.context.crm.name}** does not look isolated. The closest matches are **${closestNames.join("**, **")}**, and they share **${shared.join(", ") || "a similar risk shape"}**.`;
  }

  return `The closest accounts to **${accountData.context.crm.name}** are **${closestNames.join("**, **")}**. The recurring pattern is **${shared.join(", ") || "a mix of support load and renewal exposure"}**, which suggests a repeatable risk shape rather than a one-off issue.`;
}

function deriveSharedPatterns(similar: SimilarAccount[]) {
  const counters = new Map<string, number>([
    ["Support load", 0],
    ["Renewal pressure", 0],
    ["Usage softness", 0],
  ]);

  for (const account of similar) {
    const blob = account.priority_reasons.join(" | ");
    if (blob.includes("ticket")) {
      counters.set("Support load", (counters.get("Support load") ?? 0) + 1);
    }
    if (blob.includes("Renewal in")) {
      counters.set(
        "Renewal pressure",
        (counters.get("Renewal pressure") ?? 0) + 1
      );
    }
    if (blob.includes("Usage down")) {
      counters.set(
        "Usage softness",
        (counters.get("Usage softness") ?? 0) + 1
      );
    }
  }

  return Array.from(counters.entries()).map(([label, count]) => ({
    label,
    count,
  }));
}

function workflowLabel(workflow: WorkflowId) {
  if (workflow === "brief") {
    return "Pre-call prep";
  }
  if (workflow === "similar") {
    return "Pattern analysis";
  }
  return "Morning triage";
}

function formatCurrency(value?: number | null): string {
  if (!value) {
    return "$0";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: value >= 100000 ? "compact" : "standard",
  }).format(value);
}

function formatDateShort(value?: string | null): string {
  if (!value) {
    return "No renewal date";
  }

  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function daysLabel(value?: string | null) {
  if (!value) {
    return "No date";
  }

  try {
    const days = differenceInCalendarDays(parseISO(value), new Date());
    if (days <= 0) {
      return "Due now";
    }
    if (days === 1) {
      return "1 day";
    }
    return `${days} days`;
  } catch {
    return "Unknown";
  }
}

function formatRenewalWindow(value?: string | null) {
  if (!value) {
    return "No renewal date";
  }

  const days = daysLabel(value);
  if (days === "Due now") {
    return `Renews now (${formatDateShort(value)})`;
  }
  return `Renews in ${days} (${formatDateShort(value)})`;
}

function bootstrapToAccountData(
  data: WorkspaceBootstrap
): WorkspaceAccountData {
  return {
    source: data.source,
    accountId: data.featuredAccount.id,
    context: data.featuredAccount.context,
    brief: data.featuredAccount.brief,
    similar: data.featuredAccount.similar,
  };
}
