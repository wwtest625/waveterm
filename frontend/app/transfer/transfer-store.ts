// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { callBackendService } from "@/app/store/wos";
import { getApi, globalStore } from "@/app/store/global";
import base64 from "base64-js";
import { atom } from "jotai";

export type TransferDirection = "upload" | "download";
export type TransferStatus = "pending" | "running" | "completed" | "error" | "cancelled";

export type TransferTask = {
    id: string;
    name: string;
    direction: TransferDirection;
    status: TransferStatus;
    connection?: string;
    sourcePath?: string;
    targetPath?: string;
    transferredBytes: number;
    totalBytes?: number;
    progress: number;
    speedBytesPerSecond: number;
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    errorMessage?: string;
    lastSampleBytes: number;
    lastSampleTime: number;
};

type CreateTransferTaskInput = {
    name: string;
    direction: TransferDirection;
    connection?: string;
    sourcePath?: string;
    targetPath?: string;
    totalBytes?: number;
    status?: TransferStatus;
};

type DownloadTransferInput = {
    remoteUri: string;
    connection?: string;
    name: string;
    sourcePath?: string;
    targetPath?: string;
};

type UploadTransferInput = {
    file: File;
    connection?: string;
    targetPath: string;
    resolveRemotePath: (targetPath: string) => Promise<string>;
};

type DownloadTransferEvent = {
    taskId: string;
    phase: "progress" | "done";
    status?: "running" | "success" | "error" | "cancelled";
    name?: string;
    sourcePath?: string;
    targetPath?: string;
    transferredBytes?: number;
    totalBytes?: number;
    error?: string;
};

export const transferTasksAtom = atom<TransferTask[]>([]);

let transferSeq = 0;
let downloadListenerInstalled = false;
const UploadChunkSize = 256 * 1024;
const SshUploadChunkSize = 1024 * 1024;
const UploadRpcTimeoutMs = 60000;

function nowMs(): number {
    return Date.now();
}

function nextTransferId(): string {
    transferSeq += 1;
    return `transfer-${nowMs()}-${transferSeq}`;
}

function calculateProgress(transferredBytes: number, totalBytes?: number): number {
    if (totalBytes == null || totalBytes <= 0) {
        return transferredBytes > 0 ? 100 : 0;
    }
    return Math.max(0, Math.min(100, (transferredBytes / totalBytes) * 100));
}

function updateTransferTask(taskId: string, updater: (task: TransferTask) => TransferTask): void {
    globalStore.set(transferTasksAtom, (tasks) => tasks.map((task) => (task.id === taskId ? updater(task) : task)));
}

function applyProgressUpdate(task: TransferTask, transferredBytes: number, totalBytes?: number): TransferTask {
    const currentTime = nowMs();
    const elapsedMs = Math.max(currentTime - task.lastSampleTime, 1);
    const deltaBytes = Math.max(transferredBytes - task.lastSampleBytes, 0);
    const instantaneousSpeed = deltaBytes > 0 ? (deltaBytes * 1000) / elapsedMs : task.speedBytesPerSecond;

    return {
        ...task,
        status: transferredBytes >= (totalBytes ?? transferredBytes) ? task.status : "running",
        transferredBytes,
        totalBytes: totalBytes ?? task.totalBytes,
        progress: calculateProgress(transferredBytes, totalBytes ?? task.totalBytes),
        speedBytesPerSecond: instantaneousSpeed,
        updatedAt: currentTime,
        lastSampleBytes: transferredBytes,
        lastSampleTime: currentTime,
    };
}

export function createTransferTask(input: CreateTransferTaskInput): string {
    const currentTime = nowMs();
    const taskId = nextTransferId();
    const totalBytes = input.totalBytes;
    const transferredBytes = 0;
    const task: TransferTask = {
        id: taskId,
        name: input.name,
        direction: input.direction,
        status: input.status ?? "pending",
        connection: input.connection,
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
        transferredBytes,
        totalBytes,
        progress: calculateProgress(transferredBytes, totalBytes),
        speedBytesPerSecond: 0,
        startedAt: currentTime,
        updatedAt: currentTime,
        lastSampleBytes: 0,
        lastSampleTime: currentTime,
    };
    globalStore.set(transferTasksAtom, (tasks) => [task, ...tasks]);
    return taskId;
}

export function markTransferRunning(taskId: string, totalBytes?: number): void {
    updateTransferTask(taskId, (task) => ({
        ...task,
        status: "running",
        totalBytes: totalBytes ?? task.totalBytes,
        updatedAt: nowMs(),
    }));
}

export function updateTransferProgress(taskId: string, transferredBytes: number, totalBytes?: number): void {
    updateTransferTask(taskId, (task) => applyProgressUpdate(task, transferredBytes, totalBytes));
}

export function completeTransferTask(taskId: string, transferredBytes?: number, totalBytes?: number): void {
    updateTransferTask(taskId, (task) => {
        const effectiveTransferred = transferredBytes ?? totalBytes ?? task.totalBytes ?? task.transferredBytes;
        const nextTask = applyProgressUpdate(task, effectiveTransferred, totalBytes ?? task.totalBytes);
        return {
            ...nextTask,
            status: "completed",
            progress: 100,
            speedBytesPerSecond: 0,
            endedAt: nowMs(),
        };
    });
}

export function failTransferTask(taskId: string, errorMessage: string): void {
    updateTransferTask(taskId, (task) => ({
        ...task,
        status: "error",
        errorMessage,
        speedBytesPerSecond: 0,
        updatedAt: nowMs(),
        endedAt: nowMs(),
    }));
}

