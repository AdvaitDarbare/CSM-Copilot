"use client";

import type { ChatStatus } from "ai";
import { format, parseISO } from "date-fns";
import {
  ArrowRightIcon,
  BadgeAlertIcon,
  BriefcaseBusinessIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  LoaderCircleIcon,
  RadarIcon,
  RefreshCcwIcon,
  SparklesIcon,
  UsersRoundIcon,
  WorkflowIcon,
} from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type AccountBrief,
  type AccountContext,
  type PrioritizedAccount,
  type RiskTheme,
  type SimilarAccount,
  type WorkspaceAccountData,
  type WorkspaceBootstrap,
} from "@/lib/csm-data";
import { cn } from "@/lib/utils";

type WorkflowId = "morning" | "brief" | "similar";

// ── Generative UI data types (mirrors Python backend) ─────────────────────

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
  triage_accounts?: TriageAccountCard[] | null;
  brief_snapshot?: BriefSnapshot | null;
  similar_accounts?: SimilarAccountCard[] | null;
};

// ─────────────────────────────────────────────────────────────────────────

type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Generative UI payloads (only on assistant messages)
  triageAccounts?: TriageAccountCard[] | null;
  briefSnapshot?: BriefSnapshot | null;
  similarAccounts?: SimilarAccountCard[] | null;
};

type FlowDefinition = {
  id: WorkflowId;
  label: string;
  prompt: string;
  answer: string;
  artifactTitle: string;
  artifactSummary: string;
  steps: string[];
};

type RunState = {
  workflowId: WorkflowId;
  steps: string[];
  currentStep: number;
};

