// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { AgentRuntimeSnapshot, AgentRuntimeState, WaveUIMessage } from "./aitypes";
import { getFirstExecutableCommandFromMessage } from "./autoexecute-util";
import { AgentMode, LocalAgentHealth } from "./waveai-model";

export type AgentRuntimeStatusSnapshot = AgentRuntimeSnapshot;

type AgentRuntimeStatusInput = {
    isLocalAgent: boolean;
    provider: string;
    mode: AgentMode;
    chatStatus: string;
    messages: WaveUIMessage[];
    errorMessage?: string | null;
    localAgentHealth?: LocalAgentHealth | null;
};

type AgentPhaseMapping = Pick<AgentRuntimeStatusSnapshot, "state" | "phaseLabel" | "blockedReason">;

function formatProviderLabel(provider: string): string {
    return provider === "claude-code" ? "Claude Code" : "Codex";
}

function formatModeLabel(mode: AgentMode): string {
    switch (mode) {
        case "planning":
            return "Planning";
        case "auto-approve":
            return "Auto-Approve";
        default:
            return "Default";
    }
}

function getToolUsePhase(
    toolName: string | undefined
): Pick<AgentRuntimeStatusSnapshot, "state" | "phaseLabel"> | null {
    switch (toolName) {
        case "term_get_scrollback":
        case "term_command_output":
        case "wave_get_command_result":
            return { state: "planning", phaseLabel: "Reading Terminal" };
        case "codex_command_execution":
        case "codex_dynamic_tool":
        case "wave_run_command":
            return { state: "executing", phaseLabel: "Executing Command" };
        default:
            return null;
    }
}

function getToolProgressPhase(toolName: string | undefined, statusLine: string | undefined): AgentPhaseMapping | null {
    switch (toolName) {
        case "codex_wave_terminal_context_ok":
            return { state: "planning", phaseLabel: "Terminal Context Ready" };
        case "codex_thinking":
        case "codex_reasoning":
        case "codex_plan":
            return { state: "planning", phaseLabel: "Thinking" };
        case "codex_command_execution":
        case "wave_run_command":
            return { state: "executing", phaseLabel: "Executing Command", blockedReason: statusLine };
        case "codex_dynamic_tool":
            return { state: "executing", phaseLabel: "Running Tool", blockedReason: statusLine };
        case "codex_file_change":
            return { state: "executing", phaseLabel: "Applying Changes", blockedReason: statusLine };
        case "term_get_scrollback":
        case "term_command_output":
        case "wave_get_command_result":
            return { state: "planning", phaseLabel: "Reading Terminal", blockedReason: statusLine };
        case "codex_waiting_approval":
            return {
                state: "awaiting_approval",
                phaseLabel: "Waiting Approval",
                blockedReason: statusLine || "Waiting for tool approval",
            };
        case "codex_responding":
            return { state: "planning", phaseLabel: "Responding" };
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
    return (
        toolName === "codex_wave_terminal_context_ok" ||
        toolName === "codex_command_execution" ||
        toolName === "wave_run_command" ||
        toolName === "term_get_scrollback" ||
        toolName === "term_command_output" ||
        toolName === "wave_get_command_result"
    );
}

function isTextPart(
    part: WaveUIMessage["parts"][number]
): part is Extract<WaveUIMessage["parts"][number], { type: "text" }> {
    return part.type === "text" && typeof part.text === "string";
}

function messageTextIncludesLocalAgentCapabilityDenial(message: WaveUIMessage | undefined): boolean {
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
        "沙箱",
        "超时",
    ];
    return denialPhrases.some((phrase) => combinedText.includes(phrase));
}

export function deriveAgentRuntimeStatus(input: AgentRuntimeStatusInput): AgentRuntimeStatusSnapshot {
    if (!input.isLocalAgent) {
        return {
            visible: false,
            providerLabel: "Wave AI",
            modeLabel: formatModeLabel(input.mode),
            state: "idle",
            phaseLabel: "Idle",
        };
    }

    const assistantMessages = input.messages.filter((message) => message.role === "assistant");
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
                    isObservedTerminalToolName(part.data?.toolname)
            )
        ) ?? false;
    const lastToolUse = [...(lastAssistantMessage?.parts ?? [])].reverse().find((part) => part.type === "data-tooluse");
    const lastToolProgress = [...(lastAssistantMessage?.parts ?? [])]
        .reverse()
        .find((part) => part.type === "data-toolprogress");
    const toolPhase =
        lastToolUse?.type === "data-tooluse" ? getToolUsePhase(lastToolUse.data?.toolname as string | undefined) : null;
    const progressStatusLine =
        lastToolProgress?.type === "data-toolprogress" &&
        Array.isArray(lastToolProgress.data?.statuslines) &&
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

    if (input.localAgentHealth && !input.localAgentHealth.available) {
        return {
            visible: true,
            providerLabel: formatProviderLabel(input.provider),
            modeLabel: formatModeLabel(input.mode),
            state: "unavailable",
            phaseLabel: "Unavailable",
            lastCommand,
            blockedReason: input.localAgentHealth.message,
        };
    }

    if (
        messageTextIncludesLocalAgentCapabilityDenial(lastAssistantMessage) &&
        !hasObservedTerminalToolCall &&
        input.localAgentHealth?.available !== false
    ) {
        return {
            visible: true,
            providerLabel: formatProviderLabel(input.provider),
            modeLabel: formatModeLabel(input.mode),
            state: "failed_fatal",
            phaseLabel: "Capability Mismatch",
            lastCommand,
            blockedReason:
                "No terminal tool call was observed. The local agent replied as if terminal tools were unavailable.",
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
        if (toolPhase != null) {
            return {
                visible: true,
                providerLabel: formatProviderLabel(input.provider),
                modeLabel: formatModeLabel(input.mode),
                state: toolPhase.state,
                phaseLabel: toolPhase.phaseLabel,
                lastCommand,
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

    return {
        visible: true,
        providerLabel: formatProviderLabel(input.provider),
        modeLabel: formatModeLabel(input.mode),
        state: lastAssistantMessage ? "success" : "idle",
        phaseLabel: lastAssistantMessage ? "Ready" : "Idle",
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
                <span className={cn("rounded-full px-2 py-1", getStateTone(snapshot.state))}>
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
