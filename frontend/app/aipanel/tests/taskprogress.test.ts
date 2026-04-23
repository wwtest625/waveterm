import { describe, expect, it } from "vitest";
import { deriveTaskProgressViewModel } from "../taskprogress";

describe("deriveTaskProgressViewModel", () => {
    it("builds a visible summary for an active plan", () => {
        const viewModel = deriveTaskProgressViewModel({
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
                { id: "task-2", title: "Render task panel", status: "in_progress", order: 1 },
                { id: "task-3", title: "Verify session restore", status: "pending", order: 2 },
            ],
        });

        expect(viewModel.visible).toBe(true);
        expect(viewModel.completedLabel).toBe("1 / 3");
        expect(viewModel.percent).toBe(33);
        expect(viewModel.currentTaskTitle).toBe("Render task panel");
        expect(viewModel.tasks[1].isCurrent).toBe(true);
    });

    it("hides the card when there is no task state or no tasks", () => {
        expect(deriveTaskProgressViewModel(null).visible).toBe(false);
        expect(
            deriveTaskProgressViewModel({
                tasks: [],
                summary: {},
            })?.visible
        ).toBe(false);
    });

    it("derives focus chain and context info from task state", () => {
        const viewModel = deriveTaskProgressViewModel({
            planid: "plan-1",
            source: "model-generated",
            status: "active",
            currenttaskid: "task-2",
            tasks: [
                { id: "task-1", title: "安装 MySQL", description: "使用 apt 安装", status: "completed", priority: "high" },
                { id: "task-2", title: "配置 my.cnf", description: "调整 buffer pool", status: "in_progress", priority: "high", isfocused: true },
            ],
            summary: { total: 2, completed: 1, inprogress: 1, pending: 0, blocked: 0, percent: 50 },
            focuschain: { focusedtodoid: "task-2", chainprogress: 50, totaltodos: 2, completedtodos: 1, currentcontextusage: 35 },
        });

        expect(viewModel.currentTaskTitle).toBe("配置 my.cnf");
        expect(viewModel.currentTaskDescription).toBe("调整 buffer pool");
        expect(viewModel.currentTaskPriority).toBe("high");
        expect(viewModel.chainProgress).toBe(50);
        expect(viewModel.contextUsagePercent).toBe(35);
        expect(viewModel.contextLevel).toBe("normal");
        expect(viewModel.focusedTaskId).toBe("task-2");
        expect(viewModel.securityBlocked).toBe(false);
    });

    it("ignores stale focus metadata on completed tasks", () => {
        const viewModel = deriveTaskProgressViewModel({
            planid: "plan-1",
            source: "model-generated",
            status: "completed",
            currenttaskid: "",
            tasks: [
                { id: "task-1", title: "收集信息", status: "completed", isfocused: true },
                { id: "task-2", title: "整理结果", status: "completed" },
            ],
            summary: { total: 2, completed: 2, percent: 100 },
            focuschain: { focusedtodoid: "task-1", chainprogress: 100, totaltodos: 2, completedtodos: 2 },
        });

        expect(viewModel.focusedTaskId).toBeUndefined();
        expect(viewModel.tasks[0].isFocused).toBe(false);
    });

    it("derives context level from usage percent when not in focuschain", () => {
        const viewModel = deriveTaskProgressViewModel({
            tasks: [
                { id: "task-1", title: "Task A", status: "in_progress", isfocused: true, contextusagepercent: 85 },
            ],
            summary: { total: 1, completed: 0, percent: 0 },
        });

        expect(viewModel.contextUsagePercent).toBe(85);
        expect(viewModel.contextLevel).toBe("critical");
    });

    it("detects security blocked state", () => {
        const viewModel = deriveTaskProgressViewModel({
            tasks: [{ id: "task-1", title: "Dangerous task", status: "blocked" }],
            summary: { total: 1, blocked: 1, percent: 0 },
            blockedreason: "命令被安全机制阻止",
            securityblocked: true,
        });

        expect(viewModel.securityBlocked).toBe(true);
        expect(viewModel.blockedReason).toBe("命令被安全机制阻止");
    });

    it("includes description, priority, and subtasks in items", () => {
        const viewModel = deriveTaskProgressViewModel({
            tasks: [
                {
                    id: "task-1",
                    title: "Setup DB",
                    description: "Install and configure",
                    status: "in_progress",
                    priority: "high",
                    isfocused: true,
                    subtasks: [
                        { id: "sub-1", content: "Install PostgreSQL" },
                        { id: "sub-2", content: "Create database" },
                    ],
                },
            ],
            summary: { total: 1, percent: 0 },
        });

        expect(viewModel.tasks[0].description).toBe("Install and configure");
        expect(viewModel.tasks[0].priority).toBe("high");
        expect(viewModel.tasks[0].isFocused).toBe(true);
        expect(viewModel.tasks[0].subtasks).toHaveLength(2);
        expect(viewModel.tasks[0].subtasks![0].content).toBe("Install PostgreSQL");
    });

    it("computes chain progress from summary when focuschain is absent", () => {
        const viewModel = deriveTaskProgressViewModel({
            tasks: [
                { id: "task-1", title: "A", status: "completed" },
                { id: "task-2", title: "B", status: "completed" },
                { id: "task-3", title: "C", status: "pending" },
                { id: "task-4", title: "D", status: "pending" },
            ],
            summary: { total: 4, completed: 2, percent: 50 },
        });

        expect(viewModel.chainProgress).toBe(50);
    });

    it("returns normal context level for 0% usage", () => {
        const viewModel = deriveTaskProgressViewModel({
            tasks: [{ id: "task-1", title: "A", status: "pending" }],
            summary: { total: 1, percent: 0 },
        });

        expect(viewModel.contextLevel).toBe("normal");
        expect(viewModel.contextUsagePercent).toBe(0);
    });

    it("shows panel when security blocked even for single-item tasks", () => {
        const viewModel = deriveTaskProgressViewModel({
            tasks: [{ id: "task-1", title: "A", status: "blocked" }],
            summary: { total: 1, blocked: 1, percent: 0 },
            blockedreason: "命令被安全机制阻止",
            securityblocked: true,
        });

        expect(viewModel.visible).toBe(true);
        expect(viewModel.securityBlocked).toBe(true);
    });

    it("hides trivial single-item task panels without security block", () => {
        const viewModel = deriveTaskProgressViewModel({
            tasks: [{ id: "task-1", title: "A", status: "completed" }],
            summary: { total: 1, completed: 1, percent: 100 },
        });

        expect(viewModel.visible).toBe(false);
    });
});
