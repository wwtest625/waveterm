import { createImagePreview, formatFileSizeError, isAcceptableFile, resizeImage, validateFileSize } from "./ai-utils";
import { atoms, getFocusedBlockId, recordTEvent } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { type AIPanelChatContextValue } from "./aipanel-chat-context";
import { deriveAgentRuntimeStatus } from "./agentstatus";
import { shouldHideProgressStatusLines } from "./aitooluse";
import {
    type AgentTaskState,
    type AgentRuntimeState,
    type AskUserData,
    type CommandInteractionState,
    type FileContextData,
    type WaveUIMessage,
    coalesceMessageParts,
    getLatestAskPart,
    getLatestTaskStatePart,
    getLatestVisibleToolProgressPart,
    getLatestVisibleToolUsePart,
    isInternalAssistantToolName,
    isTerminalRuntimeState,
    toolCallFromPart,
    toolResultFromPart,
} from "./aitypes";
import { t } from "./aipanel-i18n";
import type { WaveAIModel } from "./waveai-model";
import type { AgentMode } from "./waveai-model";
import { useDrop } from "react-dnd";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ChatStatus } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useFileDragDrop(model: WaveAIModel, containerRef: React.RefObject<HTMLDivElement | null>) {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isReactDndDragOver, setIsReactDndDragOver] = useState(false);

    const hasFilesDragged = (dataTransfer: DataTransfer): boolean => {
        return dataTransfer.types.includes("Files");
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!hasFilesDragged(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!isDragOver) {
            setIsDragOver(true);
        }
    };

    const handleDragEnter = (e: React.DragEvent) => {
        if (!hasFilesDragged(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!hasFilesDragged(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            setIsDragOver(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        if (!e.dataTransfer.files.length) return;
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
            const processedFile = await resizeImage(file);
            let previewUrl: string | undefined;
            if (processedFile.type.startsWith("image/")) {
                const preview = await createImagePreview(processedFile);
                if (preview) previewUrl = preview;
            }
            model.addContextItem({
                id: crypto.randomUUID(),
                type: "file",
                label: processedFile.name,
                icon: "fa-file",
                data: {
                    path: processedFile.name,
                    connName: "local",
                    size: processedFile.size,
                    mimetype: processedFile.type,
                    file: processedFile,
                    previewUrl,
                } as FileContextData,
            });
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
            model.addFileFromRemoteUri(draggedFile);
        },
        [model]
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

    useEffect(() => {
        if (isOver && canDrop) {
            setIsReactDndDragOver(true);
        } else {
            setIsReactDndDragOver(false);
        }
    }, [isOver, canDrop]);

    useEffect(() => {
        if (containerRef.current) {
            drop(containerRef.current);
        }
    }, [drop]);

    return {
        isDragOver,
        isReactDndDragOver,
        handleDragOver,
        handleDragEnter,
        handleDragLeave,
        handleDrop,
    };
}

export function usePerformanceTracking(
    agentRuntimeSnapshot: { state: string },
    coalescedMessages: { role: string; parts?: any[] }[],
    status: string,
    model: WaveAIModel
) {
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

    useEffect(() => {
        if (agentRuntimeSnapshot.state !== "submitting") return;
        const traceId = crypto.randomUUID();
        const submitAt = Date.now();
        runtimePerfRef.current = { traceId, submitAt, firstTokenAt: 0, active: true };
        recordTEvent("waveai:perf:submit", {
            "waveai:traceid": traceId,
            "waveai:chatid": globalStore.get(model.chatId) || "",
            "waveai:agentmode": globalStore.get(model.agentModeAtom),
        });
    }, [agentRuntimeSnapshot.state, model]);

    useEffect(() => {
        const perf = runtimePerfRef.current;
        if (!perf.active || perf.firstTokenAt > 0 || status !== "streaming") return;
        const lastAssistantMessage = [...coalescedMessages].reverse().find((message) => message.role === "assistant");
        const hasAssistantPayload =
            (lastAssistantMessage?.parts?.some(
                (part) =>
                    (part.type === "text" && Boolean((part as { text?: string }).text?.trim())) ||
                    part.type === "data-tooluse" ||
                    part.type === "data-toolprogress"
            ) ?? false) || Boolean(lastAssistantMessage);
        if (!hasAssistantPayload) return;
        const firstTokenAt = Date.now();
        perf.firstTokenAt = firstTokenAt;
        recordTEvent("waveai:perf:firsttoken", {
            "waveai:traceid": perf.traceId,
            "waveai:ttfbms": firstTokenAt - perf.submitAt,
        });
    }, [coalescedMessages, status]);

    useEffect(() => {
        const perf = runtimePerfRef.current;
        if (!perf.active || status === "streaming") return;
        const terminalStates = new Set([
            "completed",
            "success",
            "failed_retryable",
            "failed_fatal",
            "cancelled",
            "unavailable",
        ]);
        if (!terminalStates.has(agentRuntimeSnapshot.state)) return;
        const doneAt = Date.now();
        recordTEvent("waveai:perf:done", {
            "waveai:traceid": perf.traceId,
            "waveai:state": agentRuntimeSnapshot.state,
            "waveai:totalms": doneAt - perf.submitAt,
            "waveai:streamms": perf.firstTokenAt > 0 ? doneAt - perf.firstTokenAt : 0,
            "waveai:hadfirsttoken": perf.firstTokenAt > 0,
        });
        runtimePerfRef.current = { traceId: "", submitAt: 0, firstTokenAt: 0, active: false };
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
            });
            approvalWaitRef.current = null;
        }
    }, [agentRuntimeSnapshot.state]);
}

