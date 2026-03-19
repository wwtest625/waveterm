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

export function buildTmuxEnterOrCreateSessionCommand(sessionName: string): string {
    const target = shellQuote([sessionName]);
    return `tmux new-session -Ad -s ${target}; ${buildTmuxEnterSessionCommand(sessionName)}`;
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
