import type { CSSProperties } from "react";
import "./ansiline.scss";

type AnsiState = {
    bold: boolean;
    dim: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    hidden: boolean;
    reverse: boolean;
    fg: string | null;
    bg: string | null;
};

type SegmentType = {
    text: string;
    style: CSSProperties;
};

type HighlightPart = {
    text: string;
    highlighted: boolean;
};

const ansiVarPalette = [
    "var(--ansi-black)",
    "var(--ansi-red)",
    "var(--ansi-green)",
    "var(--ansi-yellow)",
    "var(--ansi-blue)",
    "var(--ansi-magenta)",
    "var(--ansi-cyan)",
    "var(--ansi-white)",
];

const ansiVarBrightPalette = [
    "var(--ansi-brightblack)",
    "var(--ansi-brightred)",
    "var(--ansi-brightgreen)",
    "var(--ansi-brightyellow)",
    "var(--ansi-brightblue)",
    "var(--ansi-brightmagenta)",
    "var(--ansi-brightcyan)",
    "var(--ansi-brightwhite)",
];

const ansiRegex = /\x1b\[([0-9;]*)m/g;

function makeInitialState(): AnsiState {
    return {
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        strike: false,
        hidden: false,
        reverse: false,
        fg: null,
        bg: null,
    };
}

function ansi256ToCssColor(value: number): string {
    if (value < 0) {
        return ansiVarPalette[0];
    }
    if (value < 8) {
        return ansiVarPalette[value];
    }
    if (value < 16) {
        return ansiVarBrightPalette[value - 8];
    }
    if (value < 232) {
        const n = value - 16;
        const r = Math.floor(n / 36);
        const g = Math.floor((n % 36) / 6);
        const b = n % 6;
        const levels = [0, 95, 135, 175, 215, 255];
        return `rgb(${levels[r]}, ${levels[g]}, ${levels[b]})`;
    }
    const gray = 8 + (value - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
}

function readExtendedColor(codes: number[], startIndex: number): { color: string | null; nextIndex: number } {
    const mode = codes[startIndex];
    if (mode === 5) {
        const paletteIndex = codes[startIndex + 1];
        if (paletteIndex == null || Number.isNaN(paletteIndex)) {
            return { color: null, nextIndex: startIndex };
        }
        return {
            color: ansi256ToCssColor(paletteIndex),
            nextIndex: startIndex + 1,
        };
    }
    if (mode === 2) {
        const r = codes[startIndex + 1];
        const g = codes[startIndex + 2];
        const b = codes[startIndex + 3];
        if ([r, g, b].some((v) => v == null || Number.isNaN(v))) {
            return { color: null, nextIndex: startIndex };
        }
        return {
            color: `rgb(${r}, ${g}, ${b})`,
            nextIndex: startIndex + 3,
        };
    }
    return { color: null, nextIndex: startIndex };
}

function updateStateWithCodes(state: AnsiState, codes: number[]): AnsiState {
    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        switch (code) {
            case 0:
                Object.assign(state, makeInitialState());
                break;
            case 1:
                state.bold = true;
                break;
            case 2:
                state.dim = true;
                break;
            case 3:
                state.italic = true;
                break;
            case 4:
                state.underline = true;
                break;
            case 7:
                state.reverse = true;
                break;
            case 8:
                state.hidden = true;
                break;
            case 9:
                state.strike = true;
                break;
            case 22:
                state.bold = false;
                state.dim = false;
                break;
            case 23:
                state.italic = false;
                break;
            case 24:
                state.underline = false;
                break;
            case 27:
                state.reverse = false;
                break;
            case 28:
                state.hidden = false;
                break;
            case 29:
                state.strike = false;
                break;
            case 39:
                state.fg = null;
                break;
            case 49:
                state.bg = null;
                break;
            default:
                if (code >= 30 && code <= 37) {
                    state.fg = ansiVarPalette[code - 30];
                } else if (code >= 40 && code <= 47) {
                    state.bg = ansiVarPalette[code - 40];
                } else if (code >= 90 && code <= 97) {
                    state.fg = ansiVarBrightPalette[code - 90];
                } else if (code >= 100 && code <= 107) {
                    state.bg = ansiVarBrightPalette[code - 100];
                } else if (code === 38 || code === 48) {
                    const { color, nextIndex } = readExtendedColor(codes, i + 1);
                    if (color != null) {
                        if (code === 38) {
                            state.fg = color;
                        } else {
                            state.bg = color;
                        }
                    }
                    i = nextIndex;
                }
                break;
        }
    }
    return state;
}

function stateToStyle(state: AnsiState): CSSProperties {
    let color = state.fg ?? undefined;
    let backgroundColor = state.bg ?? undefined;
    if (state.reverse) {
        [color, backgroundColor] = [backgroundColor, color];
    }
    const textDecorationParts = [];
    if (state.underline) {
        textDecorationParts.push("underline");
    }
    if (state.strike) {
        textDecorationParts.push("line-through");
    }
    return {
        color,
        backgroundColor,
        fontWeight: state.bold ? "bold" : undefined,
        fontStyle: state.italic ? "italic" : undefined,
        opacity: state.dim ? 0.75 : undefined,
        visibility: state.hidden ? "hidden" : undefined,
        textDecorationLine: textDecorationParts.length > 0 ? textDecorationParts.join(" ") : undefined,
    };
}

export function parseAnsiLine(line: string): SegmentType[] {
    const segments: SegmentType[] = [];
    let lastIndex = 0;
    let currentState = makeInitialState();
    ansiRegex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = ansiRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
            segments.push({
                text: line.substring(lastIndex, match.index),
                style: stateToStyle(currentState),
            });
        }
        const codes = match[1] === "" ? [0] : match[1].split(";").map((value) => Number(value || 0));
        currentState = updateStateWithCodes({ ...currentState }, codes);
        lastIndex = ansiRegex.lastIndex;
    }

    if (lastIndex < line.length) {
        segments.push({
            text: line.substring(lastIndex),
            style: stateToStyle(currentState),
        });
    }

    if (segments.length === 0) {
        segments.push({ text: line, style: {} });
    }
    return segments;
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitHighlightedText(text: string, searchTerm?: string): HighlightPart[] {
    const query = searchTerm?.trim();
    if (!query) {
        return [{ text, highlighted: false }];
    }
    const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
    const parts = text.split(regex);
    return parts.filter((part) => part !== "").map((part) => ({
        text: part,
        highlighted: part.toLowerCase() === query.toLowerCase(),
    }));
}

const AnsiLine = ({ line, searchTerm }: { line: string; searchTerm?: string }) => {
    const segments = parseAnsiLine(line);
    return (
        <div className="ansi-line">
            {segments.map((seg, idx) => (
                <span key={idx} style={seg.style}>
                    {splitHighlightedText(seg.text, searchTerm).map((part, partIdx) => (
                        <span
                            key={`${idx}-${partIdx}`}
                            className={part.highlighted ? "ansi-line-highlight" : undefined}
                        >
                            {part.text}
                        </span>
                    ))}
                </span>
            ))}
        </div>
    );
};

export default AnsiLine;
