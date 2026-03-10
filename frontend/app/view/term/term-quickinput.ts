// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function normalizeQuickInputForSend(value: string): string | null {
    if ((value ?? "").trim() === "") {
        return null;
    }
    return /[\r\n]$/.test(value) ? value : `${value}\n`;
}

export function isQuickInputSubmitKeyEvent(event: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    nativeEvent?: { isComposing?: boolean };
}): boolean {
    if (event.nativeEvent?.isComposing) {
        return false;
    }
    return event.key === "Enter" && !!(event.ctrlKey || event.metaKey);
}