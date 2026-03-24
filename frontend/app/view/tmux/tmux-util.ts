// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { quote as shellQuote } from "shell-quote";

export function trimNameInput(value: string): string {
    return (value ?? "").trim();
}

export function getNextSuffixName(baseName: string, existingNames: string[]): string {
    const base = trimNameInput(baseName);
    if (base === "") {
        return "main";
    }
    const normalized = new Set(existingNames.map((name) => trimNameInput(name)));
    if (!normalized.has(base)) {
        return base;
    }
    let suffix = 1;
    while (normalized.has(`${base}-${suffix}`)) {
        suffix += 1;
    }
    return `${base}-${suffix}`;
}

export function buildTmuxEnterSessionCommand(sessionName: string): string {
    const target = shellQuote([sessionName]);
    return `tmux switch-client -t ${target} || tmux attach-session -t ${target}`;
}

export function buildTmuxPromptEnterSessionCommand(sessionName: string): string {
    return `switch-client -t ${shellQuote([sessionName])}`;
}

export function buildTmuxEnterOrCreateSessionCommand(sessionName: string): string {
    const target = shellQuote([sessionName]);
    return `tmux new-session -Ad -s ${target}; ${buildTmuxEnterSessionCommand(sessionName)}`;
}

export function buildTmuxPromptEnterOrCreateSessionCommand(sessionName: string): string {
    const target = shellQuote([sessionName]);
    return `new-session -Ad -s ${target} ; ${buildTmuxPromptEnterSessionCommand(sessionName)}`;
}

export function buildTmuxCreateSessionCommand(sessionName: string): string {
    const target = shellQuote([sessionName]);
    return `tmux new-session -Ad -s ${target}; ${buildTmuxEnterSessionCommand(sessionName)}`;
}

export function buildTmuxRenameSessionCommand(sessionName: string, newName: string): string {
    return `tmux rename-session -t ${shellQuote([sessionName])} ${shellQuote([newName])}`;
}

export function buildTmuxDetachSessionCommand(sessionName: string): string {
    return `tmux detach-client -s ${shellQuote([sessionName])}`;
}

export function buildTmuxKillSessionCommand(sessionName: string): string {
    return `tmux kill-session -t ${shellQuote([sessionName])}`;
}

export function buildTmuxEnterWindowCommand(sessionName: string, windowIndex: number): string {
    const target = shellQuote([`${sessionName}:${windowIndex}`]);
    return `tmux select-window -t ${target}; ${buildTmuxEnterSessionCommand(sessionName)}`;
}

export function buildTmuxPromptEnterWindowCommand(sessionName: string, windowIndex: number): string {
    const target = shellQuote([`${sessionName}:${windowIndex}`]);
    return `select-window -t ${target} ; ${buildTmuxPromptEnterSessionCommand(sessionName)}`;
}

export function buildTmuxCreateWindowCommand(sessionName: string, windowName?: string): string {
    const trimmedName = trimNameInput(windowName);
    const sessionTarget = shellQuote([sessionName]);
    if (trimmedName === "") {
        return `tmux new-window -t ${sessionTarget}; ${buildTmuxEnterSessionCommand(sessionName)}`;
    }
    const windowNameQuoted = shellQuote([trimmedName]);
    const windowTarget = shellQuote([`${sessionName}:${trimmedName}`]);
    return `tmux new-window -t ${sessionTarget} -n ${windowNameQuoted}; tmux select-window -t ${windowTarget}; ${buildTmuxEnterSessionCommand(sessionName)}`;
}

export function buildTmuxRenameWindowCommand(sessionName: string, windowIndex: number, newName: string): string {
    const target = shellQuote([`${sessionName}:${windowIndex}`]);
    return `tmux rename-window -t ${target} ${shellQuote([newName])}`;
}

export function buildTmuxKillWindowCommand(sessionName: string, windowIndex: number): string {
    const target = shellQuote([`${sessionName}:${windowIndex}`]);
    return `tmux kill-window -t ${target}`;
}

export function tmuxPrefixToBytes(prefix: string): Uint8Array | null {
    const normalized = (prefix ?? "").trim();
    if (normalized === "" || normalized.toLowerCase() === "none") {
        return null;
    }
    const ctrlMatch = normalized.match(/^C-(.)$/i);
    if (ctrlMatch) {
        const key = ctrlMatch[1];
        const upper = key.toUpperCase();
        if (upper >= "A" && upper <= "Z") {
            return new Uint8Array([upper.charCodeAt(0) - 64]);
        }
        switch (key) {
            case "@":
                return new Uint8Array([0x00]);
            case "[":
                return new Uint8Array([0x1b]);
            case "\\":
                return new Uint8Array([0x1c]);
            case "]":
                return new Uint8Array([0x1d]);
            case "^":
                return new Uint8Array([0x1e]);
            case "_":
                return new Uint8Array([0x1f]);
            case "?":
                return new Uint8Array([0x7f]);
            default:
                return null;
        }
    }
    return null;
}

export function resolveTmuxPrefix(config?: TmuxGetConfigResponse | null): string | null {
    const candidates = [config?.prefix, config?.prefix2];
    for (const candidate of candidates) {
        if (candidate == null || candidate.trim() === "") {
            continue;
        }
        if (tmuxPrefixToBytes(candidate) != null) {
            return candidate;
        }
    }
    return null;
}

export function buildTmuxCommandPromptBytes(command: string): Uint8Array {
    return new TextEncoder().encode(`:${command}\r`);
}

export function getTmuxErrorHeadline(error?: TmuxError | null): string {
    switch (error?.code) {
        case "missing_cli":
            return "当前连接未安装 tmux 命令。";
        case "no_server":
            return "当前连接没有运行中的 tmux server。";
        case "session_not_found":
            return "目标 tmux session 不存在。";
        case "permission_denied":
            return "当前连接没有操作 tmux 的权限。";
        case "connection_unavailable":
            return "当前连接不可用。";
        case "invalid_request":
            return "tmux 请求参数不完整。";
        default:
            return error?.message ?? "加载 tmux 数据失败。";
    }
}

export function formatDangerConfirmText(
    actionLabel: string,
    connection: string,
    sessionName: string,
    windowName?: string
): string {
    const lines = [
        "请确认危险操作：",
        "",
        `连接: ${connection === "" ? "本机" : connection}`,
        `Session: ${sessionName}`,
        windowName ? `Window: ${windowName}` : null,
        `操作: ${actionLabel}`,
    ].filter(Boolean);
    return lines.join("\n");
}
