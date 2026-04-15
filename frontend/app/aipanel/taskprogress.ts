import { AgentTaskItem, AgentTaskState } from "./aitypes";

export type TaskProgressItemViewModel = {
    id: string;
    title: string;
    status: AgentTaskItem["status"];
    isCurrent: boolean;
};

export type TaskProgressViewModel = {
    visible: boolean;
    completedLabel: string;
    percent: number;
    currentTaskTitle?: string;
    blockedReason?: string;
    items: TaskProgressItemViewModel[];
};

export function deriveTaskProgressViewModel(taskState: AgentTaskState | null | undefined): TaskProgressViewModel {
    const tasks = taskState?.tasks ?? [];
    if (tasks.length === 0) {
        return {
            visible: false,
            completedLabel: "0 / 0",
            percent: 0,
            items: [],
        };
    }

    const sortedTasks = [...tasks].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    const currentTask = sortedTasks.find((task) => task.id === taskState?.currenttaskid);
    const completed = taskState?.summary?.completed ?? sortedTasks.filter((task) => task.status === "completed").length;
    const total = taskState?.summary?.total ?? sortedTasks.length;
    const percent = taskState?.summary?.percent ?? (total > 0 ? Math.round((completed / total) * 100) : 0);

    return {
        visible: true,
        completedLabel: `${completed} / ${total}`,
        percent,
        currentTaskTitle: currentTask?.title,
        blockedReason: taskState?.blockedreason,
        items: sortedTasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            isCurrent: task.id === taskState?.currenttaskid,
        })),
    };
}
