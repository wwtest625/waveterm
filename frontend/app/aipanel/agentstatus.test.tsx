import { describe, expect, it } from "vitest";
import { deriveAgentRuntimeStatus } from "./agentstatus";
import {
    agentRuntimeSnapshotEquals,
    getDefaultAgentRuntimeSnapshot,
    reduceAgentRuntimeSnapshot,
    toolCallFromPart,
    toolResultFromPart,
    type ToolCallEnvelope,
} from "./aitypes";

describe("agent runtime status mapping", () => {
    it("maps codex terminal context progress into a visible ready status", () => {
        const snapshot = deriveAgentRuntimeStatus({
            isLocalAgent: true,
            provider: "codex",
            mode: "auto-approve",
            chatStatus: "streaming",
            messages: [
                {
                    id: "m-context",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-toolprogress",
                            data: {
                                toolcallid: "localagent:codex_wave_terminal_context_ok",
                                toolname: "codex_wave_terminal_context_ok",
                                statuslines: ["Connected terminal context (pure wsh mode)"],
                            },
                        },
                    ],
                } as any,
            ],
            errorMessage: null,
            localAgentHealth: { ok: true, provider: "codex", available: true, message: "ok" },
        });

        expect(snapshot.state).toBe("planning");
        expect(snapshot.phaseLabel).toBe("Terminal Context Ready");
    });

    it("maps codex command execution progress into executing phase", () => {
        const snapshot = deriveAgentRuntimeStatus({
            isLocalAgent: true,
            provider: "codex",
            mode: "default",
            chatStatus: "streaming",
            messages: [
                {
                    id: "m-exec",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-toolprogress",
                            data: {
                                toolcallid: "localagent:codex_command_execution",
                                toolname: "codex_command_execution",
                                statuslines: ["lscpu"],
                            },
                        },
                    ],
                } as any,
            ],
            errorMessage: null,
            localAgentHealth: { ok: true, provider: "codex", available: true, message: "ok" },
        });

        expect(snapshot.state).toBe("executing");
        expect(snapshot.phaseLabel).toBe("Executing Command");
        expect(snapshot.blockedReason).toBe("lscpu");
    });

    it("maps terminal read tool use into a reading phase", () => {
        const snapshot = deriveAgentRuntimeStatus({
            isLocalAgent: true,
            provider: "codex",
            mode: "default",
            chatStatus: "streaming",
            messages: [
                {
                    id: "m-read",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-read",
                                toolname: "term_command_output",
                                tooldesc: "reading terminal",
                                status: "pending",
                            },
                        },
                    ],
                } as any,
            ],
            errorMessage: null,
            localAgentHealth: { ok: true, provider: "codex", available: true, message: "ok" },
        });

        expect(snapshot.visible).toBe(true);
        expect(snapshot.state).toBe("planning");
        expect(snapshot.providerLabel).toBe("Codex");
        expect(snapshot.modeLabel).toBe("Default");
    });

    it("maps approval waits and extracts the last command", () => {
        const snapshot = deriveAgentRuntimeStatus({
            isLocalAgent: true,
            provider: "claude-code",
            mode: "auto-approve",
            chatStatus: "streaming",
            messages: [
                {
                    id: "m1",
                    role: "assistant",
                    parts: [
                        { type: "text", text: "```bash\nuname -a\n```" },
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-1",
                                toolname: "write_text_file",
                                tooldesc: "writing file",
                                status: "pending",
                                approval: "needs-approval",
                            },
                        },
                    ],
                } as any,
            ],
            errorMessage: null,
            localAgentHealth: { ok: true, provider: "claude-code", available: true, message: "ok" },
        });

        expect(snapshot.state).toBe("awaiting_approval");
        expect(snapshot.lastCommand).toBe("uname -a");
        expect(snapshot.providerLabel).toBe("Claude Code");
        expect(snapshot.modeLabel).toBe("Auto-Approve");
    });

    it("maps health or execution failures into visible reasons", () => {
        const snapshot = deriveAgentRuntimeStatus({
            isLocalAgent: true,
            provider: "codex",
            mode: "planning",
            chatStatus: "ready",
            messages: [],
            errorMessage: "Local agent failed: timeout",
            localAgentHealth: { ok: false, provider: "codex", available: false, message: "Health check failed" },
        });

        expect(snapshot.state).toBe("failed_retryable");
        expect(snapshot.blockedReason).toContain("timeout");
    });

    it("flags local agent capability misalignment when no terminal tool call was observed", () => {
        const snapshot = deriveAgentRuntimeStatus({
            isLocalAgent: true,
            provider: "codex",
            mode: "default",
            chatStatus: "ready",
            messages: [
                {
                    id: "m-capability",
                    role: "assistant",
                    parts: [
                        {
                            type: "text",
                            text: "我无法实际读取你机器的硬件传感器数据，也没有可用的终端接口直接读取结果。",
                        },
                    ],
                } as any,
            ],
            errorMessage: null,
            localAgentHealth: { ok: true, provider: "codex", available: true, message: "ok" },
        });

        expect(snapshot.state).toBe("failed_fatal");
        expect(snapshot.blockedReason).toContain("No terminal tool call was observed");
    });

    it("flags host-policy claims when no terminal tool call was observed", () => {
        const snapshot = deriveAgentRuntimeStatus({
            isLocalAgent: true,
            provider: "codex",
            mode: "default",
            chatStatus: "ready",
            messages: [
                {
                    id: "m-host-policy",
                    role: "assistant",
                    parts: [
                        {
                            type: "text",
                            text: "当前这边命令执行被宿主策略拦截，无法继续执行。",
                        },
                    ],
                } as any,
            ],
            errorMessage: null,
            localAgentHealth: { ok: true, provider: "codex", available: true, message: "ok" },
        });

        expect(snapshot.state).toBe("failed_fatal");
        expect(snapshot.blockedReason).toContain("No terminal tool call was observed");
    });
});

