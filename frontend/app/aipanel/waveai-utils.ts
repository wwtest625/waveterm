// Copyright 2025, Command Platform Inc.
// SPDX-License-Identifier: Apache-2.0

import type {
    AgentRuntimeSnapshot,
    ChatBackgroundJobDetail,
    WaveChatSessionMeta,
} from "@/app/aipanel/aitypes";
import type { DroppedFile } from "./waveai-model";

export function sortSessions(sessions: WaveChatSessionMeta[]): WaveChatSessionMeta[] {
    return [...sessions].sort((left, right) => {
        if (Boolean(left.favorite) !== Boolean(right.favorite)) {
            return left.favorite ? -1 : 1;
        }
        const leftUpdated = left.updatedts ?? 0;
        const rightUpdated = right.updatedts ?? 0;
        if (leftUpdated !== rightUpdated) {
            return rightUpdated - leftUpdated;
        }
        const leftCreated = left.createdts ?? 0;
        const rightCreated = right.createdts ?? 0;
        if (leftCreated !== rightCreated) {
            return rightCreated - leftCreated;
        }
        return (left.title ?? "").localeCompare(right.title ?? "");
    });
}

export function sortBackgroundJobs(jobs: ChatBackgroundJobDetail[]): ChatBackgroundJobDetail[] {
    return [...jobs].sort((left, right) => {
        const leftCreated = left.createdts ?? 0;
        const rightCreated = right.createdts ?? 0;
        if (leftCreated !== rightCreated) {
            return rightCreated - leftCreated;
        }
        return (right.jobid ?? "").localeCompare(left.jobid ?? "");
    });
}

export function summarizeSessionText(text: string, limit: number): string {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (normalized.length <= limit) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

export function isReusableNewChatSession(session: WaveChatSessionMeta | null | undefined): boolean {
    if (!session) {
        return false;
    }
    if (session.isempty === true) {
        return true;
    }
    return (session.title ?? "") === "New Chat" && !(session.summary ?? "").trim();
}

export function shouldThrottleExecutingRuntimeUpdate(
    current: AgentRuntimeSnapshot,
    next: AgentRuntimeSnapshot,
    lastExecutingRuntimeUpdateAt: number,
    throttleMs: number
): boolean {
    if (current.state !== "executing" || next.state !== "executing") {
        return false;
    }
    if (Date.now() - lastExecutingRuntimeUpdateAt >= throttleMs) {
        return false;
    }
    if (
        current.activeJobId !== next.activeJobId ||
        current.activeTool !== next.activeTool ||
        current.blockedReason !== next.blockedReason ||
        (() => { const a = current.activeJobIds ?? [], b = next.activeJobIds ?? []; return a.length !== b.length || a.some((v, i) => v !== b[i]); })()
    ) {
        return false;
    }
    const currentResult = current.lastToolResult;
    const nextResult = next.lastToolResult;
    if (!currentResult || !nextResult) {
        return false;
    }
    return (
        currentResult.requestId === nextResult.requestId &&
        currentResult.taskId === nextResult.taskId &&
        currentResult.toolName === nextResult.toolName &&
        currentResult.jobId === nextResult.jobId &&
        currentResult.ok === nextResult.ok &&
        currentResult.exitCode === nextResult.exitCode &&
        currentResult.stdout === nextResult.stdout &&
        currentResult.stderr === nextResult.stderr &&
        currentResult.errorCode === nextResult.errorCode &&
        currentResult.artifacts?.diffPath === nextResult.artifacts?.diffPath &&
        currentResult.artifacts?.logPath === nextResult.artifacts?.logPath
    );
}

export function buildRetryMeta(retryCount: number, lastErrorCode?: string) {
    return {
        retryCount,
        maxRetries: 2,
        nextBackoffMs: Math.min(1000 * 2 ** retryCount, 4000),
        lastErrorCode,
    };
}

export function shouldRunInteractively(command: string): boolean {
    const normalized = command.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    const interactivePrefixes = [
        "ssh", "sudo", "su",
        "mysql", "psql", "sqlite3", "redis-cli", "mongosh",
        "python", "python3", "node", "irb", "scala", "clojure",
        "bash", "zsh", "fish", "sh",
        "less", "more", "top", "htop", "btop",
        "vim", "nano", "emacs", "vi",
        "docker", "kubectl", "aws", "gcloud", "az",
        "screen", "tmux",
    ];
    return interactivePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
}

export function buildInteractivePromptHint(command: string): string {
    if (!shouldRunInteractively(command)) {
        return "";
    }
    return "Command is waiting for terminal input";
}

export function hasSubmittableContent(input: string, droppedFiles: DroppedFile[]): boolean {
    return input.trim().length > 0 || droppedFiles.length > 0;
}
