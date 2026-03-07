import { WaveUIMessage } from "./aitypes";

const SHELL_FENCE_LANGS = new Set(["", "bash", "sh", "shell", "zsh", "fish", "pwsh", "powershell", "cmd", "dos"]);
const SAFE_COMMANDS = new Set([
    "ls",
    "dir",
    "pwd",
    "echo",
    "cat",
    "head",
    "tail",
    "grep",
    "rg",
    "find",
    "which",
    "where",
    "uname",
    "whoami",
    "date",
    "env",
    "printenv",
    "lscpu",
    "sed",
    "awk",
]);
const SAFE_GIT_SUBCOMMANDS = new Set(["status", "log", "diff", "show", "branch"]);
const DANGEROUS_PATTERN = /(\|\s*(bash|sh|zsh|pwsh|powershell|cmd)(\s|$)|(^|\s)sudo(\s|$)|(^|\s)(rm|dd|mkfs|shutdown|reboot)(\s|$))/i;

type CommandParseResult = {
    segments: string[];
    hasBlockedOperator: boolean;
};

function stripQuotedContent(input: string): string {
    let result = "";
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (escaped) {
            result += inSingle || inDouble ? " " : ch;
            escaped = false;
            continue;
        }

        if (ch === "\\") {
            escaped = true;
            result += inSingle || inDouble ? " " : ch;
            continue;
        }

        if (!inDouble && ch === "'") {
            inSingle = !inSingle;
            result += " ";
            continue;
        }
        if (!inSingle && ch === "\"") {
            inDouble = !inDouble;
            result += " ";
            continue;
        }

        result += inSingle || inDouble ? " " : ch;
    }

    return result;
}

function parseCommandSegments(command: string): CommandParseResult {
    const segments: string[] = [];
    let current = "";
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        const next = i + 1 < command.length ? command[i + 1] : "";

        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }

        if (ch === "\\") {
            current += ch;
            escaped = true;
            continue;
        }

        if (!inDouble && ch === "'") {
            inSingle = !inSingle;
            current += ch;
            continue;
        }
        if (!inSingle && ch === "\"") {
            inDouble = !inDouble;
            current += ch;
            continue;
        }

        if (!inSingle && !inDouble) {
            if (ch === ";" || ch === "<" || ch === ">" || ch === "`") {
                return { segments: [], hasBlockedOperator: true };
            }
            if (ch === "$" && next === "(") {
                return { segments: [], hasBlockedOperator: true };
            }
            if (ch === "&") {
                return { segments: [], hasBlockedOperator: true };
            }
            if (ch === "|") {
                if (next === "|" || next === "&") {
                    return { segments: [], hasBlockedOperator: true };
                }
                const segment = current.trim();
                if (!segment) {
                    return { segments: [], hasBlockedOperator: true };
                }
                segments.push(segment);
                current = "";
                continue;
            }
        }

        current += ch;
    }

    if (inSingle || inDouble || escaped) {
        return { segments: [], hasBlockedOperator: true };
    }

    const finalSegment = current.trim();
    if (!finalSegment) {
        return { segments: [], hasBlockedOperator: true };
    }
    segments.push(finalSegment);

    return { segments, hasBlockedOperator: false };
}

function getFirstToken(segment: string): string | null {
    const words = segment.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return null;
    }
    const token = words[0].replace(/^['"]+|['"]+$/g, "");
    const base = token.split(/[\\/]/).pop();
    return base ? base.toLowerCase() : null;
}

export function extractExecutableCommandsFromMarkdown(text: string): string[] {
    if (!text) {
        return [];
    }

    const commands: string[] = [];
    const fenceRegex = /```([a-zA-Z0-9+-]*)[ \t]*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = fenceRegex.exec(text)) !== null) {
        const lang = (match[1] ?? "").trim().toLowerCase();
        const body = (match[2] ?? "").replace(/\r/g, "").trim();
        if (!SHELL_FENCE_LANGS.has(lang) || body === "") {
            continue;
        }
        commands.push(body);
    }

    return commands;
}

export function getFirstExecutableCommandFromMessage(message: WaveUIMessage): string | null {
    if (message?.role !== "assistant" || !Array.isArray(message.parts)) {
        return null;
    }

    for (const part of message.parts) {
        if (part?.type !== "text") {
            continue;
        }
        const text = part.text ?? "";
        const commands = extractExecutableCommandsFromMarkdown(text);
        if (commands.length > 0) {
            return commands[0];
        }
    }

    return null;
}

export function isSafeToAutoExecute(command: string): boolean {
    const trimmed = (command ?? "").trim();
    if (trimmed === "") {
        return false;
    }
    if (trimmed.includes("\n")) {
        return false;
    }
    const unquoted = stripQuotedContent(trimmed);
    if (DANGEROUS_PATTERN.test(unquoted)) {
        return false;
    }

    const parsed = parseCommandSegments(trimmed);
    if (parsed.hasBlockedOperator || parsed.segments.length === 0) {
        return false;
    }

    for (const segment of parsed.segments) {
        const words = segment.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            return false;
        }

        const first = getFirstToken(segment);
        if (!first) {
            return false;
        }

        if (first === "git") {
            if (words.length < 2) {
                return false;
            }
            if (!SAFE_GIT_SUBCOMMANDS.has(words[1].toLowerCase())) {
                return false;
            }
            continue;
        }
        if (!SAFE_COMMANDS.has(first)) {
            return false;
        }
    }
    return true;
}
