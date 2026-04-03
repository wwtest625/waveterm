// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { atoms } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { memo, startTransition, useEffect, useRef, useState } from "react";
import { cn } from "@/util/util";
import { AIFeedbackButtons } from "./aifeedbackbuttons";
import { AIModeDropdown } from "./aimode";
import { AIToolUseGroup } from "./aitooluse";
import { type WaveUIMessage, type WaveUIMessagePart } from "./aitypes";
import { getFirstExecutableCommandFromMessage, isSafeToAutoExecute } from "./autoexecute-util";
import { AgentMode } from "./waveai-model";
import { WaveAIModel } from "./waveai-model";

interface AIPanelMessagesProps {
    messages: WaveUIMessage[];
    status: string;
    onContextMenu?: (e: React.MouseEvent) => void;
}

type TaskTurn = {
    id: string;
    userMessage?: WaveUIMessage;
    assistantMessages: WaveUIMessage[];
    isStreaming: boolean;
};

type TaskChainStepStatus = "completed" | "running" | "failed" | "pending";

type TaskChainStep = {
    id: string;
    title: string;
    detail?: string;
    status: TaskChainStepStatus;
};

const RAW_OUTPUT_COLLAPSE_LINES = 5;

const ToolDetailTypes = new Set(["data-tooluse", "data-toolprogress"]);

function isTextPart(part: WaveUIMessagePart): part is WaveUIMessagePart & { type: "text"; text: string } {
    return part.type === "text" && typeof part.text === "string";
}

function isToolDetailPart(
    part: WaveUIMessagePart
): part is WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" } {
    return ToolDetailTypes.has(part.type);
}

function normalizeAssistantText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
        return "";
    }
    const lines = trimmed
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));
    if (lines.length <= 1) {
        return trimmed;
    }
    const firstLine = lines[0].trim();
    const noisyLeadInPatterns = [
        /^(看起来|我来|我帮|让我|远程命令执行|命令执行|我通过终端|我改用|我换个方式)/,
        /(重新查询|换个方式|终端回来看|执行遇到了问题|没有返回输出)/,
    ];
    const shouldDropLeadIn =
        firstLine.length <= 40 && noisyLeadInPatterns.some((pattern) => pattern.test(firstLine)) && lines.length >= 2;
    return (shouldDropLeadIn ? lines.slice(1) : lines).join("\n").trim();
}

function getMessageText(message?: WaveUIMessage): string {
    if (!message?.parts?.length) {
        return "";
    }
    return normalizeAssistantText(
        message.parts
            .filter(isTextPart)
            .map((part) => part.text ?? "")
            .join("\n\n")
    );
}

function getAssistantText(messages: WaveUIMessage[]): string {
    return normalizeAssistantText(
        messages
            .map((message) => getMessageText(message))
            .filter(Boolean)
            .join("\n\n")
    );
}

function getToolParts(
    messages: WaveUIMessage[]
): Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }> {
    return messages.flatMap((message) => (message.parts ?? []).filter(isToolDetailPart));
}

function getLatestRawToolOutput(messages: WaveUIMessage[]): string {
    const toolUsePart = [...getToolParts(messages)]
        .reverse()
        .find((part) => part.type === "data-tooluse" && Boolean(part.data.outputtext?.trim()));
    if (toolUsePart?.type !== "data-tooluse") {
        return "";
    }
    return toolUsePart.data.outputtext?.trim() ?? "";
}

function toOutputText(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    if (value == null) {
        return "";
    }
    return String(value).trim();
}

export function getRawOutputDisplayState(outputText: string, maxLines = RAW_OUTPUT_COLLAPSE_LINES) {
    const normalized = outputText.trim();
    const lines = normalized ? normalized.split(/\r?\n/) : [];
    const shouldCollapse = lines.length > maxLines;
    return {
        lineCount: lines.length,
        shouldCollapse,
        collapsedText: shouldCollapse ? lines.slice(0, maxLines).join("\n") : normalized,
        expandedText: normalized,
    };
}

