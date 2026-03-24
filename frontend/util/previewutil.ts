// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    createBlock,
    createBlockSplitHorizontally,
    getApi,
    getFocusedBlockId,
    globalStore,
    refocusNode,
    WOS,
} from "@/app/store/global";
import { getActiveTabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { startDownloadTransfer } from "@/app/transfer/transfer-store";
import { quote as shellQuote } from "shell-quote";
import { arrayToBase64, fireAndForget, stringToBase64 } from "./util";
import { formatRemoteUri } from "./waveutil";

export async function openPreviewInNewBlock(filePath: string, conn: string, currentBlockId?: string): Promise<string> {
    const blockDef: BlockDef = {
        meta: {
            view: "preview",
            file: filePath,
            connection: conn,
        },
    };
    if (currentBlockId) {
        return createBlockSplitHorizontally(blockDef, currentBlockId, "after");
    }
    return createBlock(blockDef);
}

export async function openCommandInNewBlock(
    command: string,
    cwd: string,
    conn: string,
    currentBlockId?: string,
    title?: string
): Promise<string> {
    const blockDef: BlockDef = {
        meta: {
            view: "term",
            controller: "cmd",
            cmd: command,
            "cmd:cwd": cwd,
            "cmd:closeonexit": false,
            "cmd:runonce": true,
            connection: conn,
            ...(title ? { "display:name": title } : {}),
        },
    };
    if (currentBlockId) {
        return createBlockSplitHorizontally(blockDef, currentBlockId, "after");
    }
    return createBlock(blockDef);
}

function normalizeConnectionName(conn?: string): string {
    return conn ?? "";
}

function findShellTerminalBlockId(conn?: string): string | null {
    const tabModel = getActiveTabModel();
    if (tabModel == null) {
        return null;
    }

    const tabData = globalStore.get(tabModel.tabAtom);
    const targetConnection = normalizeConnectionName(conn);

    for (const blockId of tabData?.blockids ?? []) {
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        const blockData = globalStore.get(blockAtom);
        if (blockData?.meta?.view !== "term") {
            continue;
        }
        if (blockData?.meta?.controller === "cmd") {
            continue;
        }
        const blockConnection = normalizeConnectionName(blockData?.meta?.connection as string);
        if (blockConnection === targetConnection) {
            return blockId;
        }
    }

    return null;
}

function findAnyShellTerminalBlockId(): string | null {
    const tabModel = getActiveTabModel();
    if (tabModel == null) {
        return null;
    }

    const tabData = globalStore.get(tabModel.tabAtom);
    for (const blockId of tabData?.blockids ?? []) {
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        const blockData = globalStore.get(blockAtom);
        if (blockData?.meta?.view !== "term") {
            continue;
        }
        if (blockData?.meta?.controller !== "shell") {
            continue;
        }
        return blockId;
    }
    return null;
}

export async function sendDirectoryToTerminal(
    directoryPath: string,
    conn: string,
    currentBlockId?: string
): Promise<string> {
    const existingTerminalBlockId = findShellTerminalBlockId(conn);
    if (existingTerminalBlockId != null) {
        const inputdata64 = stringToBase64(`cd ${shellQuote([directoryPath])}\n`);
        await RpcApi.ControllerInputCommand(TabRpcClient, {
            blockid: existingTerminalBlockId,
            inputdata64,
        });
        refocusNode(existingTerminalBlockId);
        return existingTerminalBlockId;
    }

    const termBlockDef: BlockDef = {
        meta: {
            controller: "shell",
            view: "term",
            "cmd:cwd": directoryPath,
            connection: conn,
        },
    };

    if (currentBlockId) {
        return createBlockSplitHorizontally(termBlockDef, currentBlockId, "after");
    }
    return createBlock(termBlockDef);
}

async function sendTextToTerminalBlock(blockId: string, text: string): Promise<void> {
    const inputdata64 = stringToBase64(text);
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            await RpcApi.ControllerInputCommand(TabRpcClient, {
                blockid: blockId,
                inputdata64,
            });
            return;
        } catch (err) {
            lastError = err;
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
    }
    throw lastError;
}

