// Copyright 2025, Command Platform Inc.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { atoms } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import { formatModeLabel } from "./agentstatus";
import { AIModeDropdown } from "./aimode";
import {
    type AgentRuntimeSnapshot,
    isAIBlockActive,
    type WaveUIMessage,
} from "./aitypes";
import { AskUserCard } from "./askusercard";
import { t } from "./aipanel-i18n";
import { TaskProgressPanel } from "./taskprogresspanel";
import { WaveAIModel } from "./waveai-model";
import { AssistantOutputCard, UserPromptCard } from "./ai-assistant-output";
import { type TaskTurn, getTurnTaskPlan } from "./ai-taskturn-utils";
import {
    shouldFollowLatestOutput,
    useBufferedTaskTurns,
    resolveTurnFallbackOutput,
} from "./ai-taskturn-utils";
import {
    TaskChain,
    TaskChainApprovalActions,
    getPendingApprovalToolUses,
    shouldShowTurnTaskChain,
} from "./ai-taskchain";

export { formatCommandDuration } from "./command-duration";
export { splitReasoningFromText, normalizeAssistantText } from "./ai-message-types";
export { shouldFollowLatestOutput } from "./ai-taskturn-utils";
export { getThinkingDisplayState, shouldRenderStreamingPlainText } from "./ai-assistant-output";
export {
    formatExitCodeLabel,
    getRawOutputDisplayState,
    getTaskChainDetailLanguage,
    buildTaskChainSteps,
    getTaskChainDisplayGroups,
    buildTaskChainFlowEntries,
    getTaskChainDisplayState,
    shouldAnimateTaskStep,
    shouldRenderTaskChainBlockedReason,
    getPendingApprovalToolUses,
    shouldShowTurnTaskChain,
    cancellationReasonLabel,
    RAW_OUTPUT_COLLAPSE_LINES,
    TASK_CHAIN_OUTPUT_COLLAPSE_LINES,
} from "./ai-taskchain";
export {
    type TaskTurn,
    buildTaskTurns,
    useBufferedTaskTurns,
    getTurnExitCode,
    resolveTurnFallbackOutput,
    getTurnTaskPlan,
} from "./ai-taskturn-utils";
export type {
    TaskChainStepStatus,
    TaskChainStep,
    TaskChainDisplayGroup,
    TaskChainDisplayState,
    TaskChainFlowEntry,
    TaskChainStepEntry,
} from "./ai-taskchain";

interface AIPanelMessagesProps {
    messages: WaveUIMessage[];
    status: string;
    onContextMenu?: (e: React.MouseEvent) => void;
}

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

const TaskTurnCard = memo(
    ({ turn, fallbackOutput, isLatestTurn }: { turn: TaskTurn; fallbackOutput?: string; isLatestTurn: boolean }) => {
        const model = WaveAIModel.getInstance();
        const runtime = useAtomValue(model.agentRuntimeAtom);
        const taskPlan = getTurnTaskPlan(turn);

        if (!turn.userMessage && turn.assistantMessages.length === 0) {
            return null;
        }
        return (
            <div className="space-y-2" data-turnid={turn.id} ref={(el) => WaveAIModel.getInstance()?.registerScrollTarget(turn.id, el)}>
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
    const latestTurn = turns.at(-1);
    const latestTurnCanApprove = Boolean(latestTurn && (isAIBlockActive(latestTurn.blockOutputStatus) || runtimeState === "awaiting_approval"));
    const latestApprovalTurn =
        latestTurnCanApprove &&
        latestTurn != null &&
        getPendingApprovalToolUses(
            latestTurn.assistantMessages,
            isAIBlockActive(latestTurn.blockOutputStatus) || runtimeState === "awaiting_approval"
        ).length > 0
            ? latestTurn
            : null;

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
            <div className="space-y-4">
                {turns.map((turn, index) => {
                    const isLastTurn = index === turns.length - 1;
                    const fallbackOutput = resolveTurnFallbackOutput(turn, isLastTurn, runtimeLastToolStdout);
                    return (
                        <ErrorBoundary
                            key={turn.id}
                            fallback={
                                <div className="mx-3 my-2 rounded-xl border border-red-500/15 bg-red-500/[0.04] px-3 py-2 text-xs text-red-200/70">
                                    {t.aipanel.messageRenderError}
                                </div>
                            }
                        >
                            <TaskTurnCard
                                turn={turn}
                                fallbackOutput={fallbackOutput}
                                isLatestTurn={isLastTurn}
                            />
                        </ErrorBoundary>
                    );
                })}
                {latestApprovalTurn && <TaskChainApprovalActions turn={latestApprovalTurn} />}
                <AskUserCard />
            </div>
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
