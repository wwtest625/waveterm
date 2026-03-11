// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { startDownloadTransfer } from "@/app/transfer/transfer-store";
import { createBlock, createBlockSplitHorizontally, getApi } from "@/app/store/global";
import { fireAndForget } from "./util";
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
            const termBlockDef: BlockDef = {
                meta: {
                    controller: "shell",
                    view: "term",
                    "cmd:cwd": finfo.isdir ? finfo.path : finfo.dir,
                    connection: conn,
                },
            };
            fireAndForget(() => createBlock(termBlockDef));
        },
    });

    return menu;
}
