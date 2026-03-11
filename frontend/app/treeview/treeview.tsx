// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import React, {
    CSSProperties,
    KeyboardEvent,
    MouseEvent,
    useCallback,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";

type TreeNodeChildrenStatus = "unloaded" | "loading" | "loaded" | "error" | "capped";

export interface TreeNodeData {
    id: string;
    parentId?: string;
    label?: string;
    path?: string;
    isDirectory: boolean;
    mimeType?: string;
    icon?: string;
    expandedIcon?: string;
    iconColor?: string;
    isReadonly?: boolean;
    notfound?: boolean;
    staterror?: string;
    childrenStatus?: TreeNodeChildrenStatus;
    childrenIds?: string[];
    capInfo?: { max: number; totalKnown?: number };
}

interface FetchDirResult {
    nodes: TreeNodeData[];
    capped?: boolean;
    totalKnown?: number;
}

export interface TreeViewVisibleRow {
    id: string;
    parentId?: string;
    depth: number;
    kind: "node" | "loading" | "error" | "capped";
    label: string;
    isDirectory?: boolean;
    isExpanded?: boolean;
    hasChildren?: boolean;
    icon?: string;
    node?: TreeNodeData;
}

export interface TreeViewProps {
    rootIds: string[];
    initialNodes: Record<string, TreeNodeData>;
    fetchDir?: (id: string, limit: number) => Promise<FetchDirResult>;
    maxDirEntries?: number;
    rowHeight?: number;
    indentWidth?: number;
    overscan?: number;
    minWidth?: number;
    maxWidth?: number;
    width?: number | string;
    height?: number | string;
    className?: string;
    onOpenFile?: (id: string, node: TreeNodeData) => void;
    onOpenDirectory?: (id: string, node: TreeNodeData) => void;
    onSelectionChange?: (id: string, node: TreeNodeData) => void;
    onContextMenu?: (id: string, node: TreeNodeData, event: MouseEvent<HTMLDivElement>) => void;
    selectedId?: string;
    defaultExpandedIds?: string[];
    ensureExpandedIds?: string[];
    disableDirectoryDoubleClick?: boolean;
}

export interface TreeViewRef {
    scrollToId: (id: string) => void;
    focus: () => void;
}

const DefaultRowHeight = 24;
const DefaultIndentWidth = 16;
const DefaultOverscan = 10;
const IconWidth = 16;

function normalizeLabel(node: TreeNodeData): string {
    if (node.label?.trim()) {
        return node.label;
    }
    const path = node.path ?? node.id;
    const chunks = path.split("/").filter(Boolean);
    return chunks[chunks.length - 1] ?? path;
}

function sortIdsByNode(nodesById: Map<string, TreeNodeData>, ids: string[]): string[] {
    return [...ids].sort((leftId, rightId) => {
        const left = nodesById.get(leftId);
        const right = nodesById.get(rightId);
        const leftDir = left?.isDirectory ? 0 : 1;
        const rightDir = right?.isDirectory ? 0 : 1;
        if (leftDir !== rightDir) {
            return leftDir - rightDir;
        }
        const leftLabel = normalizeLabel(left ?? { id: leftId, isDirectory: false }).toLocaleLowerCase();
        const rightLabel = normalizeLabel(right ?? { id: rightId, isDirectory: false }).toLocaleLowerCase();
        if (leftLabel !== rightLabel) {
            return leftLabel.localeCompare(rightLabel);
        }
        return leftId.localeCompare(rightId);
    });
}

