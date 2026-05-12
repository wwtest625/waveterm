// Copyright 2025, Command Platform Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { cn } from "@/util/util";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
    type AIBlockOutputStatus,
    type WaveUIMessage,
    AI_CODE_FONT_FAMILY,
    isAIBlockActive,
    isAIBlockTerminal,
    isTextPart,
} from "./aitypes";
import { t } from "./aipanel-i18n";
import { WaveAIModel } from "./waveai-model";
import { type TaskTurn, normalizeAssistantText, splitReasoningFromText, getMessageText } from "./ai-message-types";
import {
    cancellationReasonLabel,
    formatExitCodeLabel,
    getRawOutputDisplayState,
    RAW_OUTPUT_COLLAPSE_LINES,
    shouldShowTurnTaskChain,
} from "./ai-taskchain";
import { getTurnExitCode } from "./ai-taskturn-utils";

export const THINKING_OUTPUT_COLLAPSE_LINES = 4;

type AssistantDisplayContent = {
    answerText: string;
    thinkingText: string;
};

function getAssistantDisplayContent(messages: WaveUIMessage[]): AssistantDisplayContent {
    const answerSegments: string[] = [];
    const thinkingSegments: string[] = [];

    for (const message of messages) {
        if (!message?.parts?.length) {
            continue;
        }
        const rawText = message.parts
            .filter(isTextPart)
            .map((part) => part.text ?? "")
            .join("\n\n");
        if (!rawText.trim()) {
            continue;
        }
        const { answerText, thinkingText } = splitReasoningFromText(rawText);
        if (answerText) {
            answerSegments.push(answerText);
        }
        if (thinkingText) {
            thinkingSegments.push(thinkingText);
        }
    }

    return {
        answerText: normalizeAssistantText(answerSegments.join("\n\n")),
        thinkingText: thinkingSegments.join("\n\n").trim(),
    };
}