function getToolStepTitle(toolName: string): string {
    switch (toolName) {
        case "wave_run_command":
        case "codex_command_execution":
            return "执行命令";
        case "wave_get_command_result":
            return "获取执行结果";
        case "term_get_scrollback":
        case "term_command_output":
            return "读取终端输出";
        case "read_text_file":
            return "读取文件";
        case "read_dir":
            return "读取目录";
        case "write_text_file":
            return "写入文件";
        case "edit_text_file":
            return "精准编辑";
        default:
            return toolName.replace(/_/g, " ");
    }
}

function normalizeToolDetail(desc?: string): string | undefined {
    if (!desc) {
        return undefined;
    }
    const text = desc.trim().replace(/\s+/g, " ");
    if (!text) {
        return undefined;
    }
    if (text.length <= 120) {
        return text;
    }
    return `${text.slice(0, 120)}...`;
}

function deriveToolUseStatus(
    part: WaveUIMessagePart & { type: "data-tooluse" },
    isStreaming: boolean
): TaskChainStepStatus {
    const approval = part.data.approval;
    if (part.data.status === "error" || approval === "user-denied" || approval === "timeout") {
        return "failed";
    }
    if (part.data.status === "completed") {
        return "completed";
    }
    if (approval === "needs-approval") {
        return "pending";
    }
    return isStreaming ? "running" : "pending";
}

export function buildTaskChainSteps(
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }>,
    isStreaming: boolean
): TaskChainStep[] {
    const steps: TaskChainStep[] = [];
    const byToolCallId = new Map<string, TaskChainStep>();

    for (const part of parts) {
        if (part.type === "data-tooluse") {
            const step: TaskChainStep = {
                id: part.data.toolcallid,
                title: getToolStepTitle(part.data.toolname),
                detail: normalizeToolDetail(part.data.tooldesc || part.data.errormessage),
                status: deriveToolUseStatus(part, isStreaming),
            };
            byToolCallId.set(part.data.toolcallid, step);
            steps.push(step);
            continue;
        }
        const existing = byToolCallId.get(part.data.toolcallid);
        if (existing != null) {
            if ((existing.status === "pending" || existing.status === "running") && part.data.statuslines?.length) {
                existing.detail = normalizeToolDetail(part.data.statuslines[part.data.statuslines.length - 1]);
            }
            continue;
        }
        steps.push({
            id: part.data.toolcallid,
            title: getToolStepTitle(part.data.toolname),
            detail: normalizeToolDetail(part.data.statuslines?.[part.data.statuslines.length - 1]),
            status: isStreaming ? "running" : "pending",
        });
    }

    return steps;
}

function getTaskChainProgress(steps: TaskChainStep[]): { completed: number; total: number } {
    const total = steps.length;
    const completed = steps.filter((step) => step.status === "completed").length;
    return { completed, total };
}

