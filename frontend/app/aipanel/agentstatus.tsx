// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { getFirstExecutableCommandFromMessage } from "./autoexecute-util";
import { WaveUIMessage } from "./aitypes";
import { AgentMode, LocalAgentHealth } from "./waveai-model";

export type AgentRuntimePhase =
    | "idle"
    | "thinking"
    | "reading-terminal"
    | "executing-command"
    | "waiting-terminal"
    | "responding"
    | "waiting-approval"
    | "ready"
    | "error"
    | "unavailable";

export type AgentRuntimeStatusSnapshot = {
    visible: boolean;
    providerLabel: string;
    modeLabel: string;
    phase: AgentRuntimePhase;
    phaseLabel: string;
    lastCommand?: string;
    blockedReason?: string;
};

type AgentRuntimeStatusInput = {
    isLocalAgent: boolean;
    provider: string;
    mode: AgentMode;
    chatStatus: string;
    messages: WaveUIMessage[];
    errorMessage?: string | null;
    localAgentHealth?: LocalAgentHealth | null;
};

type AgentPhaseMapping = Pick<AgentRuntimeStatusSnapshot, "phase" | "phaseLabel" | "blockedReason">;

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

function getToolUsePhase(toolName: string | undefined): Pick<AgentRuntimeStatusSnapshot, "phase" | "phaseLabel"> | null {
    switch (toolName) {
        case "wave_read_current_terminal_context":
        case "wave_read_terminal_scrollback":
        case "wave_get_terminal_command_result":
        case "term_get_scrollback":
        case "term_command_output":
            return { phase: "reading-terminal", phaseLabel: "Reading Terminal" };
        case "wave_inject_terminal_command":
            return { phase: "executing-command", phaseLabel: "Executing Command" };
        case "wave_wait_terminal_idle":
            return { phase: "waiting-terminal", phaseLabel: "Waiting for Command" };
        default:
            return null;
    }
}

function getToolProgressPhase(toolName: string | undefined, statusLine: string | undefined): AgentPhaseMapping | null {
    switch (toolName) {
        case "codex_wave_mcp_ready":
            return { phase: "ready", phaseLabel: "终端工具已连接" };
        case "codex_wave_terminal_context_ok":
            return { phase: "ready", phaseLabel: "终端上下文已就绪" };
        case "codex_wave_mcp_unavailable":
            return {
                phase: "error",
                phaseLabel: "终端工具不可用",
                blockedReason: statusLine || "Wave terminal MCP injection failed.",
            };
        default:
            return null;
    }
}

function isObservedTerminalToolName(toolName: unknown): boolean {
    if (typeof toolName !== "string" || toolName.trim() === "") {
        return false;
    }
    return (
        toolName.startsWith("wave_") ||
        toolName === "codex_wave_terminal_context_ok" ||
        toolName === "codex_wave_terminal_tool" ||
        toolName === "codex_wave_mcp_ready"
    );
}

function messageTextIncludesLocalAgentCapabilityDenial(message: WaveUIMessage | undefined): boolean {
    if (!message?.parts?.length) {
        return false;
    }
    const combinedText = message.parts
        .filter((part) => part.type === "text" && typeof part.text === "string")
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
        "no wave terminal mcp",
        "no available wave terminal mcp",
        "没有可用的 wave 终端 mcp",
        "无法实际读取",
        "不能真实读取",
        "无法访问终端",
        "不能访问终端",
        "宿主策略直接拦了",
        "被宿主策略拦了",
        "被主策略直接拦了",
        "被拒绝执行",
        "拒绝执行",
    ];
    return denialPhrases.some((phrase) => combinedText.includes(phrase));
}

export function deriveAgentRuntimeStatus(input: AgentRuntimeStatusInput): AgentRuntimeStatusSnapshot {
    if (!input.isLocalAgent) {
        return {
            visible: false,
            providerLabel: "Wave AI",
            modeLabel: formatModeLabel(input.mode),
            phase: "idle",
            phaseLabel: "Idle",
        };
    }

    const assistantMessages = input.messages.filter((message) => message.role === "assistant");
    const lastAssistantMessage = assistantMessages.at(-1);
    const lastCommand = [...assistantMessages].reverse().map(getFirstExecutableCommandFromMessage).find(Boolean) ?? undefined;
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
    const lastToolUse = [...(lastAssistantMessage?.parts ?? [])]
        .reverse()
        .find((part) => part.type === "data-tooluse");
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
            phase: "error",
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
            phase: "unavailable",
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
            phase: "error",
            phaseLabel: "Capability Mismatch",
            lastCommand,
            blockedReason: "No terminal tool call was observed. The local agent replied as if terminal tools were unavailable.",
        };
    }

    if (input.chatStatus === "streaming") {
        if (hasPendingApproval) {
            return {
                visible: true,
                providerLabel: formatProviderLabel(input.provider),
                modeLabel: formatModeLabel(input.mode),
                phase: "waiting-approval",
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
                phase: progressPhase.phase,
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
                phase: toolPhase.phase,
                phaseLabel: toolPhase.phaseLabel,
                lastCommand,
            };
        }
        return {
            visible: true,
            providerLabel: formatProviderLabel(input.provider),
            modeLabel: formatModeLabel(input.mode),
            phase: hasAssistantText ? "responding" : "thinking",
            phaseLabel: hasAssistantText ? "Responding" : "Thinking",
            lastCommand,
        };
    }

    if (progressPhase != null) {
        return {
            visible: true,
            providerLabel: formatProviderLabel(input.provider),
            modeLabel: formatModeLabel(input.mode),
            phase: progressPhase.phase,
            phaseLabel: progressPhase.phaseLabel,
            lastCommand,
            blockedReason: progressPhase.blockedReason,
        };
    }

    return {
        visible: true,
        providerLabel: formatProviderLabel(input.provider),
        modeLabel: formatModeLabel(input.mode),
        phase: lastAssistantMessage ? "ready" : "idle",
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
                <span
                    className={cn(
                        "rounded-full px-2 py-1",
                        snapshot.phase === "error" || snapshot.phase === "unavailable"
                            ? "bg-red-950/70 text-red-300"
                            : snapshot.phase === "waiting-approval"
                              ? "bg-yellow-950/70 text-yellow-300"
                              : "bg-emerald-950/70 text-emerald-300"
                    )}
                >
                    {snapshot.phaseLabel}
                </span>
            </div>
            {(snapshot.lastCommand || snapshot.blockedReason) && (
                <div className="mt-2 space-y-1 text-xs text-zinc-400">
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
