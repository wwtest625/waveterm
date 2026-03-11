// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { transferTasksAtom } from "@/app/transfer/transfer-store";
import type { TabModel } from "@/app/store/tab-model";
import { atom } from "jotai";
import { TransferView } from "./transfer";

class TransferViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewType: string;
    viewIcon = atom("arrow-right-arrow-left");
    viewName = atom((get) => {
        const tasks = get(transferTasksAtom);
        const runningCount = tasks.filter((task) => task.status === "pending" || task.status === "running").length;
        return runningCount > 0 ? `\u4f20\u8f93\u7ba1\u7406 (${runningCount}/${tasks.length})` : "\u4f20\u8f93\u7ba1\u7406";
    });
    noPadding = atom(true);

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "transfer";
    }

    get viewComponent(): ViewComponent {
        return TransferView;
    }
}

export { TransferViewModel };