type WorkflowRunConfig = {
  workflowId: WorkflowId;
  prompt?: string;
  accountId?: string;
  answer?: (data: WorkspaceAccountData) => string;
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
  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "**Welcome to CSM Copilot.** This workspace is tuned for account triage, pre-call prep, and risk pattern discovery. Ask a question or use one of the guided prompts to assemble a durable artifact on the right.",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowId>("morning");
  const [runState, setRunState] = useState<RunState | null>(null);
  const [accountStatus, setAccountStatus] = useState<"idle" | "loading">("idle");
  const [refreshStatus, setRefreshStatus] = useState<"idle" | "loading">("idle");
  const [hasArtifact, setHasArtifact] = useState(false);
  const timeoutIdsRef = useRef<number[]>([]);

  const featuredAccount = accountData.context;
  const portfolio = workspaceData.portfolio;
  const flows = useMemo(
    () => buildFlows(workspaceData, accountData),
    [workspaceData, accountData]
  );

  const clearRunTimers = useCallback(() => {
    for (const timeoutId of timeoutIdsRef.current) {
      window.clearTimeout(timeoutId);
    }
    timeoutIdsRef.current = [];
  }, []);

  useEffect(() => clearRunTimers, [clearRunTimers]);

  const loadAccount = useCallback(
    async (accountId: string, workflowId?: WorkflowId) => {
      if (workflowId) {
        setActiveWorkflow(workflowId);
      }

      if (accountData.accountId === accountId && accountCache[accountId]) {
        setAccountData(accountCache[accountId]);
        return accountCache[accountId];
      }

      if (accountCache[accountId]) {
        setAccountData(accountCache[accountId]);
      }

      setAccountStatus("loading");

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
          setAccountCache((current) => ({
            ...current,
            [accountId]: data,
          }));
        });
        return data;
      } catch {
        if (accountCache[accountId]) {
          setAccountData(accountCache[accountId]);
          return accountCache[accountId];
        }
        return accountData;
      } finally {
        setAccountStatus("idle");
      }
    },
    [accountCache, accountData]
  );

  const refreshWorkspace = useCallback(async () => {
    setRefreshStatus("loading");

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

        if (
          accountData.accountId === featured.accountId ||
          accountData.source === "fallback"
        ) {
          setAccountData(featured);
        }
      });
    } finally {
      setRefreshStatus("idle");
    }
  }, [accountData.accountId, accountData.source]);

  const runWorkflow = useCallback(
    async ({
      workflowId,
      prompt: promptOverride,
      accountId,
      answer,
    }: WorkflowRunConfig) => {
      clearRunTimers();

      const flow = flows[workflowId];
      const prompt = promptOverride?.trim() || flow.prompt;
      const startedAt = Date.now();

      setMessages((current) => [
        ...current,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: prompt,
        },
      ]);
      setRunState({
        workflowId,
        steps: flow.steps,
        currentStep: 0,
      });
      setStatus("submitted");
      setActiveWorkflow(workflowId);

      flow.steps.forEach((_, index) => {
        const timeoutId = window.setTimeout(() => {
          setRunState((current) =>
            current
              ? {
                  ...current,
                  currentStep: index + 1,
                }
              : current
          );
        }, 550 * (index + 1));

        timeoutIdsRef.current.push(timeoutId);
      });

      const targetData =
        accountId && accountId !== accountData.accountId
          ? await loadAccount(accountId, workflowId)
          : accountData;

      const completionTimeoutId = window.setTimeout(() => {
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: answer ? answer(targetData) : flow.answer,
          },
        ]);
        setHasArtifact(true);
        setRunState(null);
        setStatus("ready");
      }, Math.max(flow.steps.length * 550 + 350 - (Date.now() - startedAt), 160));

      timeoutIdsRef.current.push(completionTimeoutId);
    },
    [accountData, clearRunTimers, flows, loadAccount]
  );

  // ── Real agent submit — calls the /api/chat endpoint ───────────────────
  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status !== "ready") return;

      // Add user message immediately
      const userMsgId = `user-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: trimmed },
      ]);
      setInputValue("");
      setStatus("submitted");

      // Determine which workflow to show in the step tracker
      const localWorkflowId = inferWorkflowFromPrompt(trimmed, featuredAccount.crm.name);
      const localAccountId = resolveAccountFromPrompt(trimmed, portfolio.prioritized, accountData);
      const flow = flows[localWorkflowId];

      // Start step animation
      clearRunTimers();
      setRunState({ workflowId: localWorkflowId, steps: flow.steps, currentStep: 0 });
      setActiveWorkflow(localWorkflowId);

      flow.steps.forEach((_, index) => {
        const id = window.setTimeout(() => {
          setRunState((cur) => cur ? { ...cur, currentStep: index + 1 } : cur);
        }, 600 * (index + 1));
        timeoutIdsRef.current.push(id);
      });

      // If account changed, load its data
      if (localAccountId && localAccountId !== accountData.accountId) {
        void loadAccount(localAccountId, localWorkflowId);
      }

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            account_id: localAccountId
              ? localAccountId
              : localWorkflowId === "morning"
                ? accountData.accountId
                : undefined,
          }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(errorText || `Request failed: ${res.status}`);
        }

        const agentResp: AgentResponse = await res.json();

        if (agentResp.workflow_stages?.length) {
          setRunState({
            workflowId: agentResp.workflow,
            steps: agentResp.workflow_stages,
            currentStep: agentResp.workflow_stages.length,
          });
        }

        // If agent resolved a different account, load it
        if (agentResp.account_id && agentResp.account_id !== accountData.accountId) {
          void loadAccount(agentResp.account_id, agentResp.workflow);
        }

        setActiveWorkflow(agentResp.workflow);
        setHasArtifact(true);

        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: agentResp.reply,
            triageAccounts: agentResp.triage_accounts,
            briefSnapshot: agentResp.brief_snapshot,
            similarAccounts: agentResp.similar_accounts,
          },
        ]);
      } catch {
        setHasArtifact(true);
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content:
              localWorkflowId === "brief" || localWorkflowId === "similar"
                ? "I couldn't confidently resolve the account for that request. Mention the account name or open it from the portfolio list and try again."
                : buildWorkflowAnswer(localWorkflowId, trimmed, workspaceData, accountData),
          },
        ]);
      } finally {
        clearRunTimers();
        setRunState(null);
        setStatus("ready");
      }
    },
    [accountData, clearRunTimers, featuredAccount.crm.name, flows, loadAccount, portfolio.prioritized, status, workspaceData]
  );

  const starterPrompts = useMemo(
    () => [
      {
        label: "Morning focus",
        description: "Rank today’s urgent accounts and show the renewal wave.",
        prompt: flows.morning.prompt,
        workflowId: "morning" as const,
        icon: RadarIcon,
      },
      {
        label: "Pre-call prep",
        description: `Open the latest account brief for ${featuredAccount.crm.name}.`,
        prompt: `I have a call with ${featuredAccount.crm.name} in 20 minutes. What should I know?`,
        workflowId: "brief" as const,
        icon: BriefcaseBusinessIcon,
      },
      {
        label: "Find the pattern",
        description: "Check whether this account belongs to a broader risk cluster.",
        prompt: `Is ${featuredAccount.crm.name} an isolated problem or part of a broader pattern?`,
        workflowId: "similar" as const,
        icon: UsersRoundIcon,
      },
    ],
    [featuredAccount.crm.name, flows.morning.prompt]
  );

  const hasConversation = messages.length > 1;

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8f7f4]">
      {/* ── Left sidebar ─────────────────────────────────── */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-black/6 bg-white/70 backdrop-blur-xl">
        {/* Branding */}
        <div className="flex items-center gap-2.5 border-b border-black/6 px-4 py-4">
          <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#141414]">
            <SparklesIcon className="size-3.5 text-white" />
          </div>
          <span className="font-semibold text-[13px] text-slate-900 tracking-tight">
            CSM Copilot
          </span>
        </div>

        {/* New session */}
        <div className="px-3 pt-3 pb-1">
          <button
            className="flex w-full items-center gap-2 rounded-xl border border-black/8 bg-white/80 px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
            onClick={() => {
              setMessages([{
                id: "welcome",
                role: "assistant",
                content: "**Welcome to CSM Copilot.** This workspace is tuned for account triage, pre-call prep, and risk pattern discovery. Ask a question or use one of the guided prompts to assemble a durable artifact on the right.",
              }]);
              setActiveWorkflow("morning");
              setRunState(null);
              setStatus("ready");
              setInputValue("");
              setHasArtifact(false);
            }}
            type="button"
          >
            <svg className="size-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            New session
          </button>
        </div>

        {/* Quick workflows */}
        <div className="px-3 pt-3 space-y-0.5">
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Workflows
          </div>
          {Object.values(flows).map((flow) => {
            const Icon =
              flow.id === "morning"
                ? RadarIcon
                : flow.id === "brief"
                  ? BriefcaseBusinessIcon
                  : UsersRoundIcon;
            return (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition-all",
                  activeWorkflow === flow.id && !runState
                    ? "bg-slate-900 font-medium text-white"
                    : "text-slate-600 hover:bg-slate-100"
                )}
                key={flow.id}
                onClick={() => {
                  void runWorkflow({
                    workflowId: flow.id,
                    prompt: flow.prompt,
                    accountId: accountData.accountId,
                    answer: (data) =>
                      buildWorkflowAnswer(flow.id, flow.prompt, workspaceData, data),
                  });
                }}
                type="button"
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{flow.label}</span>
              </button>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Portfolio stats */}
        <div className="border-t border-black/6 px-3 py-3 space-y-2">
          <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Portfolio
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "Accounts", value: portfolio.totalAccounts },
              { label: "High risk", value: portfolio.highRiskCount },
              { label: "Renewing ≤30d", value: portfolio.renewingSoonCount },
              { label: "Save plans", value: portfolio.topSavePlanCount },
            ].map((stat) => (
              <div
                className="rounded-xl border border-black/6 bg-white/80 px-2.5 py-2"
                key={stat.label}
              >
                <div className="text-[10px] text-slate-400 leading-none">{stat.label}</div>
                <div className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
          <Button
            className="mt-1 w-full rounded-xl border-black/8 bg-white/80 text-[12px] text-slate-600 shadow-none hover:bg-slate-50"
            disabled={refreshStatus === "loading"}
            onClick={refreshWorkspace}
            size="sm"
            variant="outline"
          >
            <RefreshCcwIcon
              className={cn("size-3.5", refreshStatus === "loading" && "animate-spin")}
            />
            Refresh data
          </Button>
        </div>
      </aside>

      {/* ── Chat area ─────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Chat header — fixed, compact */}
        <header className="flex shrink-0 items-center gap-3 border-b border-black/6 bg-white/80 px-4 py-2.5 backdrop-blur-xl">
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                "size-2 rounded-full",
                workspaceData.source === "live" ? "bg-emerald-500" : "bg-amber-400"
              )}
            />
            <span className="text-[13px] font-medium text-slate-800">
              {workspaceData.source === "live" ? "Live API" : "Fallback data"}
            </span>
          </div>

          <div className="h-4 w-px bg-black/8" />

          {/* Account switcher — scrollable row, truncates gracefully */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
            {accountStatus === "loading" && (
              <LoaderCircleIcon className="size-3 shrink-0 animate-spin text-slate-400" />
            )}
            {portfolio.prioritized.slice(0, 6).map((account) => {
              const isActive = account.id === accountData.accountId;
              return (
                <button
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-all whitespace-nowrap",
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-black/8 bg-white/80 text-slate-500 hover:border-slate-300 hover:text-slate-800"
                  )}
                  key={account.id}
                  onClick={() => void loadAccount(account.id, "brief")}
                  title={`${account.name} — Score ${account.priority_score}`}
                  type="button"
                >
                  {account.name}
                </button>
              );
            })}
          </div>
        </header>

        {/* Conversation */}
        <Conversation className="flex-1 bg-[#faf9f7]">
          <ConversationContent className="gap-5 px-5 py-6 max-w-[780px] mx-auto w-full">
            {/* Empty state — shown only before any user message */}
            {!hasConversation && (
              <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col items-center gap-6 pt-4 duration-500">
                <div className="space-y-1.5 text-center">
                  <h2 className="font-semibold text-xl tracking-tight text-slate-900">
                    What do you need right now?
                  </h2>
                  <p className="text-[13px] text-slate-500">
                    Ask about renewals, accounts, or risk patterns — or pick a guided workflow.
                  </p>
                </div>

                <div className="grid w-full gap-2 sm:grid-cols-3">
                  {starterPrompts.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        className="flex flex-col gap-2 rounded-2xl border border-black/6 bg-white p-4 text-left shadow-[0_6px_20px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-[0_10px_26px_rgba(15,23,42,0.08)]"
                        key={item.label}
                        onClick={() => void handleSubmit(item.prompt)}
                        type="button"
                      >
                        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                          <div className="grid size-7 place-items-center rounded-xl bg-slate-100">
                            <Icon className="size-3.5 text-slate-600" />
                          </div>
                          {item.label}
                        </div>
                        <p className="text-[12px] leading-5 text-slate-500">
                          {item.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Messages */}
            {messages
              .filter((m) => hasConversation || m.id !== "welcome")
              .map((message) => (
                <Message
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  from={message.role}
                  key={message.id}
                >
                  <MessageContent
                    className={cn(
                      message.role === "user"
                        ? "max-w-[72%] rounded-2xl bg-[#1a1a1a] px-4 py-2.5 text-white shadow-[0_4px_16px_rgba(15,23,42,0.14)]"
                        : "w-full max-w-full"
                    )}
                  >
                    {message.role === "assistant" ? (
                      <div className="space-y-3">
                        {/* Main text reply */}
                        <div className="rounded-2xl border border-black/6 bg-white px-4 py-3.5 shadow-[0_4px_16px_rgba(15,23,42,0.05)]">
                          <MessageResponse className="prose prose-slate max-w-none text-[13.5px] leading-7">
                            {message.content}
                          </MessageResponse>
                        </div>

                        {/* ── Generative UI: Triage card ── */}
                        {message.triageAccounts && message.triageAccounts.length > 0 && (
                          <InlineTriageCard accounts={message.triageAccounts} onSelect={(id) => void loadAccount(id, "brief")} />
                        )}

                        {/* ── Generative UI: Brief snapshot card ── */}
                        {message.briefSnapshot && (
                          <InlineBriefCard snapshot={message.briefSnapshot} />
                        )}

                        {/* ── Generative UI: Similar accounts card ── */}
                        {message.similarAccounts && message.similarAccounts.length > 0 && (
                          <InlineSimilarCard accounts={message.similarAccounts} />
                        )}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-[13.5px] leading-6">
                        {message.content}
                      </p>
                    )}
                  </MessageContent>
                </Message>
              ))}

            {/* In-progress step tracker */}
            {runState && (
              <Message
                className="animate-in fade-in slide-in-from-bottom-3 duration-300"
                from="assistant"
              >
                <MessageContent className="w-full max-w-full">
                  <RunStatusCard
                    currentStep={runState.currentStep}
                    label={flows[runState.workflowId].label}
                    steps={runState.steps}
                  />
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Input area */}
        <div className="shrink-0 border-t border-black/6 bg-white/80 px-4 py-3 backdrop-blur-xl">
          {/* Progress bar when running */}
          {runState && (
            <div className="mb-2 h-0.5 overflow-hidden rounded-full bg-black/6">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7c95ff] via-[#2d6cdf] to-[#141414] transition-all duration-500"
                style={{
                  width: `${Math.max(16, (runState.currentStep / runState.steps.length) * 100)}%`,
                }}
              />
            </div>
          )}
          <PromptInput
            className="[&>[data-slot=input-group]]:rounded-2xl [&>[data-slot=input-group]]:border-black/8 [&>[data-slot=input-group]]:bg-white [&>[data-slot=input-group]]:shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
            onSubmit={(message) => handleSubmit(message.text)}
          >
            <PromptInputTextarea
              onChange={(event) => setInputValue(event.currentTarget.value)}
              placeholder={`Ask about ${featuredAccount.crm.name}, renewals, or risk patterns…`}
              value={inputValue}
            />
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputButton
                  aria-label="Morning triage"
                  title="Morning triage"
                  onClick={() =>
                    void runWorkflow({
                      workflowId: "morning",
                      prompt: flows.morning.prompt,
                      accountId: accountData.accountId,
                      answer: (data) =>
                        buildWorkflowAnswer("morning", flows.morning.prompt, workspaceData, data),
                    })
                  }
                  type="button"
                >
                  <RadarIcon className="size-4" />
                </PromptInputButton>
                <PromptInputButton
                  aria-label="Pre-call brief"
                  title="Pre-call brief"
                  onClick={() =>
                    void runWorkflow({
                      workflowId: "brief",
                      prompt: flows.brief.prompt,
                      accountId: accountData.accountId,
                      answer: (data) =>
                        buildWorkflowAnswer("brief", flows.brief.prompt, workspaceData, data),
                    })
                  }
                  type="button"
                >
                  <BriefcaseBusinessIcon className="size-4" />
                </PromptInputButton>
                <PromptInputButton
                  aria-label="Pattern analysis"
                  title="Pattern analysis"
                  onClick={() =>
                    void runWorkflow({
                      workflowId: "similar",
                      prompt: flows.similar.prompt,
                      accountId: accountData.accountId,
                      answer: (data) =>
                        buildWorkflowAnswer("similar", flows.similar.prompt, workspaceData, data),
                    })
                  }
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
      </div>

      {/* ── Artifact panel — slides in after first response ───────── */}
      <div
        className={cn(
          "flex h-full shrink-0 flex-col border-l border-black/6 bg-white/60 backdrop-blur-xl transition-all duration-500 ease-out",
          hasArtifact ? "w-[480px] opacity-100" : "w-0 overflow-hidden opacity-0"
        )}
      >
        {hasArtifact && (
          <>
            <header className="flex shrink-0 items-center justify-between border-b border-black/6 px-4 py-2.5">
              <div className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
                <WorkflowIcon className="size-3.5 text-slate-400" />
                {activeWorkflow === "morning" ? "Portfolio Artifact" : activeWorkflow === "brief" ? "Account Brief" : "Pattern Analysis"}
              </div>
              <button
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setHasArtifact(false)}
                type="button"
                aria-label="Close artifact panel"
              >
                <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="animate-in fade-in slide-in-from-right-4 p-4 duration-400">
                {activeWorkflow === "morning" ? (
                  <PortfolioArtifact
                    activeAccountId={accountData.accountId}
                    onSelectAccount={(id) => void loadAccount(id, "brief")}
                    portfolio={workspaceData.portfolio}
                  />
                ) : activeWorkflow === "brief" ? (
                  <AccountArtifact
                    brief={accountData.brief}
                    context={accountData.context}
                    isLoading={accountStatus === "loading"}
                  />
                ) : (
                  <SimilarArtifact
                    context={accountData.context}
                    isLoading={accountStatus === "loading"}
                    similar={accountData.similar}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
}

function buildFlows(
  data: WorkspaceBootstrap,
  accountData: WorkspaceAccountData
): Record<WorkflowId, FlowDefinition> {
  const topAccounts = data.portfolio.prioritized.slice(0, 3);
  const featuredName = accountData.context.crm.name;
  const similarNames = (accountData.similar ?? [])
    .slice(0, 3)
    .map((account) => account.name)
    .join(", ");
  const topThemes = data.portfolio.riskThemes
    .slice(0, 2)
    .map((theme) => theme.label.toLowerCase())
    .join(" and ");

  return {
    morning: {
      id: "morning",
      label: "Morning triage",
      prompt: "What should I focus on this morning?",
      answer: `Your top accounts today are **${topAccounts
        .map((account) => account.name)
        .join("**, **")}**.\n\nThe strongest cross-account pattern is **${topThemes}**, which is why the priority queue leans toward renewal-critical accounts instead of general monitoring.\n\nI assembled a morning triage artifact with the queue, risk-theme breakdown, and manager actions on the right.`,
      artifactTitle: "Morning Triage Artifact",
      artifactSummary:
        "A ranked queue of the accounts that need attention first, plus the shared patterns behind the spike in urgency.",
      steps: [
        "Pulling prioritized accounts from Postgres",
        "Scoring renewal urgency and ticket pressure",
        "Aggregating repeated risk themes",
        "Composing the portfolio artifact",
      ],
    },
    brief: {
      id: "brief",
      label: "Pre-call brief",
      prompt: `I have a call with ${featuredName} in 20 minutes. What should I know?`,
      answer: accountData.brief
        ? `${accountData.brief.summary}\n\nThe most important move right now is **${accountData.brief.recommended_next_action.toLowerCase()}**\n\nI assembled the pre-call artifact with why it was flagged, the current situation, and the next step on the right.`
        : `Loading account brief for ${featuredName}. Ask a question to generate the full pre-call summary.`,
      artifactTitle: "Pre-Call Brief Artifact",
      artifactSummary:
        "A decision-ready account view with the summary, why it is risky, current blockers, and the next move the CSM should take.",
      steps: [
        "Loading merged account context",
        "Checking health, usage, and renewal pressure",
        "Drafting the account brief",
        "Building the account artifact",
      ],
    },
    similar: {
      id: "similar",
      label: "Pattern analysis",
      prompt: `Are there other accounts with the same pattern as ${featuredName}?`,
      answer: `**${featuredName}** does not look isolated.\n\nThe closest matches are **${similarNames}**. The shared pattern is a mix of support load, softening adoption, and renewal exposure.\n\nI assembled a similarity artifact with the nearest accounts and the common risk signature on the right.`,
      artifactTitle: "Similarity Artifact",
      artifactSummary:
        "A pattern-analysis view that shows which other accounts look most like the selected account and what the common signals are.",
      steps: [
        "Loading the source account embedding",
        "Running pgvector nearest-neighbor search",
        "Comparing repeated risk reasons",
        "Assembling the similarity artifact",
      ],
    },
  };
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
    lower.includes("pattern")
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
) {
  const lower = prompt.toLowerCase();
  const candidates = [
    {
      id: currentAccountData.accountId,
      name: currentAccountData.context.crm.name,
    },
    ...prioritized.map((account) => ({
      id: account.id,
      name: account.name,
    })),
  ];

  const directMatch = candidates.find((candidate) =>
    lower.includes(candidate.name.toLowerCase())
  );
  if (directMatch) {
    return directMatch.id;
  }

  const tokenMatches = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: candidate.name
        .toLowerCase()
        .split(/[\s-]+/)
        .filter((token) => token.length >= 4 && lower.includes(token)).length,
    }))
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score);

  if (tokenMatches[0]) {
    return tokenMatches[0].id;
  }

  return currentAccountData.accountId;
}

function buildWorkflowAnswer(
  workflowId: WorkflowId,
  prompt: string,
  workspaceData: WorkspaceBootstrap,
  accountData: WorkspaceAccountData
) {
  if (workflowId === "brief") {
    return buildBriefAnswer(prompt, accountData);
  }

  if (workflowId === "similar") {
    return buildSimilarityAnswer(prompt, accountData);
  }

  return buildPortfolioAnswer(prompt, workspaceData);
}

function buildPortfolioAnswer(
  prompt: string,
  workspaceData: WorkspaceBootstrap
) {
  const lower = prompt.toLowerCase();
  const renewingSoon = workspaceData.portfolio.prioritized.filter((account) => {
    const days = daysUntilFromString(account.renewal_date);
    return days !== null && days <= 30;
  });
  const focusAccounts =
    renewingSoon.length >= 3
      ? renewingSoon.slice(0, 3)
      : workspaceData.portfolio.prioritized.slice(0, 3);
  const topTheme = workspaceData.portfolio.riskThemes[0];

  if (lower.includes("manager")) {
    return `As of ${formatDateTime(workspaceData.generatedAt)}, there are **${workspaceData.portfolio.renewingSoonCount}** accounts renewing inside 30 days and **${workspaceData.portfolio.highRiskCount}** accounts currently marked high risk.\n\nThe immediate concentration is **${topTheme?.label.toLowerCase() || "renewal pressure"}**, led by **${focusAccounts
      .map((account) => account.name)
      .join("**, **")}**.\n\nI updated the portfolio artifact with the ranked queue, risk distribution, and manager actions.`;
  }

  if (lower.includes("renew")) {
    return `The highest-risk renewals inside the next 30 days are **${focusAccounts
      .map((account) => account.name)
      .join("**, **")}**.\n\nThere are **${workspaceData.portfolio.renewingSoonCount}** accounts in that window, and the repeated pattern is **${topTheme?.label.toLowerCase() || "renewal urgency"}**.\n\nThe portfolio artifact on the right now highlights the renewal wave and the accounts to treat as active save plans.`;
  }

  return `The accounts I would focus on first are **${focusAccounts
    .map((account) => account.name)
    .join("**, **")}**.\n\nAcross the portfolio, there are **${workspaceData.portfolio.highRiskCount}** high-risk accounts and **${workspaceData.portfolio.topSavePlanCount}** accounts already in top save-plan range. The strongest repeated signal is **${topTheme?.label.toLowerCase() || "renewal pressure"}**.\n\nI updated the portfolio artifact with the queue, theme charts, and recommended manager actions.`;
}

function buildBriefAnswer(prompt: string, accountData: WorkspaceAccountData) {
  const lower = prompt.toLowerCase();
  const brief = accountData.brief;

  if (!brief) {
    return `Here's what I know about **${accountData.context.crm.name}** so far. Ask a specific question to pull the full brief.`;
  }

  const topWhy = brief.why_risky.slice(0, 3).join(", ");
  const topIssue =
    brief.key_issues[0] ||
    accountData.context.internal.latest_ticket_summary ||
    "No issue summary available.";

  if (lower.includes("next") || lower.includes("do")) {
    return `For **${accountData.context.crm.name}**, the next move is **${brief.recommended_next_action.toLowerCase()}**.\n\nThis account is surfacing because ${topWhy.toLowerCase()}.\n\nI refreshed the pre-call artifact with why it was flagged, the current situation, and the next step.`;
  }

  return `**${accountData.context.crm.name}** is a **${(accountData.context.crm.risk_level || "high").toLowerCase()}-risk** ${accountData.context.internal.segment?.toLowerCase() || "customer"} account renewing on **${formatDateShort(accountData.context.crm.renewal_date)}**.\n\nThe main drivers are ${topWhy.toLowerCase()}. The immediate issue is **${topIssue}**.\n\nI refreshed the pre-call artifact with the summary, why it was flagged, and the recommended next step.`;
}

