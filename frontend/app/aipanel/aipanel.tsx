import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { Modal } from "@/app/modals/modal";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { maybeUseTabModel } from "@/app/store/tab-model";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AIDroppedFiles } from "./aidroppedfiles";
import { BackgroundJobsPanel } from "./aibgjobspanel";
import { CommandInteractionInput } from "./aicommandinteraction";
import { AIBlockMask, AIDragOverlay, AIErrorMessage, AIWelcomeMessage, ConfigChangeModeFixer } from "./aiminorcomponents";
import { AISessionToolbar } from "./aisessiontoolbar";
import { t } from "./aipanel-i18n";
import { useBackgroundJobsRefresh, useChatSetup, useFileDragDrop, useMessageAnalysis, usePerformanceTracking } from "./aipanel-hooks";
import { loadInitialChatForPanel } from "./aipanel-loadutil";
import { AIPanelInput } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";
import { QueuedMessageCard } from "./aipanel-queued-messages";
import { AIPanelChatContext } from "./aipanel-chat-context";
import { TaskProgressPanel } from "./taskprogresspanel";
import { WaveAIModel } from "./waveai-model";

const AIPanelComponentInner = memo(() => {
    const [initialLoadDone, setInitialLoadDone] = useState(false);
    const [renameDialog, setRenameDialog] = useState<{ chatid: string; title: string; value: string } | null>(null);
    const [deleteDialog, setDeleteDialog] = useState<{ chatid: string; title: string } | null>(null);
    const model = WaveAIModel.getInstance();
    const containerRef = useRef<HTMLDivElement>(null);
    const {
        isDragOver,
        isReactDndDragOver,
        handleDragOver,
        handleDragEnter,
        handleDragLeave,
        handleDrop,
    } = useFileDragDrop(model, containerRef);
    const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
    const showOverlayBlockNums = jotai.useAtomValue(getSettingsKeyAtom("app:showoverlayblocknums")) ?? true;
    const isFocused = jotai.useAtomValue(model.isWaveAIFocusedAtom);
    const focusFollowsCursorMode = jotai.useAtomValue(getSettingsKeyAtom("app:focusfollowscursor")) ?? "off";
    const isPanelVisible = jotai.useAtomValue(model.getPanelVisibleAtom());
    const errorMessage = jotai.useAtomValue(model.errorMessage);
    const agentRuntimeSnapshot = jotai.useAtomValue(model.agentRuntimeAtom);
    const taskState = jotai.useAtomValue(model.taskStateAtom);
    const commandInteraction = jotai.useAtomValue(model.commandInteractionAtom);
    const backgroundJobs = jotai.useAtomValue(model.backgroundJobsAtom);
    const chatIdValue = jotai.useAtomValue(model.chatId);
    const agentMode = jotai.useAtomValue(model.agentModeAtom);
    const tabModel = maybeUseTabModel();

    const { status, chatContextValue, coalescedMessages } = useChatSetup(model, tabModel.tabId);

    useMessageAnalysis(
        coalescedMessages,
        model,
        status,
        errorMessage,
        commandInteraction,
        agentMode,
        agentRuntimeSnapshot
    );

    useEffect(() => {
        const currentChatId = globalStore.get(model.chatId);
        if (status !== "ready" || !currentChatId) {
            return;
        }
        void model.loadSessions();
    }, [status, model]);

    useBackgroundJobsRefresh(chatIdValue, isPanelVisible, backgroundJobs, model);

    usePerformanceTracking(agentRuntimeSnapshot, coalescedMessages, status, model);

    const handleKeyDown = (waveEvent: WaveKeyboardEvent): boolean => {
        if (checkKeyPressed(waveEvent, "Cmd:k")) {
            model.clearChat();
            return true;
        }
        return false;
    };

    useEffect(() => {
        model.dispatch({ type: "SET_IS_AI_STREAMING", value: status == "streaming" });
    }, [status]);

    useEffect(() => {
        if (status === "ready" || status === "error") {
            void model.flushQueuedSubmissions();
        }
    }, [status, model]);

    const handleKeyDownRef = useRef(handleKeyDown);
    handleKeyDownRef.current = handleKeyDown;

    useEffect(() => {
        const keyHandler = (e: KeyboardEvent) => keydownWrapper(handleKeyDownRef.current)(e);
        document.addEventListener("keydown", keyHandler);
        return () => {
            document.removeEventListener("keydown", keyHandler);
        };
    }, []);

    useEffect(() => {
        void loadInitialChatForPanel(model, () => setInitialLoadDone(true));
    }, [model]);

    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                model.dispatch({ type: "SET_CONTAINER_WIDTH", width: containerRef.current.offsetWidth });
            }
        };

        updateWidth();

        const resizeObserver = new ResizeObserver(updateWidth);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [model]);

    useEffect(() => {
        model.ensureRateLimitSet();
    }, [model]);

    const handleSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        await model.handleSubmit();
        setTimeout(() => {
            model.focusInput();
        }, 100);
    };

    const handleFocusCapture = useCallback(
        (event: React.FocusEvent) => {
            model.requestWaveAIFocus();
        },
        [model]
    );

    const handlePointerEnter = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (focusFollowsCursorMode !== "on") return;
            if (event.pointerType === "touch" || event.buttons > 0) return;
            if (isFocused) return;
            model.focusInput();
        },
        [focusFollowsCursorMode, isFocused, model]
    );

    const handleClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const isInteractive = target.closest('button, a, input, textarea, select, [role="button"], [tabindex]');

        if (isInteractive) {
            return;
        }

        const hasSelection = waveAIHasSelection();
        if (hasSelection) {
            model.requestWaveAIFocus();
            return;
        }

        setTimeout(() => {
            if (!waveAIHasSelection()) {
                model.focusInput();
            }
        }, 0);
    };

    const showBlockMask = isLayoutMode && showOverlayBlockNums;

    return (
        <>
        <AIPanelChatContext.Provider value={chatContextValue}>
        <div
            ref={containerRef}
            data-waveai-panel="true"
            className={cn(
                "@container bg-zinc-900/80 flex flex-col relative",
                "mt-1 h-[calc(100%-4px)]",
                "rounded-tr-[12px] rounded-br-[12px] rounded-bl-[12px]",
                (isDragOver || isReactDndDragOver) && "bg-zinc-800 border-accent",
                isFocused ? "border border-white/[0.08]" : "border border-transparent"
            )}
            onFocusCapture={handleFocusCapture}
            onPointerEnter={handlePointerEnter}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            inert={!isPanelVisible ? true : undefined}
        >
            <ConfigChangeModeFixer />
            {(isDragOver || isReactDndDragOver) && <AIDragOverlay />}
            {showBlockMask && <AIBlockMask />}
            <div key="main-content" className="flex-1 flex flex-col min-h-0">
                <AISessionToolbar
                    messages={coalescedMessages}
                    onRename={(chatid, title) => setRenameDialog({ chatid, title, value: title })}
                    onDelete={(chatid, title) => setDeleteDialog({ chatid, title })}
                />
                <TaskProgressPanel taskState={taskState} compact={true} />
                <BackgroundJobsPanel />
                {coalescedMessages.length === 0 && initialLoadDone ? (
                    <div
                        className="flex-1 overflow-y-auto p-2 relative"
                        onContextMenu={(e) => handleWaveAIContextMenu(e, true)}
                    >
                        <AIWelcomeMessage />
                    </div>
                ) : (
                    <AIPanelMessages
                        messages={coalescedMessages}
                        status={status}
                        onContextMenu={(e) => handleWaveAIContextMenu(e, true)}
                    />
                )}
                <AIErrorMessage />
                <AIDroppedFiles model={model} />
                <CommandInteractionInput />
                <QueuedMessageCard model={model} />
                <AIPanelInput onSubmit={handleSubmit} status={status} model={model} />
            </div>
        </div>
        </AIPanelChatContext.Provider>
        {renameDialog && (
            <Modal
                className="rename-session-modal"
                onOk={() => {
                    const trimmed = renameDialog.value.trim();
                    if (trimmed) {
                        void model.renameSession(renameDialog.chatid, trimmed);
                    }
                    setRenameDialog(null);
                }}
                onCancel={() => setRenameDialog(null)}
                onClose={() => setRenameDialog(null)}
                okLabel={t.aipanel.rename}
                cancelLabel={t.aipanel.cancel}
            >
                <div className="flex flex-col gap-3 pt-4 pb-2 max-w-md">
                    <div className="font-semibold text-base text-zinc-100">{t.aipanel.renameSessionTitle}</div>
                    <input
                        type="text"
                        className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-400"
                        value={renameDialog.value}
                        onChange={(e) => setRenameDialog({ ...renameDialog, value: e.target.value })}
                        placeholder={t.aipanel.renameSessionPlaceholder}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                const trimmed = renameDialog.value.trim();
                                if (trimmed) {
                                    void model.renameSession(renameDialog.chatid, trimmed);
                                }
                                setRenameDialog(null);
                            }
                        }}
                    />
                </div>
            </Modal>
        )}
        {deleteDialog && (
            <Modal
                className="delete-session-modal"
                onOk={() => {
                    void model.deleteSession(deleteDialog.chatid);
                    setDeleteDialog(null);
                }}
                onCancel={() => setDeleteDialog(null)}
                onClose={() => setDeleteDialog(null)}
                okLabel={t.aipanel.delete}
                cancelLabel={t.aipanel.cancel}
            >
                <div className="flex flex-col gap-3 pt-4 pb-2 max-w-md">
                    <div className="font-semibold text-base text-zinc-100">{t.aipanel.deleteSessionTitle(deleteDialog.title)}</div>
                    <div className="text-sm text-zinc-400">{t.aipanel.deleteSessionHint}</div>
                </div>
            </Modal>
        )}
        </>
    );
});

AIPanelComponentInner.displayName = "AIPanelInner";

const AIPanelComponent = () => {
    return (
        <ErrorBoundary>
            <AIPanelComponentInner />
        </ErrorBoundary>
    );
};

AIPanelComponent.displayName = "AIPanel";

export { loadInitialChatForPanel } from "./aipanel-loadutil";
export { getHorizontalSessionTabs } from "./ai-session-utils";
export { AIPanelComponent as AIPanel };
