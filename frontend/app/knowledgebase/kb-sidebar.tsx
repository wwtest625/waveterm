import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock } from "@/app/store/global";
import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { globalStore } from "@/app/store/jotaiStore";
import {
    kbCopy,
    kbCreateFile,
    kbDelete,
    kbEnsureRoot,
    kbImportFile,
    kbListDir,
    kbMkdir,
    kbMove,
    kbReadFile,
    kbRename,
} from "@/app/store/kb-api";
import {
    kbActiveFilePathAtom,
    kbExpandedPathsAtom,
    kbIsLoadingAtom,
    kbSearchQueryAtom,
    kbSelectedPathAtom,
    kbTreeDataAtom,
} from "@/app/store/kb-model";
import type { KbEntry } from "@/app/store/kb-model";
import { fireAndForget, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./kb-sidebar.scss";

type ClipboardData = {
    paths: string[];
    operation: "copy" | "cut";
};

type KbSidebarProps = {
    className?: string;
};

function getParentPath(relPath: string): string {
    const parts = relPath.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
}

function getEntryName(relPath: string): string {
    const parts = relPath.split("/").filter(Boolean);
    return parts[parts.length - 1] || relPath;
}

function getFileIcon(name: string): string {
    const ext = name.split(".").pop()?.toLocaleLowerCase() ?? "";
    if (["md", "txt", "log"].includes(ext)) return "file-lines";
    if (["js", "jsx", "ts", "tsx", "go", "py", "java", "c", "cpp", "h", "hpp", "json", "yaml", "yml"].includes(ext))
        return "file-code";
    if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "image";
    if (ext === "pdf") return "file-pdf";
    return "file";
}

function matchesSearch(name: string, query: string): boolean {
    return name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

const KbTreeNode = memo(
    ({
        entry,
        depth,
        expandedPaths,
        selectedPaths,
        renamingPath,
        renamingValue,
        searchQuery,
        dirCache,
        newItemPath,
        newItemType,
        newItemValue,
        onToggleExpand,
        onSelect,
        onOpen,
        onContextMenu,
        onRenameStart,
        onRenameConfirm,
        onRenameCancel,
        onRenameValueChange,
        onDragStart,
        onDragOver,
        onDrop,
        onNewItemValueChange,
        onNewItemConfirm,
        onNewItemCancel,
    }: {
        entry: KbEntry;
        depth: number;
        expandedPaths: Set<string>;
        selectedPaths: Set<string>;
        renamingPath: string | null;
        renamingValue: string;
        searchQuery: string;
        dirCache: Map<string, KbEntry[]>;
        newItemPath: string | null;
        newItemType: "file" | "dir" | null;
        newItemValue: string;
        onToggleExpand: (path: string) => void;
        onSelect: (path: string, ctrlKey: boolean) => void;
        onOpen: (path: string) => void;
        onContextMenu: (path: string | null, isDir: boolean, event: React.MouseEvent) => void;
        onRenameStart: (path: string) => void;
        onRenameConfirm: () => void;
        onRenameCancel: () => void;
        onRenameValueChange: (value: string) => void;
        onDragStart: (path: string, event: React.DragEvent) => void;
        onDragOver: (path: string, isDir: boolean, event: React.DragEvent) => void;
        onDrop: (path: string, event: React.DragEvent) => void;
        onNewItemValueChange: (value: string) => void;
        onNewItemConfirm: () => void;
        onNewItemCancel: () => void;
    }) => {
        const isDir = entry.type === "dir";
        const isExpanded = expandedPaths.has(entry.relPath);
        const isSelected = selectedPaths.has(entry.relPath);
        const isRenaming = renamingPath === entry.relPath;
        const name = getEntryName(entry.relPath);
        const icon = isDir ? (isExpanded ? "folder-open" : "folder") : getFileIcon(name);
        const children = isDir && isExpanded ? dirCache.get(entry.relPath) ?? [] : [];

        const filteredChildren = useMemo(() => {
            if (!searchQuery) return children;
            return children.filter((child) => {
                if (child.type === "dir") return true;
                return matchesSearch(getEntryName(child.relPath), searchQuery);
            });
        }, [children, searchQuery]);

        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    onRenameConfirm();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    onRenameCancel();
                }
            },
            [onRenameConfirm, onRenameCancel]
        );

        return (
            <>
                <div
                    className={clsx("kb-tree-node", isSelected && "selected", isDir && "directory")}
                    style={{ paddingLeft: depth * 16 }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect(entry.relPath, e.ctrlKey || e.metaKey);
                    }}
                    onDoubleClick={() => {
                        if (isDir) {
                            onToggleExpand(entry.relPath);
                        } else {
                            onOpen(entry.relPath);
                        }
                    }}
                    onContextMenu={(e) => onContextMenu(entry.relPath, isDir, e)}
                    draggable={!isRenaming}
                    onDragStart={(e) => onDragStart(entry.relPath, e)}
                    onDragOver={(e) => onDragOver(entry.relPath, isDir, e)}
                    onDrop={(e) => onDrop(entry.relPath, e)}
                >
                    {isDir && (
                        <button
                            className="kb-tree-chevron"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand(entry.relPath);
                            }}
                        >
                            <i
                                className={clsx(
                                    "fa-sharp fa-solid text-[11px]",
                                    isExpanded ? "fa-chevron-down" : "fa-chevron-right"
                                )}
                            />
                        </button>
                    )}
                    {!isDir && <span className="kb-tree-chevron-spacer" />}
                    <span className="kb-tree-icon">
                        <i className={makeIconClass(icon, true)} />
                    </span>
                    {isRenaming ? (
                        <input
                            className="kb-tree-rename-input"
                            value={renamingValue}
                            onChange={(e) => onRenameValueChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={onRenameConfirm}
                            autoFocus
                        />
                    ) : (
                        <span
                            className="kb-tree-label"
                            title={entry.relPath}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                onRenameStart(entry.relPath);
                            }}
                        >
                            {name}
                        </span>
                    )}
                </div>
                {isDir &&
                    isExpanded &&
                    filteredChildren.map((child) => (
                        <KbTreeNode
                            key={child.relPath}
                            entry={child}
                            depth={depth + 1}
                            expandedPaths={expandedPaths}
                            selectedPaths={selectedPaths}
                            renamingPath={renamingPath}
                            renamingValue={renamingValue}
                            searchQuery={searchQuery}
                            dirCache={dirCache}
                            newItemPath={newItemPath}
                            newItemType={newItemType}
                            newItemValue={newItemValue}
                            onToggleExpand={onToggleExpand}
                            onSelect={onSelect}
                            onOpen={onOpen}
                            onContextMenu={onContextMenu}
                            onRenameStart={onRenameStart}
                            onRenameConfirm={onRenameConfirm}
                            onRenameCancel={onRenameCancel}
                            onRenameValueChange={onRenameValueChange}
                            onDragStart={onDragStart}
                            onDragOver={onDragOver}
                            onDrop={onDrop}
                            onNewItemValueChange={onNewItemValueChange}
                            onNewItemConfirm={onNewItemConfirm}
                            onNewItemCancel={onNewItemCancel}
                        />
                    ))}
                {isDir && isExpanded && newItemPath === entry.relPath && newItemType && (
                    <div className="kb-tree-new-item" style={{ paddingLeft: (depth + 1) * 16 }}>
                        <span className="kb-tree-icon">
                            <i
                                className={makeIconClass(
                                    newItemType === "dir" ? "folder" : "file",
                                    true
                                )}
                            />
                        </span>
                        <input
                            className="kb-tree-rename-input"
                            value={newItemValue}
                            placeholder={newItemType === "dir" ? "Folder name" : "File name"}
                            onChange={(e) => onNewItemValueChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") onNewItemConfirm();
                                if (e.key === "Escape") onNewItemCancel();
                            }}
                            onBlur={onNewItemConfirm}
                            autoFocus
                        />
                    </div>
                )}
            </>
        );
    }
);

