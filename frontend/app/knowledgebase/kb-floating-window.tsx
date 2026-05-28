import { RemoteFileEditor } from "@/app/knowledgebase/remote-file-editor";
import { openPreviewInNewBlock } from "@/util/previewutil";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtom, useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import {
    closeFloatingWindow,
    floatingFileStateAtom,
    floatingMinimizedAtom,
    floatingPositionAtom,
    floatingSizeAtom,
    floatingVisibleAtom,
    minimizeFloatingWindow,
    restoreFloatingWindow,
} from "../store/kb-model";
import { fireAndForget } from "@/util/util";
import "./kb-floating-window.scss";

const FloatingWindowInner = memo(() => {
    const visible = useAtomValue(floatingVisibleAtom);
    const minimized = useAtomValue(floatingMinimizedAtom);
    const fileState = useAtomValue(floatingFileStateAtom);
    const [position, setPosition] = useAtom(floatingPositionAtom);
    const [size, setSize] = useAtom(floatingSizeAtom);

    const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
    const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
    const windowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (visible && position.x === 0 && position.y === 0) {
            const x = Math.max(40, window.innerWidth - size.w - 40);
            const y = Math.max(40, 60);
            setPosition({ x, y });
        }
    }, [visible]);

    const handleDragMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if ((e.target as HTMLElement).closest(".kb-fw-btn")) return;
            e.preventDefault();
            dragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                startPosX: position.x,
                startPosY: position.y,
            };
        },
        [position]
    );

    useEffect(() => {
        if (!visible || minimized) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (dragRef.current) {
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                const newX = Math.max(0, Math.min(dragRef.current.startPosX + dx, window.innerWidth - 100));
                const newY = Math.max(0, Math.min(dragRef.current.startPosY + dy, window.innerHeight - 40));
                setPosition({ x: newX, y: newY });
            }
            if (resizeRef.current) {
                const dx = e.clientX - resizeRef.current.startX;
                const dy = e.clientY - resizeRef.current.startY;
                const newW = Math.max(320, Math.min(resizeRef.current.startW + dx, window.innerWidth - position.x - 20));
                const newH = Math.max(200, Math.min(resizeRef.current.startH + dy, window.innerHeight - position.y - 20));
                setSize({ w: newW, h: newH });
            }
        };

        const handleMouseUp = () => {
            dragRef.current = null;
            resizeRef.current = null;
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [visible, minimized, position.x, position.y, setPosition, setSize]);

    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startW: size.w,
            startH: size.h,
        };
    }, [size]);

    const handleMinimize = useCallback(() => {
        minimizeFloatingWindow();
    }, []);

    const handleRestore = useCallback(() => {
        restoreFloatingWindow();
    }, []);

    const handleClose = useCallback(() => {
        closeFloatingWindow();
    }, []);

    const handleRestoreToBlock = useCallback(() => {
        const { filePath, connection } = fileState;
        closeFloatingWindow();
        if (filePath) {
            fireAndForget(() => openPreviewInNewBlock(filePath, connection));
        }
    }, [fileState]);

    if (!visible) return null;

    const { filePath, connection } = fileState;
    const fileName = filePath ? filePath.split("/").pop() : "File Viewer";

    if (minimized) {
        return ReactDOM.createPortal(
            <div className="kb-fw-minimized" onClick={handleRestore} title="点击恢复悬浮窗，右键恢复到侧边栏" onContextMenu={(e) => { e.preventDefault(); handleRestoreToBlock(); }}>
                <i className={makeIconClass("file-lines", true)} />
                <span className="kb-fw-minimized-label">{fileName}</span>
            </div>,
            document.getElementById("main")!
        );
    }

    return ReactDOM.createPortal(
        <div
            ref={windowRef}
            className={clsx("kb-floating-window")}
            style={{
                left: position.x,
                top: position.y,
                width: size.w,
                height: size.h,
            }}
        >
            <div className="kb-fw-titlebar" onMouseDown={handleDragMouseDown}>
                <span className="kb-fw-title">
                    <i className={makeIconClass("server", true)} />
                    <span className="kb-fw-title-text">{fileName}</span>
                    {connection && (
                        <span className="kb-fw-conn-badge">
                            {connection.split("//").pop()?.split("@")[0] || connection}
                        </span>
                    )}
                </span>
                <div className="kb-fw-actions">
                    <button className="kb-fw-btn kb-fw-btn-restore" onClick={handleRestoreToBlock} title="恢复到侧边栏">
                        <i className={makeIconClass("expand", true)} />
                    </button>
                    <button className="kb-fw-btn kb-fw-btn-minimize" onClick={handleMinimize} title="最小化">
                        <i className={makeIconClass("minus", true)} />
                    </button>
                    <button className="kb-fw-btn kb-fw-btn-close" onClick={handleClose} title="关闭">
                        <i className={makeIconClass("xmark", true)} />
                    </button>
                </div>
            </div>
            <div className="kb-fw-body">
                {filePath ? (
                    <RemoteFileEditor filePath={filePath} connection={connection} />
                ) : (
                    <div className="kb-fw-empty">
                        <i className={makeIconClass("folder-open", true)} />
                        <span>从终端点击文件路径打开</span>
                    </div>
                )}
            </div>
            <div className="kb-fw-resize-handle" onMouseDown={handleResizeMouseDown} />
        </div>,
        document.getElementById("main")!
    );
});

FloatingWindowInner.displayName = "FloatingWindowInner";

function KbFloatingWindow() {
    return <FloatingWindowInner />;
}

KbFloatingWindow.displayName = "KbFloatingWindow";

export { KbFloatingWindow };
