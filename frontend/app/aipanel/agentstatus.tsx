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
    const lastToolUse = [...(lastAssistantMessage?.parts ?? [])]
        .reverse()
        .find((part) => part.type === "data-tooluse");
    const toolPhase =
        lastToolUse?.type === "data-tooluse" ? getToolUsePhase(lastToolUse.data?.toolname as string | undefined) : null;
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
