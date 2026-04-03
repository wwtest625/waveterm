// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ChatRequestOptions, FileUIPart, UIMessage, UIMessagePart } from "ai";

type WaveUIDataTypes = {
    // pkg/aiusechat/uctypes/uctypes.go UIMessageDataUserFile
    userfile: {
        filename: string;
        size: number;
        mimetype: string;
        previewurl?: string;
    };
    // pkg/aiusechat/uctypes/uctypes.go UIMessageDataToolUse
    tooluse: {
        toolcallid: string;
        toolname: string;
        tooldesc: string;
        status: "pending" | "error" | "completed";
        runts?: number;
        errormessage?: string;
        outputtext?: string;
        approval?: "needs-approval" | "user-approved" | "user-denied" | "auto-approved" | "timeout";
        tabid?: string;
        blockid?: string;
        writebackupfilename?: string;
        inputfilename?: string;
    };

    toolprogress: {
        toolcallid: string;
        toolname: string;
        statuslines: string[];
    };
};

export type WaveUIMessage = UIMessage<unknown, WaveUIDataTypes, any>;
export type WaveUIMessagePart = UIMessagePart<WaveUIDataTypes, any>;

export type UseChatSetMessagesType = (
    messages: WaveUIMessage[] | ((messages: WaveUIMessage[]) => WaveUIMessage[])
) => void;

export type UseChatSendMessageType = (
    message?:
        | (Omit<WaveUIMessage, "id" | "role"> & {
              id?: string;
              role?: "system" | "user" | "assistant";
          } & {
              text?: never;
              files?: never;
              messageId?: string;
          })
        | {
              text: string;
              files?: FileList | FileUIPart[];
              metadata?: unknown;
              parts?: never;
              messageId?: string;
          }
        | {
              files: FileList | FileUIPart[];
              metadata?: unknown;
              parts?: never;
              messageId?: string;
          },
    options?: ChatRequestOptions
) => Promise<void>;

export type ToolCapability = "read" | "write" | "edit" | "bash";

export type ToolHostScope = {
    type: "local" | "remote";
    hostId?: string;
};

export type RetryMeta = {
    retryCount: number;
    maxRetries: number;
    nextBackoffMs: number;
    lastErrorCode?: string;
};

export type ToolCallEnvelope = {
    requestId: string;
    taskId: string;
    toolName: string;
    jobId?: string;
    capability: ToolCapability;
    args: Record<string, any>;
    hostScope: ToolHostScope;
    requiresApproval: boolean;
    safetyClass?: "readonly" | "mutating" | "destructive";
    retry?: RetryMeta;
};

export type ToolResultEnvelope = {
    requestId: string;
    taskId: string;
    toolName: string;
    jobId?: string;
    ok: boolean;
    exitCode: number;
    stdout?: string;
    stderr?: string;
    durationMs: number;
    errorCode?: string;
    artifacts?: {
        diffPath?: string | null;
        logPath?: string | null;
    };
    retry?: RetryMeta;
};

export type AgentRuntimeState =
    | "idle"
    | "submitting"
    | "planning"
    | "awaiting_approval"
    | "executing"
    | "verifying"
    | "retrying"
    | "success"
    | "failed_retryable"
    | "failed_fatal"
    | "cancelled"
    | "unavailable";

export type AgentRuntimeSnapshot = {
    visible: boolean;
    state: AgentRuntimeState;
    providerLabel: string;
    modeLabel: string;
    phaseLabel: string;
    lastCommand?: string;
    blockedReason?: string;
    activeTool?: string;
    activeJobId?: string;
    lastToolCall?: ToolCallEnvelope;
    lastToolResult?: ToolResultEnvelope;
    retry?: RetryMeta;
};

export type AgentRuntimeSnapshotPatch = Partial<AgentRuntimeSnapshot>;

export type AgentRuntimeEvent =
    | { type: "USER_SUBMIT" }
    | { type: "TOOL_CALL_STARTED"; tool: ToolCallEnvelope }
    | { type: "TOOL_CALL_FINISHED"; result: ToolResultEnvelope }
    | { type: "TOOL_CALL_FAILED"; result: ToolResultEnvelope; retryable?: boolean }
    | { type: "APPROVAL_REQUIRED"; reason?: string }
    | { type: "APPROVAL_TIMEOUT"; reason?: string }
    | { type: "APPROVAL_RESOLVED"; approved: boolean; reason?: string }
    | { type: "VERIFY_STARTED"; phaseLabel?: string }
    | { type: "VERIFY_FINISHED"; ok: boolean; reason?: string }
    | { type: "RETRY_REQUESTED"; retry: RetryMeta; reason?: string }
    | { type: "CANCEL_GENERATION" }
    | { type: "CANCEL_EXECUTION"; reason?: string }
    | { type: "HEALTH_UNAVAILABLE"; reason: string }
    | { type: "RESET" };

