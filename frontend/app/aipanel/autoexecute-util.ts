import { WaveUIMessage } from "./aitypes";

const SHELL_FENCE_LANGS = new Set(["", "bash", "sh", "shell", "zsh", "fish", "pwsh", "powershell", "cmd", "dos"]);

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