export function buildVisibleRows(
    nodesById: Map<string, TreeNodeData>,
    rootIds: string[],
    expandedIds: Set<string>
): TreeViewVisibleRow[] {
    const rows: TreeViewVisibleRow[] = [];

    const appendNode = (id: string, depth: number) => {
        const node = nodesById.get(id);
        if (node == null) {
            return;
        }
        const childIds = node.childrenIds ?? [];
        const hasChildren = node.isDirectory && (childIds.length > 0 || node.childrenStatus !== "loaded");
        const isExpanded = expandedIds.has(id);
        rows.push({
            id,
            parentId: node.parentId,
            depth,
            kind: "node",
            label: normalizeLabel(node),
            isDirectory: node.isDirectory,
            isExpanded,
            hasChildren,
            icon: node.icon,
            node,
        });
        if (!isExpanded || !node.isDirectory) {
            return;
        }
        const status = node.childrenStatus ?? "unloaded";
        if (status === "loading") {
            rows.push({
                id: `${id}::__loading`,
                parentId: id,
                depth: depth + 1,
                kind: "loading",
                label: "Loading…",
            });
            return;
        }
        if (status === "error") {
            rows.push({
                id: `${id}::__error`,
                parentId: id,
                depth: depth + 1,
                kind: "error",
                label: node.staterror ? `Error: ${node.staterror}` : "Unable to load directory",
            });
            return;
        }

        const sortedChildren = sortIdsByNode(nodesById, childIds);
        sortedChildren.forEach((childId) => appendNode(childId, depth + 1));
        if (status === "capped") {
            const capMax = node.capInfo?.max ?? childIds.length;
            rows.push({
                id: `${id}::__capped`,
                parentId: id,
                depth: depth + 1,
                kind: "capped",
                label: `Showing first ${capMax} entries`,
            });
        }
    };

    sortIdsByNode(nodesById, rootIds).forEach((id) => appendNode(id, 0));
    return rows;
}

function getNodeIcon(node: TreeNodeData, isExpanded: boolean): string {
    if (node.notfound || node.staterror) {
        return "triangle-exclamation";
    }
    if (isExpanded && node.expandedIcon) {
        return node.expandedIcon;
    }
    if (node.icon) {
        return node.icon;
    }
    if (node.isDirectory) {
        return isExpanded ? "folder-open" : "folder";
    }
    const mime = node.mimeType ?? "";
    if (mime.startsWith("image/")) {
        return "image";
    }
    if (mime === "application/pdf") {
        return "file-pdf";
    }
    const extension = normalizeLabel(node).split(".").pop()?.toLocaleLowerCase();
    if (["js", "jsx", "ts", "tsx", "go", "py", "java", "c", "cpp", "h", "hpp", "json", "yaml", "yml"].includes(extension)) {
        return "file-code";
    }
    if (["md", "txt", "log"].includes(extension)) {
        return "file-lines";
    }
    return "file";
}

