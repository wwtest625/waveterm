// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import { beforeEach, describe, expect, it } from "vitest";
import {
    clearTransferHistory,
    completeTransferTask,
    createTransferTask,
    failTransferTask,
    getTransferFolderPath,
    transferTasksAtom,
    updateTransferProgress,
} from "./transfer-store";

describe("transfer store", () => {
    beforeEach(() => {
        globalStore.set(transferTasksAtom, []);
    });

    it("tracks progress and completion", () => {
        const taskId = createTransferTask({
            name: "archive.zip",
            direction: "upload",
            totalBytes: 100,
        });

        updateTransferProgress(taskId, 50, 100);
        completeTransferTask(taskId, 100, 100);

        const [task] = globalStore.get(transferTasksAtom);
        expect(task.progress).toBe(100);
        expect(task.status).toBe("completed");
        expect(task.transferredBytes).toBe(100);
    });

    it("clears finished tasks but keeps running tasks", () => {
        const runningId = createTransferTask({
            name: "running.txt",
            direction: "upload",
            totalBytes: 100,
        });
        updateTransferProgress(runningId, 10, 100);

        const failedId = createTransferTask({
            name: "failed.txt",
            direction: "download",
        });
        failTransferTask(failedId, "boom");

        clearTransferHistory();

        const tasks = globalStore.get(transferTasksAtom);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(runningId);
    });

    it("derives local folder paths for completed downloads", () => {
        expect(getTransferFolderPath("C:\\Users\\demo\\Downloads\\file.txt")).toBe("C:\\Users\\demo\\Downloads");
        expect(getTransferFolderPath("/home/demo/Downloads/file.txt")).toBe("/home/demo/Downloads");
    });
});