function buildSimilarityAnswer(
  prompt: string,
  accountData: WorkspaceAccountData
) {
  const lower = prompt.toLowerCase();
  const closest = accountData.similar.slice(0, 3);
  const closestNames = closest.map((account) => account.name);
  const shared = deriveSharedPatterns(accountData.similar)
    .filter((pattern) => pattern.count > 0)
    .map((pattern) => pattern.label.toLowerCase())
    .slice(0, 3);
  const sharedText = shared.length > 0 ? shared.join(", ") : "no clear shared pattern yet";

  if (closestNames.length === 0) {
    return `I couldn't find close matches for **${accountData.context.crm.name}** yet.\n\nI refreshed the similarity artifact so you can inspect the source account and rerun the comparison when more data is available.`;
  }

  if (lower.includes("isolated")) {
    return `No, **${accountData.context.crm.name}** does not look isolated.\n\nThe closest matches are **${closestNames.join("**, **")}**, and the shared shape is **${sharedText}**.\n\nI refreshed the similarity artifact with shared patterns and the closest matching accounts.`;
  }

  return `The closest accounts to **${accountData.context.crm.name}** are **${closestNames.join("**, **")}**.\n\nThe recurring pattern is **${sharedText}**, which suggests this is a repeatable account-risk shape rather than a one-off issue.\n\nI refreshed the similarity artifact with shared patterns and the closest matches.`;
}


