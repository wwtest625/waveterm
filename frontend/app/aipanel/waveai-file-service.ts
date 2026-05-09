// Copyright 2025, Command Platform Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as jotai from "jotai";
import { base64ToArrayBuffer } from "@/util/util";
import {
    createDataUrl,
    createImagePreview,
    formatFileSizeError,
    isAcceptableFile,
    normalizeMimeType,
    resizeImage,
    validateFileSizeFromInfo,
} from "./ai-utils";

export type DroppedFile = {
    id: string;
    file: File;
    name: string;
    type: string;
    size: number;
    previewUrl?: string;
};

type DispatchFn = (action: import("./waveai-actions").WaveAIAction) => void;
type SetErrorFn = (message: string) => void;

export class FileServiceModule {
    readonly droppedFiles: jotai.PrimitiveAtom<DroppedFile[]>;
    private dispatch: DispatchFn;
    private setError: SetErrorFn;

    constructor(dispatch: DispatchFn, setError: SetErrorFn) {
        this.dispatch = dispatch;
        this.setError = setError;
        this.droppedFiles = jotai.atom<DroppedFile[]>([]);
    }

    async addFile(file: File): Promise<DroppedFile> {
        const processedFile = await resizeImage(file);

        const droppedFile: DroppedFile = {
            id: crypto.randomUUID(),
            file: processedFile,
            name: processedFile.name,
            type: processedFile.type,
            size: processedFile.size,
        };

        if (processedFile.type.startsWith("image/")) {
            const previewDataUrl = await createImagePreview(processedFile);
            if (previewDataUrl) {
                droppedFile.previewUrl = previewDataUrl;
            }
        }

        const currentFiles = globalStore.get(this.droppedFiles);
        this.dispatch({ type: "SET_DROPPED_FILES", files: [...currentFiles, droppedFile] });

        return droppedFile;
    }

    async addFileFromRemoteUri(draggedFile: DraggedFile): Promise<void> {
        if (draggedFile.isDir) {
            this.setError("Cannot add directories to Wave AI. Please select a file.");
            return;
        }

        try {
            const fileInfo = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: draggedFile.uri } }, null);
            if (fileInfo.notfound) {
                this.setError(`File not found: ${draggedFile.relName}`);
                return;
            }
            if (fileInfo.isdir) {
                this.setError("Cannot add directories to Wave AI. Please select a file.");
                return;
            }

            const mimeType = fileInfo.mimetype || "application/octet-stream";
            const fileSize = fileInfo.size || 0;
            const sizeError = validateFileSizeFromInfo(draggedFile.relName, fileSize, mimeType);
            if (sizeError) {
                this.setError(formatFileSizeError(sizeError));
                return;
            }

            const fileData = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: draggedFile.uri } }, null);
            if (!fileData.data64) {
                this.setError(`Failed to read file: ${draggedFile.relName}`);
                return;
            }

            const buffer = base64ToArrayBuffer(fileData.data64);
            const file = new File([buffer], draggedFile.relName, { type: mimeType });
            if (!isAcceptableFile(file)) {
                this.setError(
                    `File type not supported: ${draggedFile.relName}. Supported: images, PDFs, and text/code files.`
                );
                return;
            }

            await this.addFile(file);
        } catch (error) {
            console.error("Error handling FILE_ITEM drop:", error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.setError(`Failed to add file: ${errorMsg}`);
        }
    }

    removeFile(fileId: string) {
        const currentFiles = globalStore.get(this.droppedFiles);
        const updatedFiles = currentFiles.filter((f) => f.id !== fileId);
        this.dispatch({ type: "SET_DROPPED_FILES", files: updatedFiles });
    }

    clearFiles() {
        const currentFiles = globalStore.get(this.droppedFiles);

        currentFiles.forEach((file) => {
            if (file.previewUrl) {
                URL.revokeObjectURL(file.previewUrl);
            }
        });

        this.dispatch({ type: "SET_DROPPED_FILES", files: [] });
    }
}
