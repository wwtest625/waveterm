import { describe, expect, it } from "vitest";
import { parseAnsiLine, splitHighlightedText } from "./ansiline";

describe("parseAnsiLine", () => {
    it("parses standard ansi colors", () => {
        const segments = parseAnsiLine("\u001b[31mred\u001b[0m plain");

        expect(segments[0]).toMatchObject({
            text: "red",
            style: { color: "var(--ansi-red)" },
        });
        expect(segments[1]).toMatchObject({
            text: " plain",
        });
    });

    it("parses 256-color ansi sequences", () => {
        const segments = parseAnsiLine("\u001b[38;5;208morange");

        expect(segments[0]).toMatchObject({
            text: "orange",
            style: { color: "rgb(255, 135, 0)" },
        });
    });

    it("parses truecolor ansi sequences", () => {
        const segments = parseAnsiLine("\u001b[38;2;12;34;56mcustom");

        expect(segments[0]).toMatchObject({
            text: "custom",
            style: { color: "rgb(12, 34, 56)" },
        });
    });

    it("splits highlighted text case-insensitively", () => {
        expect(splitHighlightedText("Docker docker ps", "docker")).toEqual([
            { text: "Docker", highlighted: true },
            { text: " ", highlighted: false },
            { text: "docker", highlighted: true },
            { text: " ps", highlighted: false },
        ]);
    });
});