export function getDefaultAgentRuntimeSnapshot(): AgentRuntimeSnapshot {
    return {
        visible: false,
        state: "idle",
        providerLabel: "Wave AI",
        modeLabel: "Default",
        phaseLabel: "Idle",
    };
}

export function mergeAgentRuntimeSnapshot(
    current: AgentRuntimeSnapshot,
    patch: AgentRuntimeSnapshotPatch
): AgentRuntimeSnapshot {
    return {
        ...current,
        ...patch,
    };
}

function toolCallEnvelopeEquals(left?: ToolCallEnvelope, right?: ToolCallEnvelope): boolean {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return left == null && right == null;
    }
    return (
        left.requestId === right.requestId &&
        left.taskId === right.taskId &&
        left.toolName === right.toolName &&
        left.jobId === right.jobId &&
        left.capability === right.capability &&
        left.requiresApproval === right.requiresApproval &&
        left.safetyClass === right.safetyClass &&
        left.hostScope.type === right.hostScope.type &&
        left.hostScope.hostId === right.hostScope.hostId &&
        JSON.stringify(left.args) === JSON.stringify(right.args) &&
        retryMetaEquals(left.retry, right.retry)
    );
}

function toolResultEnvelopeEquals(left?: ToolResultEnvelope, right?: ToolResultEnvelope): boolean {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return left == null && right == null;
    }
    return (
        left.requestId === right.requestId &&
        left.taskId === right.taskId &&
        left.toolName === right.toolName &&
        left.jobId === right.jobId &&
        left.ok === right.ok &&
        left.exitCode === right.exitCode &&
        left.stdout === right.stdout &&
        left.stderr === right.stderr &&
        left.durationMs === right.durationMs &&
        left.errorCode === right.errorCode &&
        left.artifacts?.diffPath === right.artifacts?.diffPath &&
        left.artifacts?.logPath === right.artifacts?.logPath &&
        retryMetaEquals(left.retry, right.retry)
    );
}

function retryMetaEquals(left?: RetryMeta, right?: RetryMeta): boolean {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return left == null && right == null;
    }
    return (
        left.retryCount === right.retryCount &&
        left.maxRetries === right.maxRetries &&
        left.nextBackoffMs === right.nextBackoffMs &&
        left.lastErrorCode === right.lastErrorCode
    );
}

export function agentRuntimeSnapshotEquals(left: AgentRuntimeSnapshot, right: AgentRuntimeSnapshot): boolean {
    return (
        left.visible === right.visible &&
        left.state === right.state &&
        left.providerLabel === right.providerLabel &&
        left.modeLabel === right.modeLabel &&
        left.phaseLabel === right.phaseLabel &&
        left.lastCommand === right.lastCommand &&
        left.blockedReason === right.blockedReason &&
        left.activeTool === right.activeTool &&
        left.activeJobId === right.activeJobId &&
        toolCallEnvelopeEquals(left.lastToolCall, right.lastToolCall) &&
        toolResultEnvelopeEquals(left.lastToolResult, right.lastToolResult) &&
        retryMetaEquals(left.retry, right.retry)
    );
}

export function inferToolCapability(toolName?: string): ToolCapability {
    switch (toolName) {
        case "read_text_file":
        case "read_dir":
        case "term_get_scrollback":
        case "term_command_output":
        case "wave_get_command_result":
            return "read";
        case "write_text_file":
        case "delete_text_file":
            return "write";
        case "edit_text_file":
        case "codex_file_change":
            return "edit";
        default:
            return "bash";
    }
}

export function inferToolHostScope(part: WaveUIMessagePart): ToolHostScope {
    const blockId = part.type === "data-tooluse" ? part.data?.blockid : undefined;
    if (blockId) {
        return { type: "local", hostId: blockId };
    }
    return { type: "local", hostId: "waveai" };
}

export function getLatestToolUsePart(message?: WaveUIMessage): (WaveUIMessagePart & { type: "data-tooluse" }) | null {
    const part = [...(message?.parts ?? [])].reverse().find((candidate) => candidate.type === "data-tooluse");
    return part?.type === "data-tooluse" ? part : null;
}

export function getLatestToolProgressPart(
    message?: WaveUIMessage
): (WaveUIMessagePart & { type: "data-toolprogress" }) | null {
    const part = [...(message?.parts ?? [])].reverse().find((candidate) => candidate.type === "data-toolprogress");
    return part?.type === "data-toolprogress" ? part : null;
}

