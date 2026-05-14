import { isDev } from "@/util/isdev";

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
        if (focusedBlock?.view === "term") {
            if (focusedBlock.connection != null && focusedBlock.connection !== "") {
                meta.connection = focusedBlock.connection;
            }
        }
        if (focusedBlock?.savedDirPath != null && focusedBlock.savedDirPath !== "") {
            if (isDev()) {
                console.log("[FileBrowserState] buildWidgetBlockDef: using savedDirPath=%s", focusedBlock.savedDirPath);
            }
            meta.file = focusedBlock.savedDirPath;
        } else if (focusedBlock?.view === "term") {
            if (focusedBlock.cwd != null && focusedBlock.cwd !== "") {
                meta.file = focusedBlock.cwd;
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

    if (meta.view === "sysinfo" && focusedBlock?.view === "term") {
        if (focusedBlock.connection != null && focusedBlock.connection !== "") {
            meta.connection = focusedBlock.connection;
        }
    }

    return {
        ...source,
        meta,
    };
}
