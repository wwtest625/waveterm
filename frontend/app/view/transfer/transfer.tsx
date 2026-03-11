// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { clearTransferHistory, formatTransferBytes, getTransferFolderPath, removeTransferTask, transferTasksAtom, type TransferTask } from "@/app/transfer/transfer-store";
import { getApi } from "@/app/store/global";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import "./transfer.scss";
import type { TransferViewModel } from "./transfer-model";

type TransferFilter = "all" | "upload" | "download" | "running" | "completed";

const filterLabels: Record<TransferFilter, string> = {
    all: "\u5168\u90e8",
    upload: "\u4e0a\u4f20",
    download: "\u4e0b\u8f7d",
    running: "\u8fdb\u884c\u4e2d",
    completed: "\u5df2\u7ed3\u675f",
};

function formatSpeed(speedBytesPerSecond: number): string {
    if (!Number.isFinite(speedBytesPerSecond) || speedBytesPerSecond <= 0) {
        return "-";
    }
    return `${formatTransferBytes(speedBytesPerSecond)}/s`;
}

function formatProgress(task: TransferTask): string {
    const totalLabel = task.totalBytes != null ? formatTransferBytes(task.totalBytes) : "?";
    return `${formatTransferBytes(task.transferredBytes)} / ${totalLabel}`;
}

function getTaskStatusLabel(task: TransferTask): string {
    if (task.status === "pending") {
        return "\u7b49\u5f85\u4e2d";
    }
    if (task.status === "running") {
        return "\u4f20\u8f93\u4e2d";
    }
    if (task.status === "completed") {
        return "\u5df2\u5b8c\u6210";
    }
    if (task.status === "cancelled") {
        return "\u5df2\u53d6\u6d88";
    }
    return "\u5931\u8d25";
}

function getTaskDirectionLabel(task: TransferTask): string {
    return task.direction === "upload" ? "\u4e0a\u4f20" : "\u4e0b\u8f7d";
}

function getTaskIcon(task: TransferTask): string {
    if (task.status === "completed") {
        return "circle-check";
    }
    if (task.status === "error") {
        return "circle-xmark";
    }
    if (task.status === "cancelled") {
        return "ban";
    }
    return task.direction === "upload" ? "arrow-up-from-bracket" : "arrow-down-to-bracket";
}

function openTransferFolder(task: TransferTask): void {
    const folderPath = getTransferFolderPath(task.targetPath);
    if (folderPath == null) {
        return;
    }
    getApi().openNativePath(folderPath);
}

function filterTasks(tasks: TransferTask[], filter: TransferFilter): TransferTask[] {
    if (filter === "all") {
        return tasks;
    }
    if (filter === "upload" || filter === "download") {
        return tasks.filter((task) => task.direction === filter);
    }
    if (filter === "running") {
        return tasks.filter((task) => task.status === "pending" || task.status === "running");
    }
    return tasks.filter((task) => task.status === "completed" || task.status === "error" || task.status === "cancelled");
}

function TransferView({
    model: _model,
}: {
    model: TransferViewModel;
    blockId?: string;
    contentRef?: React.RefObject<HTMLDivElement>;
    blockRef?: React.RefObject<HTMLDivElement>;
}) {
    const tasks = useAtomValue(transferTasksAtom);
    const [filter, setFilter] = useState<TransferFilter>("all");

    const filteredTasks = useMemo(() => filterTasks(tasks, filter), [filter, tasks]);
    const runningCount = tasks.filter((task) => task.status === "pending" || task.status === "running").length;
    const uploadCount = tasks.filter((task) => task.direction === "upload").length;
    const downloadCount = tasks.filter((task) => task.direction === "download").length;
    const clearDisabled = !tasks.some((task) => task.status === "completed" || task.status === "error" || task.status === "cancelled");

    return (
        <div className="transfer-view">
            <div className="transfer-header">
                <div className="transfer-title">
                    <div className="transfer-title-text">{"\u4f20\u8f93\u7ba1\u7406"}</div>
                    <div className="transfer-summary">
                        {`\u4e0a\u4f20: ${uploadCount} \u00b7 \u4e0b\u8f7d: ${downloadCount} \u00b7 \u8fdb\u884c\u4e2d: ${runningCount}`}
                    </div>
                </div>
                <Button className="outline grey transfer-clear-button" disabled={clearDisabled} onClick={() => clearTransferHistory()}>
                    {"\u6e05\u7a7a\u5217\u8868"}
                </Button>
            </div>
            <div className="transfer-filters">
                {(Object.keys(filterLabels) as TransferFilter[]).map((key) => (
                    <button
                        key={key}
                        type="button"
                        className={clsx("transfer-filter", filter === key && "active")}
                        onClick={() => setFilter(key)}
                    >
                        {filterLabels[key]}
                    </button>
                ))}
            </div>
            {filteredTasks.length === 0 ? (
                <div className="transfer-empty">{"\u5f53\u524d\u6ca1\u6709\u53ef\u663e\u793a\u7684\u4f20\u8f93\u4efb\u52a1\u3002"}</div>
            ) : (
                <div className="transfer-list">
                    {filteredTasks.map((task) => (
                        <div key={task.id} className="transfer-card">
                            <div className="transfer-card-header">
                                <div className="transfer-card-main">
                                    <div className="transfer-card-icon">
                                        <i className={makeIconClass(getTaskIcon(task), true)} />
                                    </div>
                                    <div className="transfer-card-text">
                                        <div className="transfer-card-name">{task.name}</div>
                                        <div className="transfer-card-path">{task.targetPath || task.sourcePath || "-"}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {task.direction === "download" && task.status === "completed" && task.targetPath && (
                                        <button
                                            type="button"
                                            className="transfer-open-folder-button"
                                            title="打开下载文件夹"
                                            onClick={() => openTransferFolder(task)}
                                        >
                                            <i className={makeIconClass("folder-open", false)} />
                                            <span>打开文件夹</span>
                                        </button>
                                    )}
                                    <div className="transfer-direction">{getTaskDirectionLabel(task)}</div>
                                    {(task.status === "completed" || task.status === "error" || task.status === "cancelled") && (
                                        <button
                                            type="button"
                                            className="transfer-remove-button"
                                            title="\u79fb\u9664"
                                            onClick={() => removeTransferTask(task.id)}
                                        >
                                            <i className={makeIconClass("trash", false)} />
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="transfer-status-row">
                                <span>{formatProgress(task)}</span>
                                <span>{getTaskStatusLabel(task)}</span>
                            </div>
                            <div className="transfer-progress-bar">
                                <div className="transfer-progress-fill" style={{ width: `${task.progress}%` }} />
                            </div>
                            <div className="transfer-meta-row">
                                <span>{`\u8fdb\u5ea6 ${Math.round(task.progress)}%`}</span>
                                <span>{`\u901f\u5ea6 ${formatSpeed(task.speedBytesPerSecond)}`}</span>
                                {task.connection ? <span>{`\u8fde\u63a5 ${task.connection}`}</span> : null}
                            </div>
                            {task.errorMessage ? <div className="transfer-error">{task.errorMessage}</div> : null}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export { TransferView };