async function sendBytesToTerminalBlock(blockId: string, bytes: Uint8Array): Promise<void> {
    const inputdata64 = arrayToBase64(bytes);
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            await RpcApi.ControllerInputCommand(TabRpcClient, {
                blockid: blockId,
                inputdata64,
            });
            return;
        } catch (err) {
            lastError = err;
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
    }
    throw lastError;
}

export async function sendCommandToTerminal(command: string, conn: string, currentBlockId?: string): Promise<string> {
    const existingTerminalBlockId = findShellTerminalBlockId(conn);
    if (existingTerminalBlockId != null) {
        await sendTextToTerminalBlock(existingTerminalBlockId, `${command}\n`);
        refocusNode(existingTerminalBlockId);
        return existingTerminalBlockId;
    }

    const termBlockDef: BlockDef = {
        meta: {
            controller: "shell",
            view: "term",
            connection: conn,
        },
    };

    const newBlockId =
        currentBlockId != null
            ? await createBlockSplitHorizontally(termBlockDef, currentBlockId, "after")
            : await createBlock(termBlockDef);
    await sendTextToTerminalBlock(newBlockId, `${command}\n`);
    refocusNode(newBlockId);
    return newBlockId;
}

export type SendCommandToFocusedTerminalResult =
    | { ok: true; blockId: string; connection: string }
    | {
          ok: false;
          code: "no_focused_terminal" | "connection_mismatch";
          message: string;
          expectedConnection?: string;
          terminalConnection?: string;
      };

export async function sendCommandToFocusedTerminal(
    command: string,
    expectedConnection?: string
): Promise<SendCommandToFocusedTerminalResult> {
    const expected = normalizeConnectionName(expectedConnection);
    const focusedBlockId = getFocusedBlockId();
    if (focusedBlockId != null) {
        const focusedAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedBlockId));
        const focusedBlockData = globalStore.get(focusedAtom);
        const focusedMeta = focusedBlockData?.meta;
        if (focusedMeta?.view === "term" && focusedMeta?.controller === "shell") {
            const focusedConn = normalizeConnectionName(focusedMeta?.connection as string);
            if (focusedConn === expected) {
                const payload = /[\r\n]$/.test(command) ? command : `${command}\n`;
                await sendTextToTerminalBlock(focusedBlockId, payload);
                return {
                    ok: true,
                    blockId: focusedBlockId,
                    connection: focusedConn,
                };
            }
        }
    }

    const matchedTerminalBlockId = findShellTerminalBlockId(expected);
    if (matchedTerminalBlockId != null) {
        const payload = /[\r\n]$/.test(command) ? command : `${command}\n`;
        await sendTextToTerminalBlock(matchedTerminalBlockId, payload);
        return {
            ok: true,
            blockId: matchedTerminalBlockId,
            connection: expected,
        };
    }

    const candidateTerminalBlockId = findAnyShellTerminalBlockId();
    if (candidateTerminalBlockId != null) {
        const candidateAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", candidateTerminalBlockId));
        const candidateBlockData = globalStore.get(candidateAtom);
        const candidateConn = normalizeConnectionName(candidateBlockData?.meta?.connection as string);
        return {
            ok: false,
            code: "connection_mismatch",
            message: "没有与面板连接一致的普通终端，请先聚焦或切换到同连接终端。",
            expectedConnection: expected,
            terminalConnection: candidateConn,
        };
    }

    return {
        ok: false,
        code: "no_focused_terminal",
        message: "没有可用终端。请先打开一个普通终端块。",
    };
}

