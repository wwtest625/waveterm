// Copyright 2025, Command Platform Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isThinkingPhaseLabel } from "./agentstatus";
import { getToolDisplayName } from "./aitooluse";
import {
    type AgentRuntimeSnapshot,
    coalesceToolDetailParts,
    type WaveUIMessage,
    type WaveUIMessagePart,
    AI_CODE_FONT_FAMILY,
    isInternalAssistantToolName,
    isTextPart,
    isToolDetailPart,
} from "./aitypes";
import { formatCommandDuration } from "./command-duration";
import { t } from "./aipanel-i18n";
import { WaveAIModel } from "./waveai-model";
import { type TaskTurn, normalizeAssistantText, splitReasoningFromText } from "./ai-message-types";

export type TaskChainStepStatus = "completed" | "running" | "failed" | "cancelled" | "pending";

export type TaskChainStep = {
    id: string;
    title: string;
    detail?: string;
    durationLabel?: string;
    exitCode?: number;
    status: TaskChainStepStatus;
    toolName: string;
    duplicateCount?: number;
};

export type TaskChainDisplayGroup = {
    primary: TaskChainStep;
    secondary?: TaskChainStep;
};

export type TaskChainDisplayState = {
    statusLabel?: string;
    blockedReason?: string;
    activeStepId?: string;
    toneClassName: string;
};

export type TaskChainFlowEntry =
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

export type TaskChainStepEntry = Extract<TaskChainFlowEntry, { type: "step" }>;

export const RAW_OUTPUT_COLLAPSE_LINES = 5;
export const TASK_CHAIN_OUTPUT_COLLAPSE_LINES = 0;
const COMMAND_OUTPUT_STEP_TOOL = "command_output";

const cancellationReasonLabels: Record<string, string> = {
    manual: t.message.cancelReasonManual,
    follow_up: t.message.cancelReasonFollowUp,
    user_command: t.message.cancelReasonUserCommand,
    timeout: t.message.cancelReasonTimeout,
    error: t.message.cancelReasonError,
};

export function cancellationReasonLabel(reason: string): string {
    return cancellationReasonLabels[reason] ?? reason;
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
    return t.message.durationFormatted(formatCommandDuration(durationMs));
}

