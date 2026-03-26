// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    getQuickInputHistoryDirection,
    isQuickInputSubmitKeyEvent,
    normalizeQuickInputForSend,
} from "./term-quickinput";

test("normalizeQuickInputForSend ignores blank input", () => {
    assert.equal(normalizeQuickInputForSend("   \n\t"), null);
});

test("normalizeQuickInputForSend appends trailing newline only when needed", () => {
    assert.equal(normalizeQuickInputForSend("echo hello"), "echo hello\n");
    assert.equal(normalizeQuickInputForSend("echo hello\n"), "echo hello\n");
});

test("isQuickInputSubmitKeyEvent accepts ctrl/cmd enter and rejects plain enter", () => {
    assert.equal(isQuickInputSubmitKeyEvent({ key: "Enter", ctrlKey: true }), true);
    assert.equal(isQuickInputSubmitKeyEvent({ key: "Enter", metaKey: true }), true);
    assert.equal(isQuickInputSubmitKeyEvent({ key: "Enter" }), false);
    assert.equal(isQuickInputSubmitKeyEvent({ key: "a", ctrlKey: true }), false);
});

test("isQuickInputSubmitKeyEvent ignores IME composition", () => {
    assert.equal(
        isQuickInputSubmitKeyEvent({ key: "Enter", ctrlKey: true, nativeEvent: { isComposing: true } }),
        false
    );
});

test("getQuickInputHistoryDirection uses up/down only on first or last line", () => {
    assert.equal(getQuickInputHistoryDirection({ key: "ArrowUp" }, "echo hello", 4, 4), "prev");
    assert.equal(getQuickInputHistoryDirection({ key: "ArrowDown" }, "echo hello", 4, 4), "next");
    assert.equal(getQuickInputHistoryDirection({ key: "ArrowUp" }, "echo hello\npwd", 11, 11), null);
    assert.equal(getQuickInputHistoryDirection({ key: "ArrowDown" }, "echo hello\npwd", 4, 4), null);
});

test("getQuickInputHistoryDirection ignores modified keys and selections", () => {
    assert.equal(getQuickInputHistoryDirection({ key: "ArrowUp", ctrlKey: true }, "echo hello", 4, 4), null);
    assert.equal(getQuickInputHistoryDirection({ key: "ArrowDown", shiftKey: true }, "echo hello", 4, 4), null);
    assert.equal(getQuickInputHistoryDirection({ key: "ArrowUp" }, "echo hello", 0, 4), null);
});
