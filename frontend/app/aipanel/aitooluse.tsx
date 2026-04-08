// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { recordTEvent } from "@/app/store/global";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import { WaveUIMessagePart } from "./aitypes";
import { formatCommandDuration } from "./command-duration";
import { RestoreBackupModal } from "./restorebackupmodal";
import { WaveAIModel } from "./waveai-model";

// matches pkg/filebackup/filebackup.go
const BackupRetentionDays = 5;

const ToolDisplayNames: Record<string, string> = {
    wave_run_command: "执行命令",
    wave_get_command_result: "获取结果",
    read_text_file: "读取文件",
    read_dir: "读取目录",
    write_text_file: "写入文件",
    edit_text_file: "精准编辑",
    term_get_scrollback: "读取终端输出",
    term_command_output: "读取命令输出",
};

export function getToolDisplayName(toolName?: string): string {
    if (!toolName) {
        return "执行步骤";
    }
    return ToolDisplayNames[toolName] ?? toolName.replace(/_/g, " ");
}

export function shouldHideProgressStatusLines(toolName?: string): boolean {
    return toolName === "wave_get_command_result" || toolName === "term_command_output";
}

type ToolGroupSummary = {
    title: string;
    description?: string;
    toneClassName: string;
    iconClassName: string;
    icon: string;
    defaultExpanded: boolean;
    canRetry: boolean;
    needsApproval: boolean;
    hasDetails: boolean;
};

function normalizeSummaryDescription(value?: string | null): string | undefined {
    const text = value?.trim();
    if (!text) {
        return undefined;
    }
    return text.replace(/\s+/g, " ");
}

function getRunningSummaryDescription(
    lastProgressLine: string | undefined,
    primaryDescription: string | undefined
): string {
    const baseDescription = normalizeSummaryDescription(lastProgressLine) ?? primaryDescription;
    if (baseDescription) {
        return `${baseDescription}，后台继续刷新`;
    }
    return "已返回最新快照，后台继续刷新";
}

function summarizeErrorMessage(toolName: string | undefined, message?: string | null): string | undefined {
    const text = normalizeSummaryDescription(message);
    if (!text) {
        return undefined;
    }
    if (toolName === "wave_run_command" && text.includes("failed to start remote job")) {
        return "远端命令启动失败";
    }
    if (toolName === "wave_get_command_result" && text.includes("job not found")) {
        return "执行结果不存在或已失效";
    }
    if (toolName === "wave_get_command_result" && text.includes("command result polling timed out")) {
        return "后台轮询超时";
    }
    if (toolName === "wave_get_command_result" && text.includes("command result polling canceled")) {
        return "后台轮询已取消";
    }
    if (text.length > 120) {
        return `${text.slice(0, 120)}...`;
    }
    return text;
}

