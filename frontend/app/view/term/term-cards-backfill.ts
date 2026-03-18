// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as TermTypes from "@xterm/xterm";
import { bufferLinesToText } from "./termutil";

type TermCardState = "pending" | "streaming" | "done";
type ShellIntegrationStatus = "ready" | "running-command";

type PromptMarkerLike = {
    line: number;
};

type CardBackfillRange = {
    startLine: number;
    endLine: number;
    state: Extract<TermCardState, "streaming" | "done">;
};

export type BackfilledTermCard = {
    id: string;
    cmdText: string;
    createdTs: number;
    startTs: number | null;
    endTs: number | null;
    exitCode: number | null;
    state: Extract<TermCardState, "streaming" | "done">;
    output: string;
    outputLines: string[];
    collapsed: boolean;
};

function makeCardId(ts: number): string {
    return `card-${ts}-${Math.random().toString(36).slice(2, 10)}`;
}

function stripAnsiForCopy(input: string): string {
    // eslint-disable-next-line no-control-regex
    return input.replace(/\x1b\[[0-9;]*m/g, "");
}

function getCardBackfillRange(
    shellIntegrationStatus: ShellIntegrationStatus,
    promptMarkers: PromptMarkerLike[],
    totalLines: number
): CardBackfillRange | null {
    if (shellIntegrationStatus === "running-command") {
        const marker = promptMarkers[promptMarkers.length - 1];
        if (marker == null || marker.line > totalLines) {
            return null;
        }
        return {
            startLine: marker.line,
            endLine: totalLines,
            state: "streaming",
        };
    }
    if (promptMarkers.length < 2) {
        return null;
    }
    const startMarker = promptMarkers[promptMarkers.length - 2];
    const endMarker = promptMarkers[promptMarkers.length - 1];
    if (startMarker.line >= endMarker.line) {
        return null;
    }
    return {
        startLine: startMarker.line,
        endLine: endMarker.line,
        state: "done",
    };
}

function trimBackfilledOutputLines(outputLines: string[], cmdText: string): string[] {
    if (outputLines.length === 0) {
        return outputLines;
    }
    const normalizedCmd = cmdText.trim();
    if (normalizedCmd === "") {
        return outputLines;
    }
    const firstLine = stripAnsiForCopy(outputLines[0]).trim();
    if (
        firstLine === normalizedCmd ||
        firstLine.endsWith(` ${normalizedCmd}`) ||
        firstLine.includes(normalizedCmd)
    ) {
        return outputLines.slice(1);
    }
    return outputLines;
}

export function buildBackfilledTermCard(params: {
    buffer: TermTypes.IBuffer;
    cmdText: string | null;
    createdTs?: number;
    exitCode: number | null;
    promptMarkers: PromptMarkerLike[];
    shellIntegrationStatus: ShellIntegrationStatus;
}): BackfilledTermCard | null {
    const { buffer, cmdText, createdTs = Date.now(), exitCode, promptMarkers, shellIntegrationStatus } = params;
    const normalizedCmd = cmdText?.trim();
    if (!normalizedCmd) {
        return null;
    }
    const range = getCardBackfillRange(shellIntegrationStatus, promptMarkers, buffer.length);
    if (range == null) {
        return null;
    }
    const outputLines = trimBackfilledOutputLines(
        bufferLinesToText(buffer, range.startLine, range.endLine),
        normalizedCmd
    );
    return {
        id: makeCardId(createdTs),
        cmdText: normalizedCmd,
        createdTs,
        startTs: null,
        endTs: null,
        exitCode: range.state === "done" ? (exitCode ?? null) : null,
        state: range.state,
        output: outputLines.join("\n"),
        outputLines,
        collapsed: true,
    };
}
