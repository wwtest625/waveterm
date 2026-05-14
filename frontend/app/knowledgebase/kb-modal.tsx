// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { TreeView, TreeNodeData } from "@/app/treeview/treeview";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock } from "@/app/store/global";
import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import {
    kbCreateFile,
    kbDelete,
    kbEnsureRoot,
    kbImportFile,
    kbListDir,
    kbMkdir,
    kbReadFile,
    kbRename,
    kbSearch,
} from "@/app/store/kb-api";
import { fireAndForget, makeIconClass } from "@/util/util";
import { useCallback, useMemo, useRef, useState } from "react";

function getParentPath(relPath: string): string {
    const parts = relPath.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
}

function getEntryName(relPath: string): string {
    const parts = relPath.split("/").filter(Boolean);
    return parts[parts.length - 1] || relPath;
}

const KbRootId = "kb://root";

function relPathFromId(id: string): string {
    if (id === KbRootId) return "";
    return id.replace("kb://", "");
}

function idFromRelPath(relPath: string): string {
    if (!relPath) return KbRootId;
    return "kb://" + relPath;
}

const initialNodes: Record<string, TreeNodeData> = {
    [KbRootId]: {
        id: KbRootId,
        label: "Knowledge Base",
        isDirectory: true,
        childrenStatus: "unloaded",
    },
};

type PendingAction =
    | { type: "newFile"; targetDir: string }
    | { type: "newFolder"; targetDir: string }
    | { type: "rename"; relPath: string; currentName: string }
    | { type: "delete"; relPath: string; name: string };

interface KnowledgeBaseModalProps {
    onClose: () => void;
}