export function summarizeToolGroup(
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }>,
    isStreaming: boolean
): ToolGroupSummary {
    const tooluseParts = parts.filter((part) => part.type === "data-tooluse") as Array<
        WaveUIMessagePart & { type: "data-tooluse" }
    >;
    const progressParts = parts.filter((part) => part.type === "data-toolprogress") as Array<
        WaveUIMessagePart & { type: "data-toolprogress" }
    >;
    const firstToolUse = tooluseParts[0];
    const lastToolUse = tooluseParts[tooluseParts.length - 1];
    const failedToolUse = tooluseParts.find(
        (part) =>
            part.data.status === "error" ||
            getEffectiveApprovalStatus(part.data.approval, isStreaming) === "timeout" ||
            part.data.approval === "user-denied"
    );
    const approvalToolUse = tooluseParts.find(
        (part) => getEffectiveApprovalStatus(part.data.approval, isStreaming) === "needs-approval"
    );
    const toolNames = tooluseParts.map((part) => part.data.toolname);
    const lastProgressLine = [...progressParts]
        .reverse()
        .flatMap((part) => [...(part.data.statuslines ?? [])].reverse())
        .find((line) => typeof line === "string" && line.trim().length > 0);
    const leadToolName = (() => {
        if (toolNames.some((toolName) => toolName === "wave_run_command")) {
            return "命令执行";
        }
        if (toolNames.some((toolName) => toolName === "edit_text_file")) {
            return "精准编辑";
        }
        if (toolNames.some((toolName) => toolName === "write_text_file")) {
            return "文件写入";
        }
        if (toolNames.some((toolName) => toolName === "read_text_file" || toolName === "read_dir")) {
            return "文件读取";
        }
        return getToolDisplayName(lastToolUse?.data.toolname ?? firstToolUse?.data.toolname);
    })();
    const primaryDescription =
        normalizeSummaryDescription(firstToolUse?.data.tooldesc) ??
        normalizeSummaryDescription(lastToolUse?.data.tooldesc) ??
        normalizeSummaryDescription(lastProgressLine);

    if (failedToolUse) {
        return {
            title: `${leadToolName}失败`,
            description:
                summarizeErrorMessage(failedToolUse.data.toolname, failedToolUse.data.errormessage) ??
                primaryDescription ??
                "执行未完成",
            toneClassName: "border-red-900/60 bg-red-950/20 text-red-100",
            iconClassName: "text-red-400",
            icon: "fa-circle-xmark",
            defaultExpanded: false,
            canRetry: true,
            needsApproval: false,
            hasDetails: parts.length > 1,
        };
    }

    if (approvalToolUse) {
        return {
            title: `${getToolDisplayName(approvalToolUse.data.toolname)}待确认`,
            description: normalizeSummaryDescription(approvalToolUse.data.tooldesc) ?? "等待批准后继续执行",
            toneClassName: "border-yellow-800/60 bg-yellow-950/20 text-yellow-100",
            iconClassName: "text-yellow-400",
            icon: "fa-clock",
            defaultExpanded: true,
            canRetry: false,
            needsApproval: true,
            hasDetails: parts.length > 1,
        };
    }

    if (
        isStreaming ||
        progressParts.length > 0 ||
        tooluseParts.some((part) => part.data.status === "pending" || part.data.status === "running")
    ) {
        const isLiveResult = tooluseParts.some((part) => part.data.status === "running");
        return {
            title: `${leadToolName}处理中`,
            description: isLiveResult
                ? getRunningSummaryDescription(lastProgressLine, primaryDescription)
                : (normalizeSummaryDescription(lastProgressLine) ?? primaryDescription ?? "正在执行"),
            toneClassName: "border-zinc-700 bg-zinc-900/60 text-zinc-100",
            iconClassName: isLiveResult ? "text-yellow-400" : "text-zinc-400",
            icon: isLiveResult ? "fa-bolt" : "fa-spinner fa-spin",
            defaultExpanded: true,
            canRetry: false,
            needsApproval: false,
            hasDetails: parts.length > 1,
        };
    }

    return {
        title: `${leadToolName}完成`,
        description: primaryDescription ?? "执行已完成",
        toneClassName: "border-zinc-700 bg-zinc-900/40 text-zinc-100",
        iconClassName: "text-emerald-400",
        icon: "fa-circle-check",
        defaultExpanded: false,
        canRetry: false,
        needsApproval: false,
        hasDetails: parts.length > 1,
    };
}

interface ToolDescLineProps {
    text: string;
}

