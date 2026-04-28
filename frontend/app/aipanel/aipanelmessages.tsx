// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { atoms } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatModeLabel, isThinkingPhaseLabel } from "./agentstatus";
import { AIModeDropdown } from "./aimode";
import { getToolDisplayName } from "./aitooluse";
import {
    type AgentRuntimeSnapshot,
    type AgentRuntimeState,
    type AgentTaskState,
    type WaveUIMessage,
    type WaveUIMessagePart,
    AI_CODE_FONT_FAMILY,
    getLatestTaskStatePart,
    isInternalAssistantToolName,
    isTextPart,
    isToolDetailPart,
} from "./aitypes";
import { AskUserCard } from "./askusercard";
import { formatCommandDuration } from "./command-duration";
import { TaskProgressPanel } from "./taskprogresspanel";
import { WaveAIModel } from "./waveai-model";

export { formatCommandDuration } from "./command-duration";

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
    durationLabel?: string;
    exitCode?: number;
    status: TaskChainStepStatus;
    toolName: string;
    duplicateCount?: number;
};

type TaskChainDisplayGroup = {
    primary: TaskChainStep;
    secondary?: TaskChainStep;
};

type TaskChainDisplayState = {
    statusLabel?: string;
    blockedReason?: string;
    activeStepId?: string;
    toneClassName: string;
};

type TaskChainFlowEntry =
    | {
          type: "narrative";
          id: string;
          text: string;
      }
    | {
          type: "step";
          id: string;
          groupIndex: number;
          group: TaskChainDisplayGroup;
          narrativeBefore?: string;
          narrativeAfter?: string;
      };

type TaskChainStepEntry = Extract<TaskChainFlowEntry, { type: "step" }>;

const RAW_OUTPUT_COLLAPSE_LINES = 5;
const TASK_CHAIN_OUTPUT_COLLAPSE_LINES = 3;
const THINKING_OUTPUT_COLLAPSE_LINES = 4;
const COMMAND_OUTPUT_STEP_TOOL = "command_output";

export function shouldFollowLatestOutput(
    status: string,
    runtimeState: AgentRuntimeState,
    activeJobId?: string | null
): boolean {
    return status === "streaming" || runtimeState === "executing" || Boolean(activeJobId);
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

type AssistantDisplayContent = {
    answerText: string;
    thinkingText: string;
};

export function splitReasoningFromText(text: string): AssistantDisplayContent {
    let remaining = text;
    const reasoningSegments: string[] = [];
    const thinkTagPairs = ["think", "thinking"];

    for (const tagName of thinkTagPairs) {
        const pairRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "gi");
        remaining = remaining.replace(pairRegex, (_match, captured: string) => {
            const segment = captured.trim();
            if (segment) {
                reasoningSegments.push(segment);
            }
            return "\n";
        });
    }

    for (const tagName of thinkTagPairs) {
        const openingTag = `<${tagName}>`;
        const closingTag = `</${tagName}>`;
        const normalized = remaining.toLowerCase();
        const openingTagIndex = normalized.lastIndexOf(openingTag);
        const closingTagIndex = normalized.lastIndexOf(closingTag);
        if (openingTagIndex !== -1 && closingTagIndex < openingTagIndex) {
            const danglingReasoning = remaining.slice(openingTagIndex + openingTag.length).trim();
            if (danglingReasoning) {
                reasoningSegments.push(danglingReasoning);
            }
            remaining = remaining.slice(0, openingTagIndex);
        }
    }

    return {
        answerText: normalizeAssistantText(remaining),
        thinkingText: reasoningSegments.join("\n\n").trim(),
    };
}

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

function getToolParts(
    messages: WaveUIMessage[]
): Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }> {
    return messages.flatMap((message) => (message.parts ?? []).filter(isToolDetailPart));
}

function getVisibleToolParts(
    messages: WaveUIMessage[]
): Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }> {
    return getToolParts(messages).filter((part) => !isInternalAssistantToolName(part.data?.toolname));
}

function getLatestRawToolOutput(messages: WaveUIMessage[]): string {
    const toolUsePart = [...getVisibleToolParts(messages)]
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

export function formatExitCodeLabel(exitCode?: number): string | undefined {
    if (exitCode == null) {
        return undefined;
    }
    return `Exit ${exitCode}`;
}

function getToolStepTitle(toolName: string): string {
    return getToolDisplayName(toolName);
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

function getDurationLabel(durationMs?: number): string | undefined {
    if (durationMs == null || durationMs <= 0) {
        return undefined;
    }
    return `耗时 ${formatCommandDuration(durationMs)}`;
}

export function getTaskChainDetailLanguage(step: Pick<TaskChainStep, "toolName">): string | undefined {
    switch (step.toolName) {
        case "wave_run_command":
            return "bash";
        default:
            return undefined;
    }
}

export function shouldRenderStreamingPlainText(isStreaming: boolean, text: string): boolean {
    return isStreaming && Boolean(text.trim());
}

function getFirstMeaningfulLine(text?: string): string | undefined {
    const normalized = text?.trim();
    if (!normalized) {
        return undefined;
    }
    return normalized
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
}

function getMeaningfulOutputPreview(text?: string, maxLines = 5): string | undefined {
    const normalized = text?.trim();
    if (!normalized) {
        return undefined;
    }
    const lines = normalized
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line, index, arr) => line.trim().length > 0 || (index > 0 && arr[index - 1].trim().length > 0));
    if (lines.length === 0) {
        return undefined;
    }
    const previewLines = lines.slice(0, maxLines);
    const preview = previewLines.join("\n").trim();
    if (lines.length <= maxLines) {
        return preview;
    }
    return `${preview}\n...`;
}

function isPollingCommandPlaceholder(text?: string): boolean {
    const normalized = text?.trim();
    if (!normalized) {
        return false;
    }
    return /^polling command result for\s+\S+$/i.test(normalized);
}

