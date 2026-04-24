import { AgentTaskItem, AgentTaskState, AgentTaskSummary, ContextThresholdLevel, deriveContextLevel } from "./aitypes";

export type TaskProgressItemViewModel = {
    id: string;
    title: string;
    description?: string;
    status: AgentTaskItem["status"];
    priority?: "high" | "medium" | "low";
    isCurrent: boolean;
    isFocused: boolean;
    subtasks?: { id: string; content: string; description?: string }[];
};

export type TaskProgressViewModel = {
    visible: boolean;
    completedLabel: string;
    percent: number;
    currentTaskTitle?: string;
    currentTaskDescription?: string;
    currentTaskPriority?: "high" | "medium" | "low";
    focusedTaskId?: string;
    chainProgress: number;
    contextUsagePercent: number;
    contextLevel: ContextThresholdLevel;
    tasks: TaskProgressItemViewModel[];
    summary: AgentTaskSummary;
    blockedReason?: string;
    securityBlocked: boolean;
};

export function deriveTaskProgressViewModel(taskState: AgentTaskState | null | undefined): TaskProgressViewModel {
    if (taskState?.source && taskState.source !== "model-generated") {
        return {
            visible: false,
            completedLabel: "0 / 0",
            percent: 0,
            chainProgress: 0,
            contextUsagePercent: 0,
            contextLevel: "normal",
            tasks: [],
            summary: taskState.summary ?? {},
            blockedReason: taskState.blockedreason,
            securityBlocked: Boolean(taskState.securityblocked),
        };
    }

    const tasks = taskState?.tasks ?? [];
    if (tasks.length === 0) {
        return {
            visible: false,
            completedLabel: "0 / 0",
            percent: 0,
            chainProgress: 0,
            contextUsagePercent: 0,
            contextLevel: "normal",
            tasks: [],
            summary: {},
            securityBlocked: false,
        };
    }
    const hasExpandedChecklist = tasks.length > 1 || tasks.some((task) => (task.subtasks?.length ?? 0) > 0);
    const hasFocusOrContextMetadata =
        Boolean(taskState?.focuschain) ||
        tasks.some((task) => Boolean(task.isfocused) || (task.contextusagepercent ?? 0) > 0);
    if (!hasExpandedChecklist && !hasFocusOrContextMetadata && !taskState?.securityblocked) {
        return {
            visible: false,
            completedLabel: "0 / 0",
            percent: 0,
            chainProgress: 0,
            contextUsagePercent: 0,
            contextLevel: "normal",
            tasks: [],
            summary: taskState?.summary ?? {},
            blockedReason: taskState?.blockedreason,
            securityBlocked: Boolean(taskState?.securityblocked),
        };
    }

    const sortedTasks = [...tasks].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    const currentTask = sortedTasks.find((task) => task.id === taskState?.currenttaskid);
    const focusedTaskFromFocusChain =
        sortedTasks.find((task) => task.id === taskState?.focuschain?.focusedtodoid && task.status !== "completed") ??
        null;
    const focusedTask =
        focusedTaskFromFocusChain ??
        sortedTasks.find((task) => task.isfocused && task.status !== "completed") ??
        sortedTasks.find((task) => task.status === "in_progress");
    const completed = taskState?.summary?.completed ?? sortedTasks.filter((task) => task.status === "completed").length;
    const total = taskState?.summary?.total ?? sortedTasks.length;
    const percent = taskState?.summary?.percent ?? (total > 0 ? Math.round((completed / total) * 100) : 0);

    const chainProgress =
        taskState?.focuschain?.chainprogress ?? (total > 0 ? Math.round((completed / total) * 100) : 0);
    const contextUsagePercent = taskState?.focuschain?.currentcontextusage ?? focusedTask?.contextusagepercent ?? 0;
    const contextLevel = taskState?.focuschain?.contextlevel ?? deriveContextLevel(contextUsagePercent);

    return {
        visible: true,
        completedLabel: `${completed} / ${total}`,
        percent,
        currentTaskTitle: currentTask?.title,
        currentTaskDescription: currentTask?.description,
        currentTaskPriority: currentTask?.priority,
        focusedTaskId: focusedTask?.id,
        chainProgress,
        contextUsagePercent,
        contextLevel,
        tasks: sortedTasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            isCurrent: task.id === taskState?.currenttaskid,
            isFocused: Boolean(task.isfocused && task.status !== "completed"),
            subtasks: task.subtasks,
        })),
        summary: taskState?.summary ?? {},
        blockedReason: taskState?.blockedreason,
        securityBlocked: Boolean(taskState?.securityblocked),
    };
}
