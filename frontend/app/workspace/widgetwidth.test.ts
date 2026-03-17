// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FlexDirection } from "@/layout/lib/types";
import { assert, test } from "vitest";
import {
    clampWidgetWidth,
    getHorizontalSplitSizes,
    getOpenWidgetWidthPercent,
    getWidgetPreferredWidth,
} from "./widgetwidth";

test("clampWidgetWidth keeps preferred widths inside the supported range", () => {
    assert.equal(clampWidgetWidth(10), 15);
    assert.equal(clampWidgetWidth(42), 42);
    assert.equal(clampWidgetWidth(99), 85);
});

test("getWidgetPreferredWidth returns undefined when width is missing", () => {
    assert.equal(getWidgetPreferredWidth({ blockdef: {} } as WidgetConfigType), undefined);
});

test("getWidgetPreferredWidth clamps configured widget widths", () => {
    assert.equal(getWidgetPreferredWidth({ "display:width": 12, blockdef: {} } as WidgetConfigType), 15);
    assert.equal(getWidgetPreferredWidth({ "display:width": 36, blockdef: {} } as WidgetConfigType), 36);
    assert.equal(getWidgetPreferredWidth({ "display:width": 90, blockdef: {} } as WidgetConfigType), 85);
});

test("getHorizontalSplitSizes preserves total node size while allocating widget width", () => {
    const sizes = getHorizontalSplitSizes(10, 30);
    assert.equal(sizes.currentSize, 7);
    assert.equal(sizes.newSize, 3);
});

test("getOpenWidgetWidthPercent derives the current width from a horizontal split", () => {
    const siblingNode = { id: "left", flexDirection: FlexDirection.Column, size: 7, data: { blockId: "left-block" } };
    const widgetNode = { id: "right", flexDirection: FlexDirection.Column, size: 3, data: { blockId: "widget-block" } };
    const rootNode = {
        id: "root",
        flexDirection: FlexDirection.Row,
        size: 10,
        children: [siblingNode, widgetNode],
    };

    assert.equal(getOpenWidgetWidthPercent(rootNode as any, widgetNode as any), 30);
});