export async function sendBytesToFocusedTerminal(
    bytes: Uint8Array,
    expectedConnection?: string
): Promise<SendCommandToFocusedTerminalResult> {
    const expected = normalizeConnectionName(expectedConnection);
    const focusedBlockId = getFocusedBlockId();
    if (focusedBlockId != null) {
        const focusedAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedBlockId));
        const focusedBlockData = globalStore.get(focusedAtom);
        const focusedMeta = focusedBlockData?.meta;
        if (focusedMeta?.view === "term" && focusedMeta?.controller === "shell") {
            const focusedConn = normalizeConnectionName(focusedMeta?.connection as string);
            if (focusedConn === expected) {
                await sendBytesToTerminalBlock(focusedBlockId, bytes);
                return {
                    ok: true,
                    blockId: focusedBlockId,
                    connection: focusedConn,
                };
            }
        }
    }

    const matchedTerminalBlockId = findShellTerminalBlockId(expected);
    if (matchedTerminalBlockId != null) {
        await sendBytesToTerminalBlock(matchedTerminalBlockId, bytes);
        return {
            ok: true,
            blockId: matchedTerminalBlockId,
            connection: expected,
        };
    }

    const candidateTerminalBlockId = findAnyShellTerminalBlockId();
    if (candidateTerminalBlockId != null) {
        const candidateAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", candidateTerminalBlockId));
        const candidateBlockData = globalStore.get(candidateAtom);
        const candidateConn = normalizeConnectionName(candidateBlockData?.meta?.connection as string);
        return {
            ok: false,
            code: "connection_mismatch",
            message: "没有与面板连接一致的普通终端，请先聚焦或切换到同连接终端。",
            expectedConnection: expected,
            terminalConnection: candidateConn,
        };
    }

    return {
        ok: false,
        code: "no_focused_terminal",
        message: "没有可用终端。请先打开一个普通终端块。",
    };
}

export function addOpenMenuItems(
    menu: ContextMenuItem[],
    conn: string,
    finfo: FileInfo,
    currentBlockId?: string
): ContextMenuItem[] {
    if (!finfo) {
        return menu;
    }

    menu.push({
        type: "separator",
    });

    if (!conn) {
        menu.push({
            label: "\u5728\u6587\u4ef6\u7ba1\u7406\u5668\u4e2d\u663e\u793a",
            click: () => {
                getApi().openNativePath(finfo.isdir ? finfo.path : finfo.dir);
            },
        });
        if (!finfo.isdir) {
            menu.push({
                label: "\u7528\u9ed8\u8ba4\u7a0b\u5e8f\u6253\u5f00",
                click: () => {
                    getApi().openNativePath(finfo.path);
                },
            });
        }
    } else {
        menu.push({
            label: "\u4e0b\u8f7d\u6587\u4ef6",
            click: () => {
                const remoteUri = formatRemoteUri(finfo.path, conn);
                startDownloadTransfer({
                    remoteUri,
                    connection: conn,
                    name: finfo.name ?? finfo.path.split("/").at(-1) ?? finfo.path,
                    sourcePath: finfo.path,
                });
            },
        });
    }

    menu.push({
        type: "separator",
    });

    if (!finfo.isdir) {
        menu.push({
            label: "\u5728\u65b0\u5757\u4e2d\u9884\u89c8\u6253\u5f00",
            click: () => fireAndForget(() => openPreviewInNewBlock(finfo.path, conn, currentBlockId)),
        });
    }

    menu.push({
        label: "\u5728\u6b64\u5904\u6253\u5f00\u7ec8\u7aef",
        click: () => {
            fireAndForget(() => sendDirectoryToTerminal(finfo.isdir ? finfo.path : finfo.dir, conn, currentBlockId));
        },
    });

    if (finfo.isdir) {
        menu.push({
            label: "执行 CD 到终端",
            click: () => {
                fireAndForget(() => sendDirectoryToTerminal(finfo.path, conn, currentBlockId));
            },
        });
    }

    return menu;
}
