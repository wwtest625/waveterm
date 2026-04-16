import { describe, expect, it } from "vitest";
import {
    AgentTaskState,
    agentRuntimeSnapshotEquals,
    deriveContextLevel,
    getContextLevelBgColor,
    getContextLevelColor,
    getContextLevelLabel,
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

    it("supports focus chain and security blocked fields", () => {
        const taskState: AgentTaskState = {
            planid: "plan-2",
            source: "model-generated",
            status: "blocked",
            currenttaskid: "task-1",
            tasks: [{ id: "task-1", title: "Dangerous op", status: "blocked" }],
            summary: { total: 1, blocked: 1, percent: 0 },
            blockedreason: "命令被安全机制阻止",
            securityblocked: true,
            focuschain: {
                focusedtodoid: "task-1",
                chainprogress: 0,
                totaltodos: 1,
                completedtodos: 0,
                currentcontextusage: 85,
                contextlevel: "critical",
            },
        };

        expect(taskState.securityblocked).toBe(true);
        expect(taskState.focuschain?.contextlevel).toBe("critical");
        expect(taskState.focuschain?.currentcontextusage).toBe(85);
    });
});

describe("deriveContextLevel", () => {
    it("returns normal for usage below 60%", () => {
        expect(deriveContextLevel(0)).toBe("normal");
        expect(deriveContextLevel(30)).toBe("normal");
        expect(deriveContextLevel(59)).toBe("normal");
    });

    it("returns warning for usage 60-79%", () => {
        expect(deriveContextLevel(60)).toBe("warning");
        expect(deriveContextLevel(70)).toBe("warning");
        expect(deriveContextLevel(79)).toBe("warning");
    });

    it("returns critical for usage 80-94%", () => {
        expect(deriveContextLevel(80)).toBe("critical");
        expect(deriveContextLevel(90)).toBe("critical");
        expect(deriveContextLevel(94)).toBe("critical");
    });

    it("returns maximum for usage >= 95%", () => {
        expect(deriveContextLevel(95)).toBe("maximum");
        expect(deriveContextLevel(100)).toBe("maximum");
    });
});

describe("context level UI helpers", () => {
    it("returns correct text colors", () => {
        expect(getContextLevelColor("normal")).toBe("text-emerald-400");
        expect(getContextLevelColor("warning")).toBe("text-amber-400");
        expect(getContextLevelColor("critical")).toBe("text-red-400");
        expect(getContextLevelColor("maximum")).toBe("text-red-500");
    });

    it("returns correct bg colors", () => {
        expect(getContextLevelBgColor("normal")).toBe("bg-emerald-400");
        expect(getContextLevelBgColor("warning")).toBe("bg-amber-400");
        expect(getContextLevelBgColor("critical")).toBe("bg-red-400");
        expect(getContextLevelBgColor("maximum")).toBe("bg-red-500");
    });

    it("returns correct labels", () => {
        expect(getContextLevelLabel("normal")).toBe("正常");
        expect(getContextLevelLabel("warning")).toBe("偏高");
        expect(getContextLevelLabel("critical")).toBe("紧张");
        expect(getContextLevelLabel("maximum")).toBe("已满");
    });
});
