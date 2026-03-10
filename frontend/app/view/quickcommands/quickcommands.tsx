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
import { base64ToString } from "@/util/util";
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

const rowButtonClass = "rounded border border-border px-2 py-1 text-xs text-secondary hover:text-primary hover:bg-hoverbg";

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

function QuickCommandTree({
    items,
    depth,
    parentGroupId,
    expandedIds,
    dragEnabled,
    draggedItemId,
    dropTarget,
    onToggleGroup,
    onRunCommand,
    onPasteCommand,
    onCopyCommand,
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
    dragEnabled: boolean;
    draggedItemId: string | null;
    dropTarget: QuickCommandDropTarget | null;
    onToggleGroup: (groupId: string) => void;
    onRunCommand: (item: QuickCommand) => void;
    onPasteCommand: (item: QuickCommand) => void;
    onCopyCommand: (item: QuickCommand) => void;
    onOpenMenu: (item: QuickCommandItem, event: MouseEvent<HTMLElement>) => void;
    onDragStart: (itemId: string, parentGroupId: string | null, event: DragEvent<HTMLElement>) => void;
    onDragOverItem: (item: QuickCommandItem, parentGroupId: string | null, index: number, event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
}) {
    return items.map((item, index) => {
        const paddingLeft = 14 + depth * 18;
        const showDropBefore = dropTarget?.type === "reorder" && dropTarget.parentGroupId === parentGroupId && dropTarget.index === index;
        const showDropAfter = dropTarget?.type === "reorder" && dropTarget.parentGroupId === parentGroupId && dropTarget.index === index + 1;
        const isDragging = draggedItemId === item.id;
        const isDropIntoGroup = item.type === "group" && dropTarget?.type === "into-group" && dropTarget.groupId === item.id;
        if (item.type === "group") {
            const expanded = expandedIds.has(item.id);
            return (
                <div key={item.id}>
                    <div
                        className={clsx(
                            "relative flex items-center gap-2 border-b border-white/5 py-2 pr-3 hover:bg-white/5",
                            isDragging && "opacity-40",
                            isDropIntoGroup && "bg-accent/10"
                        )}
                        style={{ paddingLeft }}
                        onContextMenu={(e) => onOpenMenu(item, e)}
                        onDragOver={(e) => onDragOverItem(item, parentGroupId, index, e)}
                        onDrop={onDrop}
                    >
                        {showDropBefore ? <div className="pointer-events-none absolute inset-x-0 top-0 border-t-2 border-accent/80" /> : null}
                        {isDropIntoGroup ? <div className="pointer-events-none absolute inset-0 border border-accent/70" /> : null}
                        <button
                            type="button"
                            draggable={dragEnabled}
                            className={clsx("text-secondary hover:text-primary", dragEnabled ? "cursor-grab" : "cursor-default opacity-40")}
                            title={dragEnabled ? "拖拽排序 / 拖入分组" : "搜索时暂不支持拖拽"}
                            onDragStart={(e) => onDragStart(item.id, parentGroupId, e)}
                            onDragEnd={onDragEnd}
                        >
                            <i className="fa-solid fa-grip-vertical text-xs"></i>
                        </button>
                        <button type="button" className="text-secondary hover:text-primary" onClick={() => onToggleGroup(item.id)}>
                            <i className={clsx("fa-solid text-xs", expanded ? "fa-chevron-down" : "fa-chevron-right")}></i>
                        </button>
                        <button
                            type="button"
                            className="min-w-0 flex-1 text-left text-sm font-medium text-primary"
                            onClick={() => onToggleGroup(item.id)}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <i className="fa-sharp fa-solid fa-folder-open text-xs text-secondary/90"></i>
                                <span className="truncate">{item.name}</span>
                                <span className="shrink-0 text-xs text-secondary">{item.items.length}</span>
                            </span>
                        </button>
                        <button type="button" className={rowButtonClass} onClick={(e) => onOpenMenu(item, e)}>
                            更多
                        </button>
                        {showDropAfter ? <div className="pointer-events-none absolute inset-x-0 bottom-0 border-b-2 border-accent/80" /> : null}
                    </div>
                    {expanded ? (
                        <QuickCommandTree
                            items={item.items}
                            depth={depth + 1}
                            parentGroupId={item.id}
                            expandedIds={expandedIds}
                            dragEnabled={dragEnabled}
                            draggedItemId={draggedItemId}
                            dropTarget={dropTarget}
                            onToggleGroup={onToggleGroup}
                            onRunCommand={onRunCommand}
                            onPasteCommand={onPasteCommand}
                            onCopyCommand={onCopyCommand}
                            onOpenMenu={onOpenMenu}
                            onDragStart={onDragStart}
                            onDragOverItem={onDragOverItem}
                            onDrop={onDrop}
                            onDragEnd={onDragEnd}
                        />
                    ) : null}
                </div>
            );
        }
        return (
            <div
                key={item.id}
                className={clsx("relative flex items-center gap-2 border-b border-white/5 py-2 pr-3 hover:bg-white/5", isDragging && "opacity-40")}
                style={{ paddingLeft }}
                onContextMenu={(e) => onOpenMenu(item, e)}
                onDragOver={(e) => onDragOverItem(item, parentGroupId, index, e)}
                onDrop={onDrop}
            >
                {showDropBefore ? <div className="pointer-events-none absolute inset-x-0 top-0 border-t-2 border-accent/80" /> : null}
                <div
                    draggable={dragEnabled}
                    className={clsx("flex-1 min-w-0", dragEnabled ? "cursor-grab" : "cursor-default")}
                    title={dragEnabled ? "拖拽排序 / 拖入分组" : "搜索时暂不支持拖拽"}
                    onDragStart={(e) => onDragStart(item.id, parentGroupId, e)}
                    onDragEnd={onDragEnd}
                >
                    <div className="flex items-center gap-2 truncate text-sm text-primary">
                        <i className="fa-sharp fa-solid fa-terminal text-xs text-secondary/90"></i>
                        <span className="truncate">{item.name}</span>
                    </div>
                    {item.description ? <div className="truncate text-xs text-secondary/80">{item.description}</div> : null}
                </div>
                <button type="button" className={rowButtonClass} onClick={() => onRunCommand(item)}>
                    执行
                </button>
                <button type="button" className={rowButtonClass} onClick={() => onPasteCommand(item)}>
                    粘贴
                </button>
                <button type="button" className={rowButtonClass} onClick={() => onCopyCommand(item)}>
                    复制
                </button>
                <button type="button" className={rowButtonClass} onClick={(e) => onOpenMenu(item, e)}>
                    更多
                </button>
                {showDropAfter ? <div className="pointer-events-none absolute inset-x-0 bottom-0 border-b-2 border-accent/80" /> : null}
            </div>
        );
    });
}

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
                    return persistConfig({ version: 1, items: result.items }, "创建成功");
                },
            });
        },
        [config.items, persistConfig]
    );

    const deleteItem = useCallback(
        async (item: QuickCommandItem) => {
            const ok = window.confirm(item.type === "group" ? `删除分组“${item.name}”及其子项？` : `删除命令“${item.name}”？`);
            if (!ok) {
                return;
            }
            const result = removeQuickCommandItem(config.items, item.id);
            if (!result.removed) {
                setErrorMessage("未找到要删除的快捷命令项。");
                return;
            }
            await persistConfig({ version: 1, items: result.items }, "删除成功");
        },
        [config.items, persistConfig]
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
        <div className="flex h-full w-full min-w-0 flex-col bg-black/10 text-primary">
            <div className="flex w-full flex-wrap items-start justify-between gap-3 border-b border-white/8 px-4 py-3">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">快捷命令</div>
                    <div className="text-xs text-secondary">当前版本支持分组、执行、粘贴到终端、粘贴到快捷输入框、复制、CRUD、排序，以及拖拽放入分组。</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Input
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="搜索名称、描述、命令内容"
                        className="!h-[30px] w-[220px] max-w-full"
                    />
                    <Button className="!h-[30px] !px-3 !text-xs" onClick={() => openEditor({ itemType: "command", title: "新建命令", parentGroupId: null })}>
                        新建命令
                    </Button>
                    <Button className="secondary !h-[30px] !px-3 !text-xs" onClick={() => openEditor({ itemType: "group", title: "新建分组", parentGroupId: null })}>
                        新建分组
                    </Button>
                    <Button className="grey ghost !h-[30px] !px-3 !text-xs" onClick={() => loadConfig()} disabled={loading || saving}>
                        刷新
                    </Button>
                </div>
            </div>

            {errorMessage ? <div className="mx-4 mt-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{errorMessage}</div> : null}
            {statusMessage ? <div className="mx-4 mt-3 rounded bg-green-500/10 px-3 py-2 text-sm text-green-300">{statusMessage}</div> : null}

            <div className="flex-1 w-full min-w-0 overflow-auto px-0 py-2">
                {loading ? (
                    <div className="px-4 py-6 text-sm text-secondary">正在加载快捷命令…</div>
                ) : config.items.length === 0 ? (
                    <div className="mx-4 mt-4 rounded border border-dashed border-border bg-panel px-4 py-6">
                        <div className="text-sm font-medium text-primary">还没有快捷命令</div>
                        <div className="mt-1 text-sm text-secondary">你可以先创建分组，再往分组里添加命令；也可以直接创建根级命令。</div>
                    </div>
                ) : visibleItems.length === 0 ? (
                    <div className="mx-4 mt-4 rounded border border-dashed border-border bg-panel px-4 py-6">
                        <div className="text-sm font-medium text-primary">没有匹配结果</div>
                        <div className="mt-1 text-sm text-secondary">试试搜索命令名称、描述或具体命令内容。</div>
                    </div>
                ) : (
                    <QuickCommandTree
                        items={visibleItems}
                        depth={0}
                        parentGroupId={null}
                        expandedIds={visibleExpandedIds}
                        dragEnabled={dragEnabled}
                        draggedItemId={draggedItemId}
                        dropTarget={dropTarget}
                        onToggleGroup={toggleGroup}
                        onRunCommand={(item) => void pushCommandToTerminal(item, true)}
                        onPasteCommand={(item) => void pushCommandToTerminal(item, false)}
                        onCopyCommand={(item) => void copyCommand(item)}
                        onOpenMenu={openItemMenu}
                        onDragStart={handleDragStart}
                        onDragOverItem={handleDragOverItem}
                        onDrop={(event) => void handleDrop(event)}
                        onDragEnd={clearDragState}
                    />
                )}
            </div>

            <div className="border-t border-white/8 px-4 py-2 text-xs text-secondary">
                配置文件：<span className="font-mono text-primary">{QUICK_COMMANDS_CONFIG_FILE}</span>
                {saving ? <span className="ml-2 text-primary">保存中…</span> : null}
                {searchQuery.trim() !== "" ? <span className="ml-2">搜索结果：{visibleCommandCount} 条命令</span> : null}
                {searchQuery.trim() !== "" ? <span className="ml-2">搜索时已暂停拖拽</span> : null}
                <span className="ml-2">当前块：{model.blockId}</span>
            </div>
        </div>
    );
}

export { QuickCommandsView };