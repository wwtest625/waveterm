// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { TermViewModel } from "@/app/view/term/term-model";
import { bufferLinesToText } from "@/app/view/term/termutil";

export class TermWshClient extends WshClient {
    blockId: string;
    model: TermViewModel;

    constructor(blockId: string, model: TermViewModel) {
        super(makeFeBlockRouteId(blockId));
        this.blockId = blockId;
        this.model = model;
    }

    async handle_termgetscrollbacklines(
        rh: RpcResponseHelper,
        data: CommandTermGetScrollbackLinesData
    ): Promise<CommandTermGetScrollbackLinesRtnData> {
        const termWrap = this.model.termRef.current;
        if (!termWrap || !termWrap.terminal) {
            return {
                totallines: 0,
                linestart: data.linestart,
                lines: [],
                lastupdated: 0,
            };
        }

        const buffer = termWrap.terminal.buffer.active;
        const totalLines = buffer.length;

        if (data.lastcommand) {
            if (globalStore.get(termWrap.shellIntegrationStatusAtom) == null) {
                throw new Error("Cannot get last command data without shell integration");
            }

            let startBufferIndex = 0;
            let endBufferIndex = totalLines;
            if (termWrap.promptMarkers.length > 0) {
                const markerIndex =
                    termWrap.promptMarkers.length > 1
                        ? termWrap.promptMarkers.length - 2
                        : termWrap.promptMarkers.length - 1;
                const commandStartMarker = termWrap.promptMarkers[markerIndex];
                startBufferIndex = commandStartMarker.line;

                if (termWrap.promptMarkers.length > 1) {
                    const currentPromptMarker = termWrap.promptMarkers[termWrap.promptMarkers.length - 1];
                    endBufferIndex = currentPromptMarker.line;
                }
            }

            const lines = bufferLinesToText(buffer, startBufferIndex, endBufferIndex);

            let returnLines = lines;
            let returnStartLine = totalLines - endBufferIndex;
            if (lines.length > 1000) {
                returnLines = lines.slice(lines.length - 1000);
                returnStartLine = (totalLines - endBufferIndex) + (lines.length - 1000);
            }

            return {
                totallines: totalLines,
                linestart: returnStartLine,
                lines: returnLines,
                lastupdated: termWrap.lastUpdated,
            };
        }

        const startLine = Math.max(0, data.linestart);
        const endLine = data.lineend === 0 ? totalLines : Math.min(totalLines, data.lineend);

        const startBufferIndex = totalLines - endLine;
        const endBufferIndex = totalLines - startLine;
        const lines = bufferLinesToText(buffer, startBufferIndex, endBufferIndex);

        return {
            totallines: totalLines,
            linestart: startLine,
            lines: lines,
            lastupdated: termWrap.lastUpdated,
        };
    }
}
