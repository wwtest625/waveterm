// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const widgetOpenBlockIdsByTabId = new Map<string, Record<string, string>>();

function getTrackedWidgetBlockIds(tabId: string): Record<string, string> {
    let trackedBlockIds = widgetOpenBlockIdsByTabId.get(tabId);
    if (trackedBlockIds == null) {
        trackedBlockIds = {};
        widgetOpenBlockIdsByTabId.set(tabId, trackedBlockIds);
    }
    return trackedBlockIds;
}

function getTrackedWidgetBlockId(tabId: string, widgetKey: string): string | undefined {
    return getTrackedWidgetBlockIds(tabId)[widgetKey];
}

function getTrackedWidgetKey(tabId: string, blockId: string): string | undefined {
    const trackedBlockIds = getTrackedWidgetBlockIds(tabId);
    return Object.entries(trackedBlockIds).find(([, trackedBlockId]) => trackedBlockId === blockId)?.[0];
}

export { getTrackedWidgetBlockId, getTrackedWidgetBlockIds, getTrackedWidgetKey };
