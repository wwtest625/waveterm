// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Input } from "@/app/element/input";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { modalsModel } from "@/app/store/modalmodel";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { getApi, getBlockComponentModel, globalStore } from "@/store/global";
import { RpcApi } from "@/store/wshclientapi";
import { TabRpcClient } from "@/store/wshrpcutil";
import { base64ToString, stringToBase64 } from "@/util/util";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import {
    QUICK_COMMANDS_CONFIG_FILE,
    QuickCommand,
    QuickCommandItem,
    QuickCommandsConfig,
    collectQuickCommandGroupIds,
    createEmptyQuickCommandsConfig,
    filterQuickCommandItems,
    insertQuickCommandItem,
    moveQuickCommandItem,
    normalizeQuickCommandsConfig,
    reorderQuickCommandItems,
    removeQuickCommandItem,
    replaceQuickCommandItem,
    stringifyQuickCommandsConfig,
} from "./quickcommands-config";
import { QuickCommandEditModal, QuickCommandFormValue } from "./quickcommands-modal";
import type { QuickCommandsViewModel } from "./quickcommands-model";
import type { TermViewModel } from "../term/term-model";

import "./quickcommands.scss";

type QuickCommandDropTarget =
    | {
          type: "reorder";
          parentGroupId: string | null;
          index: number;
      }
    | {
          type: "into-group";
          groupId: string;
      };

type SelectedItem =
    | { type: "command"; item: QuickCommand }
    | { type: "group"; item: QuickCommandItem & { type: "group" } }
    | null;

function getTargetTerminalModel(requireQuickInput: boolean = false): TermViewModel | null {
    const layoutModel = getLayoutModelForStaticTab();
    const getMatchingModel = (blockId: string | null | undefined): TermViewModel | null => {
        if (!blockId) {
            return null;
        }
        const bcm = getBlockComponentModel(blockId);
        const viewModel = bcm?.viewModel as TermViewModel | undefined;
        if (viewModel?.viewType !== "term" || typeof viewModel.sendDataToController !== "function") {
            return null;
        }
        if (requireQuickInput && (typeof viewModel.supportsQuickInput !== "function" || !viewModel.supportsQuickInput())) {
            return null;
        }
        return viewModel;
    };
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    const focusedBlockId = focusedNode?.data?.blockId;
    const focusedModel = getMatchingModel(focusedBlockId);
    if (focusedModel != null) {
        return focusedModel;
    }
    const leafOrder = globalStore.get(layoutModel.leafOrder) ?? [];
    for (const leaf of leafOrder) {
        const targetModel = getMatchingModel(leaf?.blockid);
        if (targetModel != null) {
            return targetModel;
        }
    }
    return null;
}

function isMissingFileError(err: unknown): boolean {
    const text = err instanceof Error ? err.message : String(err);
    const normalized = text.toLowerCase();
    return normalized.includes("not found") || normalized.includes("enoent") || normalized.includes("cannot find");
}

function ensureTrailingNewline(value: string): string {
    return /[\r\n]$/.test(value) ? value : `${value}\n`;
}

function countCommands(items: QuickCommandItem[]): number {
    return items.reduce((total, item) => total + (item.type === "command" ? 1 : countCommands(item.items)), 0);
}

function countGroups(items: QuickCommandItem[]): number {
    return items.reduce((total, item) => total + (item.type === "group" ? 1 + countGroups(item.items) : 0), 0);
}

function findItemById(items: QuickCommandItem[], id: string): QuickCommandItem | null {
    for (const item of items) {
        if (item.id === id) return item;
        if (item.type === "group") {
            const found = findItemById(item.items, id);
            if (found) return found;
        }
    }
    return null;
}

function flattenCommands(items: QuickCommandItem[]): QuickCommand[] {
    const result: QuickCommand[] = [];
    for (const item of items) {
        if (item.type === "command") {
            result.push(item);
        } else {
            result.push(...flattenCommands(item.items));
        }
    }
    return result;
}

// --- Sidebar Tree ---