const ToolDescLine = memo(({ text }: ToolDescLineProps) => {
    let displayText = text;
    if (displayText.startsWith("* ")) {
        displayText = "• " + displayText.slice(2);
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const regex = /(?<!\w)([+-])(\d+)(?!\w)/g;
    let match;

    while ((match = regex.exec(displayText)) !== null) {
        if (match.index > lastIndex) {
            parts.push(displayText.slice(lastIndex, match.index));
        }

        const sign = match[1];
        const number = match[2];
        const colorClass = sign === "+" ? "text-green-600" : "text-red-600";
        parts.push(
            <span key={match.index} className={colorClass}>
                {sign}
                {number}
            </span>
        );

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < displayText.length) {
        parts.push(displayText.slice(lastIndex));
    }

    return <div>{parts.length > 0 ? parts : displayText}</div>;
});

ToolDescLine.displayName = "ToolDescLine";

interface ToolDescProps {
    text: string | string[];
    className?: string;
}

const ToolDesc = memo(({ text, className }: ToolDescProps) => {
    const lines = Array.isArray(text) ? text : text.split("\n");

    if (lines.length === 0) return null;

    return (
        <div className={className}>
            {lines.map((line, idx) => (
                <ToolDescLine key={idx} text={line} />
            ))}
        </div>
    );
});

ToolDesc.displayName = "ToolDesc";

function getEffectiveApprovalStatus(baseApproval: string, isStreaming: boolean): string {
    return !isStreaming && baseApproval === "needs-approval" ? "timeout" : baseApproval;
}

interface AIToolApprovalButtonsProps {
    count: number;
    onApprove: () => void;
    onDeny: () => void;
}

const AIToolApprovalButtons = memo(({ count, onApprove, onDeny }: AIToolApprovalButtonsProps) => {
    const approveText = count > 1 ? `Approve All (${count})` : "Approve";
    const denyText = count > 1 ? "Deny All" : "Deny";

    return (
        <div className="mt-2 flex gap-2">
            <button
                onClick={onApprove}
                className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
            >
                {approveText}
            </button>
            <button
                onClick={onDeny}
                className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
            >
                {denyText}
            </button>
        </div>
    );
});

AIToolApprovalButtons.displayName = "AIToolApprovalButtons";

interface AIToolUseBatchItemProps {
    part: WaveUIMessagePart & { type: "data-tooluse" };
    effectiveApproval: string;
}

const AIToolUseBatchItem = memo(({ part, effectiveApproval }: AIToolUseBatchItemProps) => {
    const statusIcon =
        part.data.status === "completed"
            ? "✓"
            : part.data.status === "error"
              ? "✗"
              : part.data.status === "running"
                ? "↻"
                : "•";
    const statusColor =
        part.data.status === "completed"
            ? "text-success"
            : part.data.status === "error"
              ? "text-error"
              : part.data.status === "running"
                ? "text-yellow-400"
                : "text-gray-400";
    const effectiveErrorMessage = part.data.errormessage || (effectiveApproval === "timeout" ? "Not approved" : null);

    return (
        <div className="text-sm pl-2 flex items-start gap-1.5">
            <span className={cn("font-bold flex-shrink-0", statusColor)}>{statusIcon}</span>
            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-gray-400">{part.data.tooldesc}</span>
                    {part.data.durationms != null && part.data.durationms > 0 && (
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-300">
                            耗时 {formatCommandDuration(part.data.durationms)}
                        </span>
                    )}
                </div>
                {effectiveErrorMessage && <div className="text-red-300 mt-0.5">{effectiveErrorMessage}</div>}
            </div>
        </div>
    );
});

AIToolUseBatchItem.displayName = "AIToolUseBatchItem";

interface AIToolUseBatchProps {
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" }>;
    isStreaming: boolean;
}

const AIToolUseBatch = memo(({ parts, isStreaming }: AIToolUseBatchProps) => {
    const [userApprovalOverride, setUserApprovalOverride] = useState<string | null>(null);

    const firstTool = parts[0].data;
    const baseApproval = userApprovalOverride || firstTool.approval;
    const effectiveApproval = getEffectiveApprovalStatus(baseApproval, isStreaming);

    const handleApprove = () => {
        setUserApprovalOverride("user-approved");
        parts.forEach((part) => {
            WaveAIModel.getInstance().toolUseSendApproval(part.data.toolcallid, "user-approved");
        });
    };

    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        parts.forEach((part) => {
            WaveAIModel.getInstance().toolUseSendApproval(part.data.toolcallid, "user-denied");
        });
    };

    return (
        <div className="flex items-start gap-2 p-2 rounded bg-zinc-800/60 border border-zinc-700">
            <div className="flex-1">
                <div className="font-semibold">Reading Files</div>
                <div className="mt-1 space-y-0.5">
                    {parts.map((part, idx) => (
                        <AIToolUseBatchItem key={idx} part={part} effectiveApproval={effectiveApproval} />
                    ))}
                </div>
                {effectiveApproval === "needs-approval" && (
                    <AIToolApprovalButtons count={parts.length} onApprove={handleApprove} onDeny={handleDeny} />
                )}
            </div>
        </div>
    );
});

AIToolUseBatch.displayName = "AIToolUseBatch";

interface AIToolUseProps {
    part: WaveUIMessagePart & { type: "data-tooluse" };
    isStreaming: boolean;
}

