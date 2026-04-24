// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { shouldHideProgressStatusLines } from "./aitooluse";
import {
    AgentRuntimeSnapshot,
    AgentRuntimeState,
    WaveUIMessage,
    isInternalAssistantToolName,
    isTextPart,
} from "./aitypes";
import { getFirstExecutableCommandFromMessage } from "./autoexecute-util";
import { AgentMode } from "./waveai-model";

export type AgentRuntimeStatusSnapshot = AgentRuntimeSnapshot;

type AgentRuntimeStatusInput = {
    provider: string;
    mode: AgentMode;
    chatStatus: string;
    messages: WaveUIMessage[];
    errorMessage?: string | null;
};

type AgentPhaseMapping = Pick<AgentRuntimeStatusSnapshot, "state" | "phaseLabel" | "blockedReason">;

function formatProviderLabel(provider: string): string {
    return provider || "Wave AI";
}

export function formatModeLabel(mode: AgentMode): string {
    switch (mode) {
        case "planning":
            return "Planning";
        case "auto-approve":
            return "Auto-Approve";
        default:
            return "Default";
    }
}

export function isThinkingPhaseLabel(phaseLabel?: string): boolean {
    return typeof phaseLabel === "string" && phaseLabel.trim().toLowerCase() === "thinking";
}

function getToolUsePhase(
    toolName: string | undefined,
    toolStatus?: string
): Pick<AgentRuntimeStatusSnapshot, "state" | "phaseLabel"> | null {
    switch (toolName) {
        case "wave_run_command":
            return { state: "executing", phaseLabel: "Executing Command" };
        default:
            return null;
    }
}

function getToolProgressPhase(toolName: string | undefined, statusLine: string | undefined): AgentPhaseMapping | null {
    switch (toolName) {
        case "wave_run_command":
            return { state: "executing", phaseLabel: "Executing Command", blockedReason: statusLine };
        default:
            return null;
    }
}

function getStateTone(state: AgentRuntimeState): string {
    switch (state) {
        case "failed_retryable":
        case "failed_fatal":
        case "unavailable":
        case "cancelled":
            return "bg-red-950/70 text-red-300";
        case "awaiting_approval":
        case "interacting":
        case "retrying":
            return "bg-yellow-950/70 text-yellow-300";
        default:
            return "bg-emerald-950/70 text-emerald-300";
    }
}

function isObservedTerminalToolName(toolName: unknown): boolean {
    if (typeof toolName !== "string" || toolName.trim() === "") {
        return false;
    }
    return toolName === "wave_run_command";
}

function messageTextIncludesCapabilityDenial(message: WaveUIMessage | undefined): boolean {
    if (!message?.parts?.length) {
        return false;
    }
    const combinedText = message.parts
        .filter(isTextPart)
        .map((part) => part.text)
        .join("\n")
        .toLowerCase();
    if (!combinedText) {
        return false;
    }
    const denialPhrases = [
        "i can't access the terminal",
        "i cannot access the terminal",
        "i can't read the terminal",
        "i cannot read the terminal",
        "i don't have access to the terminal",
        "host policy blocked",
        "blocked by host policy",
        "refused to execute",
        "unable to execute",
        "无法实际读取",
        "不能真实读取",
        "无法访问终端",
        "不能访问终端",
        "宿主策略直接拦了",
        "宿主策略拦截",
        "被宿主策略拦了",
        "被拒绝执行",
        "拒绝执行",
        "运行在沙箱中",
        "命令执行超时",
        "请求超时无法完成",
    ];
    return denialPhrases.some((phrase) => combinedText.includes(phrase));
}

