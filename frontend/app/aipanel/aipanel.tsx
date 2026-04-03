// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { atoms, getFocusedBlockId, getSettingsKeyAtom, recordTEvent } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { maybeUseTabModel } from "@/app/store/tab-model";
import { isBuilderWindow } from "@/app/store/windowtype";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { isMacOS, isWindows } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import { deriveAgentRuntimeStatus } from "./agentstatus";
import { formatFileSizeError, isAcceptableFile, validateFileSize } from "./ai-utils";
import { AIDroppedFiles } from "./aidroppedfiles";
import { AIModeDropdown } from "./aimode";
import { loadInitialChatForPanel } from "./aipanel-loadutil";
import { AIPanelInput } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";
import { shouldHideProgressStatusLines } from "./aitooluse";
import {
    WaveUIMessage,
    getLatestToolProgressPart,
    getLatestToolUsePart,
    toolCallFromPart,
    toolResultFromPart,
} from "./aitypes";
import { BYOKAnnouncement } from "./byokannouncement";
import { TelemetryRequiredMessage } from "./telemetryrequired";
import { WaveAIModel } from "./waveai-model";

const AIBlockMask = memo(() => {
    return (
        <div
            key="block-mask"
            className="absolute top-0 left-0 right-0 bottom-0 border-1 border-transparent pointer-events-auto select-none p-0.5"
            style={{
                borderRadius: "var(--block-border-radius)",
                zIndex: "var(--zindex-block-mask-inner)",
            }}
        >
            <div
                className="w-full mt-[44px] h-[calc(100%-44px)] flex items-center justify-center"
                style={{
                    backgroundColor: "rgb(from var(--block-bg-color) r g b / 50%)",
                }}
            >
                <div className="font-bold opacity-70 mt-[-25%] text-[60px]">0</div>
            </div>
        </div>
    );
});

AIBlockMask.displayName = "AIBlockMask";

const AIDragOverlay = memo(() => {
    return (
        <div
            key="drag-overlay"
            className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-10 p-4"
        >
            <div className="text-accent text-center">
                <i className="fa fa-upload text-3xl mb-2"></i>
                <div className="text-lg font-semibold">Drop files here</div>
                <div className="text-sm">Images, PDFs, and text/code files supported</div>
            </div>
        </div>
    );
});

AIDragOverlay.displayName = "AIDragOverlay";

const KeyCap = memo(({ children, className }: { children: React.ReactNode; className?: string }) => {
    return (
        <kbd
            className={cn(
                "px-1.5 py-0.5 text-xs bg-zinc-700 border border-zinc-600 rounded-sm shadow-sm font-mono",
                className
            )}
        >
            {children}
        </kbd>
    );
});

KeyCap.displayName = "KeyCap";