describe("agent runtime reducer", () => {
    it("moves from submit into executing and verifying", () => {
        const base = getDefaultAgentRuntimeSnapshot();
        const submitting = reduceAgentRuntimeSnapshot(base, { type: "USER_SUBMIT" });
        const tool: ToolCallEnvelope = {
            requestId: "req-1",
            taskId: "task-1",
            toolName: "bash",
            capability: "bash",
            args: { command: "pwd" },
            hostScope: { type: "local", hostId: "localhost" },
            requiresApproval: false,
        };

        const executing = reduceAgentRuntimeSnapshot(submitting, { type: "TOOL_CALL_STARTED", tool });
        const verifying = reduceAgentRuntimeSnapshot(executing, {
            type: "TOOL_CALL_FINISHED",
            result: {
                requestId: "req-1",
                taskId: "task-1",
                toolName: "bash",
                ok: true,
                exitCode: 0,
                durationMs: 12,
            },
        });

        expect(submitting.state).toBe("submitting");
        expect(executing.state).toBe("executing");
        expect(verifying.state).toBe("verifying");
    });

    it("tracks retryable failures and cancellation", () => {
        const base = getDefaultAgentRuntimeSnapshot();
        const failed = reduceAgentRuntimeSnapshot(base, {
            type: "TOOL_CALL_FAILED",
            retryable: true,
            result: {
                requestId: "req-2",
                taskId: "task-2",
                toolName: "bash",
                ok: false,
                exitCode: 1,
                stderr: "timeout",
                durationMs: 18,
                errorCode: "ETIMEDOUT",
            },
        });
        const cancelled = reduceAgentRuntimeSnapshot(failed, { type: "CANCEL_EXECUTION" });

        expect(failed.state).toBe("failed_retryable");
        expect(cancelled.state).toBe("cancelled");
    });

    it("marks approval timeout as retryable failure", () => {
        const base = getDefaultAgentRuntimeSnapshot();
        const timedOut = reduceAgentRuntimeSnapshot(base, {
            type: "APPROVAL_TIMEOUT",
            reason: "write_text_file timed out",
        });

        expect(timedOut.state).toBe("failed_retryable");
        expect(timedOut.phaseLabel).toBe("Approval Timed Out");
    });

    it("builds tool envelopes from tooluse parts", () => {
        const part = {
            type: "data-tooluse",
            data: {
                toolcallid: "tool-1",
                toolname: "read_text_file",
                tooldesc: "reading README.md",
                status: "completed",
                inputfilename: "README.md",
            },
        } as any;

        const call = toolCallFromPart(part, "task-1");
        const result = toolResultFromPart(part, "task-1");

        expect(call.requestId).toBe("tool-1");
        expect(call.capability).toBe("read");
        expect(result?.ok).toBe(true);
        expect(result?.artifacts?.diffPath).toBe("README.md");
    });

    it("treats identical runtime snapshots as equal", () => {
        const base = getDefaultAgentRuntimeSnapshot();
        const same = { ...base };

        expect(agentRuntimeSnapshotEquals(base, same)).toBe(true);
    });
});
