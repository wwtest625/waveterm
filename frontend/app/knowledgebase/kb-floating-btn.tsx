import { makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";
import ReactDOM from "react-dom";
import { floatingMinimizedAtom, floatingVisibleAtom, toggleFloatingWindow } from "../store/kb-model";
import "./kb-floating-btn.scss";

const KbFloatingBtnInner = memo(() => {
    const visible = useAtomValue(floatingVisibleAtom);
    const minimized = useAtomValue(floatingMinimizedAtom);

    const handleClick = useCallback(() => {
        toggleFloatingWindow();
    }, []);

    if (visible && !minimized) return null;

    return ReactDOM.createPortal(
        <div className="kb-floating-btn" onClick={handleClick} title="打开文件查看器">
            <i className={makeIconClass("file-lines", true)} />
        </div>,
        document.getElementById("main")!
    );
});

KbFloatingBtnInner.displayName = "KbFloatingBtnInner";

function KbFloatingBtn() {
    return <KbFloatingBtnInner />;
}

KbFloatingBtn.displayName = "KbFloatingBtn";

export { KbFloatingBtn };