const TaskChain = memo(({ steps }: { steps: TaskChainStep[] }) => {
    if (steps.length === 0) {
        return null;
    }
    const progress = getTaskChainProgress(steps);
    const activeStep =
        steps.find((step) => step.status === "running") ?? steps.find((step) => step.status === "failed");

    return (
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-200">运行任务进度</div>
                <div className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                    {progress.completed}/{progress.total}
                </div>
            </div>
            {activeStep && <div className="mt-2 text-xs text-yellow-300">当前聚焦 {activeStep.title}</div>}
            <div className="mt-2 space-y-1.5">
                {steps.map((step, index) => {
                    const iconClass =
                        step.status === "completed"
                            ? "fa-circle-check text-emerald-400"
                            : step.status === "failed"
                              ? "fa-circle-xmark text-red-400"
                              : step.status === "running"
                                ? "fa-spinner fa-spin text-yellow-400"
                                : "fa-circle text-zinc-500";
                    const titleClass =
                        step.status === "failed"
                            ? "text-red-300"
                            : step.status === "completed"
                              ? "text-zinc-100"
                              : "text-zinc-300";
                    return (
                        <div key={step.id} className="rounded border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-2">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-zinc-500">{index + 1}.</span>
                                <i className={`fa ${iconClass}`}></i>
                                <span className={titleClass}>{step.title}</span>
                            </div>
                            {step.detail && <div className="mt-1 pl-7 text-xs text-zinc-500">{step.detail}</div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

TaskChain.displayName = "TaskChain";

function getLatestMeaningfulCommand(messages: WaveUIMessage[]): string | undefined {
    return [...messages].reverse().map(getFirstExecutableCommandFromMessage).find(Boolean) ?? undefined;
}

function getLatestApprovalState(messages: WaveUIMessage[]): "needs-approval" | "approved" | "denied" | null {
    const toolUse = getToolParts(messages)
        .filter((part) => part.type === "data-tooluse")
        .at(-1);
    if (!toolUse) {
        return null;
    }
    if (toolUse.data.approval === "needs-approval") {
        return "needs-approval";
    }
    if (toolUse.data.approval === "user-approved" || toolUse.data.approval === "auto-approved") {
        return "approved";
    }
    if (toolUse.data.approval === "user-denied" || toolUse.data.approval === "timeout") {
        return "denied";
    }
    return null;
}

export function buildTaskTurns(messages: WaveUIMessage[], status: string): TaskTurn[] {
    const turns: TaskTurn[] = [];
    let currentTurn: TaskTurn | null = null;

    for (const message of messages) {
        if (message.role === "user") {
            currentTurn = {
                id: message.id,
                userMessage: message,
                assistantMessages: [],
                isStreaming: false,
            };
            turns.push(currentTurn);
            continue;
        }
        if (message.role !== "assistant") {
            continue;
        }
        if (currentTurn == null) {
            currentTurn = {
                id: message.id,
                assistantMessages: [],
                isStreaming: false,
            };
            turns.push(currentTurn);
        }
        currentTurn.assistantMessages.push(message);
    }

    const lastTurn = turns.at(-1);
    if (lastTurn) {
        const lastAssistant = lastTurn.assistantMessages.at(-1);
        lastTurn.isStreaming = status === "streaming" && (Boolean(lastAssistant) || Boolean(lastTurn.userMessage));
    }

    return turns;
}

function getTurnSignature(turn: TaskTurn): string {
    const assistantIds = turn.assistantMessages.map((message) => message.id).join(",");
    return `${turn.id}|${turn.userMessage?.id ?? ""}|${assistantIds}|${turn.isStreaming ? "1" : "0"}`;
}

function reuseStableTurns(previousTurns: TaskTurn[], nextTurns: TaskTurn[]): TaskTurn[] {
    return nextTurns.map((turn, index) => {
        if (turn.isStreaming) {
            return turn;
        }
        const previousTurn = previousTurns[index];
        if (previousTurn && !previousTurn.isStreaming && getTurnSignature(previousTurn) === getTurnSignature(turn)) {
            return previousTurn;
        }
        return turn;
    });
}

function useBufferedTaskTurns(messages: WaveUIMessage[], status: string): TaskTurn[] {
    const initialTurnsRef = useRef<TaskTurn[]>(buildTaskTurns(messages, status));
    const [turns, setTurns] = useState<TaskTurn[]>(initialTurnsRef.current);
    const turnsRef = useRef(turns);
    const pendingTurnsRef = useRef<TaskTurn[] | null>(null);
    const frameRef = useRef<number | null>(null);

    useEffect(() => {
        turnsRef.current = turns;
    }, [turns]);

    useEffect(() => {
        const nextTurns = reuseStableTurns(turnsRef.current, buildTaskTurns(messages, status));

        if (status !== "streaming") {
            if (frameRef.current != null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            pendingTurnsRef.current = null;
            turnsRef.current = nextTurns;
            startTransition(() => {
                setTurns(nextTurns);
            });
            return;
        }

        pendingTurnsRef.current = nextTurns;
        if (frameRef.current != null) {
            return;
        }

        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const pendingTurns = pendingTurnsRef.current;
            pendingTurnsRef.current = null;
            if (!pendingTurns) {
                return;
            }
            turnsRef.current = pendingTurns;
            startTransition(() => {
                setTurns(pendingTurns);
            });
        });
    }, [messages, status]);

    useEffect(() => {
        return () => {
            if (frameRef.current != null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, []);

    return turns;
}

const UserPromptCard = memo(({ message }: { message?: WaveUIMessage }) => {
    if (!message) {
        return null;
    }
    const text = getMessageText(message);
    if (!text) {
        return null;
    }
    return (
        <div className="flex justify-end">
            <div className="max-w-[78%] rounded-[20px] border border-lime-300/25 bg-[linear-gradient(180deg,rgba(132,255,120,0.12),rgba(132,255,120,0.06))] px-4 py-3 text-sm text-zinc-100 shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
                <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-lime-200/70">You</div>
                <div className="whitespace-pre-wrap break-words">{text}</div>
            </div>
        </div>
    );
});

UserPromptCard.displayName = "UserPromptCard";

const StreamingTextBlock = memo(({ text }: { text: string }) => {
    return (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400/70" />
            <div className="whitespace-pre-wrap break-words pl-2 text-sm leading-6 text-zinc-100">{text}</div>
        </div>
    );
});

StreamingTextBlock.displayName = "StreamingTextBlock";

const AssistantStatusPill = memo(({ turn }: { turn: TaskTurn }) => {
    const toolParts = getToolParts(turn.assistantMessages);
    const latestCommand = getLatestMeaningfulCommand(turn.assistantMessages);
    const label = turn.isStreaming ? "Working" : "Response";

    return (
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            <span>{label}</span>
            {latestCommand && <span className="truncate normal-case tracking-normal text-zinc-500/80">{latestCommand}</span>}
            {!latestCommand && toolParts.length > 0 && (
                <span className="normal-case tracking-normal text-zinc-500/80">{toolParts.length} tool event</span>
            )}
        </div>
    );
});

AssistantStatusPill.displayName = "AssistantStatusPill";

const ToolProgressList = memo(({ turn }: { turn: TaskTurn }) => {
    const toolParts = getToolParts(turn.assistantMessages);
    const steps = buildTaskChainSteps(toolParts, turn.isStreaming);

    if (steps.length === 0) {
        return null;
    }

    return (
        <div className="mt-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
            {steps.map((step) => {
                const dotClass =
                    step.status === "completed"
                        ? "bg-emerald-400"
                        : step.status === "failed"
                          ? "bg-red-400"
                          : step.status === "running"
                            ? "bg-amber-300"
                            : "bg-zinc-500";
                return (
                    <div key={step.id} className="flex items-start gap-2 py-1.5 text-sm text-zinc-200">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
                        <div className="min-w-0">
                            <div>{step.title}</div>
                            {step.detail && <div className="truncate text-xs text-zinc-500">{step.detail}</div>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

ToolProgressList.displayName = "ToolProgressList";

const CompletionHeader = memo(() => {
    return (
        <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <i className="fa-solid fa-circle-check text-emerald-400" />
                <span>Task completed</span>
            </div>
        </div>
    );
});

CompletionHeader.displayName = "CompletionHeader";

function getModeLabel(mode: AgentMode): string {
    switch (mode) {
        case "planning":
            return "Planning";
        case "auto-approve":
            return "Auto approve";
        default:
            return "Default";
    }
}

const CompactRateLimit = memo(() => {
    const rateLimitInfo = useAtomValue(atoms.waveAIRateLimitInfoAtom);

    if (!rateLimitInfo || rateLimitInfo.unknown) {
        return null;
    }

    if (rateLimitInfo.req === 0 && rateLimitInfo.preq === 0) {
        return (
            <div className="rounded-full border border-red-300/20 bg-red-300/10 px-3 py-1 text-[11px] text-red-100">
                Daily limit reached
            </div>
        );
    }

    if (rateLimitInfo.preq <= 5) {
        return (
            <div className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] text-amber-100">
                Premium {Math.max(rateLimitInfo.preq, 0)} left
            </div>
        );
    }

    return null;
});

CompactRateLimit.displayName = "CompactRateLimit";

const PanelHero = memo(() => {
    const model = WaveAIModel.getInstance();
    const isLocalAgent = useAtomValue(model.isLocalAgentAtom);
    const localAgentProvider = useAtomValue(model.localAgentProviderAtom);
    const agentMode = useAtomValue(model.agentModeAtom);
    const runtime = useAtomValue(model.agentRuntimeAtom);
    const providerLabel = isLocalAgent ? (localAgentProvider === "claude-code" ? "Claude Code" : "Codex") : "Wave AI";
    const modeLabel = getModeLabel(agentMode);
    const stateLabel = runtime.phaseLabel || "Ready";

    return (
        <div className="mb-4 rounded-[24px] border border-lime-400/20 bg-[radial-gradient(circle_at_top_left,rgba(114,255,102,0.16),transparent_42%),linear-gradient(180deg,rgba(114,255,102,0.08),rgba(114,255,102,0.02))] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                        <i className="fa fa-sparkles text-lime-300" />
                        <span>{providerLabel}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{modeLabel}</span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{stateLabel}</span>
                        <CompactRateLimit />
                    </div>
                </div>
                <AIModeDropdown compatibilityMode={true} />
            </div>
        </div>
    );
});

PanelHero.displayName = "PanelHero";

const AssistantRail = memo(({ status }: { status: "streaming" | "ready" | "attention" }) => {
    const dotClass =
        status === "streaming" ? "bg-emerald-400" : status === "attention" ? "bg-amber-300" : "bg-zinc-500";
    return (
        <div className="flex shrink-0 flex-col items-center">
            <div className={cn("mt-1 h-2.5 w-2.5 rounded-full", dotClass)} />
            <div className="mt-2 h-full min-h-10 w-px bg-white/8" />
        </div>
    );
});

AssistantRail.displayName = "AssistantRail";

const InlineCommandActions = memo(({ turn }: { turn: TaskTurn }) => {
    const model = WaveAIModel.getInstance();
    const latestCommand = getLatestMeaningfulCommand(turn.assistantMessages);
    const approvalState = getLatestApprovalState(turn.assistantMessages);
    const [copied, setCopied] = useState(false);

    if (!latestCommand || turn.isStreaming) {
        return null;
    }

    const handleCopy = async () => {
        await navigator.clipboard.writeText(latestCommand);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };

    const handleRun = () => {
        model.executeCommandInTerminal(latestCommand, { source: "manual" });
    };

    return (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3">
            <button
                type="button"
                onClick={handleCopy}
                className="cursor-pointer rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08]"
            >
                {copied ? "Copied" : "Copy command"}
            </button>
            <button
                type="button"
                onClick={handleRun}
                className="cursor-pointer rounded-full border border-lime-300/20 bg-lime-300/10 px-3 py-1.5 text-xs text-lime-100 transition hover:border-lime-200/35 hover:bg-lime-300/15"
            >
                Run in terminal
            </button>
            {approvalState === "needs-approval" && (
                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-xs text-amber-100">
                    Waiting for approval
                </span>
            )}
            {approvalState === "approved" && (
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100">
                    Approved
                </span>
            )}
            {approvalState === "denied" && (
                <span className="rounded-full border border-red-300/20 bg-red-300/10 px-3 py-1.5 text-xs text-red-100">
                    Denied
                </span>
            )}
        </div>
    );
});

InlineCommandActions.displayName = "InlineCommandActions";

const ToolTrace = memo(({ turn }: { turn: TaskTurn }) => {
    const [open, setOpen] = useState(false);
    const toolParts = getToolParts(turn.assistantMessages);

    useEffect(() => {
        if (turn.isStreaming) {
            setOpen(false);
        }
    }, [turn.isStreaming, turn.id]);

    if (toolParts.length === 0 || turn.isStreaming) {
        return null;
    }

    return (
        <div className="mt-4 border-t border-white/8 pt-3">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="cursor-pointer text-xs uppercase tracking-[0.18em] text-zinc-500 transition hover:text-zinc-300"
            >
                {open ? "Hide tool trace" : "Show tool trace"}
            </button>
            {open && (
                <div className="mt-3">
                    <AIToolUseGroup parts={toolParts} isStreaming={turn.isStreaming} />
                </div>
            )}
        </div>
    );
});

ToolTrace.displayName = "ToolTrace";

const AssistantOutputCard = memo(
    ({ turn, fallbackOutput }: { turn: TaskTurn; fallbackOutput?: string }) => {
        const assistantText = getAssistantText(turn.assistantMessages);
        const rawToolOutput = toOutputText(fallbackOutput);
        const outputText = assistantText || fallbackOutput || "";
        const showRawOutputBlock = !turn.isStreaming && rawToolOutput.length > 0;
        const showEmptyState = !assistantText && !rawToolOutput && !turn.isStreaming;
        const showCompletionHeader = !turn.isStreaming && assistantText.length > 0;
        const model = WaveAIModel.getInstance();
        const approvalState = getLatestApprovalState(turn.assistantMessages);
        const railStatus = turn.isStreaming ? "streaming" : approvalState === "needs-approval" ? "attention" : "ready";
        const [rawOutputExpanded, setRawOutputExpanded] = useState(false);
        const rawOutputDisplay = getRawOutputDisplayState(rawToolOutput);
        const displayedRawOutput = rawOutputExpanded ? rawOutputDisplay.expandedText : rawOutputDisplay.collapsedText;

        useEffect(() => {
            setRawOutputExpanded(false);
        }, [rawToolOutput]);

        return (
            <div className="flex items-stretch gap-3">
                <AssistantRail status={railStatus} />
                <div className="min-w-0 flex-1 rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
                    <AssistantStatusPill turn={turn} />
                    {showCompletionHeader && <CompletionHeader />}

                    {assistantText && (
                        <div>
                            {turn.isStreaming ? (
                                <StreamingTextBlock text={assistantText} />
                            ) : (
                                <WaveStreamdown
                                    text={outputText}
                                    className="text-zinc-100 [&_.markdown-content]:mx-0"
                                    codeBlockMaxWidthAtom={model.codeBlockMaxWidth}
                                    onClickExecute={(cmd) => model.executeCommandInTerminal(cmd, { source: "manual" })}
                                />
                            )}
                        </div>
                    )}

                    <ToolProgressList turn={turn} />

                    {showRawOutputBlock && (
                        <div className="mt-3 overflow-hidden rounded-2xl border border-white/8 bg-black/30">
                            <div className="flex items-center justify-between gap-3 border-b border-white/8 px-3 py-2">
                                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Raw output</div>
                                {rawOutputDisplay.shouldCollapse && (
                                    <button
                                        type="button"
                                        onClick={() => setRawOutputExpanded((value) => !value)}
                                        className="text-[11px] uppercase tracking-[0.18em] text-zinc-400 transition hover:text-zinc-200"
                                    >
                                        {rawOutputExpanded ? "收起" : `展开全部 (${rawOutputDisplay.lineCount} 行)`}
                                    </button>
                                )}
                            </div>
                            <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-3 text-sm text-zinc-100">
                                {displayedRawOutput}
                            </pre>
                            {rawOutputDisplay.shouldCollapse && !rawOutputExpanded && (
                                <div className="border-t border-white/8 px-3 py-2 text-xs text-zinc-500">
                                    仅显示前 {RAW_OUTPUT_COLLAPSE_LINES} 行，点击展开查看全部
                                </div>
                            )}
                        </div>
                    )}

                    {turn.isStreaming && !assistantText && <div className="mt-3 text-sm text-zinc-400">处理中...</div>}

                    {showEmptyState && <div className="mt-3 text-sm text-zinc-400">No visible result returned.</div>}

                    <InlineCommandActions turn={turn} />

                    {!turn.isStreaming && assistantText && (
                        <div className="mt-4 border-t border-white/8 pt-3">
                            <AIFeedbackButtons messageText={assistantText} />
                        </div>
                    )}

                    <ToolTrace turn={turn} />
                </div>
            </div>
        );
    }
);

AssistantOutputCard.displayName = "AssistantOutputCard";

const TaskTurnCard = memo(({ turn, fallbackOutput }: { turn: TaskTurn; fallbackOutput?: string }) => {
    if (!turn.userMessage && turn.assistantMessages.length === 0) {
        return null;
    }
    return (
        <div className="space-y-4">
            <UserPromptCard message={turn.userMessage} />
            <AssistantOutputCard turn={turn} fallbackOutput={fallbackOutput} />
        </div>
    );
});

TaskTurnCard.displayName = "TaskTurnCard";

export const AIPanelMessages = memo(({ messages, status, onContextMenu }: AIPanelMessagesProps) => {
    const model = WaveAIModel.getInstance();
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const autoExecute = useAtomValue(model.autoExecuteAtom);
    const runtime = useAtomValue(model.agentRuntimeAtom);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<string>(status);
    const seenAssistantMessageIdsRef = useRef<Set<string>>(new Set());
    const pendingAutoExecuteMessageIdRef = useRef<string | null>(null);
    const autoExecuteReadyRef = useRef(false);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const turns = useBufferedTaskTurns(messages, status);
    const runtimeLastToolStdout = runtime.lastToolResult?.stdout?.trim() ?? "";

    const checkIfAtBottom = () => {
        const container = messagesContainerRef.current;
        if (!container) return true;

        const threshold = 50;
        const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return scrollBottom <= threshold;
    };

    const handleScroll = () => {
        setShouldAutoScroll(checkIfAtBottom());
    };

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            container.scrollLeft = 0;
            setShouldAutoScroll(true);
        }
    };

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        container.addEventListener("scroll", handleScroll);
        return () => container.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
    }, [model]);

    useEffect(() => {
        if (shouldAutoScroll) {
            scrollToBottom();
        }
    }, [turns, shouldAutoScroll]);

    useEffect(() => {
        if (isPanelOpen) {
            scrollToBottom();
        }
    }, [isPanelOpen]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming) {
            requestAnimationFrame(() => {
                scrollToBottom();
            });
        }

        prevStatusRef.current = status;
    }, [status]);

    useEffect(() => {
        const assistantMessages = messages.filter((message) => message.role === "assistant");

        if (!autoExecuteReadyRef.current) {
            for (const message of assistantMessages) {
                seenAssistantMessageIdsRef.current.add(message.id);
            }
            autoExecuteReadyRef.current = true;
            return;
        }

        for (const message of assistantMessages) {
            if (!seenAssistantMessageIdsRef.current.has(message.id)) {
                seenAssistantMessageIdsRef.current.add(message.id);
                pendingAutoExecuteMessageIdRef.current = message.id;
            }
        }
    }, [messages]);

    useEffect(() => {
        if (status === "streaming") {
            return;
        }

        if (!autoExecute) {
            pendingAutoExecuteMessageIdRef.current = null;
            return;
        }

        const pendingMessageId = pendingAutoExecuteMessageIdRef.current;
        if (!pendingMessageId) {
            return;
        }

        const pendingMessage = messages.find((message) => message.id === pendingMessageId);
        pendingAutoExecuteMessageIdRef.current = null;
        if (!pendingMessage || pendingMessage.role !== "assistant") {
            return;
        }

        const command = getFirstExecutableCommandFromMessage(pendingMessage);
        if (!command || !isSafeToAutoExecute(command)) {
            return;
        }

        model.executeCommandInTerminal(command, { source: "auto" });
    }, [messages, status, autoExecute, model]);

    return (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2" onContextMenu={onContextMenu}>
            <PanelHero />
            <div className="space-y-6">
                {turns.map((turn, index) => {
                    const isLastTurn = index === turns.length - 1;
                    const turnOutput = getLatestRawToolOutput(turn.assistantMessages);
                    const fallbackOutput = !turn.isStreaming && (turnOutput || (isLastTurn ? runtimeLastToolStdout : ""));
                    return <TaskTurnCard key={turn.id} turn={turn} fallbackOutput={fallbackOutput} />;
                })}
            </div>
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
