import { cn } from "@/util/util";
import { memo, useEffect, useState } from "react";
import { formatBackgroundJobDuration, isTerminalBackgroundJobStatus } from "./ai-utils";
import { t } from "./aipanel-i18n";
import { WaveAIModel } from "./waveai-model";
import { useAtomValue } from "jotai";

function bgJobStatusLabel(job: { approvalstate?: string; interactionstate?: string; status?: string }): string {
    if (job.approvalstate === "needs-approval") {
        return t.bgJob.awaitingApproval;
    }
    if (job.interactionstate === "awaiting-input") {
        return t.bgJob.awaitingInput;
    }
    if (job.interactionstate === "tui-detected") {
        return t.bgJob.interactiveUIDetected;
    }
    switch (job.status) {
        case "running":
            return t.bgJob.running;
        case "completed":
            return t.bgJob.completed;
        case "error":
            return t.bgJob.failed;
        case "gone":
            return t.bgJob.gone;
        case "cancelled":
            return t.bgJob.cancelled;
        default:
            return t.bgJob.unknown;
    }
}

export const BackgroundJobsPanel = memo(() => {
    const model = WaveAIModel.getInstance();
    const backgroundJobs = useAtomValue(model.backgroundJobsAtom);
    const [expandedJobIds, setExpandedJobIds] = useState<Record<string, boolean>>({});

    useEffect(() => {
        setExpandedJobIds((prev) => {
            const next: Record<string, boolean> = {};
            for (const job of backgroundJobs) {
                if (prev[job.jobid]) {
                    next[job.jobid] = true;
                }
            }
            return next;
        });
    }, [backgroundJobs]);

    if (backgroundJobs.length === 0) {
        return null;
    }

    const runningCount = backgroundJobs.filter((job) => !isTerminalBackgroundJobStatus(job.status)).length;
    const finishedCount = backgroundJobs.length - runningCount;

    return (
        <div className="mx-3 mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-100">{t.bgJob.title}</div>
                    <div className="mt-1 text-[11px] text-zinc-400">
                        {t.bgJob.jobCount(backgroundJobs.length)}
                        {runningCount > 0 ? `，${t.bgJob.runningCount(runningCount)}` : ""}
                        {finishedCount > 0 ? `，${t.bgJob.finishedCount(finishedCount)}` : ""}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={runningCount === 0}
                        onClick={() => void model.cancelAllRunningBackgroundJobs()}
                        className={cn(
                            "rounded-lg px-2.5 py-1 text-[11px]",
                            runningCount > 0
                                ? "border border-red-300/15 bg-red-300/[0.06] text-red-100 hover:bg-red-300/[0.1]"
                                : "border border-white/[0.05] bg-white/[0.03] text-zinc-500"
                        )}
                    >
                        {t.bgJob.cancelAllRunning}
                    </button>
                    <button
                        type="button"
                        disabled={finishedCount === 0}
                        onClick={() => void model.clearFinishedBackgroundJobs()}
                        className={cn(
                            "rounded-lg px-2.5 py-1 text-[11px]",
                            finishedCount > 0
                                ? "border border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
                                : "border border-white/[0.05] bg-white/[0.03] text-zinc-500"
                        )}
                    >
                        {t.bgJob.clearFinished}
                    </button>
                </div>
            </div>
            <div className="mt-3 space-y-2">
                {backgroundJobs.map((job) => {
                    const expanded = expandedJobIds[job.jobid] === true;
                    const preview = job.outputpreview?.trim() ?? "";
                    return (
                        <div
                            key={job.jobid}
                            className="rounded-xl border border-white/[0.05] bg-black/15 px-3 py-2.5"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-[13px] font-medium text-zinc-100">
                                        {job.commandsummary || job.jobid}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                                        <span>{bgJobStatusLabel(job)}</span>
                                        {job.targetlabel && <span>{job.targetlabel}</span>}
                                        {job.durationms ? <span>{formatBackgroundJobDuration(job.durationms)}</span> : null}
                                        {job.exitcode != null && (
                                            <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
                                                {t.bgJob.exitCode(job.exitcode)}
                                            </span>
                                        )}
                                    </div>
                                    {job.error && (
                                        <div className="mt-1 text-[11px] text-red-200/70">{job.error}</div>
                                    )}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    {preview && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setExpandedJobIds((prev) => ({
                                                    ...prev,
                                                    [job.jobid]: !prev[job.jobid],
                                                }))
                                            }
                                            className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/[0.06]"
                                        >
                                            {expanded ? t.bgJob.hideOutput : t.bgJob.showOutput}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => model.scrollToBackgroundJob(job)}
                                        className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/[0.06]"
                                    >
                                        {t.bgJob.jump}
                                    </button>
                                    {!isTerminalBackgroundJobStatus(job.status) && (
                                        <button
                                            type="button"
                                            onClick={() => void model.cancelBackgroundJobs([job.jobid])}
                                            className="rounded-lg border border-red-300/15 bg-red-300/[0.06] px-2 py-1 text-[11px] text-red-100 hover:bg-red-300/[0.1]"
                                        >
                                            {t.bgJob.cancel}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {expanded && preview && (
                                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 px-3 py-2 text-[12px] text-zinc-200">
                                    {preview}
                                </pre>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

BackgroundJobsPanel.displayName = "BackgroundJobsPanel";