const AIToolUse = memo(({ part, isStreaming }: AIToolUseProps) => {
    const toolData = part.data;
    const [userApprovalOverride, setUserApprovalOverride] = useState<string | null>(null);
    const model = WaveAIModel.getInstance();
    const restoreModalToolCallId = useAtomValue(model.restoreBackupModalToolCallId);
    const showRestoreModal = restoreModalToolCallId === toolData.toolcallid;
    const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const highlightedBlockIdRef = useRef<string | null>(null);

    const statusIcon =
        toolData.status === "completed"
            ? "✓"
            : toolData.status === "error"
              ? "✗"
              : toolData.status === "running"
                ? "↻"
                : "•";
    const statusColor =
        toolData.status === "completed"
            ? "text-success"
            : toolData.status === "error"
              ? "text-error"
              : toolData.status === "running"
                ? "text-yellow-400"
                : "text-gray-400";

    const baseApproval = userApprovalOverride || toolData.approval;
    const effectiveApproval = getEffectiveApprovalStatus(baseApproval, isStreaming);
    const approvalTimeoutDispatchedRef = useRef(false);

    const isFileWriteTool = toolData.toolname === "write_text_file" || toolData.toolname === "edit_text_file";

    useEffect(() => {
        if (effectiveApproval === "timeout" && !approvalTimeoutDispatchedRef.current) {
            approvalTimeoutDispatchedRef.current = true;
            model.dispatchAgentEvent({
                type: "APPROVAL_TIMEOUT",
                reason: `${toolData.toolname} was not approved before the stream ended`,
            });
        }
        if (effectiveApproval !== "timeout") {
            approvalTimeoutDispatchedRef.current = false;
        }
    }, [effectiveApproval, model, toolData.toolname]);

    useEffect(() => {
        return () => {
            if (highlightTimeoutRef.current) {
                clearTimeout(highlightTimeoutRef.current);
            }
        };
    }, []);

    const handleApprove = () => {
        setUserApprovalOverride("user-approved");
        WaveAIModel.getInstance().toolUseSendApproval(toolData.toolcallid, "user-approved");
    };

    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        WaveAIModel.getInstance().toolUseSendApproval(toolData.toolcallid, "user-denied");
    };

    const handleMouseEnter = () => {
        if (!toolData.blockid) return;

        if (highlightTimeoutRef.current) {
            clearTimeout(highlightTimeoutRef.current);
        }

        highlightedBlockIdRef.current = toolData.blockid;
        BlockModel.getInstance().setBlockHighlight({
            blockId: toolData.blockid,
            icon: "sparkles",
        });

        highlightTimeoutRef.current = setTimeout(() => {
            if (highlightedBlockIdRef.current === toolData.blockid) {
                BlockModel.getInstance().setBlockHighlight(null);
                highlightedBlockIdRef.current = null;
            }
        }, 2000);
    };

    const handleMouseLeave = () => {
        if (!toolData.blockid) return;

        if (highlightTimeoutRef.current) {
            clearTimeout(highlightTimeoutRef.current);
            highlightTimeoutRef.current = null;
        }

        if (highlightedBlockIdRef.current === toolData.blockid) {
            BlockModel.getInstance().setBlockHighlight(null);
            highlightedBlockIdRef.current = null;
        }
    };

    const handleOpenDiff = () => {
        recordTEvent("waveai:showdiff");
        fireAndForget(() => WaveAIModel.getInstance().openDiff(toolData.inputfilename, toolData.toolcallid));
    };

    return (
        <div
            className={cn("flex flex-col gap-1 p-2 rounded bg-zinc-800/60 border border-zinc-700", statusColor)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div className="flex items-center gap-2">
                <span className="font-bold">{statusIcon}</span>
                <div className="font-semibold">{toolData.toolname}</div>
                {toolData.durationms != null && toolData.durationms > 0 && (
                    <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-300">
                        耗时 {formatCommandDuration(toolData.durationms)}
                    </span>
                )}
                <div className="flex-1" />
                {isFileWriteTool &&
                    toolData.inputfilename &&
                    toolData.writebackupfilename &&
                    toolData.runts &&
                    Date.now() - toolData.runts < BackupRetentionDays * 24 * 60 * 60 * 1000 && (
                        <button
                            onClick={() => {
                                recordTEvent("waveai:revertfile", { "waveai:action": "revertfile:open" });
                                model.openRestoreBackupModal(toolData.toolcallid);
                            }}
                            className="flex-shrink-0 px-1.5 py-0.5 border border-zinc-600 hover:border-zinc-500 hover:bg-zinc-700 rounded cursor-pointer transition-colors flex items-center gap-1 text-zinc-400"
                            title="Restore backup file"
                        >
                            <span className="text-xs">Revert File</span>
                            <i className="fa fa-clock-rotate-left text-xs"></i>
                        </button>
                    )}
                {isFileWriteTool && toolData.inputfilename && (
                    <button
                        onClick={handleOpenDiff}
                        className="flex-shrink-0 px-1.5 py-0.5 border border-zinc-600 hover:border-zinc-500 hover:bg-zinc-700 rounded cursor-pointer transition-colors flex items-center gap-1 text-zinc-400"
                        title="Open in diff viewer"
                    >
                        <span className="text-xs">Show Diff</span>
                        <i className="fa fa-arrow-up-right-from-square text-xs"></i>
                    </button>
                )}
            </div>
            {toolData.tooldesc && <ToolDesc text={toolData.tooldesc} className="text-sm text-gray-400 pl-6" />}
            {(toolData.errormessage || effectiveApproval === "timeout") && (
                <div className="pl-6">
                    <div className="text-sm text-red-300">{toolData.errormessage || "Not approved"}</div>
                    <button
                        type="button"
                        className="mt-2 rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:border-zinc-400 cursor-pointer"
                        onClick={() => void model.retryLastAction("step")}
                    >
                        Retry this step
                    </button>
                </div>
            )}
            {effectiveApproval === "needs-approval" && (
                <div className="pl-6">
                    <AIToolApprovalButtons count={1} onApprove={handleApprove} onDeny={handleDeny} />
                </div>
            )}
            {showRestoreModal && <RestoreBackupModal part={part} />}
        </div>
    );
});

