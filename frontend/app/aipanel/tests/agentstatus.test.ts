import { describe, expect, it } from "vitest";

import { deriveAgentRuntimeStatus } from "../agentstatus";
import { WaveUIMessage } from "../aitypes";

describe("deriveAgentRuntimeStatus", () => {
    it("returns completed after streaming ends even when the latest tool snapshot is still running", () => {
        const messages: WaveUIMessage[] = [
            {
                id: "assistant-1",
                role: "assistant",
                parts: [
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-1",
                            toolname: "wave_run_command",
                            tooldesc: "running \"sleep 5\" on current terminal",
                            status: "running",
                            jobid: "job-1",
                            durationms: 1200,
                        },
                    },
                ],
            },
        ];

        const snapshot = deriveAgentRuntimeStatus({
            provider: "Wave AI",
            mode: "default",
            chatStatus: "ready",
            messages,
            errorMessage: null,
        });

        expect(snapshot.state).toBe("completed");
        expect(snapshot.phaseLabel).toBe("Completed");
    });

    it("shows executing while streaming when a wave_run_command tool is running", () => {
        const messages: WaveUIMessage[] = [
            {
                id: "assistant-1",
                role: "assistant",
                parts: [
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-1",
                            toolname: "wave_run_command",
                            tooldesc: "running \"sleep 5\" on current terminal",
                            status: "running",
                            jobid: "job-1",
                            durationms: 1200,
                        },
                    },
                ],
            },
        ];

        const snapshot = deriveAgentRuntimeStatus({
            provider: "Wave AI",
            mode: "default",
            chatStatus: "streaming",
            messages,
            errorMessage: null,
        });

        expect(snapshot.state).toBe("executing");
        expect(snapshot.phaseLabel).toBe("Executing Command");
        expect(snapshot.activeJobId).toBe("job-1");
        expect(snapshot.activeTool).toBe("wave_run_command");
    });

    it("summarizes multiple running commands in the same assistant turn", () => {
        const messages: WaveUIMessage[] = [
            {
                id: "assistant-1",
                role: "assistant",
                parts: [
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-1",
                            toolname: "wave_run_command",
                            tooldesc: 'running "pwd" on current terminal',
                            status: "running",
                            jobid: "job-1",
                        },
                    },
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-2",
                            toolname: "wave_run_command",
                            tooldesc: 'running "uname -a" on current terminal',
                            status: "running",
                            jobid: "job-2",
                        },
                    },
                ],
            },
        ];

        const snapshot = deriveAgentRuntimeStatus({
            provider: "Wave AI",
            mode: "default",
            chatStatus: "streaming",
            messages,
            errorMessage: null,
        });

        expect(snapshot.state).toBe("executing");
        expect(snapshot.phaseLabel).toBe("Executing Commands");
        expect(snapshot.activeJobIds).toEqual(["job-1", "job-2"]);
        expect(snapshot.activeTool).toBe("2 commands");
    });

    it("ignores internal running tool snapshots once the turn is otherwise complete", () => {
        const messages: WaveUIMessage[] = [
            {
                id: "assistant-1",
                role: "assistant",
                parts: [
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-1",
                            toolname: "waveai_use_skill",
                            tooldesc: 'activating skill "troubleshoot-network"',
                            status: "running",
                        },
                    },
                    {
                        type: "text",
                        text: "已经完成分析。",
                    },
                ],
            },
        ];

        const snapshot = deriveAgentRuntimeStatus({
            provider: "Wave AI",
            mode: "default",
            chatStatus: "ready",
            messages,
            errorMessage: null,
        });

        expect(snapshot.state).toBe("completed");
        expect(snapshot.phaseLabel).toBe("Completed");
        expect(snapshot.activeJobId).toBeUndefined();
    });
});
