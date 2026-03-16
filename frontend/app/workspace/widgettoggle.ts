// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type WidgetToggleAction =
    | { type: "create" }
    | { type: "focus"; blockId: string }
    | { type: "close"; blockId: string };

function isWidgetOpen(trackedBlockId: string | undefined, activeBlockIds: string[]): boolean {
    return trackedBlockId != null && activeBlockIds.includes(trackedBlockId);
}

function getWidgetToggleAction(
    trackedBlockId: string | undefined,
    activeBlockIds: string[],
    focusedBlockId?: string
): WidgetToggleAction {
    if (!isWidgetOpen(trackedBlockId, activeBlockIds)) {
        return { type: "create" };
    }
    if (focusedBlockId === trackedBlockId) {
        return { type: "close", blockId: trackedBlockId };
    }
    return { type: "focus", blockId: trackedBlockId };
}

export { getWidgetToggleAction };
export { isWidgetOpen };
export type { WidgetToggleAction };