const AIWelcomeMessage = memo(() => {
    const modKey = isMacOS() ? "⌘" : "Alt";
    const aiModeConfigs = jotai.useAtomValue(atoms.waveaiModeConfigAtom);
    const hasCustomModes = Object.keys(aiModeConfigs).some((key) => !key.startsWith("waveai@"));
    return (
            <div className="text-secondary py-8">
                <div className="text-center">
                    <i className="fa fa-sparkles text-4xl text-accent mb-2 block"></i>
                    <p className="text-lg font-bold text-primary">Welcome to Wave AI</p>
                </div>
                <div className="mt-4 text-left max-w-md mx-auto">
                    <p className="text-sm mb-6">
                        Wave AI is your terminal assistant with context. I can read your terminal output, analyze
                        widgets, access files, and help you solve problems faster.
                    </p>
                    <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
                        <div className="text-sm font-semibold mb-3 text-accent">Getting Started:</div>
                        <div className="space-y-3 text-sm">
                            <div className="flex items-start gap-3">
                                <div className="w-4 text-center flex-shrink-0">
                                    <i className="fa-solid fa-plug text-accent"></i>
                                </div>
                                <div>
                                    <span className="font-bold">Widget Context</span>
                                    <div className="">When ON, I can read your terminal and analyze widgets.</div>
                                    <div className="">When OFF, I'm sandboxed with no system access.</div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-4 text-center flex-shrink-0">
                                    <i className="fa-solid fa-file-import text-accent"></i>
                                </div>
                                <div>Drag & drop files or images for analysis</div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-4 text-center flex-shrink-0">
                                    <i className="fa-solid fa-keyboard text-accent"></i>
                                </div>
                                <div className="space-y-1">
                                    <div>
                                        <KeyCap>{modKey}</KeyCap>
                                        <KeyCap className="ml-1">K</KeyCap>
                                        <span className="ml-1.5">to start a new chat</span>
                                    </div>
                                    <div>
                                        <KeyCap>{modKey}</KeyCap>
                                        <KeyCap className="ml-1">Shift</KeyCap>
                                        <KeyCap className="ml-1">A</KeyCap>
                                        <span className="ml-1.5">to toggle panel</span>
                                    </div>
                                    <div>
                                        {isWindows() ? (
                                            <>
                                                <KeyCap>Alt</KeyCap>
                                                <KeyCap className="ml-1">0</KeyCap>
                                                <span className="ml-1.5">to focus</span>
                                            </>
                                        ) : (
                                            <>
                                                <KeyCap>Ctrl</KeyCap>
                                                <KeyCap className="ml-1">Shift</KeyCap>
                                                <KeyCap className="ml-1">0</KeyCap>
                                                <span className="ml-1.5">to focus</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-4 text-center flex-shrink-0">
                                    <i className="fa-brands fa-discord text-accent"></i>
                                </div>
                                <div>
                                    Questions or feedback?{" "}
                                    <a
                                        target="_blank"
                                        href="https://discord.gg/XfvZ334gwU"
                                        rel="noopener"
                                        className="text-accent hover:underline cursor-pointer"
                                    >
                                        Join our Discord
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                    {!hasCustomModes && <BYOKAnnouncement />}
                    <div className="mt-4 text-center text-[12px] text-muted">
                        BETA: Free to use. Daily limits keep our costs in check.
                    </div>
                </div>
            </div>
    );
});

AIWelcomeMessage.displayName = "AIWelcomeMessage";

const AIBuilderWelcomeMessage = memo(() => {
    return (
        <div className="text-secondary py-8">
            <div className="text-center">
                <i className="fa fa-sparkles text-4xl text-accent mb-4 block"></i>
                <p className="text-lg font-bold text-primary">WaveApp Builder</p>
            </div>
            <div className="mt-4 text-left max-w-md mx-auto">
                <p className="text-sm mb-6">
                    The WaveApp builder helps create wave widgets that integrate seamlessly into Wave Terminal.
                </p>
            </div>
        </div>
    );
});

AIBuilderWelcomeMessage.displayName = "AIBuilderWelcomeMessage";

const AIErrorMessage = memo(() => {
    const model = WaveAIModel.getInstance();
    const errorMessage = jotai.useAtomValue(model.errorMessage);

    if (!errorMessage) {
        return null;
    }

    return (
        <div className="px-4 py-2 text-red-400 bg-red-900/20 border-l-4 border-red-500 mx-2 mb-2 relative">
            <button
                onClick={() => model.clearError()}
                className="absolute top-2 right-2 text-red-400 hover:text-red-300 cursor-pointer z-10"
                aria-label="Close error"
            >
                <i className="fa fa-times text-sm"></i>
            </button>
            <div className="text-sm pr-6 max-h-[100px] overflow-y-auto">
                {errorMessage}
                <button
                    onClick={() => model.clearChat()}
                    className="ml-2 text-xs text-red-300 hover:text-red-200 cursor-pointer underline"
                >
                    New Chat
                </button>
            </div>
        </div>
    );
});

AIErrorMessage.displayName = "AIErrorMessage";

const ConfigChangeModeFixer = memo(() => {
    const model = WaveAIModel.getInstance();
    const telemetryEnabled = jotai.useAtomValue(getSettingsKeyAtom("telemetry:enabled")) ?? false;
    const aiModeConfigs = jotai.useAtomValue(model.aiModeConfigs);

    useEffect(() => {
        model.fixModeAfterConfigChange();
    }, [telemetryEnabled, aiModeConfigs, model]);

    return null;
});

ConfigChangeModeFixer.displayName = "ConfigChangeModeFixer";

const STREAM_UPDATE_THROTTLE_MS = 34;

const AIPanelComponentInner = memo(() => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isReactDndDragOver, setIsReactDndDragOver] = useState(false);
    const [initialLoadDone, setInitialLoadDone] = useState(false);
    const model = WaveAIModel.getInstance();
    const containerRef = useRef<HTMLDivElement>(null);
    const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
    const showOverlayBlockNums = jotai.useAtomValue(getSettingsKeyAtom("app:showoverlayblocknums")) ?? true;
    const isFocused = jotai.useAtomValue(model.isWaveAIFocusedAtom);
    const focusFollowsCursorMode = jotai.useAtomValue(getSettingsKeyAtom("app:focusfollowscursor")) ?? "off";
    const telemetryEnabled = jotai.useAtomValue(getSettingsKeyAtom("telemetry:enabled")) ?? false;
    const isPanelVisible = jotai.useAtomValue(model.getPanelVisibleAtom());
    const errorMessage = jotai.useAtomValue(model.errorMessage);
    const agentRuntimeSnapshot = jotai.useAtomValue(model.agentRuntimeAtom);
    const agentMode = jotai.useAtomValue(model.agentModeAtom);
    const tabModel = maybeUseTabModel();
    const defaultMode = jotai.useAtomValue(getSettingsKeyAtom("waveai:defaultmode")) ?? "waveai@balanced";
    const aiModeConfigs = jotai.useAtomValue(model.aiModeConfigs);
    const runtimePerfRef = useRef<{
        traceId: string;
        submitAt: number;
        firstTokenAt: number;
        active: boolean;
    }>({
        traceId: "",
        submitAt: 0,
        firstTokenAt: 0,
        active: false,
    });
    const approvalWaitRef = useRef<{ startedAt: number; traceId: string } | null>(null);

    const hasCustomModes = Object.keys(aiModeConfigs).some((key) => !key.startsWith("waveai@"));
    const isUsingCustomMode = !defaultMode.startsWith("waveai@");
    const allowAccess = telemetryEnabled || (hasCustomModes && isUsingCustomMode);

    const { messages, sendMessage, status, setMessages, error, stop } = useChat<WaveUIMessage>({
        experimental_throttle: STREAM_UPDATE_THROTTLE_MS,
        transport: new DefaultChatTransport({
            api: model.getUseChatEndpointUrl(),
            prepareSendMessagesRequest: (opts) => {
                const msg = model.getAndClearMessage();
                const body: any = {
                    msg,
                    chatid: globalStore.get(model.chatId),
                    widgetaccess: globalStore.get(model.widgetAccessAtom),
                    aimode: globalStore.get(model.currentAIMode),
                    agentmode: globalStore.get(model.agentModeAtom),
                };
                if (isBuilderWindow()) {
                    body.builderid = globalStore.get(atoms.builderId);
                    body.builderappid = globalStore.get(atoms.builderAppId);
                }
                body.tabid = tabModel.tabId;
                const focusedBlockId = getFocusedBlockId();
                if (focusedBlockId) {
                    body.blockid = focusedBlockId;
                }
                return { body };
            },
        }),
        onError: (error) => {
            console.error("AI Chat error:", error);
            model.dispatchAgentEvent({
                type: "TOOL_CALL_FAILED",
                result: {
                    requestId: crypto.randomUUID(),
                    taskId: globalStore.get(model.chatId) || crypto.randomUUID(),
                    toolName: "chat-stream",
                    ok: false,
                    exitCode: 1,
                    stderr: error.message || "An error occurred",
                    durationMs: 0,
                    errorCode: "CHAT_STREAM_ERROR",
                },
                retryable: true,
            });
            model.setError(error.message || "An error occurred");
        },
    });

    model.registerUseChatData(sendMessage, setMessages, status, stop);

    // console.log("AICHAT messages", messages);
    (window as any).aichatmessages = messages;
    (window as any).aichatstatus = status;

    const derivedAgentStatusSnapshot = deriveAgentRuntimeStatus({
        provider: "Wave AI",
        mode: agentMode,
        chatStatus: status,
        messages,
        errorMessage,
    });

    useEffect(() => {
        model.mergeAgentRuntimeSnapshot(derivedAgentStatusSnapshot);
    }, [derivedAgentStatusSnapshot, model]);

    useEffect(() => {
        const taskId = globalStore.get(model.chatId) || "waveai";
        const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
        const latestToolUse = getLatestToolUsePart(lastAssistantMessage);
        const latestToolProgress = getLatestToolProgressPart(lastAssistantMessage);

        if (latestToolUse) {
            const lastToolCall = toolCallFromPart(latestToolUse, taskId);
            const lastToolResult = toolResultFromPart(latestToolUse, taskId) ?? undefined;
            const progressBlockedReason =
                !shouldHideProgressStatusLines(latestToolProgress?.data?.toolname) &&
                latestToolProgress?.data?.statuslines?.find((line) => Boolean(line?.trim()));
            model.mergeAgentRuntimeSnapshot({
                lastToolCall,
                lastToolResult,
                activeTool: latestToolUse.data.toolname,
                blockedReason: latestToolUse.data.errormessage ?? latestToolUse.data.tooldesc ?? progressBlockedReason,
            });
            if (latestToolUse.data.approval === "needs-approval") {
                model.dispatchAgentEvent({
                    type: "APPROVAL_REQUIRED",
                    reason: latestToolUse.data.tooldesc || "Waiting for tool approval",
                });
            }
            return;
        }

        if (latestToolProgress) {
            model.mergeAgentRuntimeSnapshot({
                activeTool: latestToolProgress.data.toolname,
                blockedReason: shouldHideProgressStatusLines(latestToolProgress.data.toolname)
                    ? undefined
                    : latestToolProgress.data.statuslines?.find((line) => Boolean(line?.trim())),
            });
        }
    }, [messages, model]);

    useEffect(() => {
        if (status === "streaming") {
            return;
        }
        if (errorMessage) {
            return;
        }
        if (messages.length > 0) {
            model.dispatchAgentEvent({ type: "VERIFY_FINISHED", ok: true });
        }
    }, [status, errorMessage, messages.length, model]);

    useEffect(() => {
        if (agentRuntimeSnapshot.state !== "submitting") {
            return;
        }
        const traceId = crypto.randomUUID();
        const submitAt = Date.now();
        runtimePerfRef.current = {
            traceId,
            submitAt,
            firstTokenAt: 0,
            active: true,
        };
        recordTEvent("waveai:perf:submit", {
            "waveai:traceid": traceId,
            "waveai:chatid": globalStore.get(model.chatId) || "",
            "waveai:agentmode": globalStore.get(model.agentModeAtom),
        } as any);
    }, [agentRuntimeSnapshot.state, model]);

    useEffect(() => {
        const perf = runtimePerfRef.current;
        if (!perf.active || perf.firstTokenAt > 0 || status !== "streaming") {
            return;
        }
        const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
        const hasAssistantPayload =
            (lastAssistantMessage?.parts?.some(
                (part) =>
                    (part.type === "text" && Boolean(part.text?.trim())) ||
                    part.type === "data-tooluse" ||
                    part.type === "data-toolprogress"
            ) ??
                false) ||
            Boolean(lastAssistantMessage);
        if (!hasAssistantPayload) {
            return;
        }
        const firstTokenAt = Date.now();
        perf.firstTokenAt = firstTokenAt;
        recordTEvent("waveai:perf:firsttoken", {
            "waveai:traceid": perf.traceId,
            "waveai:ttfbms": firstTokenAt - perf.submitAt,
        } as any);
    }, [messages, status]);

    useEffect(() => {
        const perf = runtimePerfRef.current;
        if (!perf.active || status === "streaming") {
            return;
        }
        const terminalStates = new Set(["success", "failed_retryable", "failed_fatal", "cancelled", "unavailable"]);
        if (!terminalStates.has(agentRuntimeSnapshot.state)) {
            return;
        }
        const doneAt = Date.now();
        recordTEvent("waveai:perf:done", {
            "waveai:traceid": perf.traceId,
            "waveai:state": agentRuntimeSnapshot.state,
            "waveai:totalms": doneAt - perf.submitAt,
            "waveai:streamms": perf.firstTokenAt > 0 ? doneAt - perf.firstTokenAt : 0,
            "waveai:hadfirsttoken": perf.firstTokenAt > 0,
        } as any);
        runtimePerfRef.current = {
            traceId: "",
            submitAt: 0,
            firstTokenAt: 0,
            active: false,
        };
    }, [agentRuntimeSnapshot.state, status]);

    useEffect(() => {
        if (agentRuntimeSnapshot.state === "awaiting_approval") {
            if (approvalWaitRef.current == null) {
                approvalWaitRef.current = {
                    startedAt: Date.now(),
                    traceId: runtimePerfRef.current.traceId,
                };
            }
            return;
        }
        if (approvalWaitRef.current != null) {
            recordTEvent("waveai:perf:approvalwait", {
                "waveai:traceid": approvalWaitRef.current.traceId,
                "waveai:waitms": Date.now() - approvalWaitRef.current.startedAt,
                "waveai:endstate": agentRuntimeSnapshot.state,
            } as any);
            approvalWaitRef.current = null;
        }
    }, [agentRuntimeSnapshot.state]);

    const handleKeyDown = (waveEvent: WaveKeyboardEvent): boolean => {
        if (checkKeyPressed(waveEvent, "Cmd:k")) {
            model.clearChat();
            return true;
        }
        return false;
    };

    useEffect(() => {
        globalStore.set(model.isAIStreaming, status == "streaming");
    }, [status]);

    useEffect(() => {
        const keyHandler = keydownWrapper(handleKeyDown);
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
                globalStore.set(model.containerWidth, containerRef.current.offsetWidth);
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await model.handleSubmit();
        setTimeout(() => {
            model.focusInput();
        }, 100);
    };

    const hasFilesDragged = (dataTransfer: DataTransfer): boolean => {
        // Check if the drag operation contains files by looking at the types
        return dataTransfer.types.includes("Files");
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!allowAccess) {
            return;
        }

        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (!isDragOver) {
            setIsDragOver(true);
        }
    };

    const handleDragEnter = (e: React.DragEvent) => {
        if (!allowAccess) {
            return;
        }

        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!allowAccess) {
            return;
        }

        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        // Only set drag over to false if we're actually leaving the drop zone
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;

        if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            setIsDragOver(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        if (!allowAccess) {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
            return;
        }

        // Check if this is a FILE_ITEM drag from react-dnd
        // If so, let react-dnd handle it instead
        if (!e.dataTransfer.files.length) {
            return; // Let react-dnd handle FILE_ITEM drags
        }

        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        const acceptableFiles = files.filter(isAcceptableFile);

        for (const file of acceptableFiles) {
            const sizeError = validateFileSize(file);
            if (sizeError) {
                model.setError(formatFileSizeError(sizeError));
                return;
            }
            await model.addFile(file);
        }

        if (acceptableFiles.length < files.length) {
            const rejectedCount = files.length - acceptableFiles.length;
            const rejectedFiles = files.filter((f) => !isAcceptableFile(f));
            const fileNames = rejectedFiles.map((f) => f.name).join(", ");
            model.setError(
                `${rejectedCount} file${rejectedCount > 1 ? "s" : ""} rejected (unsupported type): ${fileNames}. Supported: images, PDFs, and text/code files.`
            );
        }
    };

    const handleFileItemDrop = useCallback(
        (draggedFile: DraggedFile) => {
            if (!allowAccess) {
                return;
            }
            model.addFileFromRemoteUri(draggedFile);
        },
        [model, allowAccess]
    );

    const [{ isOver, canDrop }, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM",
            drop: handleFileItemDrop,
            collect: (monitor) => ({
                isOver: monitor.isOver(),
                canDrop: monitor.canDrop(),
            }),
        }),
        [handleFileItemDrop]
    );

    // Update drag over state for FILE_ITEM drags
    useEffect(() => {
        if (isOver && canDrop) {
            setIsReactDndDragOver(true);
        } else {
            setIsReactDndDragOver(false);
        }
    }, [isOver, canDrop]);

    // Attach the drop ref to the container
    useEffect(() => {
        if (containerRef.current) {
            drop(containerRef.current);
        }
    }, [drop]);

    const handleFocusCapture = useCallback(
        (event: React.FocusEvent) => {
            // console.log("Wave AI focus capture", getElemAsStr(event.target));
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
        <div
            ref={containerRef}
            data-waveai-panel="true"
            className={cn(
                "@container bg-zinc-900/70 flex flex-col relative",
                model.inBuilder ? "mt-0 h-full" : "mt-1 h-[calc(100%-4px)]",
                (isDragOver || isReactDndDragOver) && "bg-zinc-800 border-accent",
                isFocused ? "border-2 border-accent" : "border-2 border-transparent"
            )}
            style={{
                borderTopRightRadius: model.inBuilder ? 0 : 10,
                borderBottomRightRadius: model.inBuilder ? 0 : 10,
                borderBottomLeftRadius: 10,
            }}
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
            {(isDragOver || isReactDndDragOver) && allowAccess && <AIDragOverlay />}
            {showBlockMask && <AIBlockMask />}
            <div key="main-content" className="flex-1 flex flex-col min-h-0">
                {!allowAccess ? (
                    <TelemetryRequiredMessage />
                ) : (
                    <>
                        {messages.length === 0 && initialLoadDone ? (
                            <div
                                className="flex-1 overflow-y-auto p-2 relative"
                                onContextMenu={(e) => handleWaveAIContextMenu(e, true)}
                            >
                                <div className="absolute top-2 left-2 z-10">
                                <AIModeDropdown />
                                </div>
                                {model.inBuilder ? (
                                    <AIBuilderWelcomeMessage />
                                ) : (
                                    <AIWelcomeMessage />
                                )}
                            </div>
                        ) : (
                            <AIPanelMessages
                                messages={messages}
                                status={status}
                                onContextMenu={(e) => handleWaveAIContextMenu(e, true)}
                            />
                        )}
                        <AIErrorMessage />
                        <AIDroppedFiles model={model} />
                        <AIPanelInput onSubmit={handleSubmit} status={status} model={model} />
                    </>
                )}
            </div>
        </div>
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
export { AIPanelComponent as AIPanel };
