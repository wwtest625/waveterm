import { describe, expect, it } from "vitest";
import { deriveAgentRuntimeStatus } from "./agentstatus";

describe("agent runtime status mapping", () => {
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
                                toolname: "wave_read_terminal_scrollback",
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

    it("maps terminal execution and waiting states from tool use", () => {
        const executing = deriveAgentRuntimeStatus({
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
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-exec",
                                toolname: "wave_inject_terminal_command",
                                tooldesc: "running command",
                                status: "pending",
                            },
                        },
                    ],
                } as any,
            ],
            errorMessage: null,
            localAgentHealth: { ok: true, provider: "codex", available: true, message: "ok" },
        });

        expect(executing.phase).toBe("executing-command");

        const waiting = deriveAgentRuntimeStatus({
            isLocalAgent: true,
            provider: "codex",
            mode: "default",
            chatStatus: "streaming",
            messages: [
                {
                    id: "m-wait",
                    role: "assistant",
                    parts: [
                        {
                            type: "data-tooluse",
                            data: {
                                toolcallid: "tool-wait",
                                toolname: "wave_wait_terminal_idle",
                                tooldesc: "waiting for idle",
                                status: "pending",
                            },
                        },
                    ],
                } as any,
            ],
            errorMessage: null,
            localAgentHealth: { ok: true, provider: "codex", available: true, message: "ok" },
        });

        expect(waiting.phase).toBe("waiting-terminal");
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
});
