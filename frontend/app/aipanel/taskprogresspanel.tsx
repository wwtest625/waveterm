import { cn } from "@/util/util";
import { AgentTaskState } from "./aitypes";
import { deriveTaskProgressViewModel } from "./taskprogress";

function getTaskTone(status: string, isCurrent: boolean): string {
    if (isCurrent) {
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

function getTaskIcon(status: string, isCurrent: boolean): string {
    if (isCurrent || status === "in_progress") {
        return "fa-solid fa-spinner fa-spin";
    }
    switch (status) {
        case "completed":
            return "fa-solid fa-check";
        case "blocked":
            return "fa-solid fa-triangle-exclamation";
        default:
            return "fa-regular fa-circle";
    }
}

export function TaskProgressPanel({ taskState }: { taskState: AgentTaskState | null | undefined }) {
    const viewModel = deriveTaskProgressViewModel(taskState);
    if (!viewModel.visible) {
        return null;
    }

    return (
        <div className="mx-2 mb-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-xs text-zinc-400">任务进度</div>
                    <div className="mt-1 text-sm font-medium text-zinc-100">
                        {viewModel.completedLabel}
                        <span className="ml-2 text-zinc-400">({viewModel.percent}%)</span>
                    </div>
                </div>
                {viewModel.currentTaskTitle && (
                    <div className="truncate text-right text-xs text-zinc-400" title={viewModel.currentTaskTitle}>
                        当前：{viewModel.currentTaskTitle}
                    </div>
                )}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-accent transition-all" style={{ width: `${viewModel.percent}%` }} />
            </div>
            <div className="mt-3 space-y-2">
                {viewModel.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-sm">
                        <i className={cn(getTaskIcon(item.status, item.isCurrent), getTaskTone(item.status, item.isCurrent))} />
                        <span className={cn("truncate", getTaskTone(item.status, item.isCurrent))} title={item.title}>
                            {item.title}
                        </span>
                    </div>
                ))}
            </div>
            {viewModel.blockedReason && (
                <div className="mt-3 truncate text-xs text-amber-300" title={viewModel.blockedReason}>
                    阻塞：{viewModel.blockedReason}
                </div>
            )}
        </div>
    );
}
