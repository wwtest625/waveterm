import { describe, expect, it } from "vitest";
import { deriveAgentRuntimeStatus } from "./agentstatus";

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

        expect(snapshot.phase).toBe("ready");
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

        expect(snapshot.phase).toBe("executing-command");
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
        expect(snapshot.phase).toBe("reading-terminal");
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

        expect(snapshot.phase).toBe("waiting-approval");
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

        expect(snapshot.phase).toBe("error");
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

        expect(snapshot.phase).toBe("error");
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

        expect(snapshot.phase).toBe("error");
        expect(snapshot.blockedReason).toContain("No terminal tool call was observed");
    });
});