function SidebarTree({
    items,
    depth,
    parentGroupId,
    expandedIds,
    selectedId,
    dragEnabled,
    draggedItemId,
    dropTarget,
    onToggleGroup,
    onSelectItem,
    onOpenMenu,
    onDragStart,
    onDragOverItem,
    onDrop,
    onDragEnd,
}: {
    items: QuickCommandItem[];
    depth: number;
    parentGroupId: string | null;
    expandedIds: Set<string>;
    selectedId: string | null;
    dragEnabled: boolean;
    draggedItemId: string | null;
    dropTarget: QuickCommandDropTarget | null;
    onToggleGroup: (groupId: string) => void;
    onSelectItem: (item: QuickCommandItem) => void;
    onOpenMenu: (item: QuickCommandItem, event: MouseEvent<HTMLElement>) => void;
    onDragStart: (itemId: string, parentGroupId: string | null, event: DragEvent<HTMLElement>) => void;
    onDragOverItem: (item: QuickCommandItem, parentGroupId: string | null, index: number, event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
}) {
    return items.map((item, index) => {
        const isLast = index === items.length - 1;
        const isSelected = selectedId === item.id;
        const showDropBefore = dropTarget?.type === "reorder" && dropTarget.parentGroupId === parentGroupId && dropTarget.index === index;
        const showDropAfter = dropTarget?.type === "reorder" && dropTarget.parentGroupId === parentGroupId && dropTarget.index === index + 1;
        const isDragging = draggedItemId === item.id;
        const isDropIntoGroup = item.type === "group" && dropTarget?.type === "into-group" && dropTarget.groupId === item.id;

        if (item.type === "group") {
            const expanded = expandedIds.has(item.id);
            return (
                <div key={item.id} className="qc-tree-node">
                    <div
                        className={clsx(
                            "qc-sidebar-item qc-sidebar-item--group group",
                            isSelected && "qc-sidebar-item--selected",
                            isDragging && "opacity-40",
                            isDropIntoGroup && "bg-accent/10"
                        )}
                        onClick={() => onSelectItem(item)}
                        onContextMenu={(e) => onOpenMenu(item, e)}
                        onDragOver={(e) => onDragOverItem(item, parentGroupId, index, e)}
                        onDrop={onDrop}
                    >
                        {showDropBefore ? <div className="pointer-events-none absolute inset-x-0 top-0 border-t-2 border-accent/80" /> : null}
                        {isDropIntoGroup ? <div className="pointer-events-none absolute inset-0 border border-accent/70" /> : null}
                        <button
                            type="button"
                            draggable={dragEnabled}
                            className={clsx("qc-sidebar-drag", dragEnabled ? "cursor-grab" : "cursor-default opacity-0")}
                            title={dragEnabled ? "拖拽排序 / 拖入分组" : "搜索时暂不支持拖拽"}
                            onDragStart={(e) => onDragStart(item.id, parentGroupId, e)}
                            onDragEnd={onDragEnd}
                        >
                            <i className="fa-solid fa-grip-vertical text-[10px]"></i>
                        </button>
                        <button
                            type="button"
                            className="qc-sidebar-chevron"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleGroup(item.id);
                            }}
                        >
                            <i className={clsx("fa-solid text-[10px]", expanded ? "fa-chevron-down" : "fa-chevron-right")}></i>
                        </button>
                        <i className="fa-solid fa-folder text-xs text-accent/70"></i>
                        <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                        <span className="qc-sidebar-count">{item.items.length}</span>
                        {showDropAfter ? <div className="pointer-events-none absolute inset-x-0 bottom-0 border-b-2 border-accent/80" /> : null}
                    </div>
                    {expanded ? (
                        <div className="qc-tree-children">
                            <SidebarTree
                                items={item.items}
                                depth={depth + 1}
                                parentGroupId={item.id}
                                expandedIds={expandedIds}
                                selectedId={selectedId}
                                dragEnabled={dragEnabled}
                                draggedItemId={draggedItemId}
                                dropTarget={dropTarget}
                                onToggleGroup={onToggleGroup}
                                onSelectItem={onSelectItem}
                                onOpenMenu={onOpenMenu}
                                onDragStart={onDragStart}
                                onDragOverItem={onDragOverItem}
                                onDrop={onDrop}
                                onDragEnd={onDragEnd}
                            />
                        </div>
                    ) : null}
                </div>
            );
        }

        return (
            <div
                key={item.id}
                className={clsx(
                    "qc-sidebar-item qc-sidebar-item--command group",
                    isSelected && "qc-sidebar-item--selected",
                    isDragging && "opacity-40"
                )}
                onClick={() => onSelectItem(item)}
                onContextMenu={(e) => onOpenMenu(item, e)}
                onDragOver={(e) => onDragOverItem(item, parentGroupId, index, e)}
                onDrop={onDrop}
            >
                {showDropBefore ? <div className="pointer-events-none absolute inset-x-0 top-0 border-t-2 border-accent/80" /> : null}
                <button
                    type="button"
                    draggable={dragEnabled}
                    className={clsx("qc-sidebar-drag", dragEnabled ? "cursor-grab" : "cursor-default opacity-0")}
                    title={dragEnabled ? "拖拽排序 / 拖入分组" : "搜索时暂不支持拖拽"}
                    onDragStart={(e) => onDragStart(item.id, parentGroupId, e)}
                    onDragEnd={onDragEnd}
                >
                    <i className="fa-solid fa-grip-vertical text-[10px]"></i>
                </button>
                <span className="qc-sidebar-chevron-placeholder"></span>
                <i className="fa-solid fa-bolt text-[10px] text-accent/70"></i>
                <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                {showDropAfter ? <div className="pointer-events-none absolute inset-x-0 bottom-0 border-b-2 border-accent/80" /> : null}
            </div>
        );
    });
}

