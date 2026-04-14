import { describe, expect, it } from "vitest";
import { agentRuntimeSnapshotEquals, getDefaultAgentRuntimeSnapshot, reduceAgentRuntimeSnapshot } from "../aitypes";

describe("agent runtime reducer", () => {
    it("enters interacting state when command input is required", () => {
        const next = reduceAgentRuntimeSnapshot(getDefaultAgentRuntimeSnapshot(), {
            type: "INTERACTION_REQUIRED",
            reason: "Command is waiting for terminal input",
        });

        expect(next.state).toBe("interacting");
        expect(next.phaseLabel).toBe("Waiting Input");
        expect(next.blockedReason).toContain("terminal input");
    });

    it("uses completed as the terminal success state", () => {
        const next = reduceAgentRuntimeSnapshot(getDefaultAgentRuntimeSnapshot(), {
            type: "VERIFY_FINISHED",
            ok: true,
        });

        expect(next.state).toBe("completed");
        expect(next.phaseLabel).toBe("Completed");
    });

    it("shows thinking immediately after submit", () => {
        const next = reduceAgentRuntimeSnapshot(getDefaultAgentRuntimeSnapshot(), {
            type: "USER_SUBMIT",
        });

        expect(next.state).toBe("submitting");
        expect(next.phaseLabel).toBe("Thinking");
    });

    it("treats tool args as equal regardless of object key order", () => {
        const base = getDefaultAgentRuntimeSnapshot();
        const left = {
            ...base,
            lastToolCall: {
                requestId: "req-1",
                taskId: "task-1",
                toolName: "wave_run_command",
                capability: "bash" as const,
                args: {
                    command: "echo hello",
                    env: { A: "1", B: "2" },
                },
                hostScope: { type: "local" as const, hostId: "waveai" },
                requiresApproval: false,
            },
        };
        const right = {
            ...base,
            lastToolCall: {
                ...left.lastToolCall,
                args: {
                    env: { B: "2", A: "1" },
                    command: "echo hello",
                },
            },
        };

        expect(agentRuntimeSnapshotEquals(left, right)).toBe(true);
    });
});