const KnowledgeBaseModalV = ({ onClose }: KnowledgeBaseModalProps) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<TreeNodeData[] | null>(null);
    const [selectedDirPath, setSelectedDirPath] = useState("");
    const [itemCount, setItemCount] = useState(0);
    const [treeKey, setTreeKey] = useState(0);
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
    const [pendingValue, setPendingValue] = useState("");
    const [actionError, setActionError] = useState("");
    const pendingInputRef = useRef<HTMLInputElement>(null);

    const fetchDir = useCallback(async (id: string, limit: number) => {
        const relPath = relPathFromId(id);
        if (id === KbRootId) {
            await kbEnsureRoot();
        }
        const entries = await kbListDir(relPath);
        const nodes: TreeNodeData[] = entries.map((entry) => ({
            id: idFromRelPath(entry.relPath),
            parentId: id,
            label: entry.name,
            isDirectory: entry.type === "dir",
            path: entry.relPath,
            childrenStatus: entry.type === "dir" ? "unloaded" : "loaded",
        }));
        setItemCount(entries.length);
        return { nodes };
    }, []);

    const handleOpenFile = useCallback((id: string, node: TreeNodeData) => {
        const relPath = node.path ?? relPathFromId(id);
        if (!relPath) return;
        fireAndForget(async () => {
            const blockDef: BlockDef = {
                meta: {
                    view: "knowledgebase",
                    file: relPath,
                },
            };
            await createBlock(blockDef);
        });
        onClose();
    }, [onClose]);

    const handleSelectionChange = useCallback((id: string, node: TreeNodeData) => {
        if (node.isDirectory) {
            setSelectedDirPath(node.path ?? relPathFromId(id));
        } else {
            const parentPath = node.path ? getParentPath(node.path) : "";
            setSelectedDirPath(parentPath);
        }
    }, []);

    const confirmPendingAction = useCallback(() => {
        if (!pendingAction) return;
        const action = pendingAction;
        const value = pendingValue;
        setPendingAction(null);
        setPendingValue("");
        setActionError("");
        if (!value && action.type !== "delete") return;
        fireAndForget(async () => {
            try {
                await kbEnsureRoot();
                switch (action.type) {
                    case "newFile":
                        await kbCreateFile(action.targetDir, value, "");
                        break;
                    case "newFolder":
                        await kbMkdir(action.targetDir, value);
                        break;
                    case "rename":
                        if (value && value !== action.currentName) {
                            await kbRename(action.relPath, value);
                        }
                        break;
                    case "delete":
                        await kbDelete(action.relPath);
                        break;
                }
                setTreeKey((k) => k + 1);
            } catch (err) {
                console.error("[kb] action failed:", err);
                setActionError(err?.message || String(err));
            }
        });
    }, [pendingAction, pendingValue]);

    const cancelPendingAction = useCallback(() => {
        setPendingAction(null);
        setPendingValue("");
    }, []);

    const handlePendingKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                e.preventDefault();
                confirmPendingAction();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelPendingAction();
            }
        },
        [confirmPendingAction, cancelPendingAction]
    );

    const handleContextMenu = useCallback(
        (id: string, node: TreeNodeData, event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const relPath = node.path ?? relPathFromId(id);
            const isDir = node.isDirectory;
            const menu: ContextMenuItem[] = [];

            if (isDir) {
                menu.push(
                    {
                        label: "New File",
                        click: () => {
                            setPendingAction({ type: "newFile", targetDir: relPath });
                            setPendingValue("");
                            setTimeout(() => pendingInputRef.current?.focus(), 0);
                        },
                    },
                    {
                        label: "New Folder",
                        click: () => {
                            setPendingAction({ type: "newFolder", targetDir: relPath });
                            setPendingValue("");
                            setTimeout(() => pendingInputRef.current?.focus(), 0);
                        },
                    },
                    { type: "separator" },
                    {
                        label: "Rename",
                        click: () => {
                            const currentName = getEntryName(relPath);
                            setPendingAction({ type: "rename", relPath, currentName });
                            setPendingValue(currentName);
                            setTimeout(() => pendingInputRef.current?.focus(), 0);
                        },
                    },
                    {
                        label: "Delete",
                        click: () => {
                            const name = getEntryName(relPath);
                            setPendingAction({ type: "delete", relPath, name });
                            setPendingValue("");
                        },
                    }
                );
            } else {
                menu.push(
                    {
                        label: "Rename",
                        click: () => {
                            const currentName = getEntryName(relPath);
                            setPendingAction({ type: "rename", relPath, currentName });
                            setPendingValue(currentName);
                            setTimeout(() => pendingInputRef.current?.focus(), 0);
                        },
                    },
                    {
                        label: "Delete",
                        click: () => {
                            const name = getEntryName(relPath);
                            setPendingAction({ type: "delete", relPath, name });
                            setPendingValue("");
                        },
                    },
                    { type: "separator" },
                    {
                        label: "Add to AI Chat",
                        click: () => {
                            fireAndForget(async () => {
                                const result = await kbReadFile(relPath);
                                if (result.isImage || !result.content) return;
                                const fileName = relPath.split("/").pop() ?? relPath;
                                const contextText = `[KB: ${fileName}]\n\`\`\`\n${result.content}\n\`\`\``;
                                WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
                                const aiModel = WaveAIModel.getInstance();
                                globalStore.set(aiModel.inputAtom, contextText);
                                aiModel.focusInput();
                            });
                        },
                    }
                );
            }

            ContextMenuModel.getInstance().showContextMenu(menu, event);
        },
        []
    );

    const handleNewFile = useCallback(() => {
        setPendingAction({ type: "newFile", targetDir: selectedDirPath });
        setPendingValue("");
        setTimeout(() => pendingInputRef.current?.focus(), 0);
    }, [selectedDirPath]);

    const handleNewFolder = useCallback(() => {
        setPendingAction({ type: "newFolder", targetDir: selectedDirPath });
        setPendingValue("");
        setTimeout(() => pendingInputRef.current?.focus(), 0);
    }, [selectedDirPath]);

    const handleImport = useCallback(() => {
        fireAndForget(async () => {
            try {
                const { getApi } = await import("@/app/store/global");
                const files = await getApi().pickUploadFiles();
                await kbEnsureRoot();
                for (const file of files) {
                    await kbImportFile(file, selectedDirPath);
                }
                setTreeKey((k) => k + 1);
            } catch (err) {
                console.error("[kb] import failed:", err);
                setActionError(err?.message || String(err));
            }
        });
    }, [selectedDirPath]);

    const handleRefresh = useCallback(() => {
        setSearchQuery("");
        setSearchResults(null);
        setTreeKey((k) => k + 1);
    }, []);

    const handleSearch = useCallback(async (query: string) => {
        setSearchQuery(query);
        if (!query.trim()) {
            setSearchResults(null);
            return;
        }
        try {
            const results = await kbSearch(query);
            const nodes: TreeNodeData[] = results.map((r) => ({
                id: idFromRelPath(r.relPath),
                label: r.name,
                isDirectory: false,
                path: r.relPath,
            }));
            setSearchResults(nodes);
        } catch {
            setSearchResults(null);
        }
    }, []);

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Escape") {
                setSearchQuery("");
                setSearchResults(null);
            }
            if (e.key === "Enter") {
                handleSearch(searchQuery);
            }
        },
        [searchQuery, handleSearch]
    );

    const pendingActionLabel = useMemo(() => {
        if (!pendingAction) return null;
        switch (pendingAction.type) {
            case "newFile":
                return "New file name:";
            case "newFolder":
                return "New folder name:";
            case "rename":
                return "New name:";
            case "delete":
                return `Delete "${pendingAction.name}"?`;
        }
    }, [pendingAction]);

    return (
        <Modal className="kb-modal" onClose={onClose}>
            <div className="flex flex-col gap-3 w-full" style={{ width: 700, height: "70vh" }}>
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-foreground">Knowledge Base</h2>
                    <div className="flex items-center gap-2">
                        <button
                            className="flex items-center justify-center w-7 h-7 rounded hover:bg-hoverbg text-secondary hover:text-foreground"
                            title="New File"
                            onClick={handleNewFile}
                        >
                            <i className={makeIconClass("file-circle-plus", true)} />
                        </button>
                        <button
                            className="flex items-center justify-center w-7 h-7 rounded hover:bg-hoverbg text-secondary hover:text-foreground"
                            title="New Folder"
                            onClick={handleNewFolder}
                        >
                            <i className={makeIconClass("folder-plus", true)} />
                        </button>
                        <button
                            className="flex items-center justify-center w-7 h-7 rounded hover:bg-hoverbg text-secondary hover:text-foreground"
                            title="Import"
                            onClick={handleImport}
                        >
                            <i className={makeIconClass("file-import", true)} />
                        </button>
                        <button
                            className="flex items-center justify-center w-7 h-7 rounded hover:bg-hoverbg text-secondary hover:text-foreground"
                            title="Refresh"
                            onClick={handleRefresh}
                        >
                            <i className={makeIconClass("arrows-rotate", true)} />
                        </button>
                    </div>
                </div>
                {pendingAction && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-border bg-panel">
                        <span className="text-sm text-foreground whitespace-nowrap">{pendingActionLabel}</span>
                        {pendingAction.type === "delete" ? (
                            <>
                                <button
                                    className="px-2 py-0.5 text-sm rounded bg-red-600 text-white hover:bg-red-700"
                                    onClick={confirmPendingAction}
                                >
                                    Delete
                                </button>
                                <button
                                    className="px-2 py-0.5 text-sm rounded border border-border text-foreground hover:bg-hoverbg"
                                    onClick={cancelPendingAction}
                                >
                                    Cancel
                                </button>
                            </>
                        ) : (
                            <input
                                ref={pendingInputRef}
                                className="flex-1 bg-transparent border border-border rounded px-2 py-0.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
                                placeholder={
                                    pendingAction.type === "newFile"
                                        ? "File name"
                                        : pendingAction.type === "newFolder"
                                          ? "Folder name"
                                          : "New name"
                                }
                                value={pendingValue}
                                onChange={(e) => setPendingValue(e.target.value)}
                                onKeyDown={handlePendingKeyDown}
                                autoFocus
                            />
                        )}
                    </div>
                )}
                {actionError && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-red-500/50 bg-red-500/10 text-sm text-red-400">
                        <span className="flex-1">{actionError}</span>
                        <button
                            className="text-red-400 hover:text-red-300"
                            onClick={() => setActionError("")}
                        >
                            <i className={makeIconClass("xmark", true)} />
                        </button>
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <span className="text-secondary">
                        <i className={makeIconClass("magnifying-glass", true)} />
                    </span>
                    <input
                        className="flex-1 bg-transparent border border-border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            if (!e.target.value.trim()) {
                                setSearchResults(null);
                            }
                        }}
                        onKeyDown={handleSearchKeyDown}
                    />
                    {searchQuery && (
                        <button
                            className="text-secondary hover:text-foreground"
                            onClick={() => {
                                setSearchQuery("");
                                setSearchResults(null);
                            }}
                        >
                            <i className={makeIconClass("xmark", true)} />
                        </button>
                    )}
                </div>
                <div className="flex-1 overflow-hidden">
                    {searchResults ? (
                        <div className="h-full overflow-auto rounded-md border border-border bg-panel">
                            {searchResults.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-muted text-sm">
                                    No results found
                                </div>
                            ) : (
                                searchResults.map((node) => (
                                    <div
                                        key={node.id}
                                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted/50 cursor-pointer"
                                        onClick={() => {
                                            const relPath = node.path ?? relPathFromId(node.id);
                                            if (!relPath) return;
                                            fireAndForget(async () => {
                                                const blockDef: BlockDef = {
                                                    meta: {
                                                        view: "knowledgebase",
                                                        file: relPath,
                                                    },
                                                };
                                                await createBlock(blockDef);
                                            });
                                            onClose();
                                        }}
                                    >
                                        <i className={makeIconClass("file", true)} />
                                        <span>{node.label}</span>
                                        <span className="text-muted text-xs ml-auto">{node.path}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    ) : (
                        <TreeView
                            key={treeKey}
                            rootIds={[KbRootId]}
                            initialNodes={initialNodes}
                            fetchDir={fetchDir}
                            onOpenFile={handleOpenFile}
                            onSelectionChange={handleSelectionChange}
                            onContextMenu={handleContextMenu}
                            height="100%"
                            width="100%"
                            maxWidth={700}
                        />
                    )}
                </div>
                <div className="text-xs text-muted">
                    {searchResults ? `${searchResults.length} results` : `${itemCount} items`}
                </div>
            </div>
        </Modal>
    );
};

KnowledgeBaseModalV.displayName = "KnowledgeBaseModalV";

const KnowledgeBaseModal = () => {
    return <KnowledgeBaseModalV onClose={() => modalsModel.popModal()} />;
};

KnowledgeBaseModal.displayName = "KnowledgeBaseModal";

export { KnowledgeBaseModal, KnowledgeBaseModalV };
