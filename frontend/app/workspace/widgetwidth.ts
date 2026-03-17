// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { findParent } from "@/layout/lib/layoutNode";
import { FlexDirection, type LayoutNode } from "@/layout/lib/types";

const MinWidgetWidthPercent = 15;
const MaxWidgetWidthPercent = 85;

function clampWidgetWidth(width: number): number {
    return Math.max(MinWidgetWidthPercent, Math.min(MaxWidgetWidthPercent, Math.round(width)));
}

function getWidgetPreferredWidth(widget: WidgetConfigType): number | undefined {
    const width = widget?.["display:width"];
    if (typeof width !== "number" || !Number.isFinite(width)) {
        return undefined;
    }
    return clampWidgetWidth(width);
}

function getHorizontalSplitSizes(
    currentNodeSize: number,
    preferredWidth: number
): { currentSize: number; newSize: number } {
    const totalSize = Math.max(currentNodeSize, 1);
    const width = clampWidgetWidth(preferredWidth);
    return {
        currentSize: (totalSize * (100 - width)) / 100,
        newSize: (totalSize * width) / 100,
    };
}

function getOpenWidgetWidthPercent(rootNode?: LayoutNode, widgetNode?: LayoutNode): number | undefined {
    if (rootNode == null || widgetNode == null) {
        return undefined;
    }
    const parentNode = findParent(rootNode, widgetNode.id);
    if (parentNode?.children == null || parentNode.flexDirection !== FlexDirection.Row) {
        return undefined;
    }
    const widgetIndex = parentNode.children.findIndex((child) => child.id === widgetNode.id);
    if (widgetIndex === -1) {
        return undefined;
    }
    const siblingNode = parentNode.children[widgetIndex - 1] ?? parentNode.children[widgetIndex + 1];
    if (siblingNode == null) {
        return undefined;
    }
    const totalSize = widgetNode.size + siblingNode.size;
    if (totalSize <= 0) {
        return undefined;
    }
    return Math.round((widgetNode.size / totalSize) * 100);
}

function getHorizontalResizeTargets(
    rootNode?: LayoutNode,
    widgetNode?: LayoutNode
): { currentNode: LayoutNode; siblingNode: LayoutNode } | undefined {
    if (rootNode == null || widgetNode == null) {
        return undefined;
    }
    const parentNode = findParent(rootNode, widgetNode.id);
    if (parentNode?.children == null || parentNode.flexDirection !== FlexDirection.Row) {
        return undefined;
    }
    const widgetIndex = parentNode.children.findIndex((child) => child.id === widgetNode.id);
    if (widgetIndex === -1) {
        return undefined;
    }
    const siblingNode = parentNode.children[widgetIndex - 1] ?? parentNode.children[widgetIndex + 1];
    if (siblingNode == null) {
        return undefined;
    }
    return {
        currentNode: widgetNode,
        siblingNode,
    };
}

export {
    clampWidgetWidth,
    getHorizontalResizeTargets,
    getHorizontalSplitSizes,
    getOpenWidgetWidthPercent,
    getWidgetPreferredWidth,
    MaxWidgetWidthPercent,
    MinWidgetWidthPercent,
};
