import { isDev } from "@/util/isdev";

const storagePrefix = "waveterm:filebrowser-state:";

export type FileBrowserState = {
    viewMode: "tree" | "list";
    expandedPaths: string[];
    selectedPath: string;
    dirPath: string;
    listScrollPosition: number;
};

export function getFileBrowserStateKey(connection: string): string {
    return `${storagePrefix}${encodeURIComponent(connection || "local")}`;
}

export function loadFileBrowserState(storage: Pick<Storage, "getItem">, connection: string): FileBrowserState | null {
    const key = getFileBrowserStateKey(connection);
    const raw = storage.getItem(key);
    if (raw == null || raw.trim() === "") {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
            return null;
        }
        const result: FileBrowserState = {
            viewMode: parsed.viewMode === "list" ? "list" : "tree",
            expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths.filter((p: unknown) => typeof p === "string") : [],
            selectedPath: typeof parsed.selectedPath === "string" ? parsed.selectedPath : "",
            dirPath: typeof parsed.dirPath === "string" ? parsed.dirPath : "",
            listScrollPosition: typeof parsed.listScrollPosition === "number" ? parsed.listScrollPosition : 0,
        };
        if (isDev()) {
            console.log("[FileBrowserState] load: connection=%s dirPath=%s viewMode=%s expandedPaths=%d selectedPath=%s", connection, result.dirPath, result.viewMode, result.expandedPaths.length, result.selectedPath);
        }
        return result;
    } catch (e) {
        if (isDev()) {
            console.warn("[FileBrowserState] load parse error:", e);
        }
        return null;
    }
}

export function saveFileBrowserState(storage: Pick<Storage, "setItem">, connection: string, state: FileBrowserState): void {
    const key = getFileBrowserStateKey(connection);
    storage.setItem(key, JSON.stringify(state));
    if (isDev()) {
        console.log("[FileBrowserState] save: connection=%s dirPath=%s viewMode=%s expandedPaths=%d selectedPath=%s", connection, state.dirPath, state.viewMode, state.expandedPaths.length, state.selectedPath);
    }
}