export function useBackgroundJobsRefresh(
    chatIdValue: string,
    isPanelVisible: boolean,
    backgroundJobs: { status?: string }[],
    model: WaveAIModel
) {
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!chatIdValue || !isPanelVisible) return;
        void model.refreshBackgroundJobs(chatIdValue);
    }, [chatIdValue, isPanelVisible, model]);

    useEffect(() => {
        if (!chatIdValue || !isPanelVisible) return;
        const unsub = waveEventSubscribeSingle({
            eventType: "waveai:bgjob",
            handler: (event) => {
                const job = event.data as UIChatBackgroundJobInfo | undefined;
                if (!job) return;
                model.upsertBackgroundJobFromEvent(job);
            },
            scope: `chat:${chatIdValue}`,
        });
        return unsub;
    }, [chatIdValue, isPanelVisible, model]);

    useEffect(() => {
        if (timerRef.current != null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (!chatIdValue || !isPanelVisible || backgroundJobs.length === 0) return;
        const interval = 30000;
        timerRef.current = window.setInterval(() => {
            void model.refreshBackgroundJobs(chatIdValue);
        }, interval);
        return () => {
            if (timerRef.current != null) {
                window.clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [chatIdValue, isPanelVisible, backgroundJobs.length, model]);
}

const STREAM_UPDATE_THROTTLE_MS = 34;

export function useChatSetup(model: WaveAIModel, tabId: string) {
    const chatId = jotai.useAtomValue(model.chatId);
    const { messages, sendMessage, status, setMessages, error, stop } = useChat<WaveUIMessage>({
        id: chatId,
        experimental_throttle: STREAM_UPDATE_THROTTLE_MS,
        transport: new DefaultChatTransport({
            api: model.getUseChatEndpointUrl(),
            prepareSendMessagesRequest: () => {
                const msg = model.getAndClearMessage();
                const body: Record<string, unknown> = {
                    msg,
                    chatid: globalStore.get(model.chatId),
                    widgetaccess: globalStore.get(model.widgetAccessAtom),
                    aimode: globalStore.get(model.currentAIMode),
                    agentmode: globalStore.get(model.agentModeAtom),
                };
                body.tabid = tabId;
                const focusedBlockId = getFocusedBlockId();
                if (focusedBlockId) {
                    body.blockid = focusedBlockId;
                }
                return { body };
            },
        }),
        onError: (err) => {
            console.error("AI Chat error:", err);
            model.dispatchAgentEvent({
                type: "TOOL_CALL_FAILED",
                result: {
                    requestId: crypto.randomUUID(),
                    taskId: globalStore.get(model.chatId) || crypto.randomUUID(),
                    toolName: "chat-stream",
                    ok: false,
                    exitCode: 1,
                    stderr: err.message || "An error occurred",
                    durationMs: 0,
                    errorCode: "CHAT_STREAM_ERROR",
                },
                retryable: true,
            });
            model.setError(err.message || "An error occurred");
        },
    });

    const chatContextValue = useMemo<AIPanelChatContextValue>(
        () => ({ sendMessage, setMessages, status, stop }),
        [sendMessage, setMessages, status, stop]
    );

    useEffect(() => {
        model.registerChatContext(chatContextValue);
    }, [chatContextValue, model]);

    const coalescedMessages = useMemo(() => {
        let changed = false;
        const result: typeof messages = [];
        for (const msg of messages) {
            const coalescedParts = coalesceMessageParts(msg.parts);
            if (coalescedParts === msg.parts) {
                result.push(msg);
            } else {
                changed = true;
                result.push({ ...msg, parts: coalescedParts });
            }
        }
        return changed ? result : messages;
    }, [messages]);

    return { messages, sendMessage, status, setMessages, error, stop, chatContextValue, coalescedMessages };
}

type MessageAnalysisResult = {
    latestTaskState: ReturnType<typeof getLatestTaskStatePart>;
    visibleToolUses: NonNullable<ReturnType<typeof getLatestVisibleToolUsePart>>[];
    latestToolUse: ReturnType<typeof getLatestVisibleToolUsePart>;
    latestCompletedToolUse: NonNullable<ReturnType<typeof getLatestVisibleToolUsePart>> | undefined;
    runningToolUses: NonNullable<ReturnType<typeof getLatestVisibleToolUsePart>>[];
    pendingApprovalToolUse: NonNullable<ReturnType<typeof getLatestVisibleToolUsePart>> | undefined;
    latestToolProgress: ReturnType<typeof getLatestVisibleToolProgressPart>;
    latestInteractiveToolUse: NonNullable<ReturnType<typeof getLatestVisibleToolUsePart>> | undefined;
    latestAsk: ReturnType<typeof getLatestAskPart>;
};

export function useMessageAnalysis(
    coalescedMessages: WaveUIMessage[],
    model: WaveAIModel,
    status: ChatStatus,
    errorMessage: string | null | undefined,
    commandInteraction: CommandInteractionState | null,
    agentMode: AgentMode,
    agentRuntimeSnapshot: { state: AgentRuntimeState; activeJobIds?: string[] },
    chatClearEpoch: number
) {
    const messageAnalysis = useMemo<MessageAnalysisResult>(() => {
        const lastAssistantMessage = [...coalescedMessages].reverse().find((message) => message.role === "assistant");
        const latestTaskStateMessage = [...coalescedMessages]
            .reverse()
            .find((message) => message.role === "assistant" && getLatestTaskStatePart(message));
        const latestTaskState = getLatestTaskStatePart(latestTaskStateMessage);
        const visibleToolUses =
            [...(lastAssistantMessage?.parts ?? [])]
                .filter(
                    (part): part is WaveUIMessage["parts"][number] & { type: "data-tooluse" } =>
                        part.type === "data-tooluse" && !isInternalAssistantToolName(part.data?.toolname)
                ) ?? [];
        const latestToolUse = visibleToolUses.at(-1) ?? getLatestVisibleToolUsePart(lastAssistantMessage);
        const latestCompletedToolUse = [...visibleToolUses]
            .reverse()
            .find((part) => part.data.status !== "pending" && part.data.partial !== true);
        const runningToolUses = visibleToolUses.filter(
            (part) => (part.data.status === "running" || part.data.partial === true) && Boolean(part.data.jobid)
        );
        const pendingApprovalToolUse = visibleToolUses.find((part) => part.data.approval === "needs-approval");
        const latestToolProgress = getLatestVisibleToolProgressPart(lastAssistantMessage);
        const latestInteractiveToolUse = [...visibleToolUses]
            .reverse()
            .find(
                (part) =>
                    part.data.toolname === "wave_run_command" &&
                    part.data.status === "running" &&
                    part.data.jobid &&
                    (part.data.awaitinginput || part.data.tuidetected)
            );
        const latestAsk = getLatestAskPart(lastAssistantMessage);
        return {
            latestTaskState,
            visibleToolUses,
            latestToolUse,
            latestCompletedToolUse,
            runningToolUses,
            pendingApprovalToolUse,
            latestToolProgress,
            latestInteractiveToolUse,
            latestAsk,
        };
    }, [coalescedMessages]);

    useEffect(() => {
        if (!messageAnalysis.latestTaskState?.data) return;
        const taskStateData = messageAnalysis.latestTaskState.data as AgentTaskState;
        model.dispatch({ type: "SET_TASK_STATE", taskState: taskStateData });
        if (taskStateData.focuschain) {
            model.dispatch({ type: "SET_FOCUS_CHAIN", focusChain: taskStateData.focuschain });
        }
        if (taskStateData.focuschain?.currentcontextusage != null) {
            model.dispatch({ type: "SET_CONTEXT_USAGE", usage: taskStateData.focuschain.currentcontextusage });
        }
        if (taskStateData.securityblocked) {
            model.dispatch({ type: "SET_SECURITY_BLOCKED", blocked: true });
        }
        if (taskStateData.status === "completed" && status !== "streaming" && !commandInteraction) {
            const currentRuntime = globalStore.get(model.agentRuntimeAtom);
            if (!isTerminalRuntimeState(currentRuntime.state)) {
                model.dispatchAgentEvent({ type: "VERIFY_FINISHED", ok: true });
            }
        }
    }, [messageAnalysis, model, status, commandInteraction, chatClearEpoch]);

    useEffect(() => {
        const currentInteraction = globalStore.get(model.commandInteractionAtom);
        const { latestInteractiveToolUse, visibleToolUses } = messageAnalysis;
        if (latestInteractiveToolUse?.data?.jobid) {
            const nextInteraction: CommandInteractionState = {
                jobId: latestInteractiveToolUse.data.jobid,
                awaitingInput: Boolean(latestInteractiveToolUse.data.awaitinginput),
                promptHint: latestInteractiveToolUse.data.prompthint || "Command is waiting for terminal input",
                inputOptions: latestInteractiveToolUse.data.inputoptions,
                tuiDetected: latestInteractiveToolUse.data.tuidetected,
                tuiSuppressed: latestInteractiveToolUse.data.tuisuppressed,
                outputPreview: latestInteractiveToolUse.data.outputtext,
            };
            const changed =
                currentInteraction?.jobId !== nextInteraction.jobId ||
                currentInteraction?.awaitingInput !== nextInteraction.awaitingInput ||
                currentInteraction?.promptHint !== nextInteraction.promptHint ||
                currentInteraction?.tuiDetected !== nextInteraction.tuiDetected ||
                currentInteraction?.tuiSuppressed !== nextInteraction.tuiSuppressed ||
                (currentInteraction?.inputOptions ?? []).length !== (nextInteraction.inputOptions ?? []).length ||
                (currentInteraction?.inputOptions ?? []).some((v, i) => v !== nextInteraction.inputOptions?.[i]) ||
                currentInteraction?.outputPreview !== nextInteraction.outputPreview;
            if (changed) {
                model.dispatch({ type: "SET_COMMAND_INTERACTION", interaction: nextInteraction });
                model.dispatchAgentEvent({
                    type: "INTERACTION_REQUIRED",
                    reason: nextInteraction.promptHint,
                });
            }
        } else if (
            currentInteraction?.jobId &&
            !visibleToolUses.some(
                (part) =>
                    part.data.toolname === "wave_run_command" &&
                    part.data.jobid === currentInteraction.jobId &&
                    part.data.status === "running" &&
                    (part.data.awaitinginput || part.data.tuidetected)
            )
        ) {
            model.dispatch({ type: "SET_COMMAND_INTERACTION", interaction: null });
        }
    }, [messageAnalysis, model]);

    useEffect(() => {
        if (!messageAnalysis.latestAsk?.data) return;
        const askData = messageAnalysis.latestAsk.data as AskUserData;
        if (askData.status === "pending") {
            const currentAsk = globalStore.get(model.askUserAtom);
            if (currentAsk?.actionid !== askData.actionid) {
                model.dispatch({ type: "SET_ASK_USER", data: askData });
                model.dispatchAgentEvent({ type: "ASK_USER", reason: askData.prompt });
            }
        } else if (askData.status === "answered" || askData.status === "canceled") {
            model.dispatch({ type: "SET_ASK_USER", data: null });
        }
    }, [messageAnalysis, model]);

    useEffect(() => {
        const taskId = globalStore.get(model.chatId) || "waveai";
        const { latestToolUse, latestCompletedToolUse, runningToolUses, pendingApprovalToolUse, latestToolProgress } =
            messageAnalysis;
        if (latestToolUse) {
            const lastToolCall = toolCallFromPart(latestToolUse, taskId);
            const lastToolResult = toolResultFromPart(latestCompletedToolUse ?? latestToolUse, taskId) ?? undefined;
            const activeToolCalls = Object.fromEntries(
                runningToolUses.map((part) => [part.data.toolcallid, toolCallFromPart(part, taskId)])
            );
            const activeJobIds = runningToolUses
                .map((part) => part.data.jobid)
                .filter((jobId): jobId is string => Boolean(jobId));
            const progressBlockedReason =
                !shouldHideProgressStatusLines(latestToolProgress?.data?.toolname) &&
                latestToolProgress?.data?.statuslines?.find((line) => Boolean(line?.trim()));
            model.mergeAgentRuntimeSnapshot({
                lastToolCall,
                lastToolResult,
                blockedReason: latestToolUse.data.errormessage ?? latestToolUse.data.tooldesc ?? progressBlockedReason,
                activeToolCalls,
                activeJobIds,
                ...(activeJobIds.length > 0
                    ? {
                          state: "executing" as const,
                          phaseLabel: activeJobIds.length > 1 ? "Executing Commands" : "Executing Command",
                          activeTool: activeJobIds.length > 1 ? `${activeJobIds.length} commands` : latestToolUse.data.toolname,
                          activeJobId: activeJobIds.at(-1),
                      }
                    : {
                          activeTool: undefined,
                          activeJobId: undefined,
                      }),
            });
            if (pendingApprovalToolUse) {
                model.dispatchAgentEvent({
                    type: "APPROVAL_REQUIRED",
                    reason: pendingApprovalToolUse.data.tooldesc || "Waiting for tool approval",
                });
            }
            if (
                latestToolUse.data.errormessage &&
                (latestToolUse.data.errormessage.includes(t.message.commandBlockedBySecurity) ||
                    latestToolUse.data.errormessage.includes("command_blocked"))
            ) {
                model.dispatch({ type: "SET_SECURITY_BLOCKED", blocked: true });
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
    }, [messageAnalysis, model]);

    useEffect(() => {
        if (status === "streaming") {
            return;
        }
        if (errorMessage) {
            return;
        }
        if (commandInteraction) {
            return;
        }
        if (coalescedMessages.length > 0) {
            model.dispatchAgentEvent({ type: "VERIFY_FINISHED", ok: true });
        }
    }, [status, errorMessage, coalescedMessages.length, commandInteraction, model]);

    const derivedAgentStatusSnapshot = deriveAgentRuntimeStatus({
        provider: "Wave AI",
        mode: agentMode,
        chatStatus: status,
        messages: coalescedMessages,
        errorMessage,
    });

    useEffect(() => {
        if (commandInteraction || (agentRuntimeSnapshot.activeJobIds?.length ?? 0) > 0) {
            return;
        }
        if (
            isTerminalRuntimeState(agentRuntimeSnapshot.state) &&
            !isTerminalRuntimeState(derivedAgentStatusSnapshot.state)
        ) {
            return;
        }
        model.mergeAgentRuntimeSnapshot(derivedAgentStatusSnapshot);
    }, [
        agentRuntimeSnapshot.activeJobIds,
        agentRuntimeSnapshot.state,
        commandInteraction,
        derivedAgentStatusSnapshot,
        model,
    ]);

    return messageAnalysis;
}