function extractCommandFromToolDesc(toolDesc?: string): string | undefined {
    const normalized = toolDesc?.trim();
    if (!normalized) {
        return undefined;
    }
    const quotedPrefix = normalized.match(/^(?:running|executing|run)\s+"/i);
    if (quotedPrefix) {
        const quoteStart = normalized.indexOf(`"`);
        if (quoteStart >= 0) {
            let escaped = false;
            for (let i = quoteStart + 1; i < normalized.length; i++) {
                const ch = normalized[i];
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (ch === "\\") {
                    escaped = true;
                    continue;
                }
                if (ch === `"`) {
                    const quotedLiteral = normalized.slice(quoteStart, i + 1);
                    try {
                        const decoded = JSON.parse(quotedLiteral) as string;
                        return decoded.trim();
                    } catch {
                        return quotedLiteral.slice(1, -1).trim();
                    }
                }
            }
        }
    }
    const unquotedMatch = normalized.match(/(?:running|executing|run)\s+(.+?)(?:\s+on\s+.+)?$/i);
    if (unquotedMatch?.[1]) {
        return unquotedMatch[1].trim();
    }
    return normalized;
}

function formatStepDetail(
    toolName: string,
    part: WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }
): string | undefined {
    if (part.type === "data-tooluse") {
        if (toolName === "wave_run_command") {
            return extractCommandFromToolDesc(part.data.tooldesc);
        }
        // Historical messages may still contain this old model-facing tool.
        if (toolName === "term_command_output") {
            if (toolName === "term_command_output" && part.data.status === "running") {
                const outputPreview = getMeaningfulOutputPreview(part.data.outputtext, 3);
                if (outputPreview) {
                    return outputPreview;
                }
                return "已返回最新快照，后台继续刷新";
            }
            const fullOutput = part.data.outputtext?.trim();
            if (fullOutput) {
                return fullOutput;
            }
            const errorMessage = part.data.errormessage?.trim();
            if (errorMessage) {
                return errorMessage;
            }
            const fallbackDetail =
                getFirstMeaningfulLine(part.data.tooldesc) ?? normalizeToolDetail(part.data.tooldesc);
            return isPollingCommandPlaceholder(fallbackDetail) ? undefined : fallbackDetail;
        }
        return normalizeToolDetail(part.data.tooldesc || part.data.errormessage);
    }

    if (toolName === "term_command_output") {
        return undefined;
    }
    return normalizeToolDetail(part.data.statuslines?.[part.data.statuslines.length - 1]);
}

