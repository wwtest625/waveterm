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

        expect(snapshot.state).toBe("executing");
        expect(snapshot.phaseLabel).toBe("Executing Command");
        expect(snapshot.activeJobId).toBe("job-1");
        expect(snapshot.activeTool).toBe("wave_run_command");
    });
});
