// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    buildTmuxCommandPromptBytes,
    buildTmuxCreateSessionCommand,
    buildTmuxCreateWindowCommand,
    buildTmuxPromptEnterOrCreateSessionCommand,
    buildTmuxPromptEnterSessionCommand,
    buildTmuxPromptEnterWindowCommand,
    buildTmuxEnterOrCreateSessionCommand,
    buildTmuxEnterWindowCommand,
    buildTmuxKillWindowCommand,
    formatDangerConfirmText,
    getNextSuffixName,
    getTmuxErrorHeadline,
    resolveTmuxPrefix,
    tmuxPrefixToBytes,
} from "./tmux-util";

test("getNextSuffixName appends -1 / -2 when base name already exists", () => {
    assert.equal(getNextSuffixName("main", ["main"]), "main-1");
    assert.equal(getNextSuffixName("main", ["main", "main-1"]), "main-2");
    assert.equal(getNextSuffixName("main", ["work"]), "main");
});

test("tmux command builders quote names safely", () => {
    assert.equal(
        buildTmuxEnterOrCreateSessionCommand("my session"),
        "tmux new-session -Ad -s 'my session'; tmux switch-client -t 'my session' || tmux attach-session -t 'my session'"
    );
    assert.equal(
        buildTmuxCreateSessionCommand("my session"),
        "tmux new-session -Ad -s 'my session'; tmux switch-client -t 'my session' || tmux attach-session -t 'my session'"
    );
    assert.equal(
        buildTmuxCreateWindowCommand("main", "web app"),
        "tmux new-window -t main -n 'web app'; tmux select-window -t 'main:web app'; tmux switch-client -t main || tmux attach-session -t main"
    );
    assert.equal(
        buildTmuxEnterWindowCommand("main", 2),
        "tmux select-window -t main\\:2; tmux switch-client -t main || tmux attach-session -t main"
    );
    assert.equal(buildTmuxKillWindowCommand("main", 1), "tmux kill-window -t main\\:1");
});

test("tmux prompt command builders use tmux command-prompt syntax", () => {
    assert.equal(buildTmuxPromptEnterSessionCommand("my session"), "switch-client -t 'my session'");
    assert.equal(
        buildTmuxPromptEnterOrCreateSessionCommand("my session"),
        "new-session -Ad -s 'my session' ; switch-client -t 'my session'"
    );
    assert.equal(
        buildTmuxPromptEnterWindowCommand("main", 2),
        "select-window -t main\\:2 ; switch-client -t main"
    );
});

test("tmuxPrefixToBytes maps common control prefixes", () => {
    assert.deepEqual(Array.from(tmuxPrefixToBytes("C-b") ?? []), [0x02]);
    assert.deepEqual(Array.from(tmuxPrefixToBytes("C-a") ?? []), [0x01]);
    assert.deepEqual(Array.from(tmuxPrefixToBytes("C-[") ?? []), [0x1b]);
    assert.isNull(tmuxPrefixToBytes("M-b"));
    assert.isNull(tmuxPrefixToBytes("None"));
});

test("resolveTmuxPrefix prefers supported prefix values", () => {
    assert.equal(resolveTmuxPrefix({ prefix: "M-b", prefix2: "C-a" } as TmuxGetConfigResponse), "C-a");
    assert.equal(resolveTmuxPrefix({ prefix: "C-b", prefix2: "C-a" } as TmuxGetConfigResponse), "C-b");
    assert.isNull(resolveTmuxPrefix({ prefix: "M-b", prefix2: "M-a" } as TmuxGetConfigResponse));
});

test("buildTmuxCommandPromptBytes encodes colon command prompt sequence", () => {
    const bytes = buildTmuxCommandPromptBytes("switch-client -t main");
    assert.deepEqual(Array.from(bytes), Array.from(new TextEncoder().encode(":switch-client -t main\r")));
});

test("getTmuxErrorHeadline returns friendly Chinese copy", () => {
    assert.equal(getTmuxErrorHeadline({ code: "missing_cli", message: "" } as TmuxError), "当前连接未安装 tmux 命令。");
    assert.equal(
        getTmuxErrorHeadline({ code: "connection_unavailable", message: "" } as TmuxError),
        "当前连接不可用。"
    );
    assert.equal(getTmuxErrorHeadline({ code: "unknown", message: "boom" } as TmuxError), "boom");
});

test("formatDangerConfirmText includes concrete operation target", () => {
    const text = formatDangerConfirmText("Kill Window", "ssh://devbox", "main", "2:web");
    assert.match(text, /连接: ssh:\/\/devbox/);
    assert.match(text, /Session: main/);
    assert.match(text, /Window: 2:web/);
    assert.match(text, /操作: Kill Window/);
});
