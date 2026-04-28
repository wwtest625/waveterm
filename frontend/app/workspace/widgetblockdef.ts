// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type FocusedBlockContext = {
    view?: string;
    connection?: string;
    cwd?: string;
    previewDefaultDir?: string;
};

export function buildWidgetBlockDef(widget: WidgetConfigType, focusedBlock?: FocusedBlockContext): BlockDef {
    const source = widget.blockdef ?? {};
    const meta = { ...(source.meta ?? {}) };

    if (meta.view === "preview") {
        if (focusedBlock?.view === "term") {
            if (focusedBlock.connection != null && focusedBlock.connection !== "") {
                meta.connection = focusedBlock.connection;
            }
            if (focusedBlock.cwd != null && focusedBlock.cwd !== "") {
                meta.file = focusedBlock.cwd;
            } else if (
                focusedBlock.previewDefaultDir != null &&
                focusedBlock.previewDefaultDir !== ""
            ) {
                meta.file = focusedBlock.previewDefaultDir;
            }
        } else if (focusedBlock?.previewDefaultDir != null && focusedBlock.previewDefaultDir !== "") {
            if (meta.file == null || meta.file === "~") {
                meta.file = focusedBlock.previewDefaultDir;
            }
        }
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
