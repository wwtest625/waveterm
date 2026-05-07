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
    console.log("[FileBrowserState] loadFileBrowserState called, connection=", connection, "key=", key, "raw=", raw);
    if (raw == null || raw.trim() === "") {
        console.log("[FileBrowserState] loadFileBrowserState: no saved state found");
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
            console.log("[FileBrowserState] loadFileBrowserState: parsed value is not an object");
            return null;
        }
        const result: FileBrowserState = {
            viewMode: parsed.viewMode === "list" ? "list" : "tree",
            expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths.filter((p: unknown) => typeof p === "string") : [],
            selectedPath: typeof parsed.selectedPath === "string" ? parsed.selectedPath : "",
            dirPath: typeof parsed.dirPath === "string" ? parsed.dirPath : "",
            listScrollPosition: typeof parsed.listScrollPosition === "number" ? parsed.listScrollPosition : 0,
        };
        console.log("[FileBrowserState] loadFileBrowserState: loaded state=", result);
        return result;
    } catch (e) {
        console.log("[FileBrowserState] loadFileBrowserState: parse error=", e);
        return null;
    }
}

export function saveFileBrowserState(storage: Pick<Storage, "setItem">, connection: string, state: FileBrowserState): void {
    const key = getFileBrowserStateKey(connection);
    const json = JSON.stringify(state);
    console.log("[FileBrowserState] saveFileBrowserState called, connection=", connection, "key=", key, "state=", state);
    storage.setItem(key, json);
}
