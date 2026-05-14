import { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { getBlockMetaKeyAtom } from "@/store/global";
import { atom, Atom } from "jotai";
import { KbEditorView } from "./kb-view";

export class KbViewModel implements ViewModel {
    viewType = "knowledgebase";
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon: Atom<string | IconButtonDecl>;
    viewName: Atom<string>;
    viewComponent = KbEditorView;
    noPadding = atom(true);

    relPathAtom: Atom<string>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.relPathAtom = getBlockMetaKeyAtom(blockId, "file");
        this.viewIcon = atom("book");
        this.viewName = atom("Knowledge Base");
    }
}