function RunStatusCard({
  label,
  steps,
  currentStep,
}: {
  label: string;
  steps: string[];
  currentStep: number;
}) {
  const phaseLabel =
    currentStep >= steps.length
      ? "Synthesizing"
      : currentStep >= Math.ceil(steps.length * 0.6)
        ? "Verifying"
        : currentStep >= 1
          ? "Researching"
          : "Planning";

  return (
    <div className="overflow-hidden rounded-2xl border border-black/6 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-black/5 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <LoaderCircleIcon className="size-3.5 animate-spin text-slate-400" />
          <span className="text-[13px] font-medium text-slate-700">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {["Planning", "Researching", "Verifying", "Synthesizing"].map((phase) => (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium transition-all",
                phase === phaseLabel
                  ? "bg-slate-900 text-white"
                  : "text-slate-400"
              )}
              key={phase}
            >
              {phase}
            </span>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-black/4">
        {steps.map((step, index) => {
          const state =
            index < currentStep
              ? "done"
              : index === currentStep
                ? "active"
                : "pending";
          return (
            <div
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 text-[13px] transition-all duration-300",
                state === "done" && "text-slate-400",
                state === "active" && "bg-blue-50/50 font-medium text-slate-800",
                state === "pending" && "text-slate-300"
              )}
              key={step}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                  state === "done" && "bg-emerald-100 text-emerald-700",
                  state === "active" && "bg-blue-100 text-blue-700",
                  state === "pending" && "bg-slate-100 text-slate-400"
                )}
              >
                {state === "done" ? (
                  <CheckCircle2Icon className="size-3" />
                ) : state === "active" ? (
                  <LoaderCircleIcon className="size-3 animate-spin" />
                ) : (
                  index + 1
                )}
              </span>
              {step}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountFocusRail({
  prioritized,
  activeAccountId,
  loading,
  onSelectAccount,
}: {
  prioritized: PrioritizedAccount[];
  activeAccountId: string;
  loading: boolean;
  onSelectAccount: (accountId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
          Focus accounts
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            Loading account
          </div>
        ) : null}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {prioritized.slice(0, 6).map((account) => (
          <button
            className={cn(
              "min-w-[13rem] rounded-[22px] border px-3 py-3 text-left transition-all duration-300",
              account.id === activeAccountId
                ? "border-slate-900 bg-slate-900 text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)]"
                : "border-black/8 bg-white/85 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            )}
            key={account.id}
            onClick={() => onSelectAccount(account.id)}
            type="button"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-medium">{account.name}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  account.id === activeAccountId
                    ? "bg-white/12 text-white"
                    : "bg-slate-100 text-slate-500"
                )}
              >
                {account.priority_score}
              </span>
            </div>
            <div
              className={cn(
                "mt-1 text-xs leading-5",
                account.id === activeAccountId ? "text-white/75" : "text-slate-500"
              )}
            >
              {account.segment} · {account.plan_tier} ·{" "}
              {formatDateShort(account.renewal_date)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PortfolioArtifact({
  portfolio,
  activeAccountId,
  onSelectAccount,
}: {
  portfolio: WorkspaceBootstrap["portfolio"];
  activeAccountId: string;
  onSelectAccount: (accountId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3">
        <MetricCard icon={RadarIcon} label="Accounts reviewed" value={String(portfolio.totalAccounts)} />
        <MetricCard icon={BadgeAlertIcon} label="High risk" tone="critical" value={String(portfolio.highRiskCount)} />
        <MetricCard icon={CalendarClockIcon} label="Renewing ≤30d" tone="warning" value={String(portfolio.renewingSoonCount)} />
        <MetricCard icon={WorkflowIcon} label="Top save plans" value={String(portfolio.topSavePlanCount)} />
      </section>

      <SectionCard title="Priority Queue">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Renewal</TableHead>
              <TableHead>Top signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {portfolio.prioritized.slice(0, 8).map((account) => (
              <TableRow
                className={cn("cursor-pointer", account.id === activeAccountId && "bg-slate-50")}
                key={account.id}
                onClick={() => onSelectAccount(account.id)}
              >
                <TableCell className="py-3">
                  <div className="font-medium text-slate-900">{account.name}</div>
                  <div className="text-xs text-slate-500">{account.segment} · {account.plan_tier}</div>
                </TableCell>
                <TableCell><RiskBadge value={account.risk_level} /></TableCell>
                <TableCell className="font-medium text-slate-900">{account.priority_score}</TableCell>
                <TableCell className="text-slate-600">{formatDateShort(account.renewal_date)}</TableCell>
                <TableCell className="max-w-[14rem] truncate text-slate-600">{account.priority_reasons[0]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      <SectionCard title="Risk Theme Breakdown">
        <div className="space-y-3">
          {portfolio.riskThemes.map((theme) => (
            <ThemeRow
              count={theme.count}
              key={theme.label}
              label={theme.label}
              max={Math.max(portfolio.totalAccounts / 4, 1)}
              tone={theme.tone}
            />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Recommended Manager Actions">
        <ActionList
          items={[
            `Escalate ${portfolio.prioritized[0]?.name} and ${portfolio.prioritized[1]?.name} into active save-plan review.`,
            `Review the ticket-heavy cohort before the next renewal stand-up.`,
            `Assign an owner and due date to each account scoring 90 or above.`,
          ]}
        />
      </SectionCard>

      <ProvenanceCard
        labels={["CRM", "support", "usage", "CSM activity", "renewal", "derived"]}
      />
    </div>
  );
}

function AccountArtifact({
  context,
  brief,
  isLoading,
}: {
  context: AccountContext;
  brief: AccountBrief | null;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      {isLoading && <InlineLoadingBanner label="Loading account data" />}

      {/* Header */}
      <div className="rounded-2xl border border-black/6 bg-[#f7f4ef] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="font-semibold text-slate-900 text-[15px]">{context.crm.name}</div>
            <div className="text-sm text-slate-500">
              {context.internal.segment} · {context.internal.plan_tier} · {formatCurrency(context.internal.arr)} ARR
            </div>
            <div className="text-sm text-slate-500">
              Renewal {formatDateShort(context.crm.renewal_date)} · Owner {context.internal.owner_name ?? "—"}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <RiskBadge value={context.crm.risk_level} />
            <Badge className="bg-white text-slate-500" variant="outline">Score {context.priority_score}</Badge>
          </div>
        </div>
        {brief && (
          <p className="mt-3 text-[14px] leading-6 text-slate-700">{brief.summary}</p>
        )}
      </div>

      {/* Why flagged */}
      <SectionCard title="Why Flagged">
        <div className="space-y-2">
          {context.priority_reasons.map((reason) => (
            <div
              className="flex items-start gap-2.5 rounded-xl border border-black/6 bg-slate-50 px-3 py-2.5"
              key={reason}
            >
              <BadgeAlertIcon className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
              <span className="text-sm leading-5 text-slate-700">{reason}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Current situation */}
      <SectionCard title="Current Situation">
        <div className="space-y-4">
          <InfoRow label="Latest ticket" value={context.internal.latest_ticket_summary} />
          <InfoRow label="Recent CSM note" value={context.internal.recent_csm_note} />
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Champion" value={context.internal.champion_status} />
            <MiniStat label="Renewal confidence" value={context.internal.renewal_confidence} />
            <MiniStat label="Engagement" value={context.internal.engagement_status} />
            <MiniStat
              label="Last touch"
              value={context.internal.days_since_last_touch != null ? `${context.internal.days_since_last_touch}d ago` : null}
            />
          </div>
        </div>
      </SectionCard>

      {/* Recommended next step */}
      <div className="rounded-2xl bg-slate-950 p-4 text-white">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-slate-400">
          <SparklesIcon className="size-3.5" />
          Recommended next step
        </div>
        <p className="mt-2 text-[14px] leading-7 text-white">
          {brief?.recommended_next_action
            ?? context.internal.recommended_next_action
            ?? "Ask a question to generate the recommended next step for this account."}
        </p>
      </div>

      <ProvenanceCard
        labels={["CRM", "support", "usage", "CSM activity", "renewal", "derived"]}
      />
    </div>
  );
}

function SimilarArtifact({
  context,
  similar,
  isLoading,
}: {
  context: AccountContext;
  similar: SimilarAccount[];
  isLoading: boolean;
}) {
  const sharedPatterns = deriveSharedPatterns(similar)
    .filter((pattern) => pattern.count > 0)
    .map((pattern, index) => ({
      ...pattern,
      tone:
        index === 0
          ? ("critical" as const)
          : index === 1
            ? ("warning" as const)
            : ("watch" as const),
    }));
  const topMatch = similar[0];
  const nextStep =
    context.internal.recommended_next_action ||
    (topMatch
      ? `Review ${topMatch.name} and reuse the recovery motion around ${sharedPatterns[0]?.label.toLowerCase() || "the shared risk pattern"}.`
      : "No similar accounts are available yet. Ask a question to refresh the comparison set.");

  return (
    <div className="space-y-4">
      {isLoading && <InlineLoadingBanner label="Loading similar accounts" />}

      <div className="rounded-2xl border border-black/6 bg-[#f7f4ef] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="font-semibold text-[15px] text-slate-900">{context.crm.name}</div>
            <div className="text-sm text-slate-500">
              {context.internal.segment} · {context.internal.plan_tier} · {formatCurrency(context.internal.arr)} ARR
            </div>
            <div className="text-sm text-slate-500">
              Renewal {formatDateShort(context.crm.renewal_date)} · Comparing against similar risk patterns
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <RiskBadge value={context.crm.risk_level} />
            <Badge className="bg-white text-slate-500" variant="outline">
              {similar.length} matches
            </Badge>
          </div>
        </div>
      </div>

      <SectionCard title="Shared Patterns">
        {sharedPatterns.length > 0 ? (
          <div className="space-y-3">
            {sharedPatterns.map((pattern) => (
              <ThemeRow
                count={pattern.count}
                key={pattern.label}
                label={pattern.label}
                max={Math.max(similar.length, 1)}
                tone={pattern.tone}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-slate-600">
            No repeated pattern surfaced across the current comparison set.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Closest Matches">
        {similar.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Similarity</TableHead>
                <TableHead>Renewal</TableHead>
                <TableHead>Top signal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {similar.slice(0, 6).map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="py-3">
                    <div className="font-medium text-slate-900">{account.name}</div>
                    <div className="text-xs text-slate-500">
                      {account.segment} · {formatCurrency(account.arr)}
                    </div>
                  </TableCell>
                  <TableCell><RiskBadge value={account.risk_level} /></TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {Math.round(account.similarity * 100)}%
                  </TableCell>
                  <TableCell className="text-slate-600">{formatDateShort(account.renewal_date)}</TableCell>
                  <TableCell className="max-w-[14rem] truncate text-slate-600">
                    {account.priority_reasons[0] || "No signal available"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm leading-6 text-slate-600">
            No similar accounts are available for this account yet.
          </p>
        )}
      </SectionCard>

      <div className="rounded-2xl bg-slate-950 p-4 text-white">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-slate-400">
          <SparklesIcon className="size-3.5" />
          Matching next step
        </div>
        <p className="mt-2 text-[14px] leading-7 text-white">{nextStep}</p>
      </div>

      <ProvenanceCard labels={["CRM", "support", "usage", "derived"]} />
    </div>
  );
}

function InlineLoadingBanner({ label }: { label: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-[20px] border border-black/6 bg-slate-50 px-3 py-2 text-sm text-slate-600">
      <LoaderCircleIcon className="size-4 animate-spin" />
      {label}
    </div>
  );
}


function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="animate-in fade-in slide-in-from-bottom-3 rounded-[28px] border border-black/6 bg-white/80 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.06)] duration-500 sm:p-5">
      <div className="mb-4 space-y-1.5">
        <h3 className="font-semibold text-xl tracking-tight text-slate-900">
          {title}
        </h3>
        {description ? (
          <p className="max-w-3xl text-pretty text-sm leading-6 text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "neutral" | "critical" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] border p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]",
        tone === "critical" && "border-rose-200 bg-rose-50/80",
        tone === "warning" && "border-amber-200 bg-amber-50/80",
        tone === "neutral" && "border-black/6 bg-white"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
            {label}
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            {value}
          </div>
        </div>
        <div className="grid size-10 place-items-center rounded-2xl bg-white/75">
          <Icon className="size-5 text-slate-600" />
        </div>
      </div>
    </div>
  );
}

function ThemeRow({
  label,
  count,
  max,
  tone,
}: RiskTheme & {
  max: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">{count} accounts</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/6">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            tone === "critical" && "bg-[#111827]",
            tone === "warning" && "bg-[#d97706]",
            tone === "watch" && "bg-[#2563eb]"
          )}
          style={{ width: `${Math.min((count / max) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ActionList({ items }: { items: string[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          className="flex items-start gap-3 rounded-[22px] border border-black/6 bg-slate-50 px-4 py-3"
          key={item}
        >
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-sm font-medium text-slate-700">
            {index + 1}
          </div>
          <div className="text-sm leading-6 text-slate-700">{item}</div>
        </div>
      ))}
    </div>
  );
}

function ProvenanceCard({ labels }: { labels: string[] }) {
  return (
    <SectionCard title="Evidence Sources">
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => (
          <Badge className="bg-slate-50 text-slate-600" key={label} variant="outline">
            {label}
          </Badge>
        ))}
      </div>
    </SectionCard>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <p className="text-sm leading-7 text-slate-700">{value || "Not available"}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="rounded-[22px] border border-black/6 bg-slate-50 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 font-medium text-slate-900">{value || "Unknown"}</div>
    </div>
  );
}

function RiskBadge({ value }: { value?: string | null }) {
  const normalized = value || "Unknown";
  return (
    <Badge
      className={cn(
        "border-0 px-2.5 py-1",
        normalized === "High" && "bg-rose-100 text-rose-800",
        normalized === "Medium" && "bg-amber-100 text-amber-800",
        normalized === "Low" && "bg-emerald-100 text-emerald-800",
        normalized !== "High" &&
          normalized !== "Medium" &&
          normalized !== "Low" &&
          "bg-slate-100 text-slate-700"
      )}
      variant="outline"
    >
      {normalized}
    </Badge>
  );
}

function deriveSharedPatterns(similar: SimilarAccount[]) {
  const counters = new Map<string, number>([
    ["Support load", 0],
    ["Renewal pressure", 0],
    ["Usage softness", 0],
  ]);

  for (const account of similar) {
    const reasonBlob = account.priority_reasons.join(" | ");
    if (reasonBlob.includes("ticket")) {
      counters.set("Support load", (counters.get("Support load") || 0) + 1);
    }
    if (reasonBlob.includes("Renewal in")) {
      counters.set(
        "Renewal pressure",
        (counters.get("Renewal pressure") || 0) + 1
      );
    }
    if (reasonBlob.includes("Usage down")) {
      counters.set(
        "Usage softness",
        (counters.get("Usage softness") || 0) + 1
      );
    }
  }

  return Array.from(counters.entries()).map(([label, count]) => ({
    label,
    count,
  }));
}

function formatCurrency(value?: number | null) {
  if (!value) {
    return "$0";
  }
  if (value >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
      notation: value >= 100000 ? "compact" : "standard",
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateShort(value?: string | null) {
  if (!value) {
    return "No renewal date";
  }
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "recently";
  }
  try {
    return format(parseISO(value), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return value;
  }
}

function daysUntilFromString(value?: string | null) {
  if (!value) {
    return null;
  }
  try {
    const parsed = parseISO(value);
    const now = new Date();
    return Math.ceil((parsed.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function bootstrapToAccountData(data: WorkspaceBootstrap): WorkspaceAccountData {
  return {
    source: data.source,
    accountId: data.featuredAccount.id,
    context: data.featuredAccount.context,
    brief: data.featuredAccount.brief,
    similar: data.featuredAccount.similar,
  };
}

// ── Generative UI Inline Cards ─────────────────────────────────────────────

function InlineTriageCard({
  accounts,
  onSelect,
}: {
  accounts: TriageAccountCard[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/6 bg-white shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
      {/* Card header */}
      <div className="flex items-center gap-2 border-b border-black/5 bg-slate-50 px-4 py-2.5">
        <RadarIcon className="size-3.5 text-slate-500" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Priority Queue
        </span>
        <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          {accounts.length} accounts
        </span>
      </div>

      {/* Account rows */}
      <div className="divide-y divide-black/4">
        {accounts.map((account, index) => (
          <button
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
            key={account.id}
            onClick={() => onSelect(account.id)}
            type="button"
          >
            {/* Rank badge */}
            <div className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
              {index + 1}
            </div>

            {/* Name + reason */}
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

            {/* Metadata */}
            <div className="shrink-0 text-right">
              <div className="text-[13px] font-semibold text-slate-900">
                {account.priority_score}
              </div>
              {account.renewal_date && (
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {formatDateShort(account.renewal_date)}
                </div>
              )}
            </div>

            <ArrowRightIcon className="size-3.5 shrink-0 text-slate-300" />
          </button>
        ))}
      </div>
    </div>
  );
}

function InlineBriefCard({ snapshot }: { snapshot: BriefSnapshot }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/6 bg-white shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
      {/* Card header */}
      <div className="flex items-center gap-2 border-b border-black/5 bg-slate-50 px-4 py-2.5">
        <BriefcaseBusinessIcon className="size-3.5 text-slate-500" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Account Brief
        </span>
      </div>

      {/* Account name + badges */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        <span className="text-[15px] font-semibold text-slate-900">
          {snapshot.name}
        </span>
        <RiskBadge value={snapshot.risk_level} />
        <Badge className="bg-white text-slate-500" variant="outline">
          Score {snapshot.priority_score}
        </Badge>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-3">
        {[
          { label: "ARR", value: formatCurrency(snapshot.arr) },
          { label: "Renewal", value: formatDateShort(snapshot.renewal_date) },
          { label: "Health", value: snapshot.health_score ?? "—" },
          { label: "Tickets", value: snapshot.open_tickets ?? "—" },
          { label: "Engagement", value: snapshot.engagement ?? "—" },
          { label: "Segment", value: snapshot.segment ?? "—" },
        ].map((metric) => (
          <div
            className="rounded-xl border border-black/5 bg-slate-50 px-2.5 py-2"
            key={metric.label}
          >
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
              {metric.label}
            </div>
            <div className="mt-1 truncate text-[12px] font-semibold text-slate-800">
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      {/* Top reason */}
      <div className="mx-4 mb-3 rounded-xl border border-black/5 bg-amber-50 px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-amber-600">
          Why it&apos;s surfacing
        </div>
        <p className="mt-1 text-[12.5px] leading-5 text-slate-700">
          {snapshot.top_reason}
        </p>
      </div>

      {/* Recommended next action */}
      {snapshot.recommended_next_action && (
        <div className="mx-4 mb-4 rounded-xl border border-black/5 bg-slate-900 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-400">
            <SparklesIcon className="size-3" />
            Recommended action
          </div>
          <p className="mt-1 text-[12.5px] leading-5 text-white">
            {snapshot.recommended_next_action}
          </p>
        </div>
      )}
    </div>
  );
}

function InlineSimilarCard({ accounts }: { accounts: SimilarAccountCard[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/6 bg-white shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
      {/* Card header */}
      <div className="flex items-center gap-2 border-b border-black/5 bg-slate-50 px-4 py-2.5">
        <UsersRoundIcon className="size-3.5 text-slate-500" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Similar Accounts
        </span>
        <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          {accounts.length} matches
        </span>
      </div>

      {/* Account rows */}
      <div className="divide-y divide-black/4">
        {accounts.map((account) => (
          <div className="px-4 py-3" key={account.id}>
            <div className="flex items-start justify-between gap-3">
              {/* Name + risk */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-slate-900">
                    {account.name}
                  </span>
                  <RiskBadge value={account.risk_level} />
                </div>
                <p className="mt-0.5 truncate text-[12px] text-slate-500">
                  {account.top_reason}
                </p>
              </div>

              {/* Similarity */}
              <div className="shrink-0 text-right">
                <div className="text-[13px] font-semibold text-slate-900">
                  {Math.round(account.similarity * 100)}%
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  similarity
                </div>
              </div>
            </div>

            {/* Similarity bar */}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/6">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#78b8ff] to-[#161616] transition-all duration-500"
                style={{ width: `${Math.min(account.similarity * 100, 100)}%` }}
              />
            </div>

            {/* Metadata chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {account.health_score && (
                <span className="rounded-md border border-black/5 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                  Health {account.health_score}
                </span>
              )}
              {account.renewal_date && (
                <span className="rounded-md border border-black/5 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                  Renews {formatDateShort(account.renewal_date)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
