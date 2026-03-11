// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getActiveTabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { callBackendService } from "@/app/store/wos";
import { createBlock, getApi, globalStore, refocusNode, WOS } from "@/app/store/global";
import { fireAndForget } from "@/util/util";
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
    file?: File;
    localPath?: string;
    name: string;
    size?: number;
    connection?: string;
    targetPath: string;
    resolveRemotePath: (targetPath: string) => Promise<string>;
    onCompleted?: () => void;
};

type FileWithPath = File & { path?: string; webkitRelativePath?: string };

type LocalFileInfo = {
    path?: string;
    name?: string;
    size?: number;
};

type LocalFileChunk = {
    data64?: string;
    size?: number;
};

type UploadSource = {
    name: string;
    sourcePath: string;
    size: number;
    readChunk: (offset: number, chunkSize: number) => Promise<LocalFileChunk>;
};

type BufferedUploadSource = UploadSource & {
    bytes?: Uint8Array;
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
let ensureTransferViewOpenPromise: Promise<void> | null = null;
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

function ensureTransferViewOpen(): void {
    if (ensureTransferViewOpenPromise != null) {
        return;
    }
    ensureTransferViewOpenPromise = (async () => {
        const tabModel = getActiveTabModel();
        if (tabModel == null) {
            return;
        }
        const tabData = globalStore.get(tabModel.tabAtom);
        for (const blockId of tabData?.blockids ?? []) {
            const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
            const blockData = globalStore.get(blockAtom);
            if (blockData?.meta?.view === "transfer") {
                refocusNode(blockId);
                return;
            }
        }
        await createBlock({ meta: { view: "transfer" } }, false, true);
    })().finally(() => {
        ensureTransferViewOpenPromise = null;
    });
    fireAndForget(() => ensureTransferViewOpenPromise);
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
    ensureTransferViewOpen();
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

export function getTransferFolderPath(targetPath?: string): string | null {
    if (targetPath == null || targetPath.trim() === "") {
        return null;
    }
    const normalizedPath = targetPath.replace(/[\\/]+$/, "");
    const lastSeparatorIndex = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
    if (lastSeparatorIndex < 0) {
        return null;
    }
    if (lastSeparatorIndex === 0) {
        return normalizedPath.slice(0, 1);
    }
    return normalizedPath.slice(0, lastSeparatorIndex);
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

function getFileSourcePath(file: FileWithPath): string {
    return file.path || file.webkitRelativePath || file.name;
}

async function createUploadSource(input: UploadTransferInput): Promise<UploadSource> {
    const fileWithPath = input.file as FileWithPath | undefined;
    const localPath = input.localPath ?? fileWithPath?.path;
    if (localPath != null && localPath !== "") {
        const localInfo = (await callBackendService("client", "StatLocalFile", [localPath])) as LocalFileInfo;
        const localSize = Number(localInfo?.size ?? input.size ?? 0);
        return {
            name: localInfo?.name || input.name,
            sourcePath: localInfo?.path || localPath,
            size: localSize,
            readChunk: async (offset: number, chunkSize: number) =>
                ((await callBackendService("client", "ReadLocalFileChunk", [localPath, offset, chunkSize])) as LocalFileChunk) ?? {
                    data64: "",
                    size: 0,
                },
        };
    }
    if (input.file == null) {
        throw new Error("upload file source is missing");
    }
    if (input.file.size === 0) {
        const bytes = new Uint8Array(await input.file.arrayBuffer());
        if (bytes.length > 0) {
            const bufferedSource: BufferedUploadSource = {
                name: input.name,
                sourcePath: getFileSourcePath(fileWithPath ?? input.file),
                size: bytes.length,
                bytes,
                readChunk: async (offset: number, chunkSize: number) => {
                    const chunk = bytes.slice(offset, offset + chunkSize);
                    return {
                        data64: base64.fromByteArray(chunk),
                        size: chunk.length,
                    };
                },
            };
            return bufferedSource;
        }
    }
    return {
        name: input.name,
        sourcePath: getFileSourcePath(fileWithPath ?? input.file),
        size: input.file.size,
        readChunk: async (offset: number, chunkSize: number) => {
            const chunk = input.file.slice(offset, offset + chunkSize);
            return {
                data64: await blobToBase64(chunk),
                size: chunk.size,
            };
        },
    };
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

async function uploadViaSshService(input: UploadTransferInput, transferId: string, source: UploadSource): Promise<void> {
    const uploadIdRaw = await callBackendService("client", "StartSSHUpload", [input.connection, input.targetPath, true]);
    const uploadId = String(uploadIdRaw ?? "");
    if (uploadId === "") {
        throw new Error("failed to start ssh upload session");
    }

    try {
        let offset = 0;
        while (offset < source.size) {
            const chunk = await source.readChunk(offset, SshUploadChunkSize);
            const chunkSize = Number(chunk.size ?? 0);
            const data64 = String(chunk.data64 ?? "");
            if (chunkSize <= 0) {
                throw new Error(`local upload source ended early at ${offset} / ${source.size} bytes`);
            }
            await callBackendService("client", "AppendSSHUpload", [uploadId, data64]);
            offset += chunkSize;
            updateTransferProgress(transferId, offset, source.size);
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
    const source = await createUploadSource(input);
    const transferId = createTransferTask({
        name: source.name,
        direction: "upload",
        connection: input.connection,
        sourcePath: source.sourcePath,
        targetPath: input.targetPath,
        totalBytes: source.size,
        status: "running",
    });

    try {
        if (canUseSshUpload(input.connection)) {
            await uploadViaSshService(input, transferId, source);
            completeTransferTask(transferId, source.size, source.size);
            input.onCompleted?.();
            return transferId;
        }

        const remotePath = await input.resolveRemotePath(input.targetPath);
        await RpcApi.FileWriteCommand(TabRpcClient, { info: { path: remotePath }, data64: "" }, { timeout: UploadRpcTimeoutMs });

        if (source.size === 0) {
            completeTransferTask(transferId, 0, 0);
            return transferId;
        }

        const chunkSize = UploadChunkSize;
        let offset = 0;

        while (offset < source.size) {
            const chunk = await source.readChunk(offset, chunkSize);
            const bytesRead = Number(chunk.size ?? 0);
            const data64 = String(chunk.data64 ?? "");
            if (bytesRead <= 0) {
                throw new Error(`local upload source ended early at ${offset} / ${source.size} bytes`);
            }
            await RpcApi.FileAppendCommand(TabRpcClient, { info: { path: remotePath }, data64 }, { timeout: UploadRpcTimeoutMs });
            offset += bytesRead;
            updateTransferProgress(transferId, offset, source.size);
        }

        completeTransferTask(transferId, source.size, source.size);
        input.onCompleted?.();
        return transferId;
    } catch (error) {
        failTransferTask(transferId, error instanceof Error ? error.message : String(error));
        throw error;
    }
}
