import { cn } from "@/util/util";
import { useState } from "react";
import {
    AgentTaskState,
    ContextThresholdLevel,
    getContextLevelBgColor,
    getContextLevelColor,
    getContextLevelLabel,
} from "./aitypes";
import { TaskProgressItemViewModel, deriveTaskProgressViewModel } from "./taskprogress";

function getTaskTone(status: string, isCurrent: boolean, isFocused: boolean): string {
    if (status !== "completed" && (isCurrent || isFocused)) {
        return "text-accent";
    }
    switch (status) {
        case "completed":
            return "text-emerald-400";
        case "blocked":
            return "text-amber-400";
        case "in_progress":
            return "text-blue-300";
        default:
            return "text-zinc-400";
    }
}

function getTaskIcon(status: string, isCurrent: boolean, isFocused: boolean): string {
    if (status !== "completed" && (isCurrent || isFocused || status === "in_progress")) {
        return "fa-solid fa-spinner fa-spin";
    }
    switch (status) {
        case "completed":
            return "fa-solid fa-check";
        case "blocked":
            return "fa-solid fa-triangle-exclamation";
        case "skipped":
            return "fa-solid fa-forward";
        default:
            return "fa-regular fa-circle";
    }
}

function getPriorityBadge(priority: "high" | "medium" | "low" | undefined): string | null {
    switch (priority) {
        case "high":
            return "P0";
        case "medium":
            return "P1";
        case "low":
            return "P2";
        default:
            return null;
    }
}

function getPriorityBadgeClass(priority: "high" | "medium" | "low" | undefined): string {
    switch (priority) {
        case "high":
            return "bg-red-500/20 text-red-400";
        case "medium":
            return "bg-amber-500/20 text-amber-400";
        case "low":
            return "bg-zinc-500/20 text-zinc-400";
        default:
            return "";
    }
}

