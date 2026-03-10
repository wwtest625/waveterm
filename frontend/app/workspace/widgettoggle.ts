// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type WidgetToggleAction =
    | { type: "create" }
    | { type: "focus"; blockId: string }
    | { type: "close"; blockId: string };

function getWidgetToggleAction(
    trackedBlockId: string | undefined,
    activeBlockIds: string[],
    focusedBlockId?: string
): WidgetToggleAction {
    if (trackedBlockId == null || !activeBlockIds.includes(trackedBlockId)) {
        return { type: "create" };
    }
    if (focusedBlockId === trackedBlockId) {
        return { type: "close", blockId: trackedBlockId };
    }
    return { type: "focus", blockId: trackedBlockId };
}

export { getWidgetToggleAction };
export type { WidgetToggleAction };