export function toolCallFromPart(part: WaveUIMessagePart & { type: "data-tooluse" }, taskId: string): ToolCallEnvelope {
    return {
        requestId: part.data.toolcallid,
        taskId,
        toolName: part.data.toolname,
        capability: inferToolCapability(part.data.toolname),
        args: {
            description: part.data.tooldesc,
            inputFile: part.data.inputfilename,
        },
        hostScope: inferToolHostScope(part),
        requiresApproval: part.data.approval === "needs-approval",
    };
}

export function toolResultFromPart(
    part: WaveUIMessagePart & { type: "data-tooluse" },
    taskId: string
): ToolResultEnvelope | null {
    if (part.data.status === "pending") {
        return null;
    }
    return {
        requestId: part.data.toolcallid,
        taskId,
        toolName: part.data.toolname,
        ok: part.data.status === "completed",
        exitCode: part.data.status === "completed" ? 0 : 1,
        stdout: part.data.outputtext,
        stderr: part.data.errormessage,
        durationMs: 0,
        artifacts:
            part.data.inputfilename || part.data.writebackupfilename
                ? {
                      diffPath: part.data.inputfilename ?? null,
                      logPath: part.data.writebackupfilename ?? null,
                  }
                : undefined,
    };
}

export function reduceAgentRuntimeSnapshot(
    current: AgentRuntimeSnapshot,
    event: AgentRuntimeEvent
): AgentRuntimeSnapshot {
    switch (event.type) {
        case "USER_SUBMIT":
            return {
                ...current,
                visible: true,
                state: "submitting",
                phaseLabel: "Submitting",
                blockedReason: undefined,
            };
        case "TOOL_CALL_STARTED":
            return {
                ...current,
                visible: true,
                state: "executing",
                phaseLabel: "Executing",
                activeTool: event.tool.toolName,
                activeJobId: event.tool.jobId,
                lastToolCall: event.tool,
                blockedReason: undefined,
            };
        case "TOOL_CALL_FINISHED":
            return {
                ...current,
                visible: true,
                state: "verifying",
                phaseLabel: "Verifying",
                activeTool: undefined,
                activeJobId: undefined,
                lastToolResult: event.result,
                blockedReason: undefined,
            };
        case "TOOL_CALL_FAILED":
            return {
                ...current,
                visible: true,
                state: event.retryable ? "failed_retryable" : "failed_fatal",
                phaseLabel: event.retryable ? "Retry Available" : "Failed",
                activeTool: undefined,
                activeJobId: undefined,
                lastToolResult: event.result,
                blockedReason: event.result.stderr || event.result.errorCode,
            };
        case "APPROVAL_REQUIRED":
            return {
                ...current,
                visible: true,
                state: "awaiting_approval",
                phaseLabel: "Waiting Approval",
                blockedReason: event.reason ?? "Waiting for tool approval",
            };
        case "APPROVAL_TIMEOUT":
            return {
                ...current,
                visible: true,
                state: "failed_retryable",
                phaseLabel: "Approval Timed Out",
                blockedReason: event.reason ?? "Tool approval timed out",
            };
        case "APPROVAL_RESOLVED":
            return {
                ...current,
                visible: true,
                state: event.approved ? "planning" : "cancelled",
                phaseLabel: event.approved ? "Planning" : "Cancelled",
                blockedReason: event.reason,
            };
        case "VERIFY_STARTED":
            return {
                ...current,
                visible: true,
                state: "verifying",
                phaseLabel: event.phaseLabel ?? "Verifying",
                blockedReason: undefined,
            };
        case "VERIFY_FINISHED":
            return {
                ...current,
                visible: true,
                state: event.ok ? "success" : "failed_retryable",
                phaseLabel: event.ok ? "Ready" : "Retry Available",
                blockedReason: event.reason,
            };
        case "RETRY_REQUESTED":
            return {
                ...current,
                visible: true,
                state: "retrying",
                phaseLabel: "Retrying",
                retry: event.retry,
                blockedReason: event.reason,
            };
        case "CANCEL_GENERATION":
            return {
                ...current,
                visible: true,
                blockedReason: "Generation stopped",
            };
        case "CANCEL_EXECUTION":
            return {
                ...current,
                visible: true,
                state: "cancelled",
                phaseLabel: "Cancelled",
                activeTool: undefined,
                activeJobId: undefined,
                blockedReason: event.reason ?? "Execution stopped",
            };
        case "HEALTH_UNAVAILABLE":
            return {
                ...current,
                visible: true,
                state: "unavailable",
                phaseLabel: "Unavailable",
                blockedReason: event.reason,
            };
        case "RESET":
            return getDefaultAgentRuntimeSnapshot();
        default:
            return current;
    }
}