export const TreeView = forwardRef<TreeViewRef, TreeViewProps>((props, ref) => {
    const {
        rootIds,
        initialNodes,
        fetchDir,
        maxDirEntries = 500,
        rowHeight = DefaultRowHeight,
        indentWidth = DefaultIndentWidth,
        overscan = DefaultOverscan,
        minWidth = 100,
        maxWidth = 400,
        width = "100%",
        height = 360,
        className,
        onOpenFile,
        onOpenDirectory,
        onSelectionChange,
        onContextMenu,
        selectedId: controlledSelectedId,
        defaultExpandedIds,
        ensureExpandedIds,
        disableDirectoryDoubleClick = false,
    } = props;
    const firstRootId = rootIds[0];
    const [nodesById, setNodesById] = useState<Map<string, TreeNodeData>>(
        () =>
            new Map(
                Object.entries(initialNodes).map(([id, node]) => [id, { ...node, childrenStatus: node.childrenStatus ?? "unloaded" }])
            )
    );
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(defaultExpandedIds ?? []));
    const [internalSelectedId, setInternalSelectedId] = useState<string>(controlledSelectedId ?? firstRootId);
    const selectedId = controlledSelectedId ?? internalSelectedId;
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const ensureExpandedKey = useMemo(() => (ensureExpandedIds ?? []).join("\0"), [ensureExpandedIds]);

    useEffect(() => {
        setNodesById(
            new Map(
                Object.entries(initialNodes).map(([id, node]) => [
                    id,
                    {
                        ...node,
                        childrenStatus: node.childrenStatus ?? "unloaded",
                    },
                ])
            )
        );
    }, [initialNodes]);

    useEffect(() => {
        if ((ensureExpandedIds ?? []).length === 0) {
            return;
        }
        setExpandedIds((prev) => {
            const next = new Set(prev);
            ensureExpandedIds?.forEach((id) => next.add(id));
            return next;
        });
    }, [ensureExpandedKey, ensureExpandedIds]);

    useEffect(() => {
        if (controlledSelectedId == null) {
            setInternalSelectedId(firstRootId);
        }
    }, [controlledSelectedId, firstRootId]);

    const visibleRows = useMemo(() => buildVisibleRows(nodesById, rootIds, expandedIds), [nodesById, rootIds, expandedIds]);
    const idToIndex = useMemo(
        () => new Map(visibleRows.map((row, index) => [row.id, index])),
        [visibleRows]
    );
    const virtualizer = useVirtualizer({
        count: visibleRows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan,
    });

    const commitSelection = useCallback((id: string) => {
        const node = nodesById.get(id);
        if (node == null) {
            return;
        }
        if (controlledSelectedId == null) {
            setInternalSelectedId(id);
        }
        onSelectionChange?.(id, node);
    }, [controlledSelectedId, nodesById, onSelectionChange]);

    const scrollToId = useCallback((id: string) => {
        const index = idToIndex.get(id);
        if (index == null) {
            return;
        }
        virtualizer.scrollToIndex(index, { align: "auto" });
    }, [idToIndex, virtualizer]);

    useEffect(() => {
        if (selectedId != null) {
            scrollToId(selectedId);
        }
    }, [scrollToId, selectedId, visibleRows.length]);

    useImperativeHandle(
        ref,
        () => ({
            scrollToId,
            focus: () => containerRef.current?.focus(),
        }),
        [scrollToId]
    );

    const loadChildren = useCallback(async (id: string) => {
        const currentNode = nodesById.get(id);
        if (currentNode == null || !currentNode.isDirectory || currentNode.notfound || currentNode.staterror || fetchDir == null) {
            return;
        }
        const status = currentNode.childrenStatus ?? "unloaded";
        if (status !== "unloaded") {
            return;
        }
        setNodesById((prev) => {
            const next = new Map(prev);
            next.set(id, { ...currentNode, childrenStatus: "loading" });
            return next;
        });
        try {
            const result = await fetchDir(id, maxDirEntries);
            setNodesById((prev) => {
                const next = new Map(prev);
                result.nodes.forEach((node) => {
                    const merged: TreeNodeData = {
                        ...node,
                        parentId: node.parentId ?? id,
                        childrenStatus: node.childrenStatus ?? (node.isDirectory ? "unloaded" : "loaded"),
                    };
                    next.set(merged.id, merged);
                });
                const childrenIds = sortIdsByNode(
                    next,
                    result.nodes.map((entry) => entry.id)
                );
                const source = next.get(id) ?? currentNode;
                next.set(id, {
                    ...source,
                    childrenIds,
                    childrenStatus: result.capped ? "capped" : "loaded",
                    capInfo: result.capped ? { max: maxDirEntries, totalKnown: result.totalKnown } : undefined,
                });
                return next;
            });
        } catch (error) {
            setNodesById((prev) => {
                const next = new Map(prev);
                const source = next.get(id) ?? currentNode;
                next.set(id, {
                    ...source,
                    childrenStatus: "error",
                    staterror: error instanceof Error ? error.message : "Unknown error",
                });
                return next;
            });
        }
    }, [fetchDir, maxDirEntries, nodesById]);

    useEffect(() => {
        expandedIds.forEach((id) => {
            const node = nodesById.get(id);
            if (node == null || !node.isDirectory) {
                return;
            }
            if ((node.childrenStatus ?? "unloaded") === "unloaded") {
                void loadChildren(id);
            }
        });
    }, [expandedIds, loadChildren, nodesById]);

    const toggleExpand = (id: string) => {
        const node = nodesById.get(id);
        if (node == null || !node.isDirectory || node.notfound || node.staterror) {
            return;
        }
        const expanded = expandedIds.has(id);
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (expanded) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
        scrollToId(id);
    };

    const selectVisibleNodeAt = (index: number) => {
        if (index < 0 || index >= visibleRows.length) {
            return;
        }
        const row = visibleRows[index];
        if (row.kind !== "node") {
            return;
        }
        commitSelection(row.id);
        scrollToId(row.id);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const selectedIndex = selectedId != null ? idToIndex.get(selectedId) : undefined;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = (selectedIndex ?? -1) + 1;
            for (let idx = nextIndex; idx < visibleRows.length; idx++) {
                if (visibleRows[idx].kind === "node") {
                    selectVisibleNodeAt(idx);
                    break;
                }
            }
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            const previousIndex = (selectedIndex ?? visibleRows.length) - 1;
            for (let idx = previousIndex; idx >= 0; idx--) {
                if (visibleRows[idx].kind === "node") {
                    selectVisibleNodeAt(idx);
                    break;
                }
            }
            return;
        }
        const node = selectedId ? nodesById.get(selectedId) : null;
        if (node == null) {
            return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            if (node.isDirectory && expandedIds.has(node.id)) {
                toggleExpand(node.id);
                return;
            }
            if (node.parentId != null) {
                commitSelection(node.parentId);
                scrollToId(node.parentId);
            }
            return;
        }
        if (event.key === "ArrowRight") {
            event.preventDefault();
            if (node.isDirectory && !expandedIds.has(node.id)) {
                toggleExpand(node.id);
                return;
            }
            if (node.isDirectory && expandedIds.has(node.id) && node.childrenIds?.[0]) {
                commitSelection(node.childrenIds[0]);
                scrollToId(node.childrenIds[0]);
            }
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            if (node.isDirectory) {
                if (onOpenDirectory != null) {
                    onOpenDirectory(node.id, node);
                } else {
                    toggleExpand(node.id);
                }
                return;
            }
            onOpenFile?.(node.id, node);
        }
    };

    const containerStyle: CSSProperties = {
        width,
        minWidth,
        maxWidth,
        height,
    };

    return (
            <div
                ref={containerRef}
                className={clsx("rounded-md border border-border bg-panel", className)}
                style={containerStyle}
                tabIndex={0}
            onKeyDown={onKeyDown}
        >
            <div ref={scrollRef} className="h-full overflow-auto">
                <div className="relative w-max min-w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const row = visibleRows[virtualRow.index];
                        if (row.kind === "node" && row.node == null) {
                            return null;
                        }
                        const selected = row.id === selectedId;
                        return (
                            <div
                                key={row.id}
                                className={clsx(
                                    "absolute left-0 right-0 flex items-center whitespace-nowrap text-sm",
                                    row.kind === "node" ? "cursor-pointer" : "text-muted",
                                    selected ? "bg-accent/25 text-foreground" : "text-foreground hover:bg-muted/50"
                                )}
                                style={{
                                    top: 0,
                                    height: rowHeight,
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                                onClick={() => {
                                    if (row.kind !== "node") {
                                        return;
                                    }
                                    commitSelection(row.id);
                                    if (row.isDirectory) {
                                        toggleExpand(row.id);
                                    }
                                }}
                                onDoubleClick={() => {
                                    if (row.kind !== "node") {
                                        return;
                                    }
                                    if (row.isDirectory) {
                                        if (disableDirectoryDoubleClick) {
                                            return;
                                        }
                                        if (row.node != null && onOpenDirectory != null) {
                                            onOpenDirectory(row.id, row.node);
                                        } else {
                                            toggleExpand(row.id);
                                        }
                                        return;
                                    }
                                    if (row.node != null) {
                                        onOpenFile?.(row.id, row.node);
                                    }
                                }}
                                onContextMenu={(event) => {
                                    if (row.kind !== "node" || row.node == null) {
                                        return;
                                    }
                                    commitSelection(row.id);
                                    onContextMenu?.(row.id, row.node, event);
                                }}
                            >
                                <div className="flex items-center" style={{ paddingLeft: row.depth * indentWidth }}>
                                    {row.kind === "node" && row.isDirectory && row.hasChildren ? (
                                        <button
                                            className="flex h-4 w-4 items-center justify-center rounded text-muted hover:text-foreground cursor-pointer"
                                            onClick={(event: MouseEvent<HTMLButtonElement>) => {
                                                event.stopPropagation();
                                                toggleExpand(row.id);
                                            }}
                                        >
                                            <i
                                                className={clsx(
                                                    "fa-sharp fa-solid text-[11px]",
                                                    row.isExpanded ? "fa-chevron-down" : "fa-chevron-right"
                                                )}
                                            />
                                        </button>
                                    ) : (
                                        <span className="inline-block h-4 w-4" />
                                    )}
                                </div>
                                {row.kind === "node" ? (
                                    <>
                                        <span
                                            className="ml-1 inline-flex items-center justify-center"
                                            style={{ width: IconWidth, minWidth: IconWidth }}
                                        >
                                            <i
                                                className={makeIconClass(getNodeIcon(row.node, row.isExpanded), true)}
                                                style={{
                                                    color:
                                                        row.node.notfound || row.node.staterror
                                                            ? "var(--color-error)"
                                                            : (row.node.iconColor ?? "inherit"),
                                                }}
                                            />
                                        </span>
                                        <span
                                            className={clsx("ml-2 pr-3", row.node.isReadonly && "text-muted")}
                                            title={row.label}
                                        >
                                            {row.label}
                                        </span>
                                    </>
                                ) : (
                                    <span className="ml-6 pr-3 text-xs">{row.label}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

TreeView.displayName = "TreeView";
