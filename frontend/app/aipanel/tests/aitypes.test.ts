import { describe, expect, it } from "vitest";
import {
    AgentTaskState,
    agentRuntimeSnapshotEquals,
    getDefaultAgentRuntimeSnapshot,
    reduceAgentRuntimeSnapshot,
} from "../aitypes";

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

describe("agent task state types", () => {
    it("represents summary, current task and ordered items", () => {
        const taskState: AgentTaskState = {
            version: 1,
            planid: "plan-1",
            source: "model-generated",
            status: "active",
            currenttaskid: "task-2",
            blockedreason: "",
            lastupdatedts: 123,
            summary: {
                total: 3,
                completed: 1,
                inprogress: 1,
                pending: 1,
                blocked: 0,
                percent: 33,
            },
            tasks: [
                { id: "task-1", title: "Map runtime", status: "completed", order: 0 },
                { id: "task-2", title: "Render panel", status: "in_progress", order: 1 },
            ],
        };

        expect(taskState.summary.percent).toBe(33);
        expect(taskState.currenttaskid).toBe("task-2");
        expect(taskState.tasks[1].status).toBe("in_progress");
    });
});
