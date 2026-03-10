// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const QUICK_COMMANDS_CONFIG_FILE = "quickcommands.json";

export type QuickCommandGroup = {
    id: string;
    type: "group";
    name: string;
    items: QuickCommandItem[];
};

export type QuickCommand = {
    id: string;
    type: "command";
    name: string;
    command: string;
    description?: string;
};

export type QuickCommandItem = QuickCommandGroup | QuickCommand;

export type QuickCommandsConfig = {
    version: 1;
    items: QuickCommandItem[];
};

function normalizeText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeCommandText(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function normalizeItem(value: unknown): QuickCommandItem | null {
    if (value == null || typeof value !== "object") {
        return null;
    }
    const raw = value as Record<string, unknown>;
    const type = raw.type;
    const id = normalizeText(raw.id) || crypto.randomUUID();
    const name = normalizeText(raw.name);
    if (name === "") {
        return null;
    }
    if (type === "group") {
        const rawItems = Array.isArray(raw.items) ? raw.items : [];
        return {
            id,
            type: "group",
            name,
            items: rawItems.map(normalizeItem).filter(Boolean),
        } as QuickCommandGroup;
    }
    const command = normalizeCommandText(raw.command);
    if (command === "") {
        return null;
    }
    const description = normalizeText(raw.description);
    return {
        id,
        type: "command",
        name,
        command,
        description: description || undefined,
    };
}

export function createEmptyQuickCommandsConfig(): QuickCommandsConfig {
    return { version: 1, items: [] };
}

export function normalizeQuickCommandsConfig(value: unknown): QuickCommandsConfig {
    if (value == null || typeof value !== "object") {
        return createEmptyQuickCommandsConfig();
    }
    const raw = value as Record<string, unknown>;
    const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : [];
    return { version: 1, items: items as QuickCommandItem[] };
}

export function stringifyQuickCommandsConfig(config: QuickCommandsConfig): string {
    return JSON.stringify(normalizeQuickCommandsConfig(config), null, 4);
}

export function collectQuickCommandGroupIds(items: QuickCommandItem[]): string[] {
    return items.flatMap((item) => {
        if (item.type !== "group") {
            return [];
        }
        return [item.id, ...collectQuickCommandGroupIds(item.items)];
    });
}

function matchesQuickCommandText(value: string | undefined, searchText: string): boolean {
    return (value ?? "").toLocaleLowerCase().includes(searchText);
}

export function filterQuickCommandItems(items: QuickCommandItem[], query: string): QuickCommandItem[] {
    const searchText = query.trim().toLocaleLowerCase();
    if (searchText === "") {
        return items;
    }
    return items.flatMap((item) => {
        if (item.type === "command") {
            const matched =
                matchesQuickCommandText(item.name, searchText) ||
                matchesQuickCommandText(item.command, searchText) ||
                matchesQuickCommandText(item.description, searchText);
            return matched ? [item] : [];
        }
        const groupMatched = matchesQuickCommandText(item.name, searchText);
        if (groupMatched) {
            return [item];
        }
        const filteredChildren = filterQuickCommandItems(item.items, query);
        if (filteredChildren.length === 0) {
            return [];
        }
        return [{ ...item, items: filteredChildren }];
    });
}

export function replaceQuickCommandItem(items: QuickCommandItem[], targetId: string, nextItem: QuickCommandItem) {
    let updated = false;
    const nextItems = items.map((item) => {
        if (item.id === targetId) {
            updated = true;
            return nextItem;
        }
        if (item.type !== "group") {
            return item;
        }
        const nested = replaceQuickCommandItem(item.items, targetId, nextItem);
        if (!nested.updated) {
            return item;
        }
        updated = true;
        return { ...item, items: nested.items };
    });
    return { items: nextItems, updated };
}

export function removeQuickCommandItem(items: QuickCommandItem[], targetId: string) {
    let removed = false;
    const nextItems: QuickCommandItem[] = [];
    for (const item of items) {
        if (item.id === targetId) {
            removed = true;
            continue;
        }
        if (item.type === "group") {
            const nested = removeQuickCommandItem(item.items, targetId);
            if (nested.removed) {
                removed = true;
                nextItems.push({ ...item, items: nested.items });
                continue;
            }
        }
        nextItems.push(item);
    }
    return { items: nextItems, removed };
}

export function insertQuickCommandItem(items: QuickCommandItem[], parentGroupId: string | null, nextItem: QuickCommandItem) {
    if (parentGroupId == null) {
        return { items: [...items, nextItem], inserted: true };
    }
    let inserted = false;
    const nextItems = items.map((item) => {
        if (item.type !== "group") {
            return item;
        }
        if (item.id === parentGroupId) {
            inserted = true;
            return { ...item, items: [...item.items, nextItem] };
        }
        const nested = insertQuickCommandItem(item.items, parentGroupId, nextItem);
        if (!nested.inserted) {
            return item;
        }
        inserted = true;
        return { ...item, items: nested.items };
    });
    return { items: nextItems, inserted };
}

function findQuickCommandItem(items: QuickCommandItem[], targetId: string): QuickCommandItem | null {
    for (const item of items) {
        if (item.id === targetId) {
            return item;
        }
        if (item.type === "group") {
            const nested = findQuickCommandItem(item.items, targetId);
            if (nested != null) {
                return nested;
            }
        }
    }
    return null;
}

function groupContainsItem(group: QuickCommandGroup, targetId: string): boolean {
    return group.items.some((item) => item.id === targetId || (item.type === "group" && groupContainsItem(item, targetId)));
}

export function moveQuickCommandItem(items: QuickCommandItem[], draggedId: string, targetGroupId: string | null) {
    if (draggedId === targetGroupId) {
        return { items, moved: false };
    }

    const draggedItem = findQuickCommandItem(items, draggedId);
    if (draggedItem == null) {
        return { items, moved: false };
    }

    if (draggedItem.type === "group" && targetGroupId != null && groupContainsItem(draggedItem, targetGroupId)) {
        return { items, moved: false };
    }

    const removed = removeQuickCommandItem(items, draggedId);
    if (!removed.removed) {
        return { items, moved: false };
    }

    const inserted = insertQuickCommandItem(removed.items, targetGroupId, draggedItem);
    if (!inserted.inserted) {
        return { items, moved: false };
    }

    return { items: inserted.items, moved: true };
}

function reorderQuickCommandList(items: QuickCommandItem[], draggedId: string, targetIndex: number) {
    const sourceIndex = items.findIndex((item) => item.id === draggedId);
    if (sourceIndex === -1) {
        return { items, moved: false };
    }
    const boundedTargetIndex = Math.max(0, Math.min(targetIndex, items.length));
    const adjustedTargetIndex = sourceIndex < boundedTargetIndex ? boundedTargetIndex - 1 : boundedTargetIndex;
    if (sourceIndex === adjustedTargetIndex) {
        return { items, moved: false };
    }
    const nextItems = [...items];
    const [movedItem] = nextItems.splice(sourceIndex, 1);
    nextItems.splice(adjustedTargetIndex, 0, movedItem);
    return { items: nextItems, moved: true };
}

export function reorderQuickCommandItems(
    items: QuickCommandItem[],
    parentGroupId: string | null,
    draggedId: string,
    targetIndex: number
) {
    if (parentGroupId == null) {
        return reorderQuickCommandList(items, draggedId, targetIndex);
    }
    let moved = false;
    const nextItems = items.map((item) => {
        if (item.type !== "group") {
            return item;
        }
        if (item.id === parentGroupId) {
            const reordered = reorderQuickCommandList(item.items, draggedId, targetIndex);
            if (!reordered.moved) {
                return item;
            }
            moved = true;
            return { ...item, items: reordered.items };
        }
        const nested = reorderQuickCommandItems(item.items, parentGroupId, draggedId, targetIndex);
        if (!nested.moved) {
            return item;
        }
        moved = true;
        return { ...item, items: nested.items };
    });
    return { items: nextItems, moved };
}