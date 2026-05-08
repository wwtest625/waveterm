// Copyright 2025, Command Platform Inc.
// SPDX-License-Identifier: Apache-2.0

import { startTransition, useEffect, useRef, useState } from "react";
import {
    type AgentRuntimeState,
    type AgentTaskState,
    type AIBlockOutputStatus,
    coalesceToolDetailParts,
    deriveAIBlockOutputStatus,
    type WaveUIMessage,
    type WaveUIMessagePart,
    getLatestTaskStatePart,
    isAIBlockActive,
    isInternalAssistantToolName,
    isTextPart,
    isToolDetailPart,
} from "./aitypes";
import { type TaskTurn } from "./ai-message-types";
import { buildTaskChainSteps, shouldShowTurnTaskChain } from "./ai-taskchain";

export type { TaskTurn };

export function shouldFollowLatestOutput(
    status: string,
    runtimeState: AgentRuntimeState,
    activeJobId?: string | null
): boolean {
    return status === "streaming" || runtimeState === "executing" || Boolean(activeJobId);
}

function getToolParts(
    messages: WaveUIMessage[]
): Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }> {
    return coalesceToolDetailParts(messages.flatMap((message) => (message.parts ?? []).filter(isToolDetailPart)));
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

function isSyntheticProcessExitMessage(text?: string): boolean {
    const normalized = text?.trim();
    if (!normalized) {
        return false;
    }
    return /^process exited with status \d+$/i.test(normalized);
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

function hasTurnError(messages: WaveUIMessage[]): boolean {
    return messages.some((message) =>
        (message.parts ?? []).some(
            (part) =>
                part.type === "data-tooluse" &&
                (part.data.status === "error" || part.data.approval === "user-denied" || part.data.approval === "timeout")
        )
    );
}

function hasTurnCancellation(messages: WaveUIMessage[]): boolean {
    return messages.some((message) =>
        (message.parts ?? []).some(
            (part) => part.type === "data-tooluse" && part.data.status === "cancelled"
        )
    );
}

function getTurnCancellationReason(messages: WaveUIMessage[]): string | undefined {
    for (const message of [...messages].reverse()) {
        for (const part of [...(message.parts ?? [])].reverse()) {
            if (part.type === "data-tooluse" && part.data.status === "cancelled" && part.data.cancellationreason) {
                return part.data.cancellationreason;
            }
        }
    }
    return undefined;
}

function getTurnErrorMessage(messages: WaveUIMessage[]): string | undefined {
    for (const message of [...messages].reverse()) {
        for (const part of [...(message.parts ?? [])].reverse()) {
            if (part.type === "data-tooluse" && part.data.status === "error" && part.data.errormessage) {
                return part.data.errormessage;
            }
        }
    }
    return undefined;
}

function hasTurnAnyOutput(messages: WaveUIMessage[]): boolean {
    return messages.some((message) =>
        (message.parts ?? []).some(
            (part) =>
                (isTextPart(part) && Boolean(part.text?.trim())) ||
                (part.type === "data-tooluse" && Boolean(part.data.outputtext?.trim()))
        )
    );
}

function deriveTurnBlockOutputStatus(turn: TaskTurn): AIBlockOutputStatus {
    return deriveAIBlockOutputStatus({
        isStreaming: turn.isStreaming,
        hasAnyOutput: hasTurnAnyOutput(turn.assistantMessages),
        hasError: hasTurnError(turn.assistantMessages),
        errorMessage: getTurnErrorMessage(turn.assistantMessages),
        isCancelled: hasTurnCancellation(turn.assistantMessages),
        cancellationReason: getTurnCancellationReason(turn.assistantMessages),
    });
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
                blockOutputStatus: { status: "pending" },
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
                blockOutputStatus: { status: "pending" },
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

    for (const turn of turns) {
        turn.blockOutputStatus = deriveTurnBlockOutputStatus(turn);
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

export function useBufferedTaskTurns(messages: WaveUIMessage[], status: string): TaskTurn[] {
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

export function getTurnTaskPlan(turn: TaskTurn): AgentTaskState | null {
    for (const message of [...turn.assistantMessages].reverse()) {
        const latestTaskState = getLatestTaskStatePart(message);
        const taskState = latestTaskState?.data as AgentTaskState | undefined;
        if (taskState?.source === "model-generated") {
            return taskState;
        }
    }
    return null;
}

export function resolveTurnFallbackOutput(turn: TaskTurn, isLastTurn: boolean, runtimeLastToolStdout: string): string {
    if (isAIBlockActive(turn.blockOutputStatus)) {
        return "";
    }
    if (shouldShowTurnTaskChain(turn)) {
        return "";
    }
    const turnOutput = getLatestRawToolOutput(turn.assistantMessages);
    if (turnOutput) {
        return turnOutput;
    }
    if (!isLastTurn || turn.assistantMessages.length === 0) {
        return "";
    }
    return isSyntheticProcessExitMessage(runtimeLastToolStdout) ? "" : runtimeLastToolStdout;
}
