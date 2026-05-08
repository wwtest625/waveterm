import { type WaveAIModel } from "@/app/aipanel/waveai-model";
import { Tooltip } from "@/element/tooltip";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo } from "react";

interface QueuedMessageCardProps {
    model: WaveAIModel;
}

export const QueuedMessageCard = memo(({ model }: QueuedMessageCardProps) => {
    const queuedSubmissions = useAtomValue(model.queuedSubmissionsAtom);

    if (queuedSubmissions.length === 0) return null;

    return (
        <div className="border-t border-white/[0.04] bg-black/[0.03] px-3 py-2">
            <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
                <span className="flex items-center gap-1.5">
                    <i className="fa fa-clock text-[10px]" />
                    <span>Queued ({queuedSubmissions.length})</span>
                </span>
                <button
                    className="text-zinc-500 transition-colors hover:text-red-300/70"
                    onClick={() => model.cancelAllQueuedSubmissions()}
                >
                    Cancel All
                </button>
            </div>
            <div className="flex flex-col gap-1.5">
                {queuedSubmissions.map((submission, index) => (
                    <div
                        key={submission.id}
                        className={cn(
                            "flex items-center gap-2 rounded-lg border bg-black/[0.08] px-3 py-2 text-[12px]",
                            submission.status === "sending"
                                ? "border-lime-300/10"
                                : "border-white/[0.04]"
                        )}
                    >
                        <span className="shrink-0 text-zinc-500">{index + 1}.</span>
                        <span className="min-w-0 flex-1 truncate text-zinc-300">
                            {submission.text || "(files only)"}
                        </span>
                        {submission.files.length > 0 && (
                            <span className="shrink-0 text-zinc-500">
                                <i className="fa fa-paperclip text-[9px]" />
                                {submission.files.length}
                            </span>
                        )}
                        <div className="flex shrink-0 gap-1">
                            <Tooltip content="Send now" placement="top">
                                <button
                                    className="flex h-5 w-5 items-center justify-center rounded text-lime-300/60 transition-colors hover:bg-lime-300/10 hover:text-lime-200"
                                    onClick={() => void model.sendQueuedSubmissionNow(submission.id)}
                                >
                                    <i className="fa fa-play text-[8px]" />
                                </button>
                            </Tooltip>
                            <Tooltip content="Cancel" placement="top">
                                <button
                                    className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-red-300/10 hover:text-red-300/70"
                                    onClick={() => model.cancelQueuedSubmission(submission.id)}
                                >
                                    <i className="fa fa-xmark text-[9px]" />
                                </button>
                            </Tooltip>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

QueuedMessageCard.displayName = "QueuedMessageCard";
