// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { setWidgetWidthInFileContent } from "@/app/workspace/widgetconfig";
import { getTrackedWidgetKey } from "@/app/workspace/widgetopenstate";
import { getHorizontalResizeTargets, getHorizontalSplitSizes, getOpenWidgetWidthPercent } from "@/app/workspace/widgetwidth";
import { getLayoutStateAtomFromTab } from "@/layout/lib/layoutAtom";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
import { LayoutTreeActionType, type LayoutTreeResizeNodeAction } from "@/layout/lib/types";
import { atoms, getApi, globalStore } from "@/store/global";
import { base64ToString, fireAndForget, stringToBase64 } from "@/util/util";

const BlockWidthPresets = [25, 33, 40, 50, 60, 75];

type WidgetWidthMenuOptions = {
    blockId: string;
    tabModel: TabModel;
};

function getWidgetWidthMenuItems({ blockId, tabModel }: WidgetWidthMenuOptions): ContextMenuItem[] {
    const layoutStateAtom = getLayoutStateAtomFromTab(tabModel.tabAtom, globalStore.get);
    if (layoutStateAtom == null) {
        return [];
    }
    const layoutState = globalStore.get(layoutStateAtom);
    const layoutModel = getLayoutModelForStaticTab();
    const blockNode = layoutModel.getNodeByBlockId(blockId);
    const resizeTargets = getHorizontalResizeTargets(layoutState?.rootnode, blockNode);
    if (resizeTargets == null) {
        return [];
    }

    const currentWidth = getOpenWidgetWidthPercent(layoutState?.rootnode, blockNode);
    const menuItems: ContextMenuItem[] = [];
    if (currentWidth != null) {
        menuItems.push({
            label: `Current Width: ${currentWidth}%`,
            enabled: false,
        });
        menuItems.push({ type: "separator" });
    }

    for (const width of BlockWidthPresets) {
        menuItems.push({
            label: `${width}%`,
            type: "checkbox",
            checked: currentWidth === width,
            click: () => {
                const splitSizes = getHorizontalSplitSizes(
                    resizeTargets.currentNode.size + resizeTargets.siblingNode.size,
                    width
                );
                const resizeAction: LayoutTreeResizeNodeAction = {
                    type: LayoutTreeActionType.ResizeNode,
                    resizeOperations: [
                        { nodeId: resizeTargets.siblingNode.id, size: splitSizes.currentSize },
                        { nodeId: resizeTargets.currentNode.id, size: splitSizes.newSize },
                    ],
                };
                layoutModel.treeReducer(resizeAction);
                fireAndForget(() => persistWidgetWidthSelection(blockId, tabModel, width));
            },
        });
    }

    return menuItems;
}

async function persistWidgetWidthSelection(blockId: string, tabModel: TabModel, width: number): Promise<void> {
    const widgetKey = getTrackedWidgetKey(tabModel.tabId, blockId);
    if (widgetKey == null) {
        return;
    }

    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const existingWidgetConfig = fullConfig?.widgets?.[widgetKey] ?? fullConfig?.defaultwidgets?.[widgetKey];
    if (fullConfig != null && existingWidgetConfig != null) {
        globalStore.set(atoms.fullConfigAtom, {
            ...fullConfig,
            widgets: {
                ...(fullConfig.widgets ?? {}),
                [widgetKey]: {
                    ...existingWidgetConfig,
                    "display:width": width,
                },
            },
        });
    }

    const widgetsPath = `${getApi().getConfigDir()}/widgets.json`;
    let widgetsFileContent = "";
    try {
        const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
            info: { path: widgetsPath },
        });
        widgetsFileContent = fileData?.data64 ? base64ToString(fileData.data64) : "";
    } catch (error) {
        console.warn("Failed to read widgets.json before persisting widget width:", error);
    }

    const nextFileContent = setWidgetWidthInFileContent(widgetsFileContent, widgetKey, width);
    try {
        await RpcApi.FileWriteCommand(TabRpcClient, {
            info: { path: widgetsPath },
            data64: stringToBase64(nextFileContent),
        });
    } catch (error) {
        console.warn("Failed to persist widget width to widgets.json:", error);
    }
}

async function persistPreviewDefaultDirectorySelection(directoryPath: string): Promise<void> {
    const trimmedPath = directoryPath.trim();
    try {
        await RpcApi.SetConfigCommand(TabRpcClient, {
            "preview:defaultdir": trimmedPath,
        });
    } catch (error) {
        console.warn("Failed to persist preview default directory:", error);
    }
}

export { getWidgetWidthMenuItems, persistPreviewDefaultDirectorySelection, persistWidgetWidthSelection };