export function deriveAgentRuntimeStatus(input: AgentRuntimeStatusInput): AgentRuntimeStatusSnapshot {
    const assistantMessages = input.messages.filter((message) => message.role === "assistant");
    if (!assistantMessages.length && !input.errorMessage) {
        return {
            visible: false,
            providerLabel: "Wave AI",
            modeLabel: formatModeLabel(input.mode),
            state: "idle",
            phaseLabel: "Idle",
        };
    }

    const lastAssistantMessage = assistantMessages.at(-1);
    const lastCommand =
        [...assistantMessages].reverse().map(getFirstExecutableCommandFromMessage).find(Boolean) ?? undefined;
    const hasPendingApproval =
        lastAssistantMessage?.parts?.some(
            (part) => part.type === "data-tooluse" && part.data?.approval === "needs-approval"
        ) ?? false;
    const hasObservedTerminalToolCall =
        assistantMessages.some((message) =>
            message.parts?.some(
                (part) =>
                    (part.type === "data-tooluse" || part.type === "data-toolprogress") &&
                    !isInternalAssistantToolName(part.data?.toolname) &&
                    isObservedTerminalToolName(part.data?.toolname)
            )
        ) ?? false;
    const lastToolUse = [...(lastAssistantMessage?.parts ?? [])]
        .reverse()
        .find((part) => part.type === "data-tooluse" && !isInternalAssistantToolName(part.data?.toolname));
    const lastToolProgress = [...(lastAssistantMessage?.parts ?? [])]
        .reverse()
        .find((part) => part.type === "data-toolprogress" && !isInternalAssistantToolName(part.data?.toolname));
    const toolPhase =
        lastToolUse?.type === "data-tooluse"
            ? getToolUsePhase(
                  lastToolUse.data?.toolname as string | undefined,
                  lastToolUse.data?.status as string | undefined
              )
            : null;
    const progressStatusLine =
        lastToolProgress?.type === "data-toolprogress" &&
        Array.isArray(lastToolProgress.data?.statuslines) &&
        !shouldHideProgressStatusLines(lastToolProgress.data?.toolname as string | undefined) &&
        lastToolProgress.data.statuslines.length > 0
            ? (lastToolProgress.data.statuslines.find((line: unknown) => typeof line === "string" && line.trim()) as
                  | string
                  | undefined)
            : undefined;
    const progressPhase =
        lastToolProgress?.type === "data-toolprogress"
            ? getToolProgressPhase(lastToolProgress.data?.toolname as string | undefined, progressStatusLine)
            : null;
    const hasAssistantText =
        lastAssistantMessage?.parts?.some((part) => part.type === "text" && Boolean(part.text?.trim())) ?? false;

    if (input.errorMessage) {
        return {
            visible: true,
            providerLabel: formatProviderLabel(input.provider),
            modeLabel: formatModeLabel(input.mode),
            state: "failed_retryable",
            phaseLabel: "Error",
            lastCommand,
            blockedReason: input.errorMessage,
        };
    }

    if (messageTextIncludesCapabilityDenial(lastAssistantMessage) && !hasObservedTerminalToolCall) {
        return {
            visible: true,
            providerLabel: formatProviderLabel(input.provider),
            modeLabel: formatModeLabel(input.mode),
            state: "failed_fatal",
            phaseLabel: "Capability Mismatch",
            lastCommand,
            blockedReason:
                "No terminal tool call was observed. The assistant replied as if terminal tools were unavailable.",
        };
    }

    if (input.chatStatus === "streaming") {
        if (hasPendingApproval) {
            return {
                visible: true,
                providerLabel: formatProviderLabel(input.provider),
                modeLabel: formatModeLabel(input.mode),
                state: "awaiting_approval",
                phaseLabel: "Waiting Approval",
                lastCommand,
                blockedReason: "Waiting for tool approval",
            };
        }
        if (progressPhase != null) {
            return {
                visible: true,
                providerLabel: formatProviderLabel(input.provider),
                modeLabel: formatModeLabel(input.mode),
                state: progressPhase.state,
                phaseLabel: progressPhase.phaseLabel,
                lastCommand,
                blockedReason: progressPhase.blockedReason,
            };
        }
        if (lastToolUse?.type === "data-tooluse" && lastToolUse.data?.status === "running" && toolPhase != null) {
            return {
                visible: true,
                providerLabel: formatProviderLabel(input.provider),
                modeLabel: formatModeLabel(input.mode),
                state: toolPhase.state,
                phaseLabel: toolPhase.phaseLabel,
                lastCommand,
                activeTool: lastToolUse.data?.toolname as string | undefined,
                activeJobId: lastToolUse.data?.jobid as string | undefined,
                blockedReason: lastToolUse.data?.errormessage || lastToolUse.data?.tooldesc,
            };
        }
        return {
            visible: true,
            providerLabel: formatProviderLabel(input.provider),
            modeLabel: formatModeLabel(input.mode),
            state: "planning",
            phaseLabel: hasAssistantText ? "Responding" : "Thinking",
            lastCommand,
        };
    }

    return {
        visible: true,
        providerLabel: formatProviderLabel(input.provider),
        modeLabel: formatModeLabel(input.mode),
        state: lastAssistantMessage ? "completed" : "idle",
        phaseLabel: lastAssistantMessage ? "Completed" : "Idle",
        lastCommand,
    };
}

export function AgentStatus({ snapshot }: { snapshot: AgentRuntimeStatusSnapshot }) {
    if (!snapshot.visible) {
        return null;
    }

    return (
        <div className="mx-2 mb-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-zinc-800 px-2 py-1 text-zinc-200">{snapshot.providerLabel}</span>
                <span className="rounded-full bg-zinc-800 px-2 py-1 text-zinc-200">{snapshot.modeLabel}</span>
                <span
                    className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-1",
                        getStateTone(snapshot.state)
                    )}
                >
                    {isThinkingPhaseLabel(snapshot.phaseLabel) && (
                        <i className="fa-solid fa-spinner fa-spin text-[10px]" />
                    )}
                    {snapshot.phaseLabel}
                </span>
            </div>
            {(snapshot.activeTool || snapshot.lastCommand || snapshot.blockedReason) && (
                <div className="mt-2 space-y-1 text-xs text-zinc-400">
                    {snapshot.activeTool && (
                        <div className="truncate" title={snapshot.activeTool}>
                            Tool: <code>{snapshot.activeTool}</code>
                        </div>
                    )}
                    {snapshot.lastCommand && (
                        <div className="truncate" title={snapshot.lastCommand}>
                            Last command: <code>{snapshot.lastCommand}</code>
                        </div>
                    )}
                    {snapshot.blockedReason && (
                        <div className="truncate" title={snapshot.blockedReason}>
                            Reason: {snapshot.blockedReason}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
