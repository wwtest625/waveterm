import { KbEditor } from "@/app/knowledgebase/kb-editor";
import { useAtomValue } from "jotai";
import { memo } from "react";
import type { KbViewModel } from "./kb-view-model";

const KbEditorViewInner = memo(({ model }: { model: KbViewModel }) => {
    const relPath = useAtomValue(model.relPathAtom) ?? "";
    if (!relPath) {
        return (
            <div className="flex items-center justify-center h-full text-secondary text-sm">
                No file selected
            </div>
        );
    }
    return <KbEditor relPath={relPath} />;
});

KbEditorViewInner.displayName = "KbEditorViewInner";

function KbEditorView({ model }: { blockId: string; blockRef: React.RefObject<HTMLDivElement>; contentRef: React.RefObject<HTMLDivElement>; model: KbViewModel }) {
    return <KbEditorViewInner model={model} />;
}

export { KbEditorView };