function deriveToolUseStatus(
    part: WaveUIMessagePart & { type: "data-tooluse" },
    isStreaming: boolean
): TaskChainStepStatus {
    const approval = part.data.approval;
    if (part.data.status === "error" || approval === "user-denied" || approval === "timeout") {
        return "failed";
    }
    if (part.data.status === "running") {
        return "running";
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

    const appendStep = (step: TaskChainStep) => {
        const previous = steps.at(-1);
        if (
            previous &&
            previous.toolName === step.toolName &&
            previous.status === step.status &&
            previous.detail === step.detail &&
            previous.durationLabel === step.durationLabel
        ) {
            previous.duplicateCount = (previous.duplicateCount ?? 1) + 1;
            return previous;
        }
        steps.push(step);
        return step;
    };

    for (const part of parts) {
        if (part.type === "data-tooluse") {
            const toolUseStatus = deriveToolUseStatus(part, isStreaming);
            const commandOutput = part.data.outputtext?.trim() || part.data.errormessage?.trim();
            const step: TaskChainStep = {
                id: part.data.toolcallid,
                title: getToolStepTitle(part.data.toolname),
                detail: formatStepDetail(part.data.toolname, part),
                durationLabel: getDurationLabel(part.data.durationms),
                exitCode:
                    part.data.toolname === "wave_run_command"
                        ? part.data.exitcode
                        : part.data.toolname === "term_command_output"
                          ? part.data.status === "completed"
                              ? 0
                              : part.data.status === "error"
                                ? 1
                                : undefined
                          : undefined,
                status: toolUseStatus,
                toolName: part.data.toolname,
            };
            const appended = appendStep(step);
            byToolCallId.set(part.data.toolcallid, appended);
            if (
                part.data.toolname === "wave_run_command" &&
                commandOutput &&
                (part.data.status === "completed" || part.data.exitcode != null)
            ) {
                appendStep({
                    id: `${part.data.toolcallid}:output`,
                    title: getToolStepTitle(COMMAND_OUTPUT_STEP_TOOL),
                    detail: commandOutput,
                    status: toolUseStatus,
                    toolName: COMMAND_OUTPUT_STEP_TOOL,
                });
            }
            continue;
        }
        const existing = byToolCallId.get(part.data.toolcallid);
        if (existing != null) {
            if ((existing.status === "pending" || existing.status === "running") && part.data.statuslines?.length) {
                if (part.data.toolname === "term_command_output") {
                    continue;
                }
                existing.detail = formatStepDetail(part.data.toolname, part);
            }
            continue;
        }
        appendStep({
            id: part.data.toolcallid,
            title: getToolStepTitle(part.data.toolname),
            detail: formatStepDetail(part.data.toolname, part),
            status: isStreaming ? "running" : "pending",
            toolName: part.data.toolname,
        });
    }

    return steps;
}

function isOutputLikeStep(step: TaskChainStep): boolean {
    return step.toolName === COMMAND_OUTPUT_STEP_TOOL || step.toolName === "term_command_output";
}

export function getTaskChainDisplayGroups(steps: TaskChainStep[]): TaskChainDisplayGroup[] {
    const groups: TaskChainDisplayGroup[] = [];
    const pendingCommandGroups: TaskChainDisplayGroup[] = [];

    for (const step of steps) {
        if (step.toolName === "wave_run_command") {
            const group: TaskChainDisplayGroup = { primary: step };
            groups.push(group);
            pendingCommandGroups.push(group);
            continue;
        }

        if (isOutputLikeStep(step)) {
            const pendingGroup = pendingCommandGroups.find((group) => group.secondary == null);
            if (pendingGroup) {
                pendingGroup.secondary = step;
                continue;
            }
        }

        groups.push({ primary: step });
    }

    return groups;
}

export function buildTaskChainFlowEntries(
    turn: TaskTurn,
    displayGroups: TaskChainDisplayGroup[]
): TaskChainFlowEntry[] {
    const groupIndexByStepId = new Map<string, number>();
    displayGroups.forEach((group, index) => {
        groupIndexByStepId.set(group.primary.id, index);
        if (group.secondary) {
            groupIndexByStepId.set(group.secondary.id, index);
        }
    });

    const entries: TaskChainFlowEntry[] = [];
    const emittedGroupIndexes = new Set<number>();
    const pendingBeforeSegments: string[] = [];
    let lastStepEntry: Extract<TaskChainFlowEntry, { type: "step" }> | null = null;

    const flushPendingBefore = (): string | undefined => {
        const text = normalizeAssistantText(pendingBeforeSegments.join("\n\n"));
        pendingBeforeSegments.length = 0;
        return text || undefined;
    };

    const appendStepNarrativeAfter = (stepEntry: Extract<TaskChainFlowEntry, { type: "step" }>, text: string) => {
        const normalized = normalizeAssistantText(text);
        if (!normalized) {
            return;
        }
        stepEntry.narrativeAfter = normalizeAssistantText(
            [stepEntry.narrativeAfter, normalized].filter(Boolean).join("\n\n")
        );
    };

    for (const message of turn.assistantMessages) {
        for (const part of message.parts ?? []) {
            if (isTextPart(part)) {
                const { answerText } = splitReasoningFromText(part.text ?? "");
                if (answerText) {
                    if (lastStepEntry) {
                        appendStepNarrativeAfter(lastStepEntry, answerText);
                    } else {
                        pendingBeforeSegments.push(answerText);
                    }
                }
                continue;
            }
            if (!isToolDetailPart(part) || isInternalAssistantToolName(part.data?.toolname)) {
                continue;
            }

            const groupIndex = groupIndexByStepId.get(part.data.toolcallid);
            if (groupIndex == null) {
                continue;
            }

            if (emittedGroupIndexes.has(groupIndex)) {
                continue;
            }

            emittedGroupIndexes.add(groupIndex);
            const stepEntry: Extract<TaskChainFlowEntry, { type: "step" }> = {
                type: "step",
                id: `${turn.id}:step:${displayGroups[groupIndex]?.primary.id ?? groupIndex}`,
                groupIndex,
                group: displayGroups[groupIndex],
                narrativeBefore: flushPendingBefore(),
            };
            entries.push(stepEntry);
            lastStepEntry = stepEntry;
        }
    }

    const trailingBefore = flushPendingBefore();
    if (trailingBefore) {
        entries.push({
            type: "narrative",
            id: `${turn.id}:narrative:${entries.length}`,
            text: trailingBefore,
        });
    }
    return entries;
}

export function getTaskChainDisplayState(
    steps: TaskChainStep[],
    runtime: Pick<
        AgentRuntimeSnapshot,
        "state" | "phaseLabel" | "blockedReason" | "activeJobId" | "activeTool" | "lastCommand"
    > | null
): TaskChainDisplayState {
    const systemFailedStep = steps.find(isSystemFailureStep);
    const activeStep =
        steps.find((step) => step.status === "running") ??
        steps.find((step) => step.status === "pending") ??
        systemFailedStep;
    const runtimeIsFailureState =
        runtime?.state === "failed_retryable" || runtime?.state === "failed_fatal" || runtime?.state === "unavailable";
    const hasSystemFailure =
        Boolean(systemFailedStep) || (runtimeIsFailureState && isSystemFailureText(runtime?.blockedReason));
    const statusLabel =
        runtime?.phaseLabel && (!runtimeIsFailureState || hasSystemFailure)
            ? runtime.phaseLabel
            : activeStep
              ? getTaskStepStateLabel(activeStep.status)
              : undefined;
    const blockedReason =
        runtime?.blockedReason && (!runtimeIsFailureState || hasSystemFailure)
            ? runtime.blockedReason
            : activeStep?.detail;
    const toneClassName = hasSystemFailure
        ? getTaskChainToneClass("failed")
        : getTaskChainToneClass(runtime?.state ?? (activeStep ? activeStep.status : undefined));

    return {
        statusLabel,
        blockedReason,
        activeStepId: activeStep?.id,
        toneClassName,
    };
}

function getTaskStepStateLabel(status: TaskChainStepStatus): string {
    switch (status) {
        case "completed":
            return "已完成";
        case "running":
            return "进行中";
        case "failed":
            return "失败";
        default:
            return "等待中";
    }
}

function isSystemFailureText(text?: string): boolean {
    const normalized = text?.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return (
        normalized.includes("tool not found") ||
        normalized.includes("rpc") ||
        normalized.includes("backend") ||
        normalized.includes("failed to stream") ||
        normalized.includes("request failed") ||
        normalized.includes("api returned status") ||
        normalized.includes("timed out waiting for command completion") ||
        normalized.includes("no command result received") ||
        normalized.includes("job not found") ||
        normalized.includes("polling timed out") ||
        normalized.includes("polling canceled")
    );
}

function isSystemFailureStep(step: TaskChainStep): boolean {
    return step.status === "failed" && isSystemFailureText(step.detail);
}

function getTaskChainToneClass(state?: AgentRuntimeSnapshot["state"] | TaskChainStepStatus): string {
    switch (state) {
        case "failed_retryable":
        case "failed_fatal":
        case "unavailable":
        case "cancelled":
        case "failed":
            return "border-red-500/20 bg-red-500/[0.04] text-red-100";
        case "awaiting_approval":
        case "interacting":
        case "retrying":
            return "border-amber-400/20 bg-amber-400/[0.04] text-amber-100";
        default:
            return "border-white/[0.06] text-emerald-100";
    }
}

export function shouldAnimateTaskStep(
    isActive: boolean,
    primaryStatus: TaskChainStepStatus,
    secondaryStatus?: TaskChainStepStatus,
    runtimeState?: AgentRuntimeSnapshot["state"]
): boolean {
    if (!isActive) {
        return false;
    }
    if (primaryStatus === "running" || primaryStatus === "pending" || secondaryStatus === "running") {
        return true;
    }
    if (
        runtimeState === "submitting" ||
        runtimeState === "planning" ||
        runtimeState === "awaiting_approval" ||
        runtimeState === "executing" ||
        runtimeState === "interacting" ||
        runtimeState === "verifying" ||
        runtimeState === "retrying"
    ) {
        return true;
    }
    return false;
}

export function shouldRenderTaskChainBlockedReason(reason?: string): boolean {
    const normalized = reason?.trim();
    if (!normalized) {
        return false;
    }
    if (isPollingCommandPlaceholder(normalized)) {
        return false;
    }
    return true;
}

const TaskChainStepGroup = memo(
    ({
        entry,
        displayState,
        runtimeState,
        expandedOutputSteps,
        onToggleExpanded,
    }: {
        entry: TaskChainStepEntry;
        displayState: TaskChainDisplayState;
        runtimeState?: AgentRuntimeSnapshot["state"];
        expandedOutputSteps: Record<string, boolean>;
        onToggleExpanded: (stepId: string) => void;
    }) => {
        const { group, groupIndex: index } = entry;
        const step = group.primary;
        const secondary = group.secondary;
        const isActive = displayState.activeStepId === step.id || displayState.activeStepId === secondary?.id;
        const animateStep = shouldAnimateTaskStep(isActive, step.status, secondary?.status, runtimeState);
        const durationLabel = step.durationLabel ?? secondary?.durationLabel;
        const exitCodeLabel = formatExitCodeLabel(step.exitCode ?? secondary?.exitCode);
        const iconClass =
            step.status === "completed"
                ? "fa-circle-check text-emerald-400"
                : step.status === "failed"
                  ? "fa-circle-xmark text-red-400"
                  : step.status === "running"
                    ? "fa-spinner fa-spin text-yellow-400"
                    : "fa-circle text-zinc-500";
        const titleClass =
            step.status === "failed" ? "text-red-300" : step.status === "completed" ? "text-zinc-100" : "text-zinc-300";
        const stepToneClass = isActive ? "border-lime-300/15 bg-lime-300/[0.05]" : "border-transparent bg-transparent";

        return (
            <div
                className={cn(
                    "rounded-lg border px-2.5 py-2 transition-all duration-200",
                    "border-white/[0.05] bg-black/[0.08] hover:bg-white/[0.055]",
                    isActive
                        ? `${stepToneClass} ${animateStep ? "animate-pulse" : ""}`
                        : "border-transparent bg-transparent"
                )}
            >
                {entry.narrativeBefore && <CommandNarrativeBlock title="执行意图" text={entry.narrativeBefore} />}
                <div className="flex items-center gap-2 text-[13px]">
                    <span className="inline-flex w-5 justify-end text-zinc-500">{index + 1}.</span>
                    <i className={`fa ${iconClass} w-4 text-center ${animateStep ? "animate-pulse" : ""}`}></i>
                    <span className={titleClass}>{step.title}</span>
                    {(step.duplicateCount ?? 1) > 1 && (
                        <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
                            ×{step.duplicateCount}
                        </span>
                    )}
                    {step.status === "running" && isOutputLikeStep(step) && (
                        <span className="rounded-full border border-yellow-400/15 bg-yellow-400/[0.05] px-2 py-0.5 text-[10px] font-medium tracking-[0.06em] text-yellow-200/70">
                            后台刷新中
                        </span>
                    )}
                </div>
                <TaskChainStepDetail
                    step={step}
                    isActive={isActive}
                    isExpanded={expandedOutputSteps[step.id] === true}
                    onToggleExpanded={onToggleExpanded}
                />
                {(durationLabel || exitCodeLabel) && !secondary && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 pl-5 text-[11px] text-zinc-400">
                        {durationLabel && <span>{durationLabel}</span>}
                        {exitCodeLabel && (
                            <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
                                {exitCodeLabel}
                            </span>
                        )}
                    </div>
                )}
                {secondary && (
                    <div className="mt-1 py-1">
                        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-300">
                            <span className="inline-flex w-5"></span>
                            <i className="fa-solid fa-reply w-4 text-center text-emerald-300/80" />
                            <span>{secondary.title}</span>
                        </div>
                        <TaskChainStepDetail
                            step={secondary}
                            isActive={false}
                            isExpanded={expandedOutputSteps[secondary.id] === true}
                            onToggleExpanded={onToggleExpanded}
                            secondary={true}
                        />
                        {(secondary.durationLabel || formatExitCodeLabel(secondary.exitCode)) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 pl-5 text-[11px] text-zinc-400">
                                {secondary.durationLabel && <span>{secondary.durationLabel}</span>}
                                {formatExitCodeLabel(secondary.exitCode) && (
                                    <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
                                        {formatExitCodeLabel(secondary.exitCode)}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {entry.narrativeAfter && (
                    <div className="mt-2 pl-5">
                        <CommandNarrativeBlock title="结果判断" text={entry.narrativeAfter} />
                    </div>
                )}
            </div>
        );
    }
);

TaskChainStepGroup.displayName = "TaskChainStepGroup";

const TaskChainStepDetail = memo(
    ({
        step,
        isActive,
        isExpanded,
        onToggleExpanded,
        secondary = false,
    }: {
        step: TaskChainStep;
        isActive: boolean;
        isExpanded: boolean;
        onToggleExpanded: (stepId: string) => void;
        secondary?: boolean;
    }) => {
        if (!step.detail) {
            return null;
        }

        const language = getTaskChainDetailLanguage(step);
        const outputDisplay = getRawOutputDisplayState(step.detail.trimEnd(), TASK_CHAIN_OUTPUT_COLLAPSE_LINES);
        const displayedText = isExpanded ? outputDisplay.expandedText : outputDisplay.collapsedText;
        if (language === "bash") {
            return (
                <div className={cn("mt-1 pl-5 text-[12px] leading-5", isActive ? "text-lime-100" : "text-zinc-200")}>
                    <div className="relative">
                        <WaveStreamdown
                            text={`\`\`\`bash\n${displayedText}\n\`\`\``}
                            parseIncompleteMarkdown={false}
                            codeFontFamily={AI_CODE_FONT_FAMILY}
                            codeClassName="text-[14px]"
                            className={cn(
                                "text-[14px]",
                                "[&_.markdown-content]:mx-0",
                                "[&_.markdown-content]:overflow-visible",
                                "[&_.markdown-content]:max-w-full",
                                "[&_pre]:whitespace-pre-wrap [&_pre]:break-all [&_pre]:overflow-x-hidden",
                                "[&_pre]:rounded-md [&_pre]:bg-black [&_pre]:px-2.5 [&_pre]:py-2",
                                "[&_code]:whitespace-pre-wrap [&_code]:break-all"
                            )}
                        />
                        {outputDisplay.shouldCollapse && (
                            <TaskChainExpandButton
                                isExpanded={isExpanded}
                                className="right-10"
                                onClick={() => onToggleExpanded(step.id)}
                            />
                        )}
                    </div>
                </div>
            );
        }
        if (isOutputLikeStep(step)) {
            return (
                <div className="mt-1 pl-5">
                    <div className="relative">
                        <pre
                            className={cn(
                                "whitespace-pre-wrap break-all rounded-lg bg-black/15 px-2.5 py-2 pt-7 pr-20 text-[13px] leading-6",
                                isActive || secondary ? "text-zinc-100/85" : "text-zinc-200/80"
                            )}
                            style={{ fontFamily: AI_CODE_FONT_FAMILY }}
                        >
                            {displayedText}
                        </pre>
                        {outputDisplay.shouldCollapse && (
                            <TaskChainExpandButton
                                isExpanded={isExpanded}
                                className="right-2"
                                onClick={() => onToggleExpanded(step.id)}
                            />
                        )}
                    </div>
                </div>
            );
        }
        if (secondary) {
            return (
                <div className="mt-1 whitespace-pre-wrap break-words pl-5 text-[12px] leading-5 text-zinc-300/90">
                    {step.detail}
                </div>
            );
        }
        return (
            <div className={cn("mt-1 pl-5 text-[12px] leading-5", isActive ? "text-lime-100" : "text-zinc-200")}>
                <WaveStreamdown
                    text={step.detail}
                    parseIncompleteMarkdown={true}
                    codeFontFamily={AI_CODE_FONT_FAMILY}
                    codeClassName="text-[14px]"
                    className="text-zinc-100 [&_.markdown-content]:mx-0"
                />
            </div>
        );
    }
);

TaskChainStepDetail.displayName = "TaskChainStepDetail";

const TaskChainExpandButton = memo(
    ({ isExpanded, className, onClick }: { isExpanded: boolean; className: string; onClick: () => void }) => {
        return (
            <button
                type="button"
                className={cn(
                    "absolute top-2 inline-flex items-center gap-1 rounded border border-white/[0.06] bg-black/20 px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:bg-black/35",
                    className
                )}
                onClick={onClick}
            >
                <span>更多</span>
                <i className={cn("fa-solid text-[9px]", isExpanded ? "fa-chevron-up" : "fa-chevron-down")} />
            </button>
        );
    }
);

TaskChainExpandButton.displayName = "TaskChainExpandButton";

const TaskChain = memo(({ turn, runtime }: { turn: TaskTurn; runtime: AgentRuntimeSnapshot | null }) => {
    const [expandedOutputSteps, setExpandedOutputSteps] = useState<Record<string, boolean>>({});
    const toolParts = useMemo(() => getVisibleToolParts(turn.assistantMessages), [turn.assistantMessages]);
    const toolUseCount = toolParts.filter((part) => part.type === "data-tooluse").length;
    const steps = useMemo(() => buildTaskChainSteps(toolParts, turn.isStreaming), [toolParts, turn.isStreaming]);
    const displayGroups = useMemo(() => getTaskChainDisplayGroups(steps), [steps]);
    const flowEntries = useMemo(() => buildTaskChainFlowEntries(turn, displayGroups), [turn, displayGroups]);
    const displayState = useMemo(() => getTaskChainDisplayState(steps, runtime), [steps, runtime]);
    const toggleExpandedOutputStep = useCallback((stepId: string) => {
        setExpandedOutputSteps((prev) => ({
            ...prev,
            [stepId]: !prev[stepId],
        }));
    }, []);

    if (steps.length === 0 && !runtime?.visible) {
        return null;
    }

    return (
        <div
            className={cn(
                "group relative mt-2 overflow-hidden rounded-2xl border px-3 py-2.5 transition-colors duration-200",
                "bg-white/[0.02]",
                displayState.toneClassName
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium tracking-[0.06em]">
                        <span className="text-zinc-200">执行步骤</span>
                        {displayState.statusLabel && (
                            <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-normal tracking-[0.1em] text-zinc-300 uppercase">
                                {displayState.statusLabel}
                            </span>
                        )}
                        {toolUseCount > 0 && (
                            <span className="rounded-full border border-lime-300/15 bg-lime-300/[0.06] px-2 py-0.5 text-[11px] font-normal tracking-normal text-lime-200/80">
                                {toolUseCount} 次调用
                            </span>
                        )}
                        {isThinkingPhaseLabel(displayState.statusLabel) && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] font-normal tracking-normal text-zinc-300/70">
                                <i className="fa-solid fa-spinner fa-spin text-[9px]" />
                                Thinking
                            </span>
                        )}
                    </div>
                </div>
            </div>
            {shouldRenderTaskChainBlockedReason(displayState.blockedReason) && (
                <div className="mt-1 text-[11px] text-zinc-200/70">{displayState.blockedReason}</div>
            )}
            <div className="mt-2 space-y-2">
                {flowEntries.map((entry) =>
                    entry.type === "narrative" ? (
                        <NarrativeBlock key={entry.id} text={entry.text} />
                    ) : (
                        <TaskChainStepGroup
                            key={entry.id}
                            entry={entry}
                            displayState={displayState}
                            runtimeState={runtime?.state}
                            expandedOutputSteps={expandedOutputSteps}
                            onToggleExpanded={toggleExpandedOutputStep}
                        />
                    )
                )}
            </div>
        </div>
    );
});

TaskChain.displayName = "TaskChain";

export function getPendingApprovalToolUses(
    messages: WaveUIMessage[]
): Array<WaveUIMessagePart & { type: "data-tooluse" }> {
    return getVisibleToolParts(messages).filter(
        (part): part is WaveUIMessagePart & { type: "data-tooluse" } =>
            part.type === "data-tooluse" && part.data.approval === "needs-approval"
    );
}

const TaskChainApprovalActions = memo(({ turn }: { turn: TaskTurn }) => {
    const model = WaveAIModel.getInstance();
    const approveButtonRef = useRef<HTMLButtonElement | null>(null);
    const pendingApprovals = getPendingApprovalToolUses(turn.assistantMessages);
    const pendingApprovalKey = pendingApprovals.map((part) => part.data.toolcallid).join(":");

    useEffect(() => {
        if (pendingApprovals.length === 0) {
            return;
        }
        const timer = window.setTimeout(() => {
            approveButtonRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [pendingApprovalKey, pendingApprovals.length]);

    if (pendingApprovals.length === 0) {
        return null;
    }

    const handleApproveAll = () => {
        pendingApprovals.forEach((part) => {
            model.toolUseSendApproval(part.data.toolcallid, "user-approved");
        });
    };

    const handleDenyAll = () => {
        pendingApprovals.forEach((part) => {
            model.toolUseSendApproval(part.data.toolcallid, "user-denied");
        });
    };

    const label = pendingApprovals.length > 1 ? `审批 ${pendingApprovals.length} 个步骤` : "等待审批";

    return (
        <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-amber-100">
            <div className="flex items-center gap-2 text-[11px] font-medium">
                <i className="fa-solid fa-triangle-exclamation text-amber-300/70" />
                <span>{label}</span>
            </div>
            <div className="mt-1 text-[11px] text-amber-50/60">这一步需要确认后才能继续。</div>
            <div className="mt-2 flex gap-2">
                <button
                    ref={approveButtonRef}
                    type="button"
                    onClick={handleApproveAll}
                    className="cursor-pointer rounded-lg border border-emerald-300/15 bg-emerald-300/[0.06] px-2.5 py-1 text-[11px] text-emerald-100 transition hover:border-emerald-200/25 hover:bg-emerald-300/10"
                >
                    Approve
                </button>
                <button
                    type="button"
                    onClick={handleDenyAll}
                    className="cursor-pointer rounded-lg border border-red-300/15 bg-red-300/[0.06] px-2.5 py-1 text-[11px] text-red-100 transition hover:border-red-200/25 hover:bg-red-300/10"
                >
                    Deny
                </button>
            </div>
        </div>
    );
});

TaskChainApprovalActions.displayName = "TaskChainApprovalActions";

export function shouldShowTurnTaskChain(turn: TaskTurn): boolean {
    return buildTaskChainSteps(getVisibleToolParts(turn.assistantMessages), turn.isStreaming).length > 0;
}

function getTurnTaskPlan(turn: TaskTurn): AgentTaskState | null {
    for (const message of [...turn.assistantMessages].reverse()) {
        const latestTaskState = getLatestTaskStatePart(message);
        const taskState = latestTaskState?.data as AgentTaskState | undefined;
        if (taskState?.source === "model-generated") {
            return taskState;
        }
    }
    return null;
}

export function getTurnExitCode(messages: WaveUIMessage[]): number | undefined {
    const latestToolUse = [...getToolParts(messages)]
        .reverse()
        .find(
            (part) =>
                part.type === "data-tooluse" &&
                part.data.toolname === "wave_run_command" &&
                (part.data.status === "completed" || part.data.status === "error")
        );
    if (latestToolUse?.type !== "data-tooluse") {
        return undefined;
    }
    return latestToolUse.data.exitcode ?? (latestToolUse.data.status === "completed" ? 0 : 1);
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
            <div className="whitespace-pre-wrap break-words pl-2 text-[13px] leading-6 text-zinc-100">{text}</div>
        </div>
    );
});

StreamingTextBlock.displayName = "StreamingTextBlock";

const CompletionHeader = memo(() => {
    return (
        <div className="mb-2 flex items-center gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-300">
                <i className="fa-solid fa-circle-check text-emerald-400/70" />
                <span>任务完成</span>
            </div>
        </div>
    );
});

CompletionHeader.displayName = "CompletionHeader";

const CompactRateLimit = memo(() => {
    const rateLimitInfo = useAtomValue(atoms.waveAIRateLimitInfoAtom);

    if (!rateLimitInfo || rateLimitInfo.unknown) {
        return null;
    }

    if (rateLimitInfo.req === 0 && rateLimitInfo.preq === 0) {
        return (
            <div className="rounded-full border border-red-300/12 bg-red-300/[0.05] px-2 py-0.5 text-[10px] text-red-200/70">
                Daily limit reached
            </div>
        );
    }

    if (rateLimitInfo.preq <= 5) {
        return (
            <div className="rounded-full border border-amber-300/12 bg-amber-300/[0.05] px-2 py-0.5 text-[10px] text-amber-200/70">
                Premium {Math.max(rateLimitInfo.preq, 0)} left
            </div>
        );
    }

    return null;
});

CompactRateLimit.displayName = "CompactRateLimit";

const PanelHero = memo(() => {
    const model = WaveAIModel.getInstance();
    const agentMode = useAtomValue(model.agentModeAtom);
    const runtime = useAtomValue(model.agentRuntimeAtom);
    const providerLabel = "Wave AI";
    const modeLabel = formatModeLabel(agentMode);
    const stateLabel = runtime.phaseLabel || "Ready";

    return (
        <div className="mb-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                        <i className="fa fa-sparkles text-lime-300/70" />
                        <span>{providerLabel}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                        <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5">
                            {modeLabel}
                        </span>
                        <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5">
                            {stateLabel}
                        </span>
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
        status === "streaming" ? "bg-emerald-400/60" : status === "attention" ? "bg-amber-300/60" : "bg-zinc-600";
    return (
        <div className="flex shrink-0 flex-col items-center">
            <div className={cn("mt-1 h-2 w-2 rounded-full", dotClass)} />
            <div className="mt-2 h-full min-h-10 w-px bg-white/[0.04]" />
        </div>
    );
});

AssistantRail.displayName = "AssistantRail";

const NarrativeBlock = memo(({ text }: { text: string }) => {
    const model = WaveAIModel.getInstance();

    return (
        <div className="rounded-xl border border-emerald-300/12 bg-emerald-300/[0.035] px-3 py-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-emerald-200/60">AI 描述</div>
            <WaveStreamdown
                text={text}
                parseIncompleteMarkdown={true}
                codeFontFamily={AI_CODE_FONT_FAMILY}
                codeClassName="text-[14px]"
                className="text-zinc-100 [&_.markdown-content]:mx-0"
                codeBlockMaxWidthAtom={model.codeBlockMaxWidth}
            />
        </div>
    );
});

NarrativeBlock.displayName = "NarrativeBlock";

const CommandNarrativeBlock = memo(({ title, text }: { title: string; text: string }) => {
    const model = WaveAIModel.getInstance();

    return (
        <div className="mb-2 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.035] px-2.5 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium tracking-[0.1em] text-emerald-200/65 uppercase">
                <i className="fa-solid fa-sparkles text-[9px]" />
                <span>{title}</span>
            </div>
            <WaveStreamdown
                text={text}
                parseIncompleteMarkdown={true}
                codeFontFamily={AI_CODE_FONT_FAMILY}
                codeClassName="text-[14px]"
                className="text-zinc-100 [&_.markdown-content]:mx-0"
                codeBlockMaxWidthAtom={model.codeBlockMaxWidth}
            />
        </div>
    );
});

CommandNarrativeBlock.displayName = "CommandNarrativeBlock";

const ThinkingTraceCard = memo(({ reasoningText, isStreaming }: { reasoningText: string; isStreaming: boolean }) => {
    const [expanded, setExpanded] = useState(false);
    const displayState = getThinkingDisplayState(reasoningText);
    const displayedText = expanded ? displayState.expandedText : displayState.collapsedText;

    useEffect(() => {
        if (isStreaming) {
            setExpanded(false);
        }
    }, [isStreaming, reasoningText]);

    if (!reasoningText) {
        return null;
    }

    return (
        <div className="mb-3 overflow-hidden rounded-xl border border-emerald-300/12 bg-emerald-300/[0.03]">
            <div className="flex items-center justify-between gap-2 border-b border-emerald-300/10 px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200/70">
                    <i className="fa-solid fa-brain" />
                    <span>深度思考</span>
                    {isStreaming && <span className="text-emerald-200/50">处理中</span>}
                </div>
                {displayState.shouldCollapse && (
                    <button
                        type="button"
                        onClick={() => setExpanded((value) => !value)}
                        className="text-[10px] uppercase tracking-[0.12em] text-emerald-200/50 transition hover:text-emerald-100"
                    >
                        {expanded ? "收起" : `展开 (${displayState.lineCount})`}
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
                    仅显示前 {THINKING_OUTPUT_COLLAPSE_LINES} 行
                </div>
            )}
        </div>
    );
});

ThinkingTraceCard.displayName = "ThinkingTraceCard";

const AssistantOutputCard = memo(({ turn, fallbackOutput }: { turn: TaskTurn; fallbackOutput?: string }) => {
    const { answerText: assistantText, thinkingText } = getAssistantDisplayContent(turn.assistantMessages);
    const rawToolOutput = toOutputText(fallbackOutput);
    const exitCodeLabel = formatExitCodeLabel(getTurnExitCode(turn.assistantMessages));
    const outputText = assistantText || fallbackOutput || "";
    const hasTaskChain = shouldShowTurnTaskChain(turn);
    const showAssistantMarkdown = assistantText.length > 0 && !hasTaskChain;
    const showRawOutputBlock =
        !turn.isStreaming && rawToolOutput.length > 0 && (!showAssistantMarkdown || hasTaskChain);
    const showEmptyState =
        !showAssistantMarkdown && !thinkingText && !rawToolOutput && !turn.isStreaming && !hasTaskChain;
    const showCompletionHeader = !turn.isStreaming && showAssistantMarkdown;
    const model = WaveAIModel.getInstance();
    const railStatus = turn.isStreaming ? "streaming" : "ready";
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

    if (hasTaskChain && !showRawOutputBlock && !thinkingText && !turn.isStreaming) {
        return null;
    }

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
            <AssistantRail status={railStatus} />
            <div className="min-w-0 flex-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
                {showCompletionHeader && <CompletionHeader />}

                {thinkingText && <ThinkingTraceCard reasoningText={thinkingText} isStreaming={turn.isStreaming} />}

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
                                <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">结果</div>
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
                                    {rawOutputExpanded ? "收起" : `展开 (${rawOutputDisplay.lineCount})`}
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
                                仅显示前 {RAW_OUTPUT_COLLAPSE_LINES} 行
                            </div>
                        )}
                    </div>
                )}

                {turn.isStreaming && !assistantText && <div className="mt-3 text-sm text-zinc-400">处理中...</div>}

                {showEmptyState && <div className="mt-3 text-sm text-zinc-400">No visible result returned.</div>}

                {!turn.isStreaming && (assistantText || rawToolOutput) && (
                    <div className="mt-3 flex items-center gap-2 border-t border-white/[0.04] pt-2.5">
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-400 transition hover:border-white/[0.1] hover:bg-white/[0.05] hover:text-zinc-200"
                        >
                            <i className={`fa ${copied ? "fa-check" : "fa-copy"} text-[10px]`} />
                            {copied ? "已复制" : "复制"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});

AssistantOutputCard.displayName = "AssistantOutputCard";

const TaskTurnCard = memo(
    ({ turn, fallbackOutput, isLatestTurn }: { turn: TaskTurn; fallbackOutput?: string; isLatestTurn: boolean }) => {
        const model = WaveAIModel.getInstance();
        const runtime = useAtomValue(model.agentRuntimeAtom);
        const taskPlan = getTurnTaskPlan(turn);

        if (!turn.userMessage && turn.assistantMessages.length === 0) {
            return null;
        }
        return (
            <div className="space-y-4">
                <UserPromptCard message={turn.userMessage} />
                {shouldShowTurnTaskChain(turn) && <TaskChain turn={turn} runtime={isLatestTurn ? runtime : null} />}
                <AssistantOutputCard turn={turn} fallbackOutput={fallbackOutput} />
                {taskPlan && (
                    <TaskProgressPanel
                        taskState={taskPlan}
                        className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3"
                    />
                )}
            </div>
        );
    }
);

TaskTurnCard.displayName = "TaskTurnCard";

export function resolveTurnFallbackOutput(turn: TaskTurn, isLastTurn: boolean, runtimeLastToolStdout: string): string {
    if (turn.isStreaming) {
        return "";
    }
    const turnOutput = getLatestRawToolOutput(turn.assistantMessages);
    if (turnOutput) {
        return turnOutput;
    }
    if (!isLastTurn || turn.assistantMessages.length === 0) {
        return "";
    }
    return runtimeLastToolStdout;
}

export const AIPanelMessages = memo(({ messages, status, onContextMenu }: AIPanelMessagesProps) => {
    const model = WaveAIModel.getInstance();
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const runtime = useAtomValue(model.agentRuntimeAtom);
    const runtimeState = runtime.state;
    const runtimeActiveJobId = runtime.activeJobId;
    const runtimeLastToolStdout = runtime.lastToolResult?.stdout?.trim() ?? "";
    const runtimeLastToolStderr = runtime.lastToolResult?.stderr?.trim() ?? "";
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<string>(status);
    const shouldAutoScrollRef = useRef(true);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const turns = useBufferedTaskTurns(messages, status);
    const followLatestOutput = shouldFollowLatestOutput(status, runtimeState, runtimeActiveJobId);
    const latestApprovalTurn = [...turns]
        .reverse()
        .find((turn) => getPendingApprovalToolUses(turn.assistantMessages).length > 0);

    const checkIfAtBottom = () => {
        const container = messagesContainerRef.current;
        if (!container) return true;

        const threshold = 50;
        const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return scrollBottom <= threshold;
    };

    const handleScroll = () => {
        const isAtBottom = checkIfAtBottom();
        shouldAutoScrollRef.current = isAtBottom;
        setShouldAutoScroll(isAtBottom);
    };

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            container.scrollLeft = 0;
            shouldAutoScrollRef.current = true;
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
        if (!shouldAutoScroll) {
            return;
        }
        requestAnimationFrame(() => {
            if (!shouldAutoScrollRef.current) {
                return;
            }
            scrollToBottom();
        });
    }, [turns, shouldAutoScroll, followLatestOutput, runtimeLastToolStdout, runtimeLastToolStderr]);

    useEffect(() => {
        if (isPanelOpen) {
            scrollToBottom();
        }
    }, [isPanelOpen]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming && shouldAutoScroll) {
            requestAnimationFrame(() => {
                if (!shouldAutoScrollRef.current) {
                    return;
                }
                scrollToBottom();
            });
        }

        prevStatusRef.current = status;
    }, [status, shouldAutoScroll]);

    return (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2" onContextMenu={onContextMenu}>
            <PanelHero />
            <div className="space-y-6">
                {turns.map((turn, index) => {
                    const isLastTurn = index === turns.length - 1;
                    const fallbackOutput = resolveTurnFallbackOutput(turn, isLastTurn, runtimeLastToolStdout);
                    return (
                        <TaskTurnCard
                            key={turn.id}
                            turn={turn}
                            fallbackOutput={fallbackOutput}
                            isLatestTurn={isLastTurn}
                        />
                    );
                })}
                {latestApprovalTurn && <TaskChainApprovalActions turn={latestApprovalTurn} />}
                <AskUserCard />
            </div>
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