AIToolUse.displayName = "AIToolUse";

interface AIToolProgressProps {
    part: WaveUIMessagePart & { type: "data-toolprogress" };
}

const AIToolProgress = memo(({ part }: AIToolProgressProps) => {
    const progressData = part.data;

    return (
        <div className="flex flex-col gap-1 p-2 rounded bg-zinc-800/60 border border-zinc-700">
            <div className="flex items-center gap-2">
                <i className="fa fa-spinner fa-spin text-gray-400"></i>
                <div className="font-semibold">{progressData.toolname}</div>
            </div>
            {!shouldHideProgressStatusLines(progressData.toolname) &&
                progressData.statuslines &&
                progressData.statuslines.length > 0 && (
                    <ToolDesc text={progressData.statuslines} className="text-sm text-gray-400 pl-6 space-y-0.5" />
                )}
        </div>
    );
});

AIToolProgress.displayName = "AIToolProgress";

interface AIToolUseGroupProps {
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }>;
    isStreaming: boolean;
}

type ToolGroupItem =
    | { type: "batch"; parts: Array<WaveUIMessagePart & { type: "data-tooluse" }> }
    | { type: "single"; part: WaveUIMessagePart & { type: "data-tooluse" } }
    | { type: "progress"; part: WaveUIMessagePart & { type: "data-toolprogress" } };

