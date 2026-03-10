// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { isQuickInputSubmitKeyEvent, normalizeQuickInputForSend } from "./term-quickinput";

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
    assert.equal(isQuickInputSubmitKeyEvent({ key: "Enter", ctrlKey: true, nativeEvent: { isComposing: true } }), false);
});