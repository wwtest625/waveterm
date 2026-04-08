import { describe, expect, it } from "vitest";

import { deriveAgentRuntimeStatus } from "../agentstatus";
import { WaveUIMessage } from "../aitypes";

describe("deriveAgentRuntimeStatus", () => {
    it("keeps command executions active after streaming ends when the latest tool snapshot is still running", () => {
        const messages: WaveUIMessage[] = [
            {
                id: "assistant-1",
                role: "assistant",
                parts: [
                    {
                        type: "data-tooluse",
                        data: {
                            toolcallid: "tool-1",
                            toolname: "wave_get_command_result",
                            tooldesc: "polling command result for job-1",
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

        expect(snapshot.state).toBe("executing");
        expect(snapshot.phaseLabel).toBe("Executing Command");
        expect(snapshot.activeJobId).toBe("job-1");
        expect(snapshot.activeTool).toBe("wave_get_command_result");
    });
});
