// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { getWidgetToggleAction } from "./widgettoggle";

test("getWidgetToggleAction creates when widget has not opened a block yet", () => {
    assert.deepEqual(getWidgetToggleAction(undefined, ["block-1", "block-2"], "block-1"), { type: "create" });
});

test("getWidgetToggleAction focuses tracked block when it exists but is not focused", () => {
    assert.deepEqual(getWidgetToggleAction("block-2", ["block-1", "block-2"], "block-1"), {
        type: "focus",
        blockId: "block-2",
    });
});

test("getWidgetToggleAction closes tracked block when it is already focused", () => {
    assert.deepEqual(getWidgetToggleAction("block-2", ["block-1", "block-2"], "block-2"), {
        type: "close",
        blockId: "block-2",
    });
});

test("getWidgetToggleAction creates again when tracked block is no longer in the tab", () => {
    assert.deepEqual(getWidgetToggleAction("block-9", ["block-1", "block-2"], "block-1"), { type: "create" });
});