export function cancelTransferTask(taskId: string, errorMessage?: string): void {
    updateTransferTask(taskId, (task) => ({
        ...task,
        status: "cancelled",
        errorMessage,
        speedBytesPerSecond: 0,
        updatedAt: nowMs(),
        endedAt: nowMs(),
    }));
}

export function clearTransferHistory(): void {
    globalStore.set(transferTasksAtom, (tasks) => tasks.filter((task) => task.status === "pending" || task.status === "running"));
}

export function clearAllTransfers(): void {
    globalStore.set(transferTasksAtom, []);
}

export function removeTransferTask(taskId: string): void {
    globalStore.set(transferTasksAtom, (tasks) => tasks.filter((task) => task.id !== taskId));
}

export function formatTransferBytes(bytes?: number): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
        return "-";
    }
    if (bytes < 1024) {
        return `${bytes}B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function handleDownloadTransferEvent(event: DownloadTransferEvent): void {
    if (event.taskId == null) {
        return;
    }
    if (event.phase === "progress") {
        updateTransferTask(event.taskId, (task) => ({
            ...task,
            name: event.name || task.name,
            sourcePath: event.sourcePath || task.sourcePath,
            targetPath: event.targetPath || task.targetPath,
            status: "running",
            totalBytes: event.totalBytes ?? task.totalBytes,
            updatedAt: nowMs(),
        }));
        updateTransferProgress(event.taskId, event.transferredBytes ?? 0, event.totalBytes);
        return;
    }
    if (event.status === "success") {
        completeTransferTask(event.taskId, event.transferredBytes, event.totalBytes);
        return;
    }
    if (event.status === "cancelled") {
        cancelTransferTask(event.taskId, event.error);
        return;
    }
    failTransferTask(event.taskId, event.error || "Download failed");
}

function ensureDownloadListener(): void {
    if (downloadListenerInstalled) {
        return;
    }
    try {
        getApi().onDownloadTransferEvent((event) => {
            handleDownloadTransferEvent(event as DownloadTransferEvent);
        });
        downloadListenerInstalled = true;
    } catch (error) {
        console.warn("Failed to install download transfer listener", error);
    }
}

export function startDownloadTransfer(input: DownloadTransferInput): string {
    ensureDownloadListener();
    const transferId = createTransferTask({
        name: input.name,
        direction: "download",
        connection: input.connection,
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
        status: "pending",
    });
    try {
        getApi().downloadFile(input.remoteUri, transferId);
    } catch (error) {
        failTransferTask(transferId, error instanceof Error ? error.message : String(error));
    }
    return transferId;
}

async function blobToBase64(blob: Blob): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer();
    return base64.fromByteArray(new Uint8Array(arrayBuffer));
}

function canUseSshUpload(connection?: string): boolean {
    if (connection == null || connection.trim() === "") {
        return false;
    }
    if (connection === "local") {
        return false;
    }
    if (connection.startsWith("wsl://")) {
        return false;
    }
    return true;
}

async function uploadViaSshService(input: UploadTransferInput, transferId: string): Promise<void> {
    const uploadIdRaw = await callBackendService("client", "StartSSHUpload", [input.connection, input.targetPath, true]);
    const uploadId = String(uploadIdRaw ?? "");
    if (uploadId === "") {
        throw new Error("failed to start ssh upload session");
    }

    try {
        let offset = 0;
        while (offset < input.file.size) {
            const chunk = input.file.slice(offset, offset + SshUploadChunkSize);
            const data64 = await blobToBase64(chunk);
            await callBackendService("client", "AppendSSHUpload", [uploadId, data64]);
            offset += chunk.size;
            updateTransferProgress(transferId, offset, input.file.size);
        }
        await callBackendService("client", "FinishSSHUpload", [uploadId, false]);
    } catch (error) {
        try {
            await callBackendService("client", "FinishSSHUpload", [uploadId, true]);
        } catch (cancelError) {
            console.warn("failed to cancel ssh upload session", cancelError);
        }
        throw error;
    }
}

export async function uploadFileWithTransfer(input: UploadTransferInput): Promise<string> {
    const transferId = createTransferTask({
        name: input.file.name,
        direction: "upload",
        connection: input.connection,
        sourcePath: (input.file as File & { path?: string; webkitRelativePath?: string }).path || input.file.name,
        targetPath: input.targetPath,
        totalBytes: input.file.size,
        status: "running",
    });

    try {
        if (canUseSshUpload(input.connection)) {
            await uploadViaSshService(input, transferId);
            completeTransferTask(transferId, input.file.size, input.file.size);
            return transferId;
        }

        const remotePath = await input.resolveRemotePath(input.targetPath);
        await RpcApi.FileWriteCommand(TabRpcClient, { info: { path: remotePath }, data64: "" }, { timeout: UploadRpcTimeoutMs });

        if (input.file.size === 0) {
            completeTransferTask(transferId, 0, 0);
            return transferId;
        }

        const chunkSize = UploadChunkSize;
        let offset = 0;

        while (offset < input.file.size) {
            const chunk = input.file.slice(offset, offset + chunkSize);
            const data64 = await blobToBase64(chunk);
            await RpcApi.FileAppendCommand(TabRpcClient, { info: { path: remotePath }, data64 }, { timeout: UploadRpcTimeoutMs });
            offset += chunk.size;
            updateTransferProgress(transferId, offset, input.file.size);
        }

        completeTransferTask(transferId, input.file.size, input.file.size);
        return transferId;
    } catch (error) {
        failTransferTask(transferId, error instanceof Error ? error.message : String(error));
        throw error;
    }
}
