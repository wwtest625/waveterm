// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { atom } from "jotai";
import { QuickCommandsView } from "./quickcommands";

class QuickCommandsViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewType: string;
    viewIcon = atom("bolt");
    viewName = atom("Quick Commands");
    noPadding = atom(true);

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "quickcommands";
    }

    get viewComponent(): ViewComponent {
        return QuickCommandsView;
    }
}

export { QuickCommandsViewModel };