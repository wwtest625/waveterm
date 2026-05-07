// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type FocusedBlockContext = {
    view?: string;
    connection?: string;
    cwd?: string;
    savedDirPath?: string;
};

export function buildWidgetBlockDef(widget: WidgetConfigType, focusedBlock?: FocusedBlockContext): BlockDef {
    const source = widget.blockdef ?? {};
    const meta = { ...(source.meta ?? {}) };

    if (meta.view === "preview") {
        console.log("[FileBrowserState] buildWidgetBlockDef: preview widget, focusedBlock=", focusedBlock, "original meta.file=", meta.file);
        if (focusedBlock?.savedDirPath != null && focusedBlock.savedDirPath !== "") {
            console.log("[FileBrowserState] buildWidgetBlockDef: using savedDirPath=", focusedBlock.savedDirPath);
            meta.file = focusedBlock.savedDirPath;
        } else if (focusedBlock?.view === "term") {
            if (focusedBlock.connection != null && focusedBlock.connection !== "") {
                meta.connection = focusedBlock.connection;
            }
            if (focusedBlock.cwd != null && focusedBlock.cwd !== "") {
                console.log("[FileBrowserState] buildWidgetBlockDef: using terminal cwd=", focusedBlock.cwd);
                meta.file = focusedBlock.cwd;
            }
        }
        console.log("[FileBrowserState] buildWidgetBlockDef: final meta.file=", meta.file, "meta.connection=", meta.connection);
    }

    if (meta.view === "docker" && focusedBlock?.view === "term") {
        if (focusedBlock.connection != null && focusedBlock.connection !== "") {
            meta.connection = focusedBlock.connection;
        }
    }

    if (meta.view === "network" && focusedBlock?.view === "term") {
        if (focusedBlock.connection != null && focusedBlock.connection !== "") {
            meta.connection = focusedBlock.connection;
        }
    }

    if (meta.view === "tmux" && focusedBlock?.view === "term") {
        if (focusedBlock.connection != null && focusedBlock.connection !== "") {
            meta.connection = focusedBlock.connection;
        }
        if (focusedBlock.cwd != null && focusedBlock.cwd !== "") {
            meta["cmd:cwd"] = focusedBlock.cwd;
        }
    }

    return {
        ...source,
        meta,
    };
}