function TaskItemRow({
    item,
    expanded,
    onToggle,
}: {
    item: TaskProgressItemViewModel;
    expanded: boolean;
    onToggle: () => void;
}) {
    const hasSubtasks = item.subtasks && item.subtasks.length > 0;
    return (
        <div>
            <div className="flex items-center gap-2 text-sm">
                <i
                    className={cn(
                        getTaskIcon(item.status, item.isCurrent, item.isFocused),
                        getTaskTone(item.status, item.isCurrent, item.isFocused),
                        "w-4 text-center"
                    )}
                />
                <span
                    className={cn("truncate flex-1", getTaskTone(item.status, item.isCurrent, item.isFocused))}
                    title={item.title}
                >
                    {item.title}
                </span>
                {item.priority && (
                    <span
                        className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-mono",
                            getPriorityBadgeClass(item.priority)
                        )}
                    >
                        {getPriorityBadge(item.priority)}
                    </span>
                )}
                {item.isFocused && item.status !== "completed" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent">聚焦</span>
                )}
                {hasSubtasks && (
                    <button onClick={onToggle} className="text-zinc-500 hover:text-zinc-300 transition-colors ml-1">
                        <i
                            className={cn(
                                "fa-solid fa-chevron-down text-[10px] transition-transform",
                                expanded && "rotate-180"
                            )}
                        />
                    </button>
                )}
            </div>
            {item.description && (
                <div className="ml-6 mt-0.5 text-xs text-zinc-500 truncate" title={item.description}>
                    {item.description}
                </div>
            )}
            {hasSubtasks && expanded && (
                <div className="ml-6 mt-1 space-y-1">
                    {item.subtasks!.map((sub) => (
                        <div key={sub.id} className="flex items-center gap-2 text-xs text-zinc-400">
                            <i className="fa-solid fa-minus text-[8px] text-zinc-600" />
                            <span className="truncate">{sub.content}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function ContextUsageIndicator({ percent, level }: { percent: number; level: ContextThresholdLevel }) {
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1 overflow-hidden rounded-full bg-white/[0.04]">
                <div
                    className={cn("h-full transition-all", getContextLevelBgColor(level))}
                    style={{ width: `${Math.min(percent, 100)}%` }}
                />
            </div>
            <span className={cn("text-[10px] font-mono min-w-[36px] text-right", getContextLevelColor(level))}>
                {percent}%
            </span>
            <span className={cn("text-[10px]", getContextLevelColor(level))}>{getContextLevelLabel(level)}</span>
        </div>
    );
}

export function TaskProgressPanel({
    taskState,
    compact = false,
    className,
}: {
    taskState: AgentTaskState | null | undefined;
    compact?: boolean;
    className?: string;
}) {
    const viewModel = deriveTaskProgressViewModel(taskState);
    const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

    if (!viewModel.visible) {
        return null;
    }

    const toggleExpand = (taskId: string) => {
        setExpandedTasks((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            return next;
        });
    };

    return (
        <div className={cn(className ?? "mx-3 mb-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3")}>
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-xs text-zinc-400">{compact ? "当前任务" : "任务计划"}</div>
                    <div className="mt-1 text-sm font-medium text-zinc-100">
                        {viewModel.completedLabel}
                        <span className="ml-2 text-zinc-400">({viewModel.percent}%)</span>
                    </div>
                </div>
                <div className="text-right">
                    {viewModel.currentTaskTitle && (
                        <div className="truncate text-xs text-zinc-100 font-medium" title={viewModel.currentTaskTitle}>
                            当前：{viewModel.currentTaskTitle}
                        </div>
                    )}
                    {viewModel.currentTaskDescription && (
                        <div
                            className="truncate text-[10px] text-zinc-500 mt-0.5"
                            title={viewModel.currentTaskDescription}
                        >
                            {viewModel.currentTaskDescription}
                        </div>
                    )}
                    {viewModel.currentTaskPriority && (
                        <span
                            className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded font-mono inline-block mt-0.5",
                                getPriorityBadgeClass(viewModel.currentTaskPriority)
                            )}
                        >
                            {getPriorityBadge(viewModel.currentTaskPriority)}
                        </span>
                    )}
                </div>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                <div className="h-full bg-accent/60 transition-all" style={{ width: `${viewModel.percent}%` }} />
            </div>

            {compact && viewModel.blockedReason && !viewModel.securityBlocked && (
                <div className="mt-2 truncate text-xs text-amber-300" title={viewModel.blockedReason}>
                    阻塞：{viewModel.blockedReason}
                </div>
            )}

            {compact && viewModel.securityBlocked && (
                <div className="mt-2 text-xs text-red-300/70">
                    <i className="fa-solid fa-shield-halved mr-1.5" />
                    命令被安全机制阻止
                </div>
            )}

            {!compact && (
                <>
                    {viewModel.contextUsagePercent > 0 && (
                        <div className="mt-2">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-zinc-500">上下文用量</span>
                            </div>
                            <ContextUsageIndicator
                                percent={viewModel.contextUsagePercent}
                                level={viewModel.contextLevel}
                            />
                        </div>
                    )}

                    {viewModel.chainProgress > 0 && viewModel.focusedTaskId && (
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
                            <span>聚焦链进度</span>
                            <div className="flex-1 h-0.5 overflow-hidden rounded-full bg-white/[0.04]">
                                <div
                                    className="h-full bg-blue-400 transition-all"
                                    style={{ width: `${viewModel.chainProgress}%` }}
                                />
                            </div>
                            <span className="font-mono">{viewModel.chainProgress}%</span>
                        </div>
                    )}

                    <div className="mt-3 space-y-2">
                        {viewModel.tasks.map((item) => (
                            <TaskItemRow
                                key={item.id}
                                item={item}
                                expanded={expandedTasks.has(item.id)}
                                onToggle={() => toggleExpand(item.id)}
                            />
                        ))}
                    </div>

                    {viewModel.securityBlocked && (
                        <div className="mt-3 rounded-lg border border-red-500/12 bg-red-500/[0.04] px-3 py-2 text-xs text-red-300/70">
                            <i className="fa-solid fa-shield-halved mr-1.5" />
                            命令被安全机制阻止，已停止所有处理
                        </div>
                    )}

                    {viewModel.blockedReason && !viewModel.securityBlocked && (
                        <div className="mt-3 truncate text-xs text-amber-300" title={viewModel.blockedReason}>
                            阻塞：{viewModel.blockedReason}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