export const AIToolUseGroup = memo(({ parts, isStreaming }: AIToolUseGroupProps) => {
    const model = WaveAIModel.getInstance();
    const tooluseParts = parts.filter((p) => p.type === "data-tooluse") as Array<
        WaveUIMessagePart & { type: "data-tooluse" }
    >;
    const toolprogressParts = parts.filter((p) => p.type === "data-toolprogress") as Array<
        WaveUIMessagePart & { type: "data-toolprogress" }
    >;

    const tooluseCallIds = new Set(tooluseParts.map((p) => p.data.toolcallid));
    const filteredProgressParts = toolprogressParts.filter((p) => !tooluseCallIds.has(p.data.toolcallid));
    const groupSummary = summarizeToolGroup(parts, isStreaming);
    const [detailsOpen, setDetailsOpen] = useState(groupSummary.defaultExpanded);
    const groupStateKey = parts
        .map((part) => {
            if (part.type === "data-tooluse") {
                return `${part.data.toolcallid}:${part.data.toolname}:${part.data.status}:${part.data.approval ?? ""}:${part.data.errormessage ?? ""}`;
            }
            return `${part.data.toolcallid}:${part.data.toolname}:${(part.data.statuslines ?? []).join("|")}`;
        })
        .join("||");

    const isFileOp = (part: WaveUIMessagePart & { type: "data-tooluse" }) => {
        const toolName = part.data?.toolname;
        return toolName === "read_text_file" || toolName === "read_dir";
    };

    const needsApproval = (part: WaveUIMessagePart & { type: "data-tooluse" }) => {
        return getEffectiveApprovalStatus(part.data?.approval, isStreaming) === "needs-approval";
    };

    const readFileNeedsApproval: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];
    const readFileOther: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];

    for (const part of tooluseParts) {
        if (isFileOp(part)) {
            if (needsApproval(part)) {
                readFileNeedsApproval.push(part);
            } else {
                readFileOther.push(part);
            }
        }
    }

    const groupedItems: ToolGroupItem[] = [];
    let addedApprovalBatch = false;
    let addedOtherBatch = false;

    for (const part of tooluseParts) {
        const isFileOpPart = isFileOp(part);
        const partNeedsApproval = needsApproval(part);

        if (isFileOpPart && partNeedsApproval) {
            if (!addedApprovalBatch) {
                groupedItems.push({ type: "batch", parts: readFileNeedsApproval });
                addedApprovalBatch = true;
            }
        } else if (isFileOpPart && !partNeedsApproval) {
            if (!addedOtherBatch) {
                groupedItems.push({ type: "batch", parts: readFileOther });
                addedOtherBatch = true;
            }
        } else {
            groupedItems.push({ type: "single", part });
        }
    }

    filteredProgressParts.forEach((part) => {
        groupedItems.push({ type: "progress", part });
    });

    useEffect(() => {
        setDetailsOpen(groupSummary.defaultExpanded);
    }, [groupStateKey, groupSummary.defaultExpanded]);

    return (
        <div className={cn("mt-2 rounded-xl border px-3 py-2", groupSummary.toneClassName)}>
            <div className="flex items-start gap-3">
                <i className={cn("fa mt-0.5 text-sm", groupSummary.icon, groupSummary.iconClassName)}></i>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="font-medium">{groupSummary.title}</div>
                            {groupSummary.description && (
                                <div className="mt-1 text-sm text-zinc-400 break-words">{groupSummary.description}</div>
                            )}
                        </div>
                        {groupSummary.hasDetails && (
                            <button
                                type="button"
                                className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 cursor-pointer"
                                onClick={() => setDetailsOpen((open) => !open)}
                            >
                                {detailsOpen ? "收起详情" : "查看详情"}
                            </button>
                        )}
                    </div>
                    {groupSummary.canRetry && (
                        <div className="mt-2">
                            <button
                                type="button"
                                className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:border-zinc-400 cursor-pointer"
                                onClick={() => void model.retryLastAction("step")}
                            >
                                Retry this step
                            </button>
                        </div>
                    )}
                    {detailsOpen && (
                        <div className="mt-3 border-t border-zinc-800/80 pt-3">
                            {groupedItems.map((item, idx) => {
                                if (item.type === "batch") {
                                    return (
                                        <div key={idx} className={idx === 0 ? "" : "mt-2"}>
                                            <AIToolUseBatch parts={item.parts} isStreaming={isStreaming} />
                                        </div>
                                    );
                                } else if (item.type === "progress") {
                                    return (
                                        <div key={idx} className={idx === 0 ? "" : "mt-2"}>
                                            <AIToolProgress part={item.part} />
                                        </div>
                                    );
                                } else {
                                    return (
                                        <div key={idx} className={idx === 0 ? "" : "mt-2"}>
                                            <AIToolUse part={item.part} isStreaming={isStreaming} />
                                        </div>
                                    );
                                }
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

AIToolUseGroup.displayName = "AIToolUseGroup";
