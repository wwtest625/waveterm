import { describe, expect, it } from "vitest";
import {
    AgentTaskState,
    agentRuntimeSnapshotEquals,
    deriveContextLevel,
    getContextLevelBgColor,
    getContextLevelColor,
    getContextLevelLabel,
    getDefaultAgentRuntimeSnapshot,
    getLatestAskPart,
    reduceAgentRuntimeSnapshot,
} from "../aitypes";
import type { AskUserData, AskUserKind, AskUserOption } from "../aitypes";

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

    it("tracks multiple active jobs across tool start and finish events", () => {
        const firstStarted = reduceAgentRuntimeSnapshot(getDefaultAgentRuntimeSnapshot(), {
            type: "TOOL_CALL_STARTED",
            tool: {
                requestId: "req-1",
                taskId: "task-1",
                toolName: "wave_run_command",
                jobId: "job-1",
                capability: "bash",
                args: { command: "pwd" },
                hostScope: { type: "remote", hostId: "root@host" },
                requiresApproval: false,
            },
        });
        const secondStarted = reduceAgentRuntimeSnapshot(firstStarted, {
            type: "TOOL_CALL_STARTED",
            tool: {
                requestId: "req-2",
                taskId: "task-1",
                toolName: "wave_run_command",
                jobId: "job-2",
                capability: "bash",
                args: { command: "uname -a" },
                hostScope: { type: "remote", hostId: "root@host" },
                requiresApproval: false,
            },
        });

        expect(secondStarted.activeJobIds).toEqual(["job-1", "job-2"]);
        expect(Object.keys(secondStarted.activeToolCalls ?? {})).toEqual(["req-1", "req-2"]);

        const firstFinished = reduceAgentRuntimeSnapshot(secondStarted, {
            type: "TOOL_CALL_FINISHED",
            result: {
                requestId: "req-1",
                taskId: "task-1",
                toolName: "wave_run_command",
                jobId: "job-1",
                ok: true,
                exitCode: 0,
                stdout: "/root",
                durationMs: 25,
            },
        });

        expect(firstFinished.state).toBe("executing");
        expect(firstFinished.activeJobIds).toEqual(["job-2"]);
        expect(Object.keys(firstFinished.activeToolCalls ?? {})).toEqual(["req-2"]);
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

describe("ASK_USER runtime event", () => {
    it("enters interacting state when ask user event is dispatched", () => {
        const next = reduceAgentRuntimeSnapshot(getDefaultAgentRuntimeSnapshot(), {
            type: "ASK_USER",
            reason: "请选择部署环境",
        });
        expect(next.state).toBe("interacting");
        expect(next.phaseLabel).toBe("Waiting for Answer");
        expect(next.blockedReason).toBe("请选择部署环境");
    });

    it("uses default reason when none provided", () => {
        const next = reduceAgentRuntimeSnapshot(getDefaultAgentRuntimeSnapshot(), {
            type: "ASK_USER",
        });
        expect(next.state).toBe("interacting");
        expect(next.blockedReason).toBe("Waiting for user input");
    });
});

describe("getLatestAskPart", () => {
    it("returns null for message without data-ask parts", () => {
        expect(getLatestAskPart(undefined)).toBeNull();
        expect(getLatestAskPart({ parts: [] } as any)).toBeNull();
    });

    it("returns the latest data-ask part", () => {
        const message = {
            parts: [
                { type: "text", text: "hello" },
                { type: "data-ask", data: { actionid: "ask-1", kind: "freeform", prompt: "test", status: "pending" } },
                { type: "data-ask", data: { actionid: "ask-2", kind: "select", prompt: "choose", status: "pending" } },
            ],
        } as any;
        const result = getLatestAskPart(message);
        expect(result).not.toBeNull();
        expect(result.data.actionid).toBe("ask-2");
    });
});

describe("AskUserData types", () => {
    it("represents a freeform ask with required fields", () => {
        const data: AskUserData = {
            actionid: "ask-abc-123",
            kind: "freeform",
            prompt: "请提供数据库连接字符串",
            status: "pending",
        };
        expect(data.kind).toBe("freeform");
        expect(data.prompt).toBeTruthy();
        expect(data.actionid).toBeTruthy();
    });

    it("represents a select ask with options", () => {
        const options: AskUserOption[] = [
            { id: "dev", label: "开发环境", value: "development", recommended: true },
            { id: "prod", label: "生产环境", value: "production" },
        ];
        const data: AskUserData = {
            actionid: "ask-select-1",
            kind: "select",
            prompt: "选择部署环境",
            options,
            required: true,
            status: "pending",
        };
        expect(data.kind).toBe("select");
        expect(data.options).toHaveLength(2);
        expect(data.options![0].id).toBe("dev");
        expect(data.options![0].recommended).toBe(true);
        expect(data.options![1].recommended).toBeUndefined();
    });

    it("represents a confirm ask with default value", () => {
        const data: AskUserData = {
            actionid: "ask-confirm-1",
            kind: "confirm",
            prompt: "确认要删除吗？",
            default: "no",
            required: true,
            status: "pending",
        };
        expect(data.kind).toBe("confirm");
        expect(data.default).toBe("no");
    });

    it("tracks answered status with answer field", () => {
        const data: AskUserData = {
            actionid: "ask-answered-1",
            kind: "freeform",
            prompt: "请提供名称",
            status: "answered",
            answer: "my-project",
        };
        expect(data.status).toBe("answered");
        expect(data.answer).toBe("my-project");
    });

    it("associates with a task via taskid", () => {
        const data: AskUserData = {
            actionid: "ask-task-1",
            kind: "select",
            prompt: "选择框架",
            options: [{ id: "react", label: "React" }],
            taskid: "task-123",
            status: "pending",
        };
        expect(data.taskid).toBe("task-123");
    });

    it("supports all valid AskUserKind values", () => {
        const kinds: AskUserKind[] = ["freeform", "select", "multiselect", "confirm"];
        expect(kinds).toHaveLength(4);
        for (const kind of kinds) {
            const data: AskUserData = {
                actionid: `ask-${kind}`,
                kind,
                prompt: `test ${kind}`,
                status: "pending",
            };
            expect(data.kind).toBe(kind);
        }
    });
});