export function getThinkingDisplayState(outputText: string, maxLines = THINKING_OUTPUT_COLLAPSE_LINES) {
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

export function shouldRenderStreamingPlainText(isStreaming: boolean, text: string): boolean {
    return isStreaming && Boolean(text.trim());
}

export const UserPromptCard = memo(({ message }: { message?: WaveUIMessage }) => {
    if (!message) {
        return null;
    }
    const text = getMessageText(message);
    if (!text) {
        return null;
    }
    return (
        <div className="flex justify-end">
            <div className="max-w-[78%] rounded-2xl border border-lime-300/15 bg-lime-300/[0.06] px-4 py-3 text-sm text-zinc-100">
                <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-lime-200/50">You</div>
                <div className="whitespace-pre-wrap break-words">{text}</div>
            </div>
        </div>
    );
});

UserPromptCard.displayName = "UserPromptCard";

const StreamingTextBlock = memo(({ text }: { text: string }) => {
    return (
        <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400/50" />
            <div className="whitespace-pre-wrap break-words pl-2 text-[13px] leading-6 text-zinc-100">
                {text}
                <span className="inline-block w-[3px] h-[14px] ml-0.5 bg-emerald-400 animate-pulse rounded-sm align-text-bottom" />
            </div>
        </div>
    );
});

StreamingTextBlock.displayName = "StreamingTextBlock";

const CompletionHeader = memo(() => {
    return (
        <div className="mb-2 flex items-center gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-300">
                <i className="fa-solid fa-circle-check text-emerald-400/70" />
                <span>{t.message.taskComplete}</span>
            </div>
        </div>
    );
});

CompletionHeader.displayName = "CompletionHeader";

const AssistantRail = memo(({ blockStatus }: { blockStatus: AIBlockOutputStatus }) => {
    const dotClass =
        blockStatus.status === "partially_received" || blockStatus.status === "pending"
            ? "bg-emerald-400/60"
            : blockStatus.status === "failed"
              ? "bg-red-400/60"
              : blockStatus.status === "cancelled"
                ? "bg-zinc-500/60"
                : "bg-zinc-600";
    return (
        <div className="flex shrink-0 flex-col items-center">
            <div className={cn("mt-1 h-2 w-2 rounded-full", dotClass)} />
            <div className="mt-2 h-full min-h-10 w-px bg-white/[0.04]" />
        </div>
    );
});

AssistantRail.displayName = "AssistantRail";

const ThinkingTraceCard = memo(({ reasoningText, isStreaming }: { reasoningText: string; isStreaming: boolean }) => {
    const [expanded, setExpanded] = useState(false);
    const displayState = getThinkingDisplayState(reasoningText);
    const displayedText = expanded ? displayState.expandedText : displayState.collapsedText;
    const startedAtRef = useRef<number | null>(null);
    const [durationMs, setDurationMs] = useState<number | null>(null);

    if (startedAtRef.current == null && reasoningText) {
        startedAtRef.current = performance.now();
    }

    useEffect(() => {
        if (isStreaming) {
            setExpanded(false);
        } else if (startedAtRef.current != null && durationMs == null) {
            setDurationMs(Math.round(performance.now() - startedAtRef.current));
        }
    }, [isStreaming, reasoningText, durationMs]);

    const durationLabel = useMemo(() => {
        if (durationMs == null) return null;
        if (durationMs < 1000) return `${durationMs}ms`;
        return `${(durationMs / 1000).toFixed(1)}s`;
    }, [durationMs]);

    if (!reasoningText) {
        return null;
    }

    return (
        <div className="mb-3 overflow-hidden rounded-xl border border-emerald-300/12 bg-emerald-300/[0.03]">
            <div className="flex items-center justify-between gap-2 border-b border-emerald-300/10 px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200/70">
                    <i className="fa-solid fa-brain" />
                    <span>{t.message.deepThinking}</span>
                    {isStreaming && (
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="bg-gradient-to-r from-emerald-200/70 via-emerald-100 to-emerald-200/70 bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer-sweep_2s_ease-in-out_infinite]">{t.message.processing}</span>
                        </span>
                    )}
                    {!isStreaming && durationLabel && (
                        <span className="text-emerald-200/50">{durationLabel}</span>
                    )}
                </div>
                {displayState.shouldCollapse && (
                    <button
                        type="button"
                        onClick={() => setExpanded((value) => !value)}
                        className="text-[10px] uppercase tracking-[0.12em] text-emerald-200/50 transition hover:text-emerald-100"
                    >
                        {expanded ? t.message.collapse : t.message.expand(displayState.lineCount)}
                    </button>
                )}
            </div>
            <pre
                className="max-h-[20lh] overflow-auto whitespace-pre-wrap px-3 py-2 text-xs leading-5 text-emerald-50/75"
                style={{ fontFamily: AI_CODE_FONT_FAMILY }}
            >
                {displayedText}
            </pre>
            {displayState.shouldCollapse && !expanded && (
                <div className="border-t border-emerald-300/10 px-3 py-1.5 text-[10px] text-emerald-200/50">
                    {t.message.showFirstNLines(THINKING_OUTPUT_COLLAPSE_LINES)}
                </div>
            )}
        </div>
    );
});

ThinkingTraceCard.displayName = "ThinkingTraceCard";

function toOutputText(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    if (value == null) {
        return "";
    }
    return String(value).trim();
}

export const AssistantOutputCard = memo(({ turn, fallbackOutput }: { turn: TaskTurn; fallbackOutput?: string }) => {
    const { answerText: assistantText, thinkingText } = getAssistantDisplayContent(turn.assistantMessages);
    const rawToolOutput = toOutputText(fallbackOutput);
    const exitCodeLabel = formatExitCodeLabel(getTurnExitCode(turn.assistantMessages));
    const outputText = assistantText || fallbackOutput || "";
    const hasTaskChain = shouldShowTurnTaskChain(turn);
    const blockStatus = turn.blockOutputStatus;
    const isActive = isAIBlockActive(blockStatus);
    const isTerminal = isAIBlockTerminal(blockStatus);
    const showAssistantMarkdown = assistantText.length > 0 && !hasTaskChain;
    const showRawOutputBlock =
        isTerminal && rawToolOutput.length > 0 && (!showAssistantMarkdown || hasTaskChain);
    const showEmptyState =
        !showAssistantMarkdown && !thinkingText && !rawToolOutput && isTerminal && !hasTaskChain;
    const showCompletionHeader = blockStatus.status === "complete" && showAssistantMarkdown;
    const model = WaveAIModel.getInstance();
    const [rawOutputExpanded, setRawOutputExpanded] = useState(false);
    const rawOutputDisplay = getRawOutputDisplayState(rawToolOutput);
    const displayedRawOutput = rawOutputExpanded ? rawOutputDisplay.expandedText : rawOutputDisplay.collapsedText;
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setRawOutputExpanded(false);
    }, [rawToolOutput]);

    useEffect(() => {
        setCopied(false);
    }, [assistantText, rawToolOutput]);

    if (hasTaskChain && !showRawOutputBlock && !thinkingText && isTerminal) {
        return null;
    }

    const blockBorderClass =
        blockStatus.status === "failed"
            ? "border-red-400/15"
            : blockStatus.status === "cancelled"
              ? "border-zinc-500/15"
              : "border-white/[0.06]";

    const handleCopy = async () => {
        const copyText = assistantText || rawToolOutput || outputText;
        if (!copyText) {
            return;
        }
        await navigator.clipboard.writeText(copyText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex items-stretch gap-3">
            <AssistantRail blockStatus={blockStatus} />
            <div className={cn("min-w-0 flex-1 rounded-2xl border bg-white/[0.02] px-4 py-3.5", blockBorderClass)}>
                {showCompletionHeader && <CompletionHeader />}

                {blockStatus.status === "cancelled" && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-500/15 bg-zinc-500/[0.06] px-3 py-2 text-[11px] text-zinc-300">
                        <i className="fa-solid fa-ban text-zinc-400" />
                        <span>{blockStatus.cancellationReason ? t.message.cancelledWithReason(cancellationReasonLabel(blockStatus.cancellationReason)) : t.message.cancelled}</span>
                    </div>
                )}

                {blockStatus.status === "failed" && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-400/15 bg-red-400/[0.06] px-3 py-2 text-[11px] text-red-200">
                        <i className="fa-solid fa-circle-exclamation text-red-400" />
                        <span>{blockStatus.errorMessage ? t.message.executionErrorWithMsg(blockStatus.errorMessage) : t.message.executionError}</span>
                    </div>
                )}

                {thinkingText && <ThinkingTraceCard reasoningText={thinkingText} isStreaming={isActive} />}

                {showAssistantMarkdown && (
                    <div>
                        <WaveStreamdown
                            text={assistantText}
                            parseIncompleteMarkdown={true}
                            codeFontFamily={AI_CODE_FONT_FAMILY}
                            codeClassName="text-[14px]"
                            className="text-zinc-100 [&_.markdown-content]:mx-0"
                            codeBlockMaxWidthAtom={model.codeBlockMaxWidth}
                        />
                    </div>
                )}

                {showRawOutputBlock && (
                    <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
                        <div className="flex items-center justify-between gap-3 border-b border-white/[0.04] px-3 py-1.5">
                            <div className="flex items-center gap-2">
                                <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">{t.message.result}</div>
                                {exitCodeLabel && (
                                    <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
                                        {exitCodeLabel}
                                    </span>
                                )}
                            </div>
                            {rawOutputDisplay.shouldCollapse && (
                                <button
                                    type="button"
                                    onClick={() => setRawOutputExpanded((value) => !value)}
                                    className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 transition hover:text-zinc-300"
                                >
                                    {rawOutputExpanded ? t.message.collapse : t.message.expand(rawOutputDisplay.lineCount)}
                                </button>
                            )}
                        </div>
                        <pre
                            className="overflow-x-auto whitespace-pre-wrap px-3 py-2.5 text-base text-zinc-100"
                            style={{ fontFamily: AI_CODE_FONT_FAMILY }}
                        >
                            {displayedRawOutput}
                        </pre>
                        {rawOutputDisplay.shouldCollapse && !rawOutputExpanded && (
                            <div className="border-t border-white/[0.04] px-3 py-1.5 text-[10px] text-zinc-500">
                                {t.message.showFirstNLines(RAW_OUTPUT_COLLAPSE_LINES)}
                            </div>
                        )}
                    </div>
                )}

                {isActive && !assistantText && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="bg-gradient-to-r from-zinc-400 via-zinc-200 to-zinc-400 bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer-sweep_2s_ease-in-out_infinite]">{t.message.processing}</span>
                    </div>
                )}

                {showEmptyState && <div className="mt-3 text-sm text-zinc-400">No visible result returned.</div>}

                {isTerminal && (assistantText || rawToolOutput) && (
                    <div className="mt-3 flex items-center gap-2 border-t border-white/[0.04] pt-2.5">
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-400 transition hover:border-white/[0.1] hover:bg-white/[0.05] hover:text-zinc-200"
                        >
                            <i className={`fa ${copied ? "fa-check" : "fa-copy"} text-[10px]`} />
                            {copied ? t.message.copied : t.message.copy}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});

AssistantOutputCard.displayName = "AssistantOutputCard";