export function getTaskChainDetailLanguage(step: Pick<TaskChainStep, "toolName">): string | undefined {
    switch (step.toolName) {
        case "wave_run_command":
            return "bash";
        default:
            return undefined;
    }
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

function isSyntheticProcessExitMessage(text?: string): boolean {
    const normalized = text?.trim();
    if (!normalized) {
        return false;
    }
    return /^process exited with status \d+$/i.test(normalized);
}

function isApprovalStillPending(approval?: string, isStreaming = false): boolean {
    return approval === "needs-approval" && isStreaming;
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
        if (toolName === "term_command_output") {
            if (toolName === "term_command_output" && part.data.status === "running") {
                const outputPreview = getMeaningfulOutputPreview(part.data.outputtext, 3);
                if (outputPreview) {
                    return outputPreview;
                }
                return t.message.snapshotReturned;
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
    if (part.data.status === "cancelled") {
        return "cancelled";
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
    if (part.data.partial === true) {
        return "running";
    }
    if (part.data.partial === false) {
        return "completed";
    }
    return isStreaming ? "running" : "pending";
}

export function buildTaskChainSteps(
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }>,
    isStreaming: boolean
): TaskChainStep[] {
    parts = coalesceToolDetailParts(parts);
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
            const rawCommandOutput = part.data.outputtext?.trim() || part.data.errormessage?.trim();
            const commandOutput = isSyntheticProcessExitMessage(rawCommandOutput) ? undefined : rawCommandOutput;
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

function getTaskStepStateLabel(status: TaskChainStepStatus): string {
    switch (status) {
        case "completed":
            return t.message.completed;
        case "running":
            return t.message.inProgress;
        case "failed":
            return t.message.failed;
        case "cancelled":
            return t.message.cancelled;
        default:
            return t.message.pending;
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
        case "failed":
            return "border-red-500/20 bg-red-500/[0.04] text-red-100";
        case "cancelled":
            return "border-zinc-500/20 bg-zinc-500/[0.04] text-zinc-300";
        case "awaiting_approval":
        case "interacting":
        case "retrying":
            return "border-amber-400/20 bg-amber-400/[0.04] text-amber-100";
        default:
            return "border-white/[0.06] text-emerald-100";
    }
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

export function formatExitCodeLabel(exitCode?: number): string | undefined {
    if (exitCode == null) {
        return undefined;
    }
    return `Exit ${exitCode}`;
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

function getVisibleToolParts(
    messages: WaveUIMessage[]
): Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }> {
    const toolParts = coalesceToolDetailParts(messages.flatMap((message) => (message.parts ?? []).filter(isToolDetailPart)));
    return toolParts.filter((part) => !isInternalAssistantToolName(part.data?.toolname));
}

export function getPendingApprovalToolUses(
    messages: WaveUIMessage[],
    isStreaming = false
): Array<WaveUIMessagePart & { type: "data-tooluse" }> {
    return getVisibleToolParts(messages).filter(
        (part): part is WaveUIMessagePart & { type: "data-tooluse" } =>
            part.type === "data-tooluse" && isApprovalStillPending(part.data.approval, isStreaming)
    );
}

export function shouldShowTurnTaskChain(turn: TaskTurn): boolean {
    return buildTaskChainSteps(getVisibleToolParts(turn.assistantMessages), turn.isStreaming).length > 0;
}

const CommandNarrativeBlock = memo(({ title, text }: { title: string; text: string }) => {
    const model = WaveAIModel.getInstance();

    return (
        <div className="mb-1 rounded border border-emerald-300/10 bg-emerald-300/[0.035] px-1.5 py-1">
            <div className="mb-0.5 flex items-center gap-1 text-[9px] font-medium tracking-[0.1em] text-emerald-200/65 uppercase">
                <i className="fa-solid fa-sparkles text-[8px]" />
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

const NarrativeBlock = memo(({ text }: { text: string }) => {
    const model = WaveAIModel.getInstance();

    return (
        <div className="rounded-lg border border-emerald-300/12 bg-emerald-300/[0.035] px-2 py-1">
            <div className="mb-0.5 text-[9px] uppercase tracking-[0.12em] text-emerald-200/60">{t.message.aiDescription}</div>
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

        const outputStep = secondary && isOutputLikeStep(secondary) ? secondary : isOutputLikeStep(step) ? step : null;
        const hasExpandableOutput = outputStep != null && !!outputStep.detail;
        const isOutputExpanded = hasExpandableOutput && expandedOutputSteps[outputStep.id] === true;
        const outputDisplay = hasExpandableOutput ? getRawOutputDisplayState(outputStep!.detail!.trimEnd(), TASK_CHAIN_OUTPUT_COLLAPSE_LINES) : null;

        const isCommandStep = step.toolName === "wave_run_command";
        const commandText = step.detail || step.title;
        const exitCodeLabel = formatExitCodeLabel(step.exitCode ?? secondary?.exitCode);
        const durationLabel = step.durationLabel ?? secondary?.durationLabel;

        const handleToggle = () => {
            if (outputStep) {
                onToggleExpanded(outputStep.id);
            }
        };

        return (
            <div
                data-toolcallid={step.id}
                ref={(el) => WaveAIModel.getInstance()?.registerScrollTarget(step.id, el)}
            >
                {entry.narrativeBefore && <CommandNarrativeBlock title={t.message.executionIntent} text={entry.narrativeBefore} />}
                <div
                    className={cn(
                        "flex items-center gap-1.5 rounded-sm px-1 py-px",
                        hasExpandableOutput && "cursor-pointer hover:bg-white/[0.03]",
                        isActive && "bg-lime-300/[0.04]",
                        animateStep && "animate-pulse"
                    )}
                    onClick={hasExpandableOutput ? handleToggle : undefined}
                >
                    <span className="shrink-0 text-[10px] text-zinc-500 tabular-nums w-3 text-right">{index + 1}.</span>
                    {isCommandStep ? (
                        <code className="text-[11px] text-zinc-200 truncate flex-1 min-w-0" style={{ fontFamily: AI_CODE_FONT_FAMILY }}>{commandText}</code>
                    ) : (
                        <span className="text-[11px] text-zinc-300 truncate flex-1 min-w-0">{commandText}</span>
                    )}
                    {step.status === "running" && (
                        <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                    )}
                    {step.status === "failed" && (
                        <i className="shrink-0 fa-solid fa-circle-xmark text-[9px] text-red-400" />
                    )}
                    {(step.duplicateCount ?? 1) > 1 && (
                        <span className="shrink-0 text-[9px] text-zinc-500">×{step.duplicateCount}</span>
                    )}
                    {hasExpandableOutput && !isOutputExpanded && outputDisplay && (
                        <span className="shrink-0 text-[10px] text-zinc-500">▸ {outputDisplay.lineCount}</span>
                    )}
                    {hasExpandableOutput && isOutputExpanded && (
                        <span className="shrink-0 text-[10px] text-zinc-500">▾</span>
                    )}
                    {durationLabel && (
                        <span className="shrink-0 text-[10px] text-zinc-500">{durationLabel}</span>
                    )}
                    {exitCodeLabel && (
                        <span className="shrink-0 text-[9px] text-zinc-400">{exitCodeLabel}</span>
                    )}
                </div>
                {hasExpandableOutput && isOutputExpanded && outputStep!.detail && (
                    <div className="ml-4 mt-0.5">
                        <pre
                            className={cn(
                                "whitespace-pre-wrap break-all rounded bg-black/15 px-1.5 py-1 text-[11px] leading-[18px]",
                                isActive ? "text-zinc-100/85" : "text-zinc-200/80"
                            )}
                            style={{ fontFamily: AI_CODE_FONT_FAMILY }}
                        >
                            {outputDisplay?.expandedText}
                        </pre>
                    </div>
                )}
                {entry.narrativeAfter && (
                    <div className="mt-0.5 ml-4">
                        <CommandNarrativeBlock title={t.message.resultJudgment} text={entry.narrativeAfter} />
                    </div>
                )}
            </div>
        );
    }
);

TaskChainStepGroup.displayName = "TaskChainStepGroup";

export const TaskChain = memo(({ turn, runtime }: { turn: TaskTurn; runtime: AgentRuntimeSnapshot | null }) => {
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
                "group relative mt-1.5 overflow-hidden rounded-xl border px-2 py-1.5 transition-colors duration-200",
                "bg-white/[0.02]",
                displayState.toneClassName
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium tracking-[0.06em]">
                        <span className="text-zinc-200">{t.message.executionSteps}</span>
                        {displayState.statusLabel && (
                            <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-1.5 py-px text-[9px] font-normal tracking-[0.1em] text-zinc-300 uppercase">
                                {displayState.statusLabel}
                            </span>
                        )}
                        {toolUseCount > 0 && (
                            <span className="rounded-full border border-lime-300/15 bg-lime-300/[0.06] px-1.5 py-px text-[10px] font-normal tracking-normal text-lime-200/80">
                                {t.message.callCount(toolUseCount)}
                            </span>
                        )}
                        {isThinkingPhaseLabel(displayState.statusLabel) && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-px text-[10px] font-normal tracking-normal text-zinc-300/70">
                                <i className="fa-solid fa-spinner fa-spin text-[8px]" />
                                Thinking
                            </span>
                        )}
                    </div>
                </div>
            </div>
            {shouldRenderTaskChainBlockedReason(displayState.blockedReason) && (
                <div className="mt-0.5 text-[11px] text-zinc-200/70">{displayState.blockedReason}</div>
            )}
            <div className="mt-0.5 space-y-px">
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

export const TaskChainApprovalActions = memo(({ turn }: { turn: TaskTurn }) => {
    const model = WaveAIModel.getInstance();
    const approveButtonRef = useRef<HTMLButtonElement | null>(null);
    const pendingApprovals = getPendingApprovalToolUses(turn.assistantMessages, turn.isStreaming);
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

    const label = pendingApprovals.length > 1 ? t.message.approvalCount(pendingApprovals.length) : t.message.waitingApproval;

    return (
        <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-amber-100">
            <div className="flex items-center gap-2 text-[11px] font-medium">
                <i className="fa-solid fa-triangle-exclamation text-amber-300/70" />
                <span>{label}</span>
            </div>
            <div className="mt-1 text-[11px] text-amber-50/60">{t.message.approvalHint}</div>
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