KbTreeNode.displayName = "KbTreeNode";

const KbSidebarComponent = ({ className }: KbSidebarProps) => {
    const [treeData, setTreeData] = useAtom(kbTreeDataAtom);
    const [selectedPath, setSelectedPath] = useAtom(kbSelectedPathAtom);
    const [expandedPaths, setExpandedPaths] = useAtom(kbExpandedPathsAtom);
    const [searchQuery, setSearchQuery] = useAtom(kbSearchQueryAtom);
    const setIsLoading = useSetAtom(kbIsLoadingAtom);
    const setActiveFilePath = useSetAtom(kbActiveFilePathAtom);
    const [dirCache, setDirCache] = useState<Map<string, KbEntry[]>>(new Map());
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [renamingPath, setRenamingPath] = useState<string | null>(null);
    const [renamingValue, setRenamingValue] = useState("");
    const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [newItemPath, setNewItemPath] = useState<string | null>(null);
    const [newItemType, setNewItemType] = useState<"file" | "dir" | null>(null);
    const [newItemValue, setNewItemValue] = useState("");
    const [sidebarWidth, setSidebarWidth] = useState(224);
    const [isResizing, setIsResizing] = useState(false);
    const treeRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const resizeStartXRef = useRef(0);
    const resizeStartWidthRef = useRef(0);
    const newItemConfirmingRef = useRef(false);

    const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);

    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        resizeStartXRef.current = e.clientX;
        resizeStartWidthRef.current = sidebarWidth;
    }, [sidebarWidth]);

    useEffect(() => {
        if (!isResizing) return;
        const handleMouseMove = (e: MouseEvent) => {
            const delta = resizeStartXRef.current - e.clientX;
            const newWidth = Math.min(Math.max(resizeStartWidthRef.current + delta, 180), 600);
            setSidebarWidth(newWidth);
        };
        const handleMouseUp = () => {
            setIsResizing(false);
        };
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isResizing]);

    const loadDirectory = useCallback(
        async (relPath: string): Promise<KbEntry[]> => {
            const entries = await kbListDir(relPath);
            setDirCache((prev) => {
                const next = new Map(prev);
                next.set(relPath, entries);
                return next;
            });
            return entries;
        },
        []
    );

    const refreshTree = useCallback(async () => {
        setIsLoading(true);
        try {
            await kbEnsureRoot();
            const rootEntries = await loadDirectory("");
            setTreeData(rootEntries);
            const currentExpanded = new Set(expandedPaths);
            for (const path of currentExpanded) {
                try {
                    await loadDirectory(path);
                } catch {
                    currentExpanded.delete(path);
                }
            }
            setExpandedPaths([...currentExpanded]);
        } catch (e) {
            console.error("Failed to refresh KB tree:", e);
        } finally {
            setIsLoading(false);
        }
    }, [loadDirectory, setTreeData, setIsLoading, setExpandedPaths, expandedPaths]);

    useEffect(() => {
        fireAndForget(refreshTree);
    }, []);

    const handleToggleExpand = useCallback(
        (path: string) => {
            setExpandedPaths((prev) => {
                const set = new Set(prev);
                if (set.has(path)) {
                    set.delete(path);
                } else {
                    set.add(path);
                    if (!dirCache.has(path)) {
                        fireAndForget(async () => {
                            await loadDirectory(path);
                        });
                    }
                }
                return [...set];
            });
        },
        [dirCache, loadDirectory, setExpandedPaths]
    );

    const handleSelect = useCallback(
        (path: string, ctrlKey: boolean) => {
            if (ctrlKey) {
                setSelectedPaths((prev) => {
                    const next = new Set(prev);
                    if (next.has(path)) {
                        next.delete(path);
                    } else {
                        next.add(path);
                    }
                    return next;
                });
            } else {
                setSelectedPaths(new Set([path]));
            }
            setSelectedPath(path);
        },
        [setSelectedPath]
    );

    const handleOpen = useCallback(
        (path: string) => {
            setSelectedPath(path);
            setActiveFilePath(path);
            fireAndForget(async () => {
                const blockDef: BlockDef = {
                    meta: {
                        view: "knowledgebase",
                        file: path,
                    },
                };
                await createBlock(blockDef);
            });
        },
        [setSelectedPath, setActiveFilePath]
    );

    const handleRenameStart = useCallback((path: string) => {
        setRenamingPath(path);
        setRenamingValue(getEntryName(path));
    }, []);

    const handleRenameConfirm = useCallback(() => {
        if (renamingPath && renamingValue) {
            fireAndForget(async () => {
                await kbRename(renamingPath, renamingValue);
                const parentPath = getParentPath(renamingPath);
                await loadDirectory(parentPath);
                if (parentPath === "") {
                    const rootEntries = await kbListDir("");
                    setTreeData(rootEntries);
                }
                setRenamingPath(null);
                setRenamingValue("");
            });
        } else {
            setRenamingPath(null);
            setRenamingValue("");
        }
    }, [renamingPath, renamingValue, loadDirectory, setTreeData]);

    const handleRenameCancel = useCallback(() => {
        setRenamingPath(null);
        setRenamingValue("");
    }, []);

    const handleDelete = useCallback(
        (path: string) => {
            fireAndForget(async () => {
                await kbDelete(path);
                const parentPath = getParentPath(path);
                await loadDirectory(parentPath);
                if (parentPath === "") {
                    const rootEntries = await kbListDir("");
                    setTreeData(rootEntries);
                }
                setSelectedPaths((prev) => {
                    const next = new Set(prev);
                    next.delete(path);
                    return next;
                });
                if (selectedPath === path) {
                    setSelectedPath("");
                }
            });
        },
        [loadDirectory, setTreeData, selectedPath, setSelectedPath]
    );

    const handleNewFile = useCallback(
        (dirPath: string) => {
            setNewItemPath(dirPath);
            setNewItemType("file");
            setNewItemValue("");
        },
        []
    );

    const handleNewFolder = useCallback(
        (dirPath: string) => {
            setNewItemPath(dirPath);
            setNewItemType("dir");
            setNewItemValue("");
        },
        []
    );

    const handleNewItemConfirm = useCallback(() => {
        if (newItemConfirmingRef.current) return;
        if (newItemPath === null || !newItemType || !newItemValue) {
            setNewItemPath(null);
            setNewItemType(null);
            setNewItemValue("");
            return;
        }
        newItemConfirmingRef.current = true;
        fireAndForget(async () => {
            if (newItemType === "file") {
                await kbCreateFile(newItemPath, newItemValue, "");
            } else {
                await kbMkdir(newItemPath, newItemValue);
            }
            await loadDirectory(newItemPath);
            if (newItemPath === "") {
                const rootEntries = await kbListDir("");
                setTreeData(rootEntries);
            }
            if (newItemType === "dir") {
                setExpandedPaths((prev) => {
                    const set = new Set(prev);
                    const newPath = newItemPath ? `${newItemPath}/${newItemValue}` : newItemValue;
                    set.add(newPath);
                    return [...set];
                });
            }
            setNewItemPath(null);
            setNewItemType(null);
            setNewItemValue("");
            newItemConfirmingRef.current = false;
        });
    }, [newItemPath, newItemType, newItemValue, loadDirectory, setTreeData, setExpandedPaths]);

    const handleNewItemCancel = useCallback(() => {
        newItemConfirmingRef.current = true;
        setNewItemPath(null);
        setNewItemType(null);
        setNewItemValue("");
        requestAnimationFrame(() => {
            newItemConfirmingRef.current = false;
        });
    }, []);

    const handleCopy = useCallback((paths: string[]) => {
        setClipboard({ paths, operation: "copy" });
    }, []);

    const handleCut = useCallback((paths: string[]) => {
        setClipboard({ paths, operation: "cut" });
    }, []);

    const handlePaste = useCallback(
        (targetDir: string) => {
            if (!clipboard) return;
            fireAndForget(async () => {
                for (const srcPath of clipboard.paths) {
                    if (clipboard.operation === "copy") {
                        await kbCopy(srcPath, targetDir);
                    } else {
                        await kbMove(srcPath, targetDir);
                    }
                }
                await loadDirectory(targetDir);
                if (clipboard.operation === "cut") {
                    for (const srcPath of clipboard.paths) {
                        const parentPath = getParentPath(srcPath);
                        await loadDirectory(parentPath);
                        if (parentPath === "") {
                            const rootEntries = await kbListDir("");
                            setTreeData(rootEntries);
                        }
                    }
                }
                setClipboard(null);
            });
        },
        [clipboard, loadDirectory, setTreeData]
    );

    const handleImport = useCallback(() => {
        fireAndForget(async () => {
            const targetDir = selectedPath && dirCache.has(selectedPath) ? selectedPath : getParentPath(selectedPath) || "";
            const { getApi } = await import("@/app/store/global");
            const files = await getApi().pickUploadFiles();
            for (const file of files) {
                await kbImportFile(file, targetDir);
            }
            await loadDirectory(targetDir);
            if (targetDir === "") {
                const rootEntries = await kbListDir("");
                setTreeData(rootEntries);
            }
        });
    }, [selectedPath, dirCache, loadDirectory, setTreeData]);

    const handleContextMenu = useCallback(
        (path: string | null, isDir: boolean, event: React.MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const menu: ContextMenuItem[] = [];

            if (path == null) {
                menu.push(
                    { label: "New File", click: () => handleNewFile("") },
                    { label: "New Folder", click: () => handleNewFolder("") },
                    { type: "separator" },
                    {
                        label: "Paste",
                        click: () => handlePaste(""),
                        enabled: clipboard != null,
                    },
                    { type: "separator" },
                    { label: "Refresh", click: () => fireAndForget(refreshTree) }
                );
            } else if (isDir) {
                menu.push(
                    { label: "New File", click: () => handleNewFile(path) },
                    { label: "New Folder", click: () => handleNewFolder(path) },
                    { type: "separator" },
                    { label: "Rename", click: () => handleRenameStart(path) },
                    { label: "Delete", click: () => handleDelete(path) },
                    { type: "separator" },
                    { label: "Copy", click: () => handleCopy([path]) },
                    { label: "Cut", click: () => handleCut([path]) },
                    {
                        label: "Paste",
                        click: () => handlePaste(path),
                        enabled: clipboard != null,
                    }
                );
            } else {
                menu.push(
                    { label: "New File", click: () => handleNewFile(getParentPath(path)) },
                    { label: "New Folder", click: () => handleNewFolder(getParentPath(path)) },
                    { type: "separator" },
                    { label: "Rename", click: () => handleRenameStart(path) },
                    { label: "Delete", click: () => handleDelete(path) },
                    { type: "separator" },
                    { label: "Copy Path", click: () => navigator.clipboard.writeText(path) },
                    { label: "Copy", click: () => handleCopy([path]) },
                    { label: "Cut", click: () => handleCut([path]) },
                    {
                        label: "Paste",
                        click: () => handlePaste(getParentPath(path)),
                        enabled: clipboard != null,
                    },
                    { type: "separator" },
                    {
                        label: "Add to AI Chat",
                        click: () => {
                            fireAndForget(async () => {
                                const result = await kbReadFile(path);
                                if (result.isImage || !result.content) return;
                                const fileName = path.split("/").pop() ?? path;
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
        [
            handleNewFile,
            handleNewFolder,
            handlePaste,
            clipboard,
            refreshTree,
            handleRenameStart,
            handleDelete,
            handleCopy,
            handleCut,
        ]
    );

    const handleDragStart = useCallback((path: string, event: React.DragEvent) => {
        event.dataTransfer.setData("text/kb-path", path);
        event.dataTransfer.effectAllowed = "move";
    }, []);

    const handleDragOver = useCallback((path: string, isDir: boolean, event: React.DragEvent) => {
        if (isDir) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        }
    }, []);

    const handleDrop = useCallback(
        (targetPath: string, event: React.DragEvent) => {
            event.preventDefault();
            const kbPath = event.dataTransfer.getData("text/kb-path");
            if (kbPath && kbPath !== targetPath) {
                fireAndForget(async () => {
                    await kbMove(kbPath, targetPath);
                    await loadDirectory(targetPath);
                    const srcParent = getParentPath(kbPath);
                    await loadDirectory(srcParent);
                    if (srcParent === "" || targetPath === "") {
                        const rootEntries = await kbListDir("");
                        setTreeData(rootEntries);
                    }
                });
                return;
            }
            const files = event.dataTransfer.files;
            if (files.length > 0) {
                fireAndForget(async () => {
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const absPath = (file as any).path;
                        if (absPath) {
                            await kbImportFile(absPath, targetPath);
                        }
                    }
                    await loadDirectory(targetPath);
                    if (targetPath === "") {
                        const rootEntries = await kbListDir("");
                        setTreeData(rootEntries);
                    }
                });
            }
        },
        [loadDirectory, setTreeData]
    );

    const handleTreeDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }, []);

    const handleTreeDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            const files = event.dataTransfer.files;
            if (files.length > 0) {
                fireAndForget(async () => {
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const absPath = (file as any).path;
                        if (absPath) {
                            await kbImportFile(absPath, "");
                        }
                    }
                    await loadDirectory("");
                    const rootEntries = await kbListDir("");
                    setTreeData(rootEntries);
                });
            }
        },
        [loadDirectory, setTreeData]
    );

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Escape") {
                setSearchQuery("");
            }
        },
        [setSearchQuery]
    );

    const addMenuItems: MenuItem[] = useMemo(
        () => [
            {
                label: "New File",
                onClick: () => {
                    const targetDir = selectedPath && dirCache.has(selectedPath) ? selectedPath : "";
                    handleNewFile(targetDir);
                    setAddMenuOpen(false);
                },
            },
            {
                label: "New Folder",
                onClick: () => {
                    const targetDir = selectedPath && dirCache.has(selectedPath) ? selectedPath : "";
                    handleNewFolder(targetDir);
                    setAddMenuOpen(false);
                },
            },
            {
                label: "Import",
                onClick: () => {
                    handleImport();
                    setAddMenuOpen(false);
                },
            },
            {
                label: "Refresh",
                onClick: () => {
                    fireAndForget(refreshTree);
                    setAddMenuOpen(false);
                },
            },
        ],
        [selectedPath, dirCache, handleNewFile, handleNewFolder, handleImport, refreshTree]
    );

    const filteredRootEntries = useMemo(() => {
        if (!searchQuery) return treeData ?? [];
        return (treeData ?? []).filter((entry) => {
            if (entry.type === "dir") return true;
            return matchesSearch(getEntryName(entry.relPath), searchQuery);
        });
    }, [treeData, searchQuery]);

    const isLoading = useAtomValue(kbIsLoadingAtom);

    return (
        <div
            ref={sidebarRef}
            className={clsx("kb-sidebar", className)}
            style={{ width: sidebarWidth }}
        >
            <div
                className={clsx("kb-sidebar-resize-handle", isResizing && "active")}
                onMouseDown={handleResizeMouseDown}
            />
            <div className="kb-sidebar-header">
                <span className="kb-sidebar-title">Knowledge Base</span>
            </div>
            <div className="kb-sidebar-search">
                <span className="kb-search-icon">
                    <i className={makeIconClass("magnifying-glass", true)} />
                </span>
                <input
                    className="kb-search-input"
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                />
                {searchQuery && (
                    <button
                        className="kb-search-clear"
                        onClick={() => setSearchQuery("")}
                    >
                        <i className={makeIconClass("xmark", true)} />
                    </button>
                )}
            </div>
            <div className="kb-sidebar-toolbar">
                <button
                    className="kb-toolbar-btn"
                    title="Refresh"
                    onClick={() => fireAndForget(refreshTree)}
                >
                    <i className={makeIconClass("arrows-rotate", true)} />
                </button>
                <div className="kb-toolbar-add">
                    <button
                        className="kb-toolbar-btn"
                        title="Add"
                        onClick={() => setAddMenuOpen(!addMenuOpen)}
                    >
                        <i className={makeIconClass("plus", true)} />
                    </button>
                    {addMenuOpen && (
                        <>
                            <div className="kb-add-menu-overlay" onClick={() => setAddMenuOpen(false)} />
                            <div className="kb-add-menu">
                                {addMenuItems.map((item, idx) => (
                                    <div
                                        key={idx}
                                        className="kb-add-menu-item"
                                        onClick={item.onClick}
                                    >
                                        {item.label}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
            <div
                ref={treeRef}
                className="kb-sidebar-tree"
                onContextMenu={(e) => handleContextMenu(null, false, e)}
                onDragOver={handleTreeDragOver}
                onDrop={handleTreeDrop}
            >
                {isLoading && (treeData ?? []).length === 0 && (
                    <div className="kb-tree-empty">Loading...</div>
                )}
                {!isLoading && (treeData ?? []).length === 0 && (
                    <div className="kb-tree-empty">No files yet</div>
                )}
                {filteredRootEntries.map((entry) => (
                    <KbTreeNode
                        key={entry.relPath}
                        entry={entry}
                        depth={0}
                        expandedPaths={expandedSet}
                        selectedPaths={selectedPaths}
                        renamingPath={renamingPath}
                        renamingValue={renamingValue}
                        searchQuery={searchQuery}
                        dirCache={dirCache}
                        newItemPath={newItemPath}
                        newItemType={newItemType}
                        newItemValue={newItemValue}
                        onToggleExpand={handleToggleExpand}
                        onSelect={handleSelect}
                        onOpen={handleOpen}
                        onContextMenu={handleContextMenu}
                        onRenameStart={handleRenameStart}
                        onRenameConfirm={handleRenameConfirm}
                        onRenameCancel={handleRenameCancel}
                        onRenameValueChange={setRenamingValue}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onNewItemValueChange={setNewItemValue}
                        onNewItemConfirm={handleNewItemConfirm}
                        onNewItemCancel={handleNewItemCancel}
                    />
                ))}
                {newItemPath === "" && newItemType && (
                    <div className="kb-tree-new-item" style={{ paddingLeft: 16 }}>
                        <span className="kb-tree-icon">
                            <i
                                className={makeIconClass(
                                    newItemType === "dir" ? "folder" : "file",
                                    true
                                )}
                            />
                        </span>
                        <input
                            className="kb-tree-rename-input"
                            value={newItemValue}
                            placeholder={newItemType === "dir" ? "Folder name" : "File name"}
                            onChange={(e) => setNewItemValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleNewItemConfirm();
                                if (e.key === "Escape") handleNewItemCancel();
                            }}
                            onBlur={handleNewItemConfirm}
                            autoFocus
                        />
                    </div>
                )}
            </div>
            <div className="kb-sidebar-footer">
                <span className="kb-footer-text">{(treeData ?? []).length} items</span>
            </div>
        </div>
    );
};

export const KbSidebar = memo(KbSidebarComponent);
KbSidebar.displayName = "KbSidebar";
