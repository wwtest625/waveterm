// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { quote as shellQuote } from "shell-quote";

export function normalizeQuickInputForSend(value: string): string | null {
    if ((value ?? "").trim() === "") {
        return null;
    }
    return /[\r\n]$/.test(value) ? value : `${value}\n`;
}

export type QuickInputCompletionKind = "command" | "file";

export type QuickInputCompletionRange = {
    start: number;
    end: number;
    query: string;
    kind: QuickInputCompletionKind;
};

function isCompletionSeparator(ch: string): boolean {
    return ch == null || /\s/.test(ch);
}

const commandPrefixSet = new Set(["sudo", "doas", "env", "time", "nice", "command", "builtin"]);
const wrapperCommandSet = new Set(["sudo", "doas", "env", "time", "nice", "command", "builtin"]);

function isPathLikeCompletionToken(token: string): boolean {
    if (!token) {
        return false;
    }
    return token.startsWith("/") || token.startsWith("./") || token.startsWith("../") || token.startsWith("~/") || token.includes("/");
}

function getCommandSegmentStart(text: string, tokenStart: number): number {
    const lineStart = text.lastIndexOf("\n", Math.max(tokenStart - 1, 0)) + 1;
    let segmentStart = lineStart;
    for (let i = lineStart; i < tokenStart; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === "|" || ch === ";" || ch === "(" || ch === ")" ) {
            segmentStart = i + 1;
        } else if (ch === "&" && next === "&") {
            segmentStart = i + 2;
            i += 1;
        }
    }
    return segmentStart;
}

export type QuickInputCommandContext = {
    command: string;
    args: string[];
    stage: number;
};

export function getQuickInputCommandContext(
    value: string,
    selectionStart: number,
    selectionEnd: number
): QuickInputCommandContext | null {
    const text = value ?? "";
    if (text.length === 0) {
        return null;
    }

    const cursor = Math.max(selectionStart ?? 0, selectionEnd ?? selectionStart ?? 0);
    const safeCursor = Math.max(0, Math.min(cursor, text.length));
    const segmentStart = getCommandSegmentStart(text, safeCursor);
    const segment = text.slice(segmentStart, safeCursor);
    const trimmed = segment.trim();
    if (trimmed === "") {
        return null;
    }

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && wrapperCommandSet.has(tokens[0])) {
        tokens.shift();
    }
    if (tokens.length === 0) {
        return null;
    }

    const atTokenBoundary = /\s$/.test(segment);
    const command = tokens[0];
    const args = tokens.slice(1);
    const stage = atTokenBoundary ? args.length : Math.max(args.length - 1, 0);

    return {
        command,
        args,
        stage,
    };
}

function isCommandCompletionPosition(text: string, tokenStart: number, tokenEnd: number): boolean {
    const segmentStart = getCommandSegmentStart(text, tokenStart);
    const beforeToken = text.slice(segmentStart, tokenStart).trim();
    if (beforeToken === "") {
        return true;
    }

    const tokens = beforeToken.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        return true;
    }
    if (commandPrefixSet.has(tokens[0])) {
        if (tokens.length === 1) {
            return true;
        }
        const remainder = tokens.slice(1);
        if (remainder.every((token) => token.startsWith("-"))) {
            return true;
        }
    }
    return false;
}

export function getQuickInputCompletionRange(
    value: string,
    selectionStart: number,
    selectionEnd: number
): QuickInputCompletionRange | null {
    const text = value ?? "";
    if (text.length === 0) {
        return null;
    }

    const safeStart = Math.max(0, Math.min(selectionStart ?? 0, text.length));
    const safeEnd = Math.max(0, Math.min(selectionEnd ?? safeStart, text.length));
    const lineStart = text.lastIndexOf("\n", Math.max(safeStart - 1, 0)) + 1;
    const lineEndIdx = text.indexOf("\n", safeEnd);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;

    let start = safeStart;
    let end = safeEnd;

    if (safeStart === safeEnd) {
        while (start > lineStart && !isCompletionSeparator(text[start - 1])) {
            start--;
        }
        while (end < lineEnd && !isCompletionSeparator(text[end])) {
            end++;
        }
    }

    if (start >= end) {
        if (safeStart > lineStart && text.slice(lineStart, safeStart).trim() !== "") {
            const kind: QuickInputCompletionKind = isCommandCompletionPosition(text, safeStart, safeEnd) ? "command" : "file";
            return { start: safeStart, end: safeEnd, query: "", kind };
        }
        return null;
    }

    const query = text.slice(start, end);
    if (query.trim() === "") {
        return null;
    }

    const startsAtLineStart = start === lineStart;
    const kind: QuickInputCompletionKind = isCommandCompletionPosition(text, start, end)
        ? "command"
        : isPathLikeCompletionToken(query) || !startsAtLineStart
            ? "file"
            : "command";

    if (!isPathLikeCompletionToken(query) && !isCommandCompletionPosition(text, start, end) && startsAtLineStart) {
        return null;
    }

    return { start, end, query, kind };
}

export function applyQuickInputCompletion(
    value: string,
    range: QuickInputCompletionRange,
    replacement: string
): { value: string; cursor: number } {
    const nextValue = `${value.slice(0, range.start)}${replacement}${value.slice(range.end)}`;
    return {
        value: nextValue,
        cursor: range.start + replacement.length,
    };
}

export function formatQuickInputCompletion(replacement: string, kind: QuickInputCompletionKind): string {
    return kind === "command" ? replacement : shellQuote([replacement]);
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
