import { describe, expect, it } from "vitest";
import { buildBackfilledTermCard } from "./term-cards-backfill";

function makeBuffer(lines: string[]) {
    return {
        length: lines.length,
        getLine(index: number) {
            const line = lines[index];
            if (line == null) {
                return undefined;
            }
            return {
                isWrapped: false,
                translateToString: () => line,
            };
        },
    } as any;
}

describe("buildBackfilledTermCard", () => {
    it("builds a completed card from the most recent prompt markers", () => {
        const card = buildBackfilledTermCard({
            buffer: makeBuffer(["$ git status", "modified: frontend/app/view/term/term.tsx", ""]),
            cmdText: "git status",
            createdTs: 123,
            exitCode: 0,
            promptMarkers: [{ line: 0 }, { line: 3 }],
            shellIntegrationStatus: "ready",
        });

        expect(card).toMatchObject({
            cmdText: "git status",
            createdTs: 123,
            endTs: null,
            exitCode: 0,
            output: "modified: frontend/app/view/term/term.tsx",
            outputLines: ["modified: frontend/app/view/term/term.tsx"],
            startTs: null,
            state: "done",
        });
    });

    it("builds a streaming card for a running command", () => {
        const card = buildBackfilledTermCard({
            buffer: makeBuffer(["older output", "$ npm test", "running suite...", "still running"]),
            cmdText: "npm test",
            createdTs: 456,
            exitCode: 1,
            promptMarkers: [{ line: 1 }],
            shellIntegrationStatus: "running-command",
        });

        expect(card).toMatchObject({
            cmdText: "npm test",
            createdTs: 456,
            exitCode: null,
            output: "running suite...\nstill running",
            outputLines: ["running suite...", "still running"],
            startTs: null,
            state: "streaming",
        });
    });

    it("returns null when there is no reliable marker range to backfill", () => {
        const card = buildBackfilledTermCard({
            buffer: makeBuffer(["$ pwd"]),
            cmdText: "pwd",
            exitCode: 0,
            promptMarkers: [],
            shellIntegrationStatus: "ready",
        });

        expect(card).toBeNull();
    });
});
