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
  Fragment,
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
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type AccountContext,
  type PrioritizedAccount,
  type RiskTheme,
  type SimilarAccount,
  type WorkspaceAccountData,
  type WorkspaceBootstrap,
} from "@/lib/csm-data";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar as RechartsRadar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";

type WorkflowId = "morning" | "brief" | "similar";

type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
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

const portfolioThemeChartConfig = {
  count: {
    label: "Accounts",
    color: "#111827",
  },
} satisfies ChartConfig;

const renewalTimelineChartConfig = {
  accounts: {
    label: "Accounts",
    color: "#d97706",
  },
} satisfies ChartConfig;

const accountPressureChartConfig = {
  pressure: {
    label: "Pressure",
    color: "#2563eb",
  },
} satisfies ChartConfig;

const similarityChartConfig = {
  similarity: {
    label: "Similarity",
    color: "#111827",
  },
} satisfies ChartConfig;

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
        setRunState(null);
        setStatus("ready");
      }, Math.max(flow.steps.length * 550 + 350 - (Date.now() - startedAt), 160));

      timeoutIdsRef.current.push(completionTimeoutId);
    },
    [accountData, clearRunTimers, flows, loadAccount]
  );

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const workflowId = inferWorkflowFromPrompt(
        trimmed,
        featuredAccount.crm.name
      );
      const accountId = resolveAccountFromPrompt(
        trimmed,
        portfolio.prioritized,
        accountData
      );

      void runWorkflow({
        workflowId,
        prompt: trimmed,
        accountId,
        answer: (data) =>
          buildWorkflowAnswer(workflowId, trimmed, workspaceData, data),
      });

      setInputValue("");
    },
    [accountData, featuredAccount.crm.name, portfolio.prioritized, runWorkflow, workspaceData]
  );

  const activeFlow = flows[activeWorkflow];
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
        {/* Chat header */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-black/6 bg-white/80 px-5 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-900">
              <span className="size-2 rounded-full bg-emerald-500" />
              Workspace Session
            </div>
            <Badge
              className={cn(
                "border-0 px-2 py-0.5 text-[11px]",
                workspaceData.source === "live"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              )}
              variant="outline"
            >
              {workspaceData.source === "live" ? "Live API" : "Fallback"}
            </Badge>
          </div>

          {/* Account focus rail (compact) */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {accountStatus === "loading" && (
              <div className="flex items-center gap-1.5 text-[12px] text-slate-400">
                <LoaderCircleIcon className="size-3 animate-spin" />
                Loading
              </div>
            )}
            {portfolio.prioritized.slice(0, 5).map((account) => (
              <button
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-[12px] transition-all",
                  account.id === accountData.accountId
                    ? "border-slate-900 bg-slate-900 font-medium text-white"
                    : "border-black/8 bg-white/80 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                )}
                key={account.id}
                onClick={() => void loadAccount(account.id, "brief")}
                type="button"
              >
                {account.name}
              </button>
            ))}
          </div>
        </header>

        {/* Conversation */}
        <Conversation className="flex-1 bg-transparent">
          <ConversationContent className="gap-4 px-5 py-5">
            {/* Empty state — shown only before any user message */}
            {!hasConversation && (
              <div className="animate-in fade-in slide-in-from-bottom-2 mx-auto flex w-full max-w-xl flex-col items-center gap-6 pt-8 duration-500">
                <div className="space-y-2 text-center">
                  <h2 className="font-semibold text-xl tracking-tight text-slate-900">
                    What do you need right now?
                  </h2>
                  <p className="text-sm text-slate-500">
                    Ask about renewals, accounts, or patterns — or pick a guided workflow.
                  </p>
                </div>

                <div className="grid w-full gap-2 sm:grid-cols-3">
                  {starterPrompts.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        className="flex flex-col gap-2 rounded-2xl border border-black/6 bg-white/80 p-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_28px_rgba(15,23,42,0.07)]"
                        key={item.label}
                        onClick={() =>
                          void runWorkflow({
                            workflowId: item.workflowId,
                            prompt: item.prompt,
                            accountId: accountData.accountId,
                            answer: (data) =>
                              buildWorkflowAnswer(item.workflowId, item.prompt, workspaceData, data),
                          })
                        }
                        type="button"
                      >
                        <div className="flex items-center gap-2 text-[13px] font-medium text-slate-900">
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

            {/* Messages — skip the welcome if no conversation started yet */}
            {messages
              .filter((m) => hasConversation || m.id !== "welcome")
              .map((message) => (
                <Message
                  className="animate-in fade-in slide-in-from-bottom-2 duration-400"
                  from={message.role}
                  key={message.id}
                >
                  <MessageContent
                    className={cn(
                      message.role === "user"
                        ? "max-w-[78%] rounded-2xl bg-[#1a1a1a] px-4 py-3 text-white shadow-[0_6px_20px_rgba(15,23,42,0.15)]"
                        : "max-w-[88%]"
                    )}
                  >
                    {message.role === "assistant" ? (
                      <div className="rounded-2xl border border-black/6 bg-white/90 px-4 py-4 shadow-[0_8px_20px_rgba(15,23,42,0.05)]">
                        <MessageResponse className="prose prose-slate max-w-none text-[13.5px] leading-7">
                          {message.content}
                        </MessageResponse>
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
                <MessageContent className="max-w-[88%]">
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

      {/* ── Right artifact panel ──────────────────────────── */}
      <aside className="flex w-[460px] shrink-0 flex-col border-l border-black/6 bg-white/85 backdrop-blur-xl xl:w-[500px]">
        {/* Artifact header */}
        <div className="shrink-0 border-b border-black/6 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-slate-400 uppercase tracking-[0.16em]">
              <WorkflowIcon className="size-3.5" />
              Artifact
            </div>
            <div className="flex gap-1">
              {Object.values(flows).map((flow) => (
                <button
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition-all",
                    activeWorkflow === flow.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100"
                  )}
                  key={flow.id}
                  onClick={() => setActiveWorkflow(flow.id)}
                  type="button"
                >
                  {flow.label}
                </button>
              ))}
            </div>
          </div>
          <h2 className="mt-2 font-semibold text-[18px] tracking-tight text-slate-900">
            {activeFlow.artifactTitle}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-5 text-slate-500">
            {activeFlow.artifactSummary}
          </p>
        </div>

        <ScrollArea className="flex-1">
          <div
            className="space-y-4 p-4"
            key={`${activeWorkflow}:${accountData.accountId}`}
          >
            {activeWorkflow === "morning" ? (
              <PortfolioArtifact
                activeAccountId={accountData.accountId}
                onSelectAccount={(accountId) => {
                  void loadAccount(accountId, "brief");
                }}
                portfolio={portfolio}
              />
            ) : null}
            {activeWorkflow === "brief" ? (
              <AccountArtifact
                brief={accountData.brief}
                context={featuredAccount}
                isLoading={accountStatus === "loading"}
                prioritized={portfolio.prioritized}
              />
            ) : null}
            {activeWorkflow === "similar" ? (
              <SimilarArtifact
                context={featuredAccount}
                isLoading={accountStatus === "loading"}
                similar={accountData.similar}
              />
            ) : null}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}

function buildFlows(
  data: WorkspaceBootstrap,
  accountData: WorkspaceAccountData
): Record<WorkflowId, FlowDefinition> {
  const topAccounts = data.portfolio.prioritized.slice(0, 3);
  const featuredName = accountData.context.crm.name;
  const similarNames = accountData.similar
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
      answer: `${accountData.brief.summary}\n\nThe most important move right now is **${accountData.brief.recommended_next_action.toLowerCase()}**\n\nI assembled the pre-call artifact with risk signals, current situation, and the recovery path on the right.`,
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
  const topWhy = accountData.brief.why_risky.slice(0, 3).join(", ");
  const topIssue =
    accountData.brief.key_issues[0] ||
    accountData.context.internal.latest_ticket_summary ||
    "No issue summary available.";

  if (lower.includes("next") || lower.includes("do")) {
    return `For **${accountData.context.crm.name}**, the next move is **${accountData.brief.recommended_next_action.toLowerCase()}**.\n\nThis account is surfacing because ${topWhy.toLowerCase()}.\n\nI refreshed the pre-call artifact with the signal profile, current situation, and recovery path.`;
  }

  return `**${accountData.context.crm.name}** is a **${(accountData.context.crm.risk_level || "high").toLowerCase()}-risk** ${accountData.context.internal.segment?.toLowerCase() || "customer"} account renewing on **${formatDateShort(accountData.context.crm.renewal_date)}**.\n\nThe main drivers are ${topWhy.toLowerCase()}. The immediate issue is **${topIssue}**.\n\nI refreshed the pre-call artifact with the brief, signal profile, and recommended next step.`;
}

function buildSimilarityAnswer(
  prompt: string,
  accountData: WorkspaceAccountData
) {
  const lower = prompt.toLowerCase();
  const closest = accountData.similar.slice(0, 3);
  const shared = deriveSharedPatterns(accountData.similar)
    .filter((pattern) => pattern.count > 0)
    .map((pattern) => pattern.label.toLowerCase())
    .slice(0, 3);

  if (lower.includes("isolated")) {
    return `No, **${accountData.context.crm.name}** does not look isolated.\n\nThe closest matches are **${closest
      .map((account) => account.name)
      .join("**, **")}**, and the shared shape is **${shared.join(", ")}**.\n\nI refreshed the similarity artifact with the ladder view, matching flow, and nearest accounts.`;
  }

  return `The closest accounts to **${accountData.context.crm.name}** are **${closest
    .map((account) => account.name)
    .join("**, **")}**.\n\nThe recurring pattern is **${shared.join(", ")}**, which suggests this is a repeatable account-risk shape rather than a one-off issue.\n\nI refreshed the similarity artifact with the match ladder and the shared risk signature.`;
}

function buildAccountActionBundle(
  context: AccountContext,
  brief: WorkspaceBootstrap["featuredAccount"]["brief"]
) {
  const issue =
    brief.key_issues[0] ||
    context.internal.latest_ticket_summary ||
    "the current open risk";
  const subject = `${context.crm.name}: recovery plan before ${formatDateShort(
    context.crm.renewal_date
  )}`;

  return {
    emailSubject: subject,
    emailBody: `Hi ${context.internal.owner_name || "team"},\n\nI wanted to follow up after reviewing ${context.crm.name}. The main issue right now is ${issue.toLowerCase()}.\n\nTo get us back on stable footing before renewal, I recommend we start with ${brief.recommended_next_action.toLowerCase()}.\n\nIf it helps, I can coordinate a focused working session this week and leave you with a clear next milestone.\n\nBest,\nCSM Copilot`,
    savePlanItems: [
      `Diagnose the active blocker: ${issue}`,
      `Assign ${context.internal.owner_name || "the account owner"} to confirm the customer recovery plan and next milestone.`,
      `Review renewal risk again before ${formatDateShort(context.crm.renewal_date)} and decide whether exec escalation is needed.`,
    ],
    managerUpdate: `${context.crm.name} remains a ${
      (context.crm.risk_level || "high").toLowerCase()
    }-risk account with ${brief.why_risky
      .slice(0, 2)
      .join(" and ")
      .toLowerCase()}. The current recovery move is ${brief.recommended_next_action.toLowerCase()}, and this should be treated as an active save plan through ${formatDateShort(
      context.crm.renewal_date
    )}.`,
  };
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
  const renewalTimeline = buildRenewalTimeline(portfolio.prioritized);
  const recoveryWindowCount = renewalTimeline
    .slice(0, 2)
    .reduce((total, item) => total + item.accounts, 0);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard
          icon={RadarIcon}
          label="Accounts reviewed"
          value={String(portfolio.totalAccounts)}
        />
        <MetricCard
          icon={BadgeAlertIcon}
          label="High risk"
          tone="critical"
          value={String(portfolio.highRiskCount)}
        />
        <MetricCard
          icon={CalendarClockIcon}
          label="Renewing <=30d"
          tone="warning"
          value={String(portfolio.renewingSoonCount)}
        />
        <MetricCard
          icon={WorkflowIcon}
          label="Top save plans"
          value={String(portfolio.topSavePlanCount)}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <SectionCard
          description="The strongest recurring signals across the current queue, shown as an at-a-glance distribution."
          title="Risk Pressure Map"
        >
          <ChartContainer
            className="h-[240px] w-full"
            config={portfolioThemeChartConfig}
          >
            <BarChart accessibilityLayer data={portfolio.riskThemes}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                interval={0}
                tickFormatter={(value) => compactLabel(value, 10)}
                tickLine={false}
                tickMargin={10}
              />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <ChartTooltip
                content={<ChartTooltipContent indicator="line" />}
                cursor={false}
              />
              <Bar dataKey="count" fill="var(--color-count)" radius={[14, 14, 4, 4]} />
            </BarChart>
          </ChartContainer>
        </SectionCard>

        <SectionCard
          description="Where the top-priority accounts sit on the renewal clock."
          title="Renewal Wave"
        >
          <ChartContainer
            className="h-[240px] w-full"
            config={renewalTimelineChartConfig}
          >
            <BarChart accessibilityLayer data={renewalTimeline}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="window"
                tickLine={false}
                tickMargin={10}
              />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <ChartTooltip
                content={<ChartTooltipContent indicator="line" />}
                cursor={false}
              />
              <Bar
                dataKey="accounts"
                fill="var(--color-accounts)"
                radius={[14, 14, 4, 4]}
              />
            </BarChart>
          </ChartContainer>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            {recoveryWindowCount} of the top accounts are already inside a
            two-week recovery window, which is why this artifact emphasizes
            save-plan execution over broad monitoring.
          </p>
        </SectionCard>
      </div>

      <SectionCard
        description="The highest-priority accounts right now, ordered by priority_score."
        title="Priority Queue"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Renewal</TableHead>
              <TableHead>Primary signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {portfolio.prioritized.slice(0, 6).map((account) => (
              <TableRow
                className={cn(
                  "cursor-pointer",
                  account.id === activeAccountId && "bg-slate-50"
                )}
                key={account.id}
                onClick={() => onSelectAccount(account.id)}
              >
                <TableCell className="py-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-900">
                      {account.name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {account.segment} · {account.plan_tier} ·{" "}
                      {formatCurrency(account.arr)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <RiskBadge value={account.risk_level} />
                </TableCell>
                <TableCell className="font-medium text-slate-900">
                  {account.priority_score}
                </TableCell>
                <TableCell className="text-slate-600">
                  {formatDateShort(account.renewal_date)}
                </TableCell>
                <TableCell className="max-w-[18rem] truncate text-slate-600">
                  {account.priority_reasons[0]}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <SectionCard
          description="Repeated signals across the priority queue."
          title="Risk Theme Breakdown"
        >
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

        <SectionCard
          description="The artifact should always push the team toward next actions, not just observations."
          title="Recommended Manager Actions"
        >
          <ActionList
            items={[
              `Escalate ${portfolio.prioritized[0]?.name} and ${
                portfolio.prioritized[1]?.name
              } into active save-plan review.`,
              `Review the ticket-heavy cohort before the next renewal stand-up.`,
              `Assign an owner and due date to each account scoring 90 or above.`,
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard
        description="A lightweight owner-by-owner board that makes the queue feel operational instead of purely analytical."
        title="Save Plan Board"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {portfolio.prioritized.slice(0, 3).map((account) => (
            <CoverageCard
              account={account}
              key={account.id}
              onSelect={() => onSelectAccount(account.id)}
            />
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function AccountArtifact({
  context,
  brief,
  prioritized,
  isLoading,
}: {
  context: AccountContext;
  brief: WorkspaceBootstrap["featuredAccount"]["brief"];
  prioritized: PrioritizedAccount[];
  isLoading: boolean;
}) {
  const signalBars = buildSignalBars(context);
  const seatUtilization = buildSeatUtilization(context);
  const touchRisk = buildTouchRisk(context);
  const recoveryWindow = daysUntilFromString(context.crm.renewal_date);
  const actionBundle = buildAccountActionBundle(context, brief);
  const comparisonSet = prioritized.slice(0, 5).filter((account) => {
    return account.id !== context.crm.id;
  });

  return (
    <div className="space-y-4">
      <SectionCard
        description={`${context.crm.name} · ${context.internal.segment} · ${context.internal.plan_tier}`}
        title="Account Snapshot"
      >
        {isLoading ? <InlineLoadingBanner label="Refreshing account brief" /> : null}
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-black/6 bg-[#f7f4ef] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <RiskBadge value={context.crm.risk_level} />
                    <Badge className="bg-white text-slate-500" variant="outline">
                      Score {context.priority_score}
                    </Badge>
                  </div>
                  <p className="max-w-2xl text-pretty text-[15px] leading-7 text-slate-700">
                    {brief.summary}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge className="bg-white text-slate-600" variant="outline">
                      {context.internal.segment}
                    </Badge>
                    <Badge className="bg-white text-slate-600" variant="outline">
                      {context.internal.plan_tier}
                    </Badge>
                    <Badge className="bg-white text-slate-600" variant="outline">
                      Theme {humanizeTheme(context.internal.top_issue_theme)}
                    </Badge>
                  </div>
                </div>
                <div className="grid gap-2 text-sm text-slate-500">
                  <span>Renewal {formatDateShort(context.crm.renewal_date)}</span>
                  <span>Owner {context.internal.owner_name}</span>
                  <span>{formatCurrency(context.internal.arr)} ARR</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {signalBars.map((signal) => (
                <SignalBarCard key={signal.label} {...signal} />
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-black/6 bg-slate-950 p-4 text-white">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <SparklesIcon className="size-4" />
              Recommended next step
            </div>
            <p className="mt-3 text-pretty text-lg leading-8 text-white">
              {brief.recommended_next_action}
            </p>

            <div className="mt-6 space-y-3">
              {["Diagnose", "Align", "Recover"].map((phase, index) => (
                <div
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3"
                  key={phase}
                >
                  <div className="grid size-8 place-items-center rounded-full bg-white/10 text-sm font-medium">
                    {index + 1}
                  </div>
                  <div>
                    <div className="font-medium">{phase}</div>
                    <div className="text-sm text-slate-300">
                      {index === 0
                        ? "Tighten the issue statement around the active blocker."
                        : index === 1
                          ? "Reconfirm owner, champion, and support path."
                          : "Leave the customer with a visible next milestone."}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-[1.03fr_0.97fr]">
        <SectionCard
          description="A visual read on the four dimensions driving the account to the top of the queue."
          title="Signal Profile"
        >
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <ChartContainer
              className="mx-auto h-[280px] w-full max-w-[360px]"
              config={accountPressureChartConfig}
            >
              <RadarChart accessibilityLayer data={toPressureChartData(signalBars)}>
                <ChartTooltip
                  content={<ChartTooltipContent indicator="line" />}
                  cursor={false}
                />
                <PolarGrid />
                <PolarAngleAxis
                  dataKey="label"
                  tick={{
                    fill: "#64748b",
                    fontSize: 12,
                  }}
                />
                <RechartsRadar
                  dataKey="pressure"
                  fill="var(--color-pressure)"
                  fillOpacity={0.18}
                  stroke="var(--color-pressure)"
                  strokeWidth={2}
                />
              </RadarChart>
            </ChartContainer>

            <div className="grid gap-3">
              {signalBars.map((signal) => (
                <div
                  className="rounded-[22px] border border-black/6 bg-slate-50 px-4 py-3"
                  key={signal.label}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">{signal.label}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {signal.subtitle}
                      </div>
                    </div>
                    <div className="text-right text-2xl font-semibold tracking-tight text-slate-900">
                      {signal.value}
                    </div>
                  </div>
                  <Progress
                    className="mt-4 h-2 bg-black/6 [&>[data-slot=progress-indicator]]:bg-slate-900"
                    value={signal.value}
                  />
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          description="Operational details the CSM needs before turning this into a save-plan motion."
          title="Coverage & Recovery Window"
        >
          <div className="space-y-4">
            <ProgressMetric
              label="Seat coverage"
              subtitle={`${context.internal.active_users ?? 0} active / ${
                context.internal.licensed_seats ?? 0
              } licensed`}
              value={seatUtilization}
            />
            <ProgressMetric
              label="Touch freshness"
              subtitle={
                context.internal.days_since_last_touch
                  ? `${context.internal.days_since_last_touch} days since last CSM touch`
                  : "No recent touch data"
              }
              tone={touchRisk >= 65 ? "critical" : "neutral"}
              value={touchRisk}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniStat
                label="Onboarding"
                value={context.internal.onboarding_status}
              />
              <MiniStat
                label="Issue severity"
                value={context.internal.issue_severity}
              />
              <MiniStat
                label="Issue theme"
                value={humanizeTheme(context.internal.top_issue_theme)}
              />
              <MiniStat
                label="Recovery window"
                value={
                  recoveryWindow === null
                    ? "Unknown"
                    : `${Math.max(recoveryWindow, 0)} days`
                }
              />
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        description="Copyable outputs the CSM can actually take into customer follow-up, internal save planning, and leadership communication."
        title="Action Center"
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <ActionStudioCard
            eyebrow="Customer follow-up"
            icon={BriefcaseBusinessIcon}
            title={actionBundle.emailSubject}
          >
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {actionBundle.emailBody}
            </p>
          </ActionStudioCard>

          <ActionStudioCard
            eyebrow="Internal save plan"
            icon={WorkflowIcon}
            title="Next 3 moves"
          >
            <ActionList items={actionBundle.savePlanItems} />
          </ActionStudioCard>

          <ActionStudioCard
            eyebrow="Manager update"
            icon={CalendarClockIcon}
            title="Leadership-ready summary"
          >
            <p className="text-sm leading-6 text-slate-700">
              {actionBundle.managerUpdate}
            </p>
          </ActionStudioCard>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <SectionCard
          description="The supporting narrative is secondary to the structured signals, but still useful for CSM context."
          title="Current Situation"
        >
          <div className="space-y-4">
            <InfoRow
              label="Latest ticket"
              value={context.internal.latest_ticket_summary}
            />
            <InfoRow
              label="Recent CSM note"
              value={context.internal.recent_csm_note}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniStat
                label="Champion"
                value={context.internal.champion_status}
              />
              <MiniStat
                label="Renewal confidence"
                value={context.internal.renewal_confidence}
              />
              <MiniStat
                label="Engagement"
                value={context.internal.engagement_status}
              />
              <MiniStat
                label="Last touch"
                value={`${context.internal.days_since_last_touch ?? 0} days ago`}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          description="How this account compares with the rest of the immediate save-plan set."
          title="Why It Is Surfacing"
        >
          <div className="space-y-3">
            {context.priority_reasons.map((reason) => (
              <div
                className="flex items-start gap-3 rounded-2xl border border-black/6 bg-slate-50 px-3 py-3"
                key={reason}
              >
                <BadgeAlertIcon className="mt-0.5 size-4 text-slate-500" />
                <span className="text-sm leading-6 text-slate-700">{reason}</span>
              </div>
            ))}
          </div>

          <Separator className="my-4" />

          <div className="flex flex-wrap gap-2">
            {comparisonSet.slice(0, 3).map((account) => (
              <Badge className="bg-white text-slate-600" key={account.id} variant="outline">
                {account.name} · score {account.priority_score}
              </Badge>
            ))}
          </div>
        </SectionCard>
      </div>
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
  const sharedPatterns = deriveSharedPatterns(similar);
  const similarityChart = buildSimilarityChartData(similar);
  const sharedPlaybook = buildSimilarityPlaybook(context, similar);

  return (
    <div className="space-y-4">
      <SectionCard
        description="Nearest-neighbor account search using 768-dim Gemini embeddings and pgvector cosine similarity."
        title="Pattern Overview"
      >
        {isLoading ? <InlineLoadingBanner label="Refreshing similarity matches" /> : null}
        <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-[24px] border border-black/6 bg-[#f8f5ef] p-4">
            <div className="flex items-center gap-2">
              <Badge className="bg-slate-900 text-white">Source account</Badge>
              <RiskBadge value={context.crm.risk_level} />
            </div>
            <div className="mt-3 space-y-2">
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">
                {context.crm.name}
              </h3>
              <p className="text-sm leading-6 text-slate-600">
                {context.internal.segment} · {context.internal.plan_tier} ·{" "}
                {formatCurrency(context.internal.arr)} ARR
              </p>
              <p className="text-sm leading-6 text-slate-600">
                Renewal {formatDateShort(context.crm.renewal_date)} · Health{" "}
                {context.crm.health_score} · Usage {context.crm.usage_trend}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {sharedPatterns.map((pattern) => (
              <div
                className="rounded-[24px] border border-black/6 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]"
                key={pattern.label}
              >
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  Shared pattern
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  {pattern.count}
                </div>
                <div className="mt-1 text-sm text-slate-600">{pattern.label}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
        <SectionCard
          description="A compact visual of how close each neighbor is to the selected account."
          title="Similarity Ladder"
        >
          <ChartContainer
            className="h-[260px] w-full"
            config={similarityChartConfig}
          >
            <BarChart
              accessibilityLayer
              data={similarityChart}
              layout="vertical"
              margin={{ left: 20, right: 8 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                axisLine={false}
                dataKey="similarity"
                domain={[0.85, 1]}
                tickFormatter={(value) => `${Math.round(value * 100)}%`}
                tickLine={false}
                type="number"
              />
              <YAxis
                axisLine={false}
                dataKey="name"
                tickLine={false}
                type="category"
                width={112}
              />
              <ChartTooltip
                content={<ChartTooltipContent indicator="line" />}
                cursor={false}
              />
              <Bar
                dataKey="similarity"
                fill="var(--color-similarity)"
                radius={[0, 12, 12, 0]}
              />
            </BarChart>
          </ChartContainer>
        </SectionCard>

        <SectionCard
          description="The matching logic is visible so the user understands why these neighbors were selected."
          title="How Matching Works"
        >
          <FlowDiagram
            steps={[
              {
                label: "Source account",
                description: context.crm.name,
              },
              {
                label: "Merged profile",
                description:
                  "CRM and internal context are combined into one account state.",
              },
              {
                label: "768-dim embedding",
                description:
                  "Gemini embeddings convert the account state into a searchable vector.",
              },
              {
                label: "Nearest neighbors",
                description:
                  "pgvector cosine search returns accounts with the closest risk shape.",
              },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard
        description="A reusable intervention pattern to apply when multiple accounts share the same shape."
        title="Reusable Recovery Play"
      >
        <ActionList items={sharedPlaybook} />
      </SectionCard>

      <SectionCard
        description="The nearest accounts with comparable risk shape and account context."
        title="Closest Matches"
      >
        <div className="space-y-3">
          {similar.map((account) => (
            <div
              className="rounded-[24px] border border-black/6 bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(15,23,42,0.08)]"
              key={account.id}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-lg tracking-tight text-slate-900">
                      {account.name}
                    </h3>
                    <RiskBadge value={account.risk_level} />
                    <Badge className="bg-slate-50 text-slate-500" variant="outline">
                      Score {account.priority_score}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-500">
                    {account.segment} · {formatCurrency(account.arr)} ARR ·
                    Renewal {formatDateShort(account.renewal_date)}
                  </p>
                </div>

                <div className="min-w-[11rem] space-y-2">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>Similarity</span>
                    <span className="font-medium text-slate-900">
                      {account.similarity.toFixed(4)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-black/6">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#78b8ff] to-[#161616]"
                      style={{
                        width: `${Math.min(account.similarity * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {account.priority_reasons.slice(0, 4).map((reason) => (
                  <Badge className="bg-slate-50 text-slate-600" key={reason} variant="outline">
                    {reason}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
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
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="animate-in fade-in slide-in-from-bottom-3 rounded-[28px] border border-black/6 bg-white/80 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.06)] duration-500 sm:p-5">
      <div className="mb-4 space-y-1.5">
        <h3 className="font-semibold text-xl tracking-tight text-slate-900">
          {title}
        </h3>
        <p className="max-w-3xl text-pretty text-sm leading-6 text-slate-500">
          {description}
        </p>
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

function ProgressMetric({
  label,
  subtitle,
  value,
  tone = "neutral",
}: {
  label: string;
  subtitle: string;
  value: number;
  tone?: "neutral" | "critical";
}) {
  return (
    <div className="rounded-[22px] border border-black/6 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{label}</div>
          <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
        </div>
        <div className="text-right text-2xl font-semibold tracking-tight text-slate-900">
          {value}%
        </div>
      </div>
      <Progress
        className={cn(
          "mt-4 h-2 bg-black/6",
          tone === "critical"
            ? "[&>[data-slot=progress-indicator]]:bg-rose-500"
            : "[&>[data-slot=progress-indicator]]:bg-slate-900"
        )}
        value={value}
      />
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

function FlowDiagram({
  steps,
}: {
  steps: Array<{
    label: string;
    description: string;
  }>;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      {steps.map((step, index) => (
        <Fragment key={step.label}>
          <div className="flex-1 rounded-[22px] border border-black/6 bg-slate-50 px-4 py-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
              {step.label}
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-700">
              {step.description}
            </div>
          </div>
          {index < steps.length - 1 ? (
            <div className="hidden items-center justify-center text-slate-300 lg:flex">
              <ArrowRightIcon className="size-4" />
            </div>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

function CoverageCard({
  account,
  onSelect,
}: {
  account: PrioritizedAccount;
  onSelect: () => void;
}) {
  return (
    <button
      className="rounded-[24px] border border-black/6 bg-slate-50 p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_26px_rgba(15,23,42,0.06)]"
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-slate-900">{account.name}</div>
        <Badge className="bg-white text-slate-600" variant="outline">
          {account.priority_score}
        </Badge>
      </div>
      <div className="mt-2 text-sm text-slate-500">
        {account.owner_name || "Owner unassigned"} · Renewal{" "}
        {formatDateShort(account.renewal_date)}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        {account.priority_reasons[0]}
      </p>
    </button>
  );
}

function ActionStudioCard({
  eyebrow,
  title,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-black/6 bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
        <Icon className="size-4" />
        {eyebrow}
      </div>
      <div className="mt-2 font-medium text-slate-900">{title}</div>
      <div className="mt-4">{children}</div>
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

function SignalBarCard({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: number;
  subtitle: string;
  tone: "critical" | "warning" | "watch";
}) {
  return (
    <div className="rounded-[22px] border border-black/6 bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{label}</div>
          <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
        </div>
        <div className="text-right text-2xl font-semibold tracking-tight text-slate-900">
          {value}
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/6">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            tone === "critical" && "bg-[#111827]",
            tone === "warning" && "bg-[#d97706]",
            tone === "watch" && "bg-[#2563eb]"
          )}
          style={{ width: `${Math.min(Math.max(value, 6), 100)}%` }}
        />
      </div>
    </div>
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

function buildSignalBars(
  context: AccountContext
): Array<{
  label: string;
  value: number;
  subtitle: string;
  tone: "critical" | "warning" | "watch";
}> {
  const health = safeNumber(context.crm.health_score);
  const renewalDays = daysUntilFromString(context.crm.renewal_date);
  const tickets = safeNumber(context.crm.open_ticket_count);
  const usageChange = Math.abs(safeNumber(context.internal.usage_change_30d));
  const engagement = context.internal.engagement_status;

  return [
    {
      label: "Health pressure",
      value: Math.min(Math.max(100 - health, 8), 100),
      subtitle: `Health score ${context.crm.health_score ?? "-"}`,
      tone: "critical" as const,
    },
    {
      label: "Renewal urgency",
      value:
        renewalDays === null
          ? 20
          : renewalDays <= 14
            ? 100
            : renewalDays <= 30
              ? 82
              : renewalDays <= 60
                ? 58
                : 30,
      subtitle:
        renewalDays === null
          ? "Renewal date unavailable"
          : `${renewalDays} days until renewal`,
      tone:
        renewalDays !== null && renewalDays <= 30
          ? ("critical" as const)
          : ("warning" as const),
    },
    {
      label: "Ticket pressure",
      value: Math.min(tickets * 8 + (context.internal.open_escalation ? 12 : 0), 100),
      subtitle: `${tickets} open tickets`,
      tone: tickets >= 8 ? ("critical" as const) : ("warning" as const),
    },
    {
      label: "Usage & engagement",
      value: Math.min(usageChange * 5 + engagementPenalty(engagement), 100),
      subtitle: `${usageChange}% usage delta · ${engagement || "Unknown"}`,
      tone:
        engagement === "At Risk"
          ? ("critical" as const)
          : ("watch" as const),
    },
  ];
}

function buildRenewalTimeline(accounts: PrioritizedAccount[]) {
  const buckets = [
    { window: "<=7d", accounts: 0, min: Number.NEGATIVE_INFINITY, max: 7 },
    { window: "8-14d", accounts: 0, min: 8, max: 14 },
    { window: "15-30d", accounts: 0, min: 15, max: 30 },
    { window: ">30d", accounts: 0, min: 31, max: Number.POSITIVE_INFINITY },
  ];

  for (const account of accounts) {
    const days = daysUntilFromString(account.renewal_date);
    const bucket =
      buckets.find((item) => {
        if (days === null) {
          return item.window === ">30d";
        }
        return days >= item.min && days <= item.max;
      }) || buckets[buckets.length - 1];
    bucket.accounts += 1;
  }

  return buckets.map(({ window, accounts }) => ({
    window,
    accounts,
  }));
}

function toPressureChartData(
  signalBars: Array<{
    label: string;
    value: number;
  }>
) {
  return signalBars.map((signal) => ({
    label: compactLabel(signal.label, 16),
    pressure: signal.value,
  }));
}

function buildSimilarityChartData(similar: SimilarAccount[]) {
  return similar.slice(0, 5).map((account) => ({
    name: compactLabel(account.name, 16),
    similarity: Number(account.similarity.toFixed(4)),
  }));
}

function buildSimilarityPlaybook(
  context: AccountContext,
  similar: SimilarAccount[]
) {
  const sharedPatterns = deriveSharedPatterns(similar)
    .filter((pattern) => pattern.count > 0)
    .map((pattern) => pattern.label.toLowerCase());
  const similarNames = similar
    .slice(0, 2)
    .map((account) => account.name)
    .join(" and ");

  return [
    `Treat ${context.crm.name}${similarNames ? `, ${similarNames},` : ""} as one investigation cluster around ${humanizeTheme(
      context.internal.top_issue_theme
    ).toLowerCase()}.`,
    `Apply the same first intervention across the cluster: ${
      context.internal.recommended_next_action ||
      "reconfirm the blocker, owner, and next customer milestone"
    }.`,
    `Track the cluster against shared patterns like ${
      sharedPatterns.join(", ") || "renewal pressure and support load"
    } so the team can reuse the play instead of reacting account by account.`,
  ];
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

function engagementPenalty(status?: string | null) {
  if (status === "At Risk") {
    return 26;
  }
  if (status === "Declining") {
    return 18;
  }
  if (status === "Neutral") {
    return 10;
  }
  return 4;
}

function buildSeatUtilization(context: AccountContext) {
  const active = context.internal.active_users ?? 0;
  const licensed = context.internal.licensed_seats ?? 0;
  if (!licensed) {
    return 0;
  }
  return Math.min(Math.round((active / licensed) * 100), 100);
}

function buildTouchRisk(context: AccountContext) {
  const days = context.internal.days_since_last_touch ?? 0;
  return Math.min(Math.max(Math.round((days / 30) * 100), 0), 100);
}

function safeNumber(value?: string | number | null) {
  if (typeof value === "number") {
    return value;
  }
  return Number(value ?? 0) || 0;
}

function compactLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function humanizeTheme(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