// --- Detail Panel: Overview ---

function DetailOverview({
    config,
    onOpenEditor,
}: {
    config: QuickCommandsConfig;
    onOpenEditor: (opts: { itemType: "group" | "command"; title: string; parentGroupId?: string | null }) => void;
}) {
    const totalCommands = countCommands(config.items);
    const totalGroups = countGroups(config.items);
    const allCommands = flattenCommands(config.items);
    const recentCommands = allCommands.slice(-5).reverse();

    return (
        <div className="qc-detail-overview">
            <div className="qc-detail-title">快捷命令概览</div>
            <div className="qc-detail-subtitle">选择左侧命令查看详情，或创建新命令</div>

            <div className="qc-detail-stats">
                <div className="qc-detail-stat-card">
                    <div className="qc-detail-stat-value">{totalCommands}</div>
                    <div className="qc-detail-stat-label">命令</div>
                </div>
                <div className="qc-detail-stat-card">
                    <div className="qc-detail-stat-value">{totalGroups}</div>
                    <div className="qc-detail-stat-label">分组</div>
                </div>
            </div>

            <div className="qc-detail-actions-row">
                <Button className="!h-[32px] !px-4 !text-xs" onClick={() => onOpenEditor({ itemType: "command", title: "新建命令", parentGroupId: null })}>
                    <i className="fa-solid fa-plus mr-1.5"></i>新建命令
                </Button>
                <Button className="grey outlined !h-[32px] !px-4 !text-xs" onClick={() => onOpenEditor({ itemType: "group", title: "新建分组", parentGroupId: null })}>
                    <i className="fa-solid fa-folder-plus mr-1.5"></i>新建分组
                </Button>
            </div>

            {recentCommands.length > 0 && (
                <div className="qc-detail-recent">
                    <div className="qc-detail-section-title">最近添加</div>
                    {recentCommands.map((cmd) => (
                        <div key={cmd.id} className="qc-detail-recent-item">
                            <i className="fa-solid fa-bolt text-[10px] text-accent/60"></i>
                            <span className="truncate text-sm">{cmd.name}</span>
                            {cmd.description && <span className="ml-auto truncate text-xs text-secondary/60">{cmd.description}</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// --- Detail Panel: Command Detail ---

function DetailCommand({
    item,
    onRunCommand,
    onPasteCommand,
    onPasteQuickInput,
    onCopyCommand,
    onEdit,
    onDelete,
}: {
    item: QuickCommand;
    onRunCommand: (item: QuickCommand) => void;
    onPasteCommand: (item: QuickCommand) => void;
    onPasteQuickInput: (item: QuickCommand) => void;
    onCopyCommand: (item: QuickCommand) => void;
    onEdit: (item: QuickCommand) => void;
    onDelete: (item: QuickCommand) => void;
}) {
    return (
        <div className="qc-detail-content">
            <div className="qc-detail-header">
                <div className="qc-detail-header-icon">
                    <i className="fa-solid fa-bolt"></i>
                </div>
                <div className="qc-detail-header-info">
                    <div className="qc-detail-title">{item.name}</div>
                    {item.description && <div className="qc-detail-subtitle">{item.description}</div>}
                </div>
            </div>

            <div className="qc-detail-section">
                <div className="qc-detail-section-title">命令内容</div>
                <div className="qc-detail-code-block">
                    <code>{item.command}</code>
                    <button
                        type="button"
                        className="qc-detail-code-copy"
                        onClick={() => onCopyCommand(item)}
                        title="复制命令"
                    >
                        <i className="fa-regular fa-copy"></i>
                    </button>
                </div>
            </div>

            <div className="qc-detail-section">
                <div className="qc-detail-section-title">操作</div>
                <div className="qc-detail-action-grid">
                    <button type="button" className="qc-detail-action-btn qc-detail-action-btn--primary" onClick={() => onRunCommand(item)}>
                        <i className="fa-solid fa-play"></i>
                        <span>执行</span>
                    </button>
                    <button type="button" className="qc-detail-action-btn" onClick={() => onPasteCommand(item)}>
                        <i className="fa-solid fa-paste"></i>
                        <span>粘贴到终端</span>
                    </button>
                    <button type="button" className="qc-detail-action-btn" onClick={() => onPasteQuickInput(item)}>
                        <i className="fa-solid fa-keyboard"></i>
                        <span>快捷输入框</span>
                    </button>
                    <button type="button" className="qc-detail-action-btn" onClick={() => onCopyCommand(item)}>
                        <i className="fa-regular fa-copy"></i>
                        <span>复制</span>
                    </button>
                    <button type="button" className="qc-detail-action-btn" onClick={() => onEdit(item)}>
                        <i className="fa-solid fa-pen"></i>
                        <span>编辑</span>
                    </button>
                    <button type="button" className="qc-detail-action-btn qc-detail-action-btn--danger" onClick={() => onDelete(item)}>
                        <i className="fa-solid fa-trash"></i>
                        <span>删除</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- Detail Panel: Group Detail ---

function DetailGroup({
    item,
    expandedIds,
    onToggleGroup,
    onSelectItem,
    onRunCommand,
    onPasteCommand,
    onCopyCommand,
    onOpenMenu,
    onEdit,
    onDelete,
    onAddCommand,
}: {
    item: QuickCommandItem & { type: "group" };
    expandedIds: Set<string>;
    onToggleGroup: (groupId: string) => void;
    onSelectItem: (item: QuickCommandItem) => void;
    onRunCommand: (item: QuickCommand) => void;
    onPasteCommand: (item: QuickCommand) => void;
    onCopyCommand: (item: QuickCommand) => void;
    onOpenMenu: (item: QuickCommandItem, event: MouseEvent<HTMLElement>) => void;
    onEdit: (item: QuickCommandItem) => void;
    onDelete: (item: QuickCommandItem) => void;
    onAddCommand: (groupId: string) => void;
}) {
    const commandCount = countCommands(item.items);
    return (
        <div className="qc-detail-content">
            <div className="qc-detail-header">
                <div className="qc-detail-header-icon qc-detail-header-icon--group">
                    <i className="fa-solid fa-folder-open"></i>
                </div>
                <div className="qc-detail-header-info">
                    <div className="qc-detail-title">{item.name}</div>
                    <div className="qc-detail-subtitle">{commandCount} 条命令</div>
                </div>
            </div>

            <div className="qc-detail-section">
                <div className="qc-detail-section-row">
                    <div className="qc-detail-section-title">子项</div>
                    <Button className="ghost grey !h-[26px] !px-2 !text-[11px]" onClick={() => onAddCommand(item.id)}>
                        <i className="fa-solid fa-plus mr-1"></i>添加命令
                    </Button>
                </div>
                {item.items.length === 0 ? (
                    <div className="qc-detail-empty">此分组暂无命令</div>
                ) : (
                    <div className="qc-detail-group-list">
                        {item.items.map((child) => {
                            if (child.type === "group") {
                                return (
                                    <div
                                        key={child.id}
                                        className="qc-detail-group-item"
                                        onClick={() => onSelectItem(child)}
                                        onContextMenu={(e) => onOpenMenu(child, e)}
                                    >
                                        <i className="fa-solid fa-folder text-xs text-accent/60"></i>
                                        <span className="flex-1 truncate text-sm">{child.name}</span>
                                        <span className="text-xs text-secondary/60">{child.items.length}</span>
                                    </div>
                                );
                            }
                            return (
                                <div
                                    key={child.id}
                                    className="qc-detail-group-item"
                                    onClick={() => onSelectItem(child)}
                                    onContextMenu={(e) => onOpenMenu(child, e)}
                                >
                                    <i className="fa-solid fa-bolt text-[10px] text-accent/60"></i>
                                    <span className="flex-1 truncate text-sm">{child.name}</span>
                                    <div className="qc-detail-group-item-actions">
                                        <button type="button" className="qc-detail-mini-btn" onClick={(e) => { e.stopPropagation(); onRunCommand(child); }} title="执行">
                                            <i className="fa-solid fa-play text-[9px]"></i>
                                        </button>
                                        <button type="button" className="qc-detail-mini-btn" onClick={(e) => { e.stopPropagation(); onPasteCommand(child); }} title="粘贴">
                                            <i className="fa-solid fa-paste text-[9px]"></i>
                                        </button>
                                        <button type="button" className="qc-detail-mini-btn" onClick={(e) => { e.stopPropagation(); onCopyCommand(child); }} title="复制">
                                            <i className="fa-regular fa-copy text-[9px]"></i>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="qc-detail-section">
                <div className="qc-detail-section-title">分组操作</div>
                <div className="qc-detail-action-grid">
                    <button type="button" className="qc-detail-action-btn" onClick={() => onEdit(item)}>
                        <i className="fa-solid fa-pen"></i>
                        <span>编辑分组</span>
                    </button>
                    <button type="button" className="qc-detail-action-btn qc-detail-action-btn--danger" onClick={() => onDelete(item)}>
                        <i className="fa-solid fa-trash"></i>
                        <span>删除分组</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- Main View ---

function QuickCommandsView({ model }: ViewComponentProps<QuickCommandsViewModel>) {
    const configPath = useMemo(() => `${getApi().getConfigDir()}/${QUICK_COMMANDS_CONFIG_FILE}`, []);
    const [config, setConfig] = useState<QuickCommandsConfig>(createEmptyQuickCommandsConfig());
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
    const [draggedParentGroupId, setDraggedParentGroupId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<QuickCommandDropTarget | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [newMenuOpen, setNewMenuOpen] = useState(false);

    useEffect(() => {
        if (statusMessage == null) {
            return;
        }
        const timeout = setTimeout(() => setStatusMessage(null), 2200);
        return () => clearTimeout(timeout);
    }, [statusMessage]);

    const loadConfig = useCallback(async () => {
        setLoading(true);
        try {
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: configPath } });
            const rawContent = fileData?.data64 ? base64ToString(fileData.data64) : "";
            const nextConfig = rawContent.trim() === "" ? createEmptyQuickCommandsConfig() : normalizeQuickCommandsConfig(JSON.parse(rawContent));
            setConfig(nextConfig);
            setExpandedIds(new Set(collectQuickCommandGroupIds(nextConfig.items)));
            setErrorMessage(null);
        } catch (err) {
            if (isMissingFileError(err)) {
                setConfig(createEmptyQuickCommandsConfig());
                setExpandedIds(new Set());
                setErrorMessage(null);
            } else {
                setConfig(createEmptyQuickCommandsConfig());
                setExpandedIds(new Set());
                setErrorMessage(`加载快捷命令失败：${err instanceof Error ? err.message : String(err)}`);
            }
        } finally {
            setLoading(false);
        }
    }, [configPath]);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    const persistConfig = useCallback(
        async (nextConfig: QuickCommandsConfig, successMessage: string) => {
            setSaving(true);
            try {
                const normalized = normalizeQuickCommandsConfig(nextConfig);
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: configPath },
                    data64: stringToBase64(stringifyQuickCommandsConfig(normalized)),
                });
                setConfig(normalized);
                setErrorMessage(null);
                setStatusMessage(successMessage);
                return true;
            } catch (err) {
                setErrorMessage(`保存快捷命令失败：${err instanceof Error ? err.message : String(err)}`);
                return false;
            } finally {
                setSaving(false);
            }
        },
        [configPath]
    );

    const pushCommandToTerminal = useCallback(async (item: QuickCommand, submit: boolean) => {
        try {
            const targetModel = getTargetTerminalModel(false);
            if (targetModel == null) {
                setErrorMessage("没有可用终端。请先聚焦或打开一个终端块。");
                return;
            }
            const data = submit ? ensureTrailingNewline(item.command) : item.command;
            targetModel.sendDataToController(data);
            setErrorMessage(null);
            setStatusMessage(submit ? `已执行：${item.name}` : `已粘贴到终端：${item.name}`);
        } catch (err) {
            setErrorMessage(`发送命令失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }, []);

    const pasteCommandToQuickInput = useCallback(async (item: QuickCommand) => {
        try {
            const targetModel = getTargetTerminalModel(true);
            if (targetModel == null) {
                setErrorMessage("没有支持快捷输入框的终端。请先聚焦或打开一个普通终端块。");
                return;
            }
            targetModel.setQuickInputValue(item.command);
            targetModel.focusQuickInput();
            setErrorMessage(null);
            setStatusMessage(`已填入快捷输入框：${item.name}`);
        } catch (err) {
            setErrorMessage(`填入快捷输入框失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }, []);

    const copyCommand = useCallback(async (item: QuickCommand) => {
        try {
            await navigator.clipboard.writeText(item.command);
            setStatusMessage(`已复制：${item.name}`);
            setErrorMessage(null);
        } catch (err) {
            setErrorMessage(`复制失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }, []);

    const toggleGroup = useCallback((groupId: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }, []);

    const openEditor = useCallback(
        (options: {
            itemType: "group" | "command";
            title: string;
            parentGroupId?: string | null;
            item?: QuickCommandItem;
        }) => {
            modalsModel.pushModal(QuickCommandEditModal.displayName || "QuickCommandEditModal", {
                itemType: options.itemType,
                title: options.title,
                initialValue: options.item
                    ? options.item.type === "group"
                        ? { name: options.item.name }
                        : { name: options.item.name, command: options.item.command, description: options.item.description }
                    : undefined,
                onSubmit: async (value: QuickCommandFormValue) => {
                    if (options.item) {
                        const updatedItem: QuickCommandItem =
                            options.item.type === "group"
                                ? { ...options.item, name: value.name }
                                : {
                                      ...options.item,
                                      name: value.name,
                                      command: value.command ?? "",
                                      description: value.description || undefined,
                                  };
                        const result = replaceQuickCommandItem(config.items, options.item.id, updatedItem);
                        if (!result.updated) {
                            setErrorMessage("未找到要编辑的快捷命令项。");
                            return false;
                        }
                        return persistConfig({ version: 1, items: result.items }, "保存成功");
                    }
                    const newItem: QuickCommandItem =
                        options.itemType === "group"
                            ? { id: crypto.randomUUID(), type: "group", name: value.name, items: [] }
                            : {
                                  id: crypto.randomUUID(),
                                  type: "command",
                                  name: value.name,
                                  command: value.command ?? "",
                                  description: value.description || undefined,
                              };
                    const result = insertQuickCommandItem(config.items, options.parentGroupId ?? null, newItem);
                    if (!result.inserted) {
                        setErrorMessage("未找到目标分组，无法创建快捷命令项。");
                        return false;
                    }
                    if (newItem.type === "group") {
                        setExpandedIds((prev) => new Set(prev).add(newItem.id));
                    }
                    if (options.parentGroupId) {
                        setExpandedIds((prev) => new Set(prev).add(options.parentGroupId));
                    }
                    setSelectedId(newItem.id);
                    return persistConfig({ version: 1, items: result.items }, "创建成功");
                },
            });
        },
        [config.items, persistConfig]
    );

    const deleteItem = useCallback(
        async (item: QuickCommandItem) => {
            const ok = window.confirm(item.type === "group" ? `删除分组"${item.name}"及其子项？` : `删除命令"${item.name}"？`);
            if (!ok) {
                return;
            }
            const result = removeQuickCommandItem(config.items, item.id);
            if (!result.removed) {
                setErrorMessage("未找到要删除的快捷命令项。");
                return;
            }
            if (selectedId === item.id) {
                setSelectedId(null);
            }
            await persistConfig({ version: 1, items: result.items }, "删除成功");
        },
        [config.items, persistConfig, selectedId]
    );

    const clearDragState = useCallback(() => {
        setDraggedItemId(null);
        setDraggedParentGroupId(null);
        setDropTarget(null);
    }, []);

    const dragEnabled = searchQuery.trim() === "" && !loading && !saving;

    const handleDragStart = useCallback(
        (itemId: string, parentGroupId: string | null, event: DragEvent<HTMLElement>) => {
            if (!dragEnabled) {
                event.preventDefault();
                return;
            }
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", itemId);
            setDraggedItemId(itemId);
            setDraggedParentGroupId(parentGroupId);
            setDropTarget(null);
        },
        [dragEnabled]
    );

    const handleDragOverItem = useCallback(
        (item: QuickCommandItem, parentGroupId: string | null, index: number, event: DragEvent<HTMLElement>) => {
            if (!dragEnabled || draggedItemId == null) {
                return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeY = event.clientY - rect.top;

            if (item.type === "group" && draggedItemId !== item.id) {
                const upperBound = rect.height * 0.28;
                const lowerBound = rect.height * 0.72;
                if (relativeY > upperBound && relativeY < lowerBound) {
                    event.preventDefault();
                    setDropTarget((prev) => {
                        if (prev?.type === "into-group" && prev.groupId === item.id) {
                            return prev;
                        }
                        return { type: "into-group", groupId: item.id };
                    });
                    return;
                }
            }

            if (draggedParentGroupId !== parentGroupId) {
                return;
            }

            event.preventDefault();
            const nextIndex = relativeY < rect.height / 2 ? index : index + 1;
            setDropTarget((prev) => {
                if (prev?.type === "reorder" && prev.parentGroupId === parentGroupId && prev.index === nextIndex) {
                    return prev;
                }
                return { type: "reorder", parentGroupId, index: nextIndex };
            });
        },
        [dragEnabled, draggedItemId, draggedParentGroupId]
    );

    const handleDrop = useCallback(
        async (event: DragEvent<HTMLElement>) => {
            if (!dragEnabled || draggedItemId == null || dropTarget == null) {
                clearDragState();
                return;
            }
            event.preventDefault();
            const activeDropTarget = dropTarget;
            const sourceParentGroupId = draggedParentGroupId;
            clearDragState();

            if (activeDropTarget.type === "reorder") {
                if (sourceParentGroupId !== activeDropTarget.parentGroupId) {
                    return;
                }
                const reordered = reorderQuickCommandItems(config.items, activeDropTarget.parentGroupId, draggedItemId, activeDropTarget.index);
                if (!reordered.moved) {
                    return;
                }
                await persistConfig({ version: 1, items: reordered.items }, "排序已更新");
                return;
            }

            const moved = moveQuickCommandItem(config.items, draggedItemId, activeDropTarget.groupId);
            if (!moved.moved) {
                return;
            }
            setExpandedIds((prev) => new Set(prev).add(activeDropTarget.groupId));
            await persistConfig({ version: 1, items: moved.items }, "已移动到分组");
        },
        [clearDragState, config.items, dragEnabled, draggedItemId, draggedParentGroupId, dropTarget, persistConfig]
    );

    const filteredItems = useMemo(() => filterQuickCommandItems(config.items, searchQuery), [config.items, searchQuery]);
    const visibleItems = searchQuery.trim() === "" ? config.items : filteredItems;
    const visibleExpandedIds = searchQuery.trim() === "" ? expandedIds : new Set(collectQuickCommandGroupIds(visibleItems));
    const visibleCommandCount = useMemo(() => countCommands(visibleItems), [visibleItems]);

    const selectedItem: SelectedItem = useMemo(() => {
        if (!selectedId) return null;
        const found = findItemById(visibleItems, selectedId);
        if (!found) return null;
        if (found.type === "command") return { type: "command", item: found };
        return { type: "group", item: found };
    }, [selectedId, visibleItems]);

    const selectItem = useCallback((item: QuickCommandItem) => {
        setSelectedId(item.id);
    }, []);

    const openItemMenu = useCallback(
        (item: QuickCommandItem, event: MouseEvent<HTMLElement>) => {
            const menu: ContextMenuItem[] = [];
            if (item.type === "group") {
                menu.push(
                    { label: "新建命令", click: () => openEditor({ itemType: "command", title: `新建命令 · ${item.name}`, parentGroupId: item.id }) },
                    { label: "新建子分组", click: () => openEditor({ itemType: "group", title: `新建分组 · ${item.name}`, parentGroupId: item.id }) },
                    { type: "separator" },
                    { label: expandedIds.has(item.id) ? "折叠分组" : "展开分组", click: () => toggleGroup(item.id) },
                    { label: "编辑分组", click: () => openEditor({ itemType: "group", title: `编辑分组 · ${item.name}`, item }) },
                    { label: "删除分组", click: () => deleteItem(item) }
                );
            } else {
                menu.push(
                    { label: "立即执行", click: () => void pushCommandToTerminal(item, true) },
                    { label: "粘贴到终端", click: () => void pushCommandToTerminal(item, false) },
                    { label: "复制命令", click: () => void copyCommand(item) },
                    { label: "粘贴到快捷输入框", click: () => void pasteCommandToQuickInput(item) },
                    { type: "separator" },
                    { label: "编辑命令", click: () => openEditor({ itemType: "command", title: `编辑命令 · ${item.name}`, item }) },
                    { label: "删除命令", click: () => void deleteItem(item) }
                );
            }
            ContextMenuModel.getInstance().showContextMenu(menu, event);
        },
        [copyCommand, deleteItem, expandedIds, openEditor, pasteCommandToQuickInput, pushCommandToTerminal, toggleGroup]
    );

    return (
        <div className="qc-layout">
            {/* Sidebar */}
            <div className="qc-sidebar">
                <div className="qc-sidebar-header">
                    <div className="qc-sidebar-title">
                        <i className="fa-solid fa-bolt text-accent"></i>
                        <span>快捷命令</span>
                    </div>
                    <div className="qc-sidebar-new-btn">
                        <button
                            type="button"
                            className="qc-new-dropdown-trigger"
                            onClick={() => setNewMenuOpen((v) => !v)}
                        >
                            <i className="fa-solid fa-plus"></i>
                        </button>
                        {newMenuOpen && (
                            <div className="qc-new-dropdown">
                                <button
                                    type="button"
                                    className="qc-new-dropdown-item"
                                    onClick={() => {
                                        setNewMenuOpen(false);
                                        openEditor({ itemType: "command", title: "新建命令", parentGroupId: null });
                                    }}
                                >
                                    <i className="fa-solid fa-bolt mr-2 text-xs"></i>新建命令
                                </button>
                                <button
                                    type="button"
                                    className="qc-new-dropdown-item"
                                    onClick={() => {
                                        setNewMenuOpen(false);
                                        openEditor({ itemType: "group", title: "新建分组", parentGroupId: null });
                                    }}
                                >
                                    <i className="fa-solid fa-folder-plus mr-2 text-xs"></i>新建分组
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="qc-sidebar-search">
                    <Input
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="搜索命令..."
                        className="!h-[28px] !text-xs"
                    />
                </div>

                <div className="qc-sidebar-list">
                    {loading ? (
                        <div className="qc-sidebar-loading">加载中...</div>
                    ) : config.items.length === 0 ? (
                        <div className="qc-sidebar-empty">
                            <i className="fa-solid fa-inbox text-2xl text-secondary/30"></i>
                            <div className="text-xs text-secondary/60 mt-2">暂无命令</div>
                        </div>
                    ) : visibleItems.length === 0 ? (
                        <div className="qc-sidebar-empty">
                            <i className="fa-solid fa-search text-2xl text-secondary/30"></i>
                            <div className="text-xs text-secondary/60 mt-2">无匹配结果</div>
                        </div>
                    ) : (
                        <SidebarTree
                            items={visibleItems}
                            depth={0}
                            parentGroupId={null}
                            expandedIds={visibleExpandedIds}
                            selectedId={selectedId}
                            dragEnabled={dragEnabled}
                            draggedItemId={draggedItemId}
                            dropTarget={dropTarget}
                            onToggleGroup={toggleGroup}
                            onSelectItem={selectItem}
                            onOpenMenu={openItemMenu}
                            onDragStart={handleDragStart}
                            onDragOverItem={handleDragOverItem}
                            onDrop={(event) => void handleDrop(event)}
                            onDragEnd={clearDragState}
                        />
                    )}
                </div>

                <div className="qc-sidebar-footer">
                    <button type="button" className="qc-sidebar-footer-btn" onClick={() => loadConfig()} disabled={loading || saving} title="刷新">
                        <i className="fa-solid fa-arrows-rotate text-xs"></i>
                    </button>
                    <span className="text-[10px] text-secondary/50">{visibleCommandCount} 条命令</span>
                    {saving && <span className="text-[10px] text-accent">保存中...</span>}
                </div>
            </div>

            {/* Detail Panel */}
            <div className="qc-detail">
                {errorMessage ? <div className="qc-toast qc-toast--error">{errorMessage}</div> : null}
                {statusMessage ? <div className="qc-toast qc-toast--success">{statusMessage}</div> : null}

                {!selectedItem ? (
                    <DetailOverview config={config} onOpenEditor={openEditor} />
                ) : selectedItem.type === "command" ? (
                    <DetailCommand
                        item={selectedItem.item}
                        onRunCommand={(item) => void pushCommandToTerminal(item, true)}
                        onPasteCommand={(item) => void pushCommandToTerminal(item, false)}
                        onPasteQuickInput={(item) => void pasteCommandToQuickInput(item)}
                        onCopyCommand={(item) => void copyCommand(item)}
                        onEdit={(item) => openEditor({ itemType: "command", title: `编辑命令 · ${item.name}`, item })}
                        onDelete={(item) => void deleteItem(item)}
                    />
                ) : (
                    <DetailGroup
                        item={selectedItem.item}
                        expandedIds={expandedIds}
                        onToggleGroup={toggleGroup}
                        onSelectItem={selectItem}
                        onRunCommand={(item) => void pushCommandToTerminal(item, true)}
                        onPasteCommand={(item) => void pushCommandToTerminal(item, false)}
                        onCopyCommand={(item) => void copyCommand(item)}
                        onOpenMenu={openItemMenu}
                        onEdit={(item) => openEditor({ itemType: item.type, title: `编辑${item.type === "group" ? "分组" : "命令"} · ${item.name}`, item })}
                        onDelete={(item) => void deleteItem(item)}
                        onAddCommand={(groupId) => openEditor({ itemType: "command", title: "新建命令", parentGroupId: groupId })}
                    />
                )}

                <div className="qc-detail-footer">
                    <span className="font-mono text-[10px] text-secondary/40">{QUICK_COMMANDS_CONFIG_FILE}</span>
                    {searchQuery.trim() !== "" && <span className="text-[10px] text-secondary/40 ml-2">搜索时暂停拖拽</span>}
                    <span className="text-[10px] text-secondary/40 ml-auto">{model.blockId}</span>
                </div>
            </div>
        </div>
    );
}

export { QuickCommandsView };
