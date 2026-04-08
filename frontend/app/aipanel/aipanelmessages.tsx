// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { atoms } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, startTransition, useEffect, useRef, useState } from "react";
import { AIModeDropdown } from "./aimode";
import { AIToolUseGroup } from "./aitooluse";
import { type AgentRuntimeSnapshot, type WaveUIMessage, type WaveUIMessagePart } from "./aitypes";
import { getFirstExecutableCommandFromMessage, isSafeToAutoExecute } from "./autoexecute-util";
import { formatCommandDuration } from "./command-duration";
import { AgentMode, WaveAIModel } from "./waveai-model";

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
    status: TaskChainStepStatus;
    toolName: string;
    duplicateCount?: number;
};

type TaskChainDisplayGroup = {
    primary: TaskChainStep;
    secondary?: TaskChainStep;
};

type TaskChainDisplayState = {
    progressLabel: string;
    focusLabel?: string;
    statusLabel?: string;
    blockedReason?: string;
    activeStepId?: string;
    toneClassName: string;
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
        if (
            toolName === "wave_get_command_result" ||
            toolName === "term_command_output" ||
            toolName === "term_get_scrollback"
        ) {
            if (toolName === "wave_get_command_result" && part.data.status === "running") {
                const outputPreview = getMeaningfulOutputPreview(part.data.outputtext, 3);
                if (outputPreview) {
                    return outputPreview;
                }
                return "已返回最新快照，后台继续刷新";
            }
            return (
                getMeaningfulOutputPreview(part.data.outputtext) ??
                getFirstMeaningfulLine(part.data.tooldesc) ??
                normalizeToolDetail(part.data.tooldesc)
            );
        }
        return normalizeToolDetail(part.data.tooldesc || part.data.errormessage);
    }

    if (toolName === "wave_get_command_result" || toolName === "term_command_output") {
        return undefined;
    }
    if (toolName === "term_get_scrollback") {
        return getFirstMeaningfulLine(part.data.statuslines?.[part.data.statuslines.length - 1]);
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
            const step: TaskChainStep = {
                id: part.data.toolcallid,
                title: getToolStepTitle(part.data.toolname),
                detail: formatStepDetail(part.data.toolname, part),
                durationLabel: getDurationLabel(part.data.durationms),
                status: deriveToolUseStatus(part, isStreaming),
                toolName: part.data.toolname,
            };
            const appended = appendStep(step);
            byToolCallId.set(part.data.toolcallid, appended);
            continue;
        }
        const existing = byToolCallId.get(part.data.toolcallid);
        if (existing != null) {
            if ((existing.status === "pending" || existing.status === "running") && part.data.statuslines?.length) {
                if (part.data.toolname === "wave_get_command_result" || part.data.toolname === "term_command_output") {
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
    return step.toolName === "wave_get_command_result" || step.toolName === "term_command_output";
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

function getTaskChainProgress(steps: TaskChainStep[]): { completed: number; total: number } {
    const total = steps.length;
    const completed = steps.filter((step) => step.status === "completed").length;
    return { completed, total };
}

export function getTaskChainDisplayState(
    steps: TaskChainStep[],
    runtime: Pick<
        AgentRuntimeSnapshot,
        "state" | "phaseLabel" | "blockedReason" | "activeJobId" | "activeTool" | "lastCommand"
    > | null
): TaskChainDisplayState {
    const progress = getTaskChainProgress(steps);
    const activeStep =
        steps.find((step) => step.status === "running") ??
        steps.find((step) => step.status === "failed") ??
        steps.find((step) => step.status === "pending");
    const statusLabel = runtime?.phaseLabel || (activeStep ? getTaskStepStateLabel(activeStep.status) : undefined);
    const focusLabel = runtime?.lastCommand || activeStep?.title || runtime?.activeTool || statusLabel;
    const blockedReason = runtime?.blockedReason || activeStep?.detail;
    const toneClassName = getTaskChainToneClass(runtime?.state ?? (activeStep ? activeStep.status : undefined));

    return {
        progressLabel: `${progress.completed}/${progress.total}`,
        focusLabel,
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

function getTaskChainToneClass(state?: AgentRuntimeSnapshot["state"] | TaskChainStepStatus): string {
    switch (state) {
        case "failed_retryable":
        case "failed_fatal":
        case "unavailable":
        case "cancelled":
        case "failed":
            return "border-red-900/60 bg-red-950/20 text-red-100";
        case "awaiting_approval":
        case "interacting":
        case "retrying":
            return "border-yellow-800/60 bg-yellow-950/20 text-yellow-100";
        default:
            return "border-emerald-900/50 bg-emerald-950/20 text-emerald-100";
    }
}

function isThinkingPhaseLabel(label?: string): boolean {
    return typeof label === "string" && label.trim().toLowerCase() === "thinking";
}

const TaskChain = memo(({ turn, runtime }: { turn: TaskTurn; runtime: AgentRuntimeSnapshot }) => {
    const model = WaveAIModel.getInstance();
    const [expandedCommandSteps, setExpandedCommandSteps] = useState<Record<string, boolean>>({});
    const toolParts = getToolParts(turn.assistantMessages);
    const toolUseCount = toolParts.filter((part) => part.type === "data-tooluse").length;
    const steps = buildTaskChainSteps(toolParts, turn.isStreaming);
    const displayGroups = getTaskChainDisplayGroups(steps);
    if (steps.length === 0 && !runtime.visible) {
        return null;
    }
    const displayState = getTaskChainDisplayState(steps, runtime);

    return (
        <div
            className={cn(
                "group relative mt-2 overflow-hidden rounded-[18px] border px-3 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.12)] transition-all duration-300",
                "bg-[radial-gradient(circle_at_top_left,rgba(163,230,53,0.12),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))]",
                "hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(0,0,0,0.18)]",
                displayState.toneClassName
            )}
        >
            <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-lime-300/10 blur-2xl" />
            </div>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold tracking-[0.08em]">
                        <i className="fa-solid fa-list-check text-lime-300" />
                        <span>任务链</span>
                        {displayState.statusLabel && (
                            <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-normal tracking-[0.14em] text-zinc-200 uppercase">
                                {displayState.statusLabel}
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-zinc-300">
                        {toolUseCount > 0 && (
                            <span className="rounded-full border border-lime-300/30 bg-lime-300/12 px-2 py-0.5 text-lime-100">
                                已调用工具 {toolUseCount} 次
                            </span>
                        )}
                        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5">
                            {displayState.progressLabel}
                        </span>
                        {displayState.focusLabel && (
                            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-zinc-200/80">
                                当前聚焦 {displayState.focusLabel}
                            </span>
                        )}
                        {isThinkingPhaseLabel(displayState.statusLabel) && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-zinc-200/80">
                                <i className="fa-solid fa-spinner fa-spin text-[10px]" />
                                Thinking
                            </span>
                        )}
                    </div>
                </div>
            </div>
            {displayState.blockedReason && (
                <div className="mt-1 text-[11px] text-zinc-200/70">{displayState.blockedReason}</div>
            )}
            <TaskChainApprovalActions turn={turn} />
            <div className="mt-2 space-y-1">
                {displayGroups.map((group, index) => {
                    const step = group.primary;
                    const secondary = group.secondary;
                    const isActive =
                        displayState.activeStepId === step.id || displayState.activeStepId === secondary?.id;
                    const durationLabel = step.durationLabel ?? secondary?.durationLabel;
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
                    const stepToneClass = isActive
                        ? "border-lime-300/25 bg-lime-400/[0.08] shadow-[0_0_0_1px_rgba(163,230,53,0.14)]"
                        : "border-white/8 bg-black/15";
                    return (
                        <div
                            key={step.id}
                            className={cn(
                                "rounded-md border px-2 py-1.5 transition-all duration-200",
                                "hover:border-white/15 hover:bg-white/[0.055] hover:shadow-[0_8px_18px_rgba(0,0,0,0.12)]",
                                stepToneClass,
                                isActive && "animate-pulse"
                            )}
                        >
                            <div className="flex items-center gap-2 text-[13px]">
                                <span className="text-zinc-500">{index + 1}.</span>
                                <i className={`fa ${iconClass} ${isActive ? "animate-pulse" : ""}`}></i>
                                <span className={titleClass}>{step.title}</span>
                                {(step.duplicateCount ?? 1) > 1 && (
                                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-300">
                                        ×{step.duplicateCount}
                                    </span>
                                )}
                                {step.status === "running" && step.toolName === "wave_get_command_result" && (
                                    <span className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5 text-[10px] font-medium tracking-[0.08em] text-yellow-200">
                                        后台刷新中
                                    </span>
                                )}
                            </div>
                            {step.detail &&
                                (() => {
                                    const language = getTaskChainDetailLanguage(step);
                                    if (language === "bash") {
                                        const fullCommand = step.detail.trimEnd();
                                        const commandLines = fullCommand.split(/\r?\n/);
                                        const isMultiLineCommand = commandLines.length > 1;
                                        const isExpanded = expandedCommandSteps[step.id] === true;
                                        const displayCommand =
                                            isMultiLineCommand && !isExpanded ? commandLines[0] : fullCommand;
                                        return (
                                            <div
                                                className={cn(
                                                    "mt-0.5 pl-5 text-[12px] leading-5",
                                                    isActive ? "text-lime-100" : "text-zinc-200"
                                                )}
                                            >
                                                <WaveStreamdown
                                                    text={`\`\`\`bash\n${displayCommand}\n\`\`\``}
                                                    parseIncompleteMarkdown={false}
                                                    className={cn(
                                                        "text-[12px]",
                                                        "[&_.markdown-content]:mx-0",
                                                        "[&_.markdown-content]:overflow-visible",
                                                        "[&_.markdown-content]:max-w-full"
                                                    )}
                                                    onClickExecute={(_cmd) =>
                                                        model.executeCommandInTerminal(fullCommand, {
                                                            source: "manual",
                                                        })
                                                    }
                                                />
                                                {isMultiLineCommand && (
                                                    <button
                                                        type="button"
                                                        className="mt-1 cursor-pointer rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-300 transition hover:bg-white/[0.08]"
                                                        onClick={() =>
                                                            setExpandedCommandSteps((prev) => ({
                                                                ...prev,
                                                                [step.id]: !isExpanded,
                                                            }))
                                                        }
                                                    >
                                                        {isExpanded ? "收起" : "展开完整命令"}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    }
                                    return (
                                        <div
                                            className={cn(
                                                "mt-0.5 overflow-hidden pl-5 text-[12px] leading-5",
                                                isActive ? "text-zinc-100/90" : "text-zinc-400"
                                            )}
                                            style={{ maxHeight: "2.8em" }}
                                        >
                                            {step.detail}
                                        </div>
                                    );
                                })()}
                            {durationLabel && (
                                <div className="mt-1 pl-5 text-[11px] text-zinc-400">{durationLabel}</div>
                            )}
                            {secondary && (
                                <div className="mt-2 rounded-md border border-white/8 bg-black/20 px-2 py-1.5">
                                    <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-zinc-300">
                                        <i className="fa-solid fa-reply text-emerald-300/80" />
                                        <span>{secondary.title}</span>
                                    </div>
                                    {secondary.detail && (
                                        <div className="mt-0.5 pl-5 text-[12px] leading-5 text-zinc-100/90">
                                            {secondary.detail}
                                        </div>
                                    )}
                                    {secondary.durationLabel && step.durationLabel == null && (
                                        <div className="mt-0.5 pl-5 text-[11px] text-zinc-400">
                                            {secondary.durationLabel}
                                        </div>
                                    )}
                                </div>
                            )}
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

export function getPendingApprovalToolUses(
    messages: WaveUIMessage[]
): Array<WaveUIMessagePart & { type: "data-tooluse" }> {
    return getToolParts(messages).filter(
        (part): part is WaveUIMessagePart & { type: "data-tooluse" } =>
            part.type === "data-tooluse" && part.data.approval === "needs-approval"
    );
}

const TaskChainApprovalActions = memo(({ turn }: { turn: TaskTurn }) => {
    const model = WaveAIModel.getInstance();
    const pendingApprovals = getPendingApprovalToolUses(turn.assistantMessages);

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
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-amber-100">
            <div className="flex items-center gap-2 text-xs font-medium">
                <i className="fa-solid fa-triangle-exclamation text-amber-300" />
                <span>{label}</span>
            </div>
            <div className="mt-1 text-[12px] text-amber-50/80">
                这一步需要确认后才能继续。审批按钮已直接显示在任务链里。
            </div>
            <div className="mt-2 flex gap-2">
                <button
                    type="button"
                    onClick={handleApproveAll}
                    className="cursor-pointer rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100 transition hover:border-emerald-200/35 hover:bg-emerald-300/15"
                >
                    Approve
                </button>
                <button
                    type="button"
                    onClick={handleDenyAll}
                    className="cursor-pointer rounded-full border border-red-300/20 bg-red-300/10 px-3 py-1.5 text-xs text-red-100 transition hover:border-red-200/35 hover:bg-red-300/15"
                >
                    Deny
                </button>
            </div>
        </div>
    );
});

TaskChainApprovalActions.displayName = "TaskChainApprovalActions";

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
            <div className="whitespace-pre-wrap break-words pl-2 text-[13px] leading-6 text-zinc-100">{text}</div>
        </div>
    );
});

StreamingTextBlock.displayName = "StreamingTextBlock";

const AssistantStatusPill = memo(({ turn }: { turn: TaskTurn }) => {
    const toolParts = getToolParts(turn.assistantMessages);
    const latestCommand = getLatestMeaningfulCommand(turn.assistantMessages);
    const toolUseCount = toolParts.filter((part) => part.type === "data-tooluse").length;
    const label = turn.isStreaming ? "Working" : "Response";

    return (
        <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            <span>{label}</span>
            {toolUseCount > 0 && (
                <span className="rounded-full border border-lime-300/30 bg-lime-300/10 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-lime-200">
                    Tool Used ×{toolUseCount}
                </span>
            )}
            {latestCommand && (
                <span className="normal-case tracking-normal text-zinc-500/80 break-all">{latestCommand}</span>
            )}
            {!latestCommand && toolParts.length > 0 && (
                <span className="normal-case tracking-normal text-zinc-500/80">{toolParts.length} tool event</span>
            )}
        </div>
    );
});

AssistantStatusPill.displayName = "AssistantStatusPill";

const CompletionHeader = memo(() => {
    return (
        <div className="mb-2 flex items-center gap-2">
            <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-100">
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
    const agentMode = useAtomValue(model.agentModeAtom);
    const runtime = useAtomValue(model.agentRuntimeAtom);
    const providerLabel = "Wave AI";
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
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            {modeLabel}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
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

const AssistantOutputCard = memo(({ turn, fallbackOutput }: { turn: TaskTurn; fallbackOutput?: string }) => {
    const assistantText = getAssistantText(turn.assistantMessages);
    const rawToolOutput = toOutputText(fallbackOutput);
    const outputText = assistantText || fallbackOutput || "";
    const showRawOutputBlock = !turn.isStreaming && rawToolOutput.length > 0 && assistantText.length === 0;
    const showEmptyState = !assistantText && !rawToolOutput && !turn.isStreaming;
    const showCompletionHeader = !turn.isStreaming && assistantText.length > 0;
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
            <div className="min-w-0 flex-1 rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.025))] px-3.5 py-3.5 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
                <AssistantStatusPill turn={turn} />
                {showCompletionHeader && <CompletionHeader />}

                {assistantText && (
                    <div>
                        {shouldRenderStreamingPlainText(turn.isStreaming, assistantText) ? (
                            <StreamingTextBlock text={assistantText} />
                        ) : (
                            <WaveStreamdown
                                text={assistantText}
                                parseIncompleteMarkdown={false}
                                className="text-zinc-100 [&_.markdown-content]:mx-0"
                                codeBlockMaxWidthAtom={model.codeBlockMaxWidth}
                                onClickExecute={(cmd) => model.executeCommandInTerminal(cmd, { source: "manual" })}
                            />
                        )}
                    </div>
                )}

                {showRawOutputBlock && (
                    <div className="mt-2 overflow-hidden rounded-xl border border-white/8 bg-black/25">
                        <div className="flex items-center justify-between gap-3 border-b border-white/8 px-2.5 py-1.5">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">结果</div>
                            {rawOutputDisplay.shouldCollapse && (
                                <button
                                    type="button"
                                    onClick={() => setRawOutputExpanded((value) => !value)}
                                    className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition hover:text-zinc-200"
                                >
                                    {rawOutputExpanded ? "收起" : `展开 (${rawOutputDisplay.lineCount})`}
                                </button>
                            )}
                        </div>
                        <pre className="overflow-x-auto whitespace-pre-wrap px-2.5 py-2.5 text-sm text-zinc-100">
                            {displayedRawOutput}
                        </pre>
                        {rawOutputDisplay.shouldCollapse && !rawOutputExpanded && (
                            <div className="border-t border-white/8 px-2.5 py-1.5 text-[10px] text-zinc-500">
                                仅显示前 {RAW_OUTPUT_COLLAPSE_LINES} 行
                            </div>
                        )}
                    </div>
                )}

                {turn.isStreaming && !assistantText && <div className="mt-3 text-sm text-zinc-400">处理中...</div>}

                {showEmptyState && <div className="mt-3 text-sm text-zinc-400">No visible result returned.</div>}

                <InlineCommandActions turn={turn} />

                {!turn.isStreaming && (assistantText || rawToolOutput) && (
                    <div className="mt-3 flex items-center gap-2 border-t border-white/8 pt-2.5">
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.07]"
                        >
                            <i className={`fa ${copied ? "fa-check" : "fa-copy"}`} />
                            {copied ? "已复制" : "复制"}
                        </button>
                    </div>
                )}

                <ToolTrace turn={turn} />
            </div>
        </div>
    );
});

AssistantOutputCard.displayName = "AssistantOutputCard";

const TaskTurnCard = memo(
    ({ turn, fallbackOutput, isLatestTurn }: { turn: TaskTurn; fallbackOutput?: string; isLatestTurn: boolean }) => {
        const model = WaveAIModel.getInstance();
        const runtime = useAtomValue(model.agentRuntimeAtom);

        if (!turn.userMessage && turn.assistantMessages.length === 0) {
            return null;
        }
        return (
            <div className="space-y-4">
                <UserPromptCard message={turn.userMessage} />
                {isLatestTurn && <TaskChain turn={turn} runtime={runtime} />}
                <AssistantOutputCard turn={turn} fallbackOutput={fallbackOutput} />
            </div>
        );
    }
);

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
            console.log("[waveai:autoexecute] disabled by setting");
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
            console.log("[waveai:autoexecute] pending message missing or not assistant", {
                pendingMessageId,
            });
            return;
        }

        const command = getFirstExecutableCommandFromMessage(pendingMessage);
        if (!command || !isSafeToAutoExecute(command)) {
            console.log("[waveai:autoexecute] command not executable", {
                pendingMessageId,
                hasCommand: Boolean(command),
                command,
                safe: command ? isSafeToAutoExecute(command) : false,
            });
            return;
        }

        const executed = model.executeCommandInTerminal(command, { source: "auto" });
        console.log("[waveai:autoexecute] execute result", {
            pendingMessageId,
            executed,
            command,
        });
    }, [messages, status, autoExecute, model]);

    return (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2" onContextMenu={onContextMenu}>
            <PanelHero />
            <div className="space-y-6">
                {turns.map((turn, index) => {
                    const isLastTurn = index === turns.length - 1;
                    const turnOutput = getLatestRawToolOutput(turn.assistantMessages);
                    const fallbackOutput =
                        !turn.isStreaming && (turnOutput || (isLastTurn ? runtimeLastToolStdout : ""));
                    return (
                        <TaskTurnCard
                            key={turn.id}
                            turn={turn}
                            fallbackOutput={fallbackOutput}
                            isLatestTurn={isLastTurn}
                        />
                    );
                })}
            </div>
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
