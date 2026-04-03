// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    AgentRuntimeEvent,
    AgentRuntimeSnapshot,
    AgentRuntimeSnapshotPatch,
    ToolCallEnvelope,
    ToolResultEnvelope,
    UseChatSendMessageType,
    UseChatSetMessagesType,
    WaveUIMessage,
    WaveUIMessagePart,
    agentRuntimeSnapshotEquals,
    getDefaultAgentRuntimeSnapshot,
    mergeAgentRuntimeSnapshot,
    reduceAgentRuntimeSnapshot,
} from "@/app/aipanel/aitypes";
import { FocusManager } from "@/app/store/focusManager";
import {
    atoms,
    createBlock,
    getAllBlockComponentModels,
    getBlockComponentModel,
    getFocusedBlockId,
    getOrefMetaKeyAtom,
    getSettingsKeyAtom,
    recordTEvent,
} from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { isBuilderWindow } from "@/app/store/windowtype";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { BuilderFocusManager } from "@/builder/store/builder-focusmanager";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { base64ToArrayBuffer } from "@/util/util";
import { ChatStatus } from "ai";
import * as jotai from "jotai";
import type React from "react";
import {
    createDataUrl,
    createImagePreview,
    formatFileSizeError,
    isAcceptableFile,
    normalizeMimeType,
    resizeImage,
    validateFileSizeFromInfo,
} from "./ai-utils";
import type { AIPanelInputRef } from "./aipanelinput";

export interface DroppedFile {
    id: string;
    file: File;
    name: string;
    type: string;
    size: number;
    previewUrl?: string;
}

export type AgentMode = "default" | "planning" | "auto-approve";

export class WaveAIModel {
    private static instance: WaveAIModel | null = null;
    inputRef: React.RefObject<AIPanelInputRef> | null = null;
    scrollToBottomCallback: (() => void) | null = null;
    useChatSendMessage: UseChatSendMessageType | null = null;
    useChatSetMessages: UseChatSetMessagesType | null = null;
    useChatStatus: ChatStatus = "ready";
    useChatStop: (() => void) | null = null;
    // Used for injecting Wave-specific message data into DefaultChatTransport's prepareSendMessagesRequest
    realMessage: AIMessage | null = null;
    lastSubmittedMessage: AIMessage | null = null;
    orefContext: ORef;
    inBuilder: boolean = false;
    isAIStreaming = jotai.atom(false);

    widgetAccessAtom!: jotai.Atom<boolean>;
    autoExecuteAtom!: jotai.Atom<boolean>;
    agentModeAtom!: jotai.Atom<AgentMode>;
    droppedFiles: jotai.PrimitiveAtom<DroppedFile[]> = jotai.atom([]);
    chatId!: jotai.PrimitiveAtom<string>;
    currentAIMode!: jotai.PrimitiveAtom<string>;
    aiModeConfigs!: jotai.Atom<Record<string, AIModeConfigType>>;
    hasPremiumAtom!: jotai.Atom<boolean>;
    defaultModeAtom!: jotai.Atom<string>;
    errorMessage: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    agentRuntimeAtom: jotai.PrimitiveAtom<AgentRuntimeSnapshot> = jotai.atom(getDefaultAgentRuntimeSnapshot());
    containerWidth: jotai.PrimitiveAtom<number> = jotai.atom(0);
    codeBlockMaxWidth!: jotai.Atom<number>;
    inputAtom: jotai.PrimitiveAtom<string> = jotai.atom("");
    isLoadingChatAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    isChatEmptyAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(true);
    isWaveAIFocusedAtom!: jotai.Atom<boolean>;
    panelVisibleAtom!: jotai.Atom<boolean>;
    restoreBackupModalToolCallId: jotai.PrimitiveAtom<string | null> = jotai.atom(null) as jotai.PrimitiveAtom<
        string | null
    >;
    restoreBackupStatus: jotai.PrimitiveAtom<"idle" | "processing" | "success" | "error"> = jotai.atom("idle");
    restoreBackupError: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;

    private constructor(orefContext: ORef, inBuilder: boolean) {
        this.orefContext = orefContext;
        this.inBuilder = inBuilder;
        this.chatId = jotai.atom(null) as jotai.PrimitiveAtom<string>;
        this.aiModeConfigs = atoms.waveaiModeConfigAtom;

        this.hasPremiumAtom = jotai.atom((get) => {
            const rateLimitInfo = get(atoms.waveAIRateLimitInfoAtom);
            return !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;
        });

        this.widgetAccessAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return true;
            }
            const widgetAccessMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:widgetcontext");
            const value = get(widgetAccessMetaAtom);
            // 默认为 true，如果用户没有明确设置过
            return value ?? true;
        });

        this.autoExecuteAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return true;
            }
            const autoExecuteMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:autoexecute");
            const value = get(autoExecuteMetaAtom);
            // 默认为 true，让 AI 可以直接执行命令
            return value ?? true;
        });

        this.agentModeAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return "default";
            }
            const modeMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:agentmode");
            const value = get(modeMetaAtom);
            if (value === "planning" || value === "auto-approve" || value === "default") {
                return value;
            }
            return "default";
        });

        this.codeBlockMaxWidth = jotai.atom((get) => {
            const width = get(this.containerWidth);
            return width > 0 ? width - 35 : 0;
        });

        this.isWaveAIFocusedAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return get(BuilderFocusManager.getInstance().focusType) === "waveai";
            }
            return get(FocusManager.getInstance().focusType) === "waveai";
        });

        this.panelVisibleAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return true;
            }
            return get(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
        });

        this.defaultModeAtom = jotai.atom((get) => {
            const telemetryEnabled = get(getSettingsKeyAtom("telemetry:enabled")) ?? false;
            if (this.inBuilder) {
                return telemetryEnabled ? "waveai@balanced" : "invalid";
            }
            const aiModeConfigs = get(this.aiModeConfigs);
            if (!telemetryEnabled) {
                let mode = get(getSettingsKeyAtom("waveai:defaultmode"));
                if (mode == null || mode.startsWith("waveai@")) {
                    return "unknown";
                }
                return mode;
            }
            const hasPremium = get(this.hasPremiumAtom);
            const waveFallback = hasPremium ? "waveai@balanced" : "waveai@quick";
            let mode = get(getSettingsKeyAtom("waveai:defaultmode")) ?? waveFallback;
            if (!hasPremium && mode.startsWith("waveai@")) {
                mode = "waveai@quick";
            }
            const modeExists = aiModeConfigs != null && mode in aiModeConfigs;
            if (!modeExists) {
                mode = waveFallback;
            }
            return mode;
        });

        const defaultMode = globalStore.get(this.defaultModeAtom);
        this.currentAIMode = jotai.atom(defaultMode);
    }

    getPanelVisibleAtom(): jotai.Atom<boolean> {
        return this.panelVisibleAtom;
    }

    static getInstance(): WaveAIModel {
        if (!WaveAIModel.instance) {
            let orefContext: ORef;
            if (isBuilderWindow()) {
                const builderId = globalStore.get(atoms.builderId);
                orefContext = WOS.makeORef("builder", builderId);
            } else {
                const tabId = globalStore.get(atoms.staticTabId);
                orefContext = WOS.makeORef("tab", tabId);
            }
            WaveAIModel.instance = new WaveAIModel(orefContext, isBuilderWindow());
            (window as any).WaveAIModel = WaveAIModel.instance;
        }
        return WaveAIModel.instance;
    }

    static resetInstance(): void {
        WaveAIModel.instance = null;
    }

    getUseChatEndpointUrl(): string {
        return `${getWebServerEndpoint()}/api/post-chat-message`;
    }

    async addFile(file: File): Promise<DroppedFile> {
        // Resize images before storing
        const processedFile = await resizeImage(file);

        const droppedFile: DroppedFile = {
            id: crypto.randomUUID(),
            file: processedFile,
            name: processedFile.name,
            type: processedFile.type,
            size: processedFile.size,
        };

        // Create 128x128 preview data URL for images
        if (processedFile.type.startsWith("image/")) {
            const previewDataUrl = await createImagePreview(processedFile);
            if (previewDataUrl) {
                droppedFile.previewUrl = previewDataUrl;
            }
        }

        const currentFiles = globalStore.get(this.droppedFiles);
        globalStore.set(this.droppedFiles, [...currentFiles, droppedFile]);

        return droppedFile;
    }

    async addFileFromRemoteUri(draggedFile: DraggedFile): Promise<void> {
        if (draggedFile.isDir) {
            this.setError("Cannot add directories to Wave AI. Please select a file.");
            return;
        }

        try {
            const fileInfo = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: draggedFile.uri } }, null);
            if (fileInfo.notfound) {
                this.setError(`File not found: ${draggedFile.relName}`);
                return;
            }
            if (fileInfo.isdir) {
                this.setError("Cannot add directories to Wave AI. Please select a file.");
                return;
            }

            const mimeType = fileInfo.mimetype || "application/octet-stream";
            const fileSize = fileInfo.size || 0;
            const sizeError = validateFileSizeFromInfo(draggedFile.relName, fileSize, mimeType);
            if (sizeError) {
                this.setError(formatFileSizeError(sizeError));
                return;
            }

            const fileData = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: draggedFile.uri } }, null);
            if (!fileData.data64) {
                this.setError(`Failed to read file: ${draggedFile.relName}`);
                return;
            }

            const buffer = base64ToArrayBuffer(fileData.data64);
            const file = new File([buffer], draggedFile.relName, { type: mimeType });
            if (!isAcceptableFile(file)) {
                this.setError(
                    `File type not supported: ${draggedFile.relName}. Supported: images, PDFs, and text/code files.`
                );
                return;
            }

            await this.addFile(file);
        } catch (error) {
            console.error("Error handling FILE_ITEM drop:", error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.setError(`Failed to add file: ${errorMsg}`);
        }
    }

    removeFile(fileId: string) {
        const currentFiles = globalStore.get(this.droppedFiles);
        const updatedFiles = currentFiles.filter((f) => f.id !== fileId);
        globalStore.set(this.droppedFiles, updatedFiles);
    }

    clearFiles() {
        const currentFiles = globalStore.get(this.droppedFiles);

        // Cleanup all preview URLs
        currentFiles.forEach((file) => {
            if (file.previewUrl) {
                URL.revokeObjectURL(file.previewUrl);
            }
        });

        globalStore.set(this.droppedFiles, []);
    }

    clearChat() {
        void this.cancelGeneration();
        this.clearFiles();
        this.clearError();
        globalStore.set(this.isChatEmptyAtom, true);
        globalStore.set(this.agentRuntimeAtom, getDefaultAgentRuntimeSnapshot());
        const newChatId = crypto.randomUUID();
        globalStore.set(this.chatId, newChatId);

        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "waveai:chatid": newChatId },
        });

        this.useChatSetMessages?.([]);
    }

    setError(message: string) {
        globalStore.set(this.errorMessage, message);
    }

    clearError() {
        globalStore.set(this.errorMessage, null);
    }

    setAgentRuntimeSnapshot(snapshot: AgentRuntimeSnapshot) {
        const current = globalStore.get(this.agentRuntimeAtom);
        if (agentRuntimeSnapshotEquals(current, snapshot)) {
            return;
        }
        globalStore.set(this.agentRuntimeAtom, snapshot);
    }

    mergeAgentRuntimeSnapshot(patch: AgentRuntimeSnapshotPatch) {
        const current = globalStore.get(this.agentRuntimeAtom);
        const next = mergeAgentRuntimeSnapshot(current, patch);
        if (agentRuntimeSnapshotEquals(current, next)) {
            return;
        }
        globalStore.set(this.agentRuntimeAtom, next);
    }

    dispatchAgentEvent(event: AgentRuntimeEvent) {
        const current = globalStore.get(this.agentRuntimeAtom);
        const next = reduceAgentRuntimeSnapshot(current, event);
        if (agentRuntimeSnapshotEquals(current, next)) {
            return;
        }
        globalStore.set(this.agentRuntimeAtom, next);
    }

    registerInputRef(ref: React.RefObject<AIPanelInputRef>) {
        this.inputRef = ref;
    }

    registerScrollToBottom(callback: () => void) {
        this.scrollToBottomCallback = callback;
    }

    registerUseChatData(
        sendMessage: UseChatSendMessageType,
        setMessages: UseChatSetMessagesType,
        status: ChatStatus,
        stop: () => void
    ) {
        this.useChatSendMessage = sendMessage;
        this.useChatSetMessages = setMessages;
        this.useChatStatus = status;
        this.useChatStop = stop;
    }

    scrollToBottom() {
        this.scrollToBottomCallback?.();
    }

    focusInput() {
        if (!this.inBuilder && !WorkspaceLayoutModel.getInstance().getAIPanelVisible()) {
            WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
        }
        if (this.inputRef?.current) {
            this.inputRef.current.focus();
        }
    }

    async reloadChatFromBackend(chatIdValue: string): Promise<WaveUIMessage[]> {
        const chatData = await RpcApi.GetWaveAIChatCommand(TabRpcClient, { chatid: chatIdValue });
        const messages: UIMessage[] = chatData?.messages ?? [];
        globalStore.set(this.isChatEmptyAtom, messages.length === 0);
        return messages as WaveUIMessage[];
    }

    async cancelGeneration() {
        this.dispatchAgentEvent({ type: "CANCEL_GENERATION" });
        this.useChatStop?.();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const chatIdValue = globalStore.get(this.chatId);
        if (!chatIdValue) {
            return;
        }
        try {
            const messages = await this.reloadChatFromBackend(chatIdValue);
            this.useChatSetMessages?.(messages);
        } catch (error) {
            console.error("Failed to reload chat after stop:", error);
        }
    }

    async cancelExecution() {
        const runtime = globalStore.get(this.agentRuntimeAtom);
        const activeJobId = runtime.activeJobId || runtime.lastToolResult?.jobId;
        if (activeJobId) {
            try {
                await RpcApi.JobControllerExitJobCommand(TabRpcClient, activeJobId);
            } catch (error) {
                console.error("Failed to stop execution job:", error);
            }
        }
        this.dispatchAgentEvent({ type: "CANCEL_EXECUTION" });
        await this.cancelGeneration();
    }

    async stopResponse() {
        await this.cancelGeneration();
    }

    getAndClearMessage(): AIMessage | null {
        const msg = this.realMessage;
        this.realMessage = null;
        return msg;
    }

    private buildRetryMeta(retryCount: number, lastErrorCode?: string) {
        return {
            retryCount,
            maxRetries: 2,
            nextBackoffMs: Math.min(1000 * 2 ** retryCount, 4000),
            lastErrorCode,
        };
    }

    private buildRetryParts(message: AIMessage): WaveUIMessagePart[] {
        return (message.parts ?? [])
            .map((part) => {
                if (part.type === "text") {
                    return { type: "text", text: part.text } as WaveUIMessagePart;
                }
                if (part.type === "file") {
                    return {
                        type: "data-userfile",
                        data: {
                            filename: part.filename,
                            mimetype: part.mimetype,
                            size: part.size,
                            previewurl: part.previewurl,
                        },
                    } as WaveUIMessagePart;
                }
                return null;
            })
            .filter(Boolean) as WaveUIMessagePart[];
    }

    hasNonEmptyInput(): boolean {
        const input = globalStore.get(this.inputAtom);
        return input != null && input.trim().length > 0;
    }

    appendText(text: string, newLine?: boolean, opts?: { scrollToBottom?: boolean }) {
        const currentInput = globalStore.get(this.inputAtom);
        let newInput = currentInput;

        if (newInput.length > 0) {
            if (newLine) {
                if (!newInput.endsWith("\n")) {
                    newInput += "\n";
                }
            } else if (!newInput.endsWith(" ") && !newInput.endsWith("\n")) {
                newInput += " ";
            }
        }

        newInput += text;
        globalStore.set(this.inputAtom, newInput);

        if (opts?.scrollToBottom && this.inputRef?.current) {
            setTimeout(() => this.inputRef.current.scrollToBottom(), 10);
        }
    }

    setModel(model: string) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:model": model },
        });
    }

    setWidgetAccess(enabled: boolean) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:widgetcontext": enabled },
        });
    }

    setAutoExecute(enabled: boolean) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:autoexecute": enabled },
        });
    }

    setAgentMode(mode: AgentMode) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:agentmode": mode },
        });
        this.clearChat();
    }

    private getTargetTerminalModel(): {
        blockId: string;
        sendDataToController: (data: string) => void;
    } | null {
        const focusedBlockId = getFocusedBlockId();
        if (focusedBlockId) {
            const bcm = getBlockComponentModel(focusedBlockId);
            const viewModel = bcm?.viewModel as any;
            if (viewModel?.viewType === "term" && typeof viewModel.sendDataToController === "function") {
                return {
                    blockId: focusedBlockId,
                    sendDataToController: viewModel.sendDataToController.bind(viewModel),
                };
            }
        }

        for (const bcm of getAllBlockComponentModels()) {
            const viewModel = bcm?.viewModel as any;
            if (viewModel?.viewType === "term" && typeof viewModel.sendDataToController === "function") {
                return {
                    blockId: viewModel.blockId,
                    sendDataToController: viewModel.sendDataToController.bind(viewModel),
                };
            }
        }

        return null;
    }

    private getTerminalExecutionContext(blockId: string): { connName: string; cwd?: string } {
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        const blockData = globalStore.get(blockAtom);
        const connName = (blockData?.meta?.connection as string) || "local";
        const cwd = blockData?.meta?.["cmd:cwd"] as string | undefined;
        return { connName, cwd };
    }

    executeCommandInTerminal(command: string, opts?: { source?: "manual" | "auto" }): boolean {
        const normalized = (command ?? "").replace(/\r/g, "").trim();
        if (normalized === "") {
            return false;
        }

        const target = this.getTargetTerminalModel();
        if (target == null) {
            this.setError("No active terminal available. Focus a terminal and try again.");
            return false;
        }

        const tool: ToolCallEnvelope = {
            requestId: crypto.randomUUID(),
            taskId: this.getChatId() || crypto.randomUUID(),
            toolName: "bash",
            capability: "bash",
            args: { command: normalized, blockId: target.blockId },
            hostScope: { type: "local", hostId: "active-terminal" },
            requiresApproval: false,
            safetyClass: "readonly",
        };
        void this.invokeTool(tool);
        this.clearError();
        recordTEvent("action:waveai:executecommand", {
            "action:source": opts?.source ?? "manual",
            "action:blockid": target.blockId,
        });
        return true;
    }

    async invokeTool(tool: ToolCallEnvelope): Promise<ToolResultEnvelope> {
        const startedAt = Date.now();
        this.dispatchAgentEvent({ type: "TOOL_CALL_STARTED", tool });
        recordTEvent("waveai:perf:tool:start", {
            "waveai:tool": tool.toolName,
            "waveai:requestid": tool.requestId,
            "waveai:taskid": tool.taskId,
            "waveai:capability": tool.capability,
        } as any);
        try {
            if (tool.toolName !== "bash") {
                const unsupportedResult: ToolResultEnvelope = {
                    requestId: tool.requestId,
                    taskId: tool.taskId,
                    toolName: tool.toolName,
                    ok: false,
                    exitCode: 1,
                    stderr: `Unsupported tool invocation: ${tool.toolName}`,
                    durationMs: Date.now() - startedAt,
                    errorCode: "UNSUPPORTED_TOOL",
                };
                this.dispatchAgentEvent({
                    type: "TOOL_CALL_FAILED",
                    result: unsupportedResult,
                    retryable: false,
                });
                recordTEvent("waveai:perf:tool:done", {
                    "waveai:tool": tool.toolName,
                    "waveai:requestid": tool.requestId,
                    "waveai:taskid": tool.taskId,
                    "waveai:ok": false,
                    "waveai:durationms": unsupportedResult.durationMs,
                    "waveai:error": unsupportedResult.errorCode,
                } as any);
                return unsupportedResult;
            }

            const command = typeof tool.args.command === "string" ? tool.args.command : "";
            const blockId = typeof tool.args.blockId === "string" ? tool.args.blockId : undefined;
            if (!blockId) {
                const failedResult: ToolResultEnvelope = {
                    requestId: tool.requestId,
                    taskId: tool.taskId,
                    toolName: tool.toolName,
                    ok: false,
                    exitCode: 1,
                    stderr: "No active terminal available. Focus a terminal and try again.",
                    durationMs: Date.now() - startedAt,
                    errorCode: "NO_ACTIVE_TERMINAL",
                };
                this.dispatchAgentEvent({ type: "TOOL_CALL_FAILED", result: failedResult, retryable: true });
                recordTEvent("waveai:perf:tool:done", {
                    "waveai:tool": tool.toolName,
                    "waveai:requestid": tool.requestId,
                    "waveai:taskid": tool.taskId,
                    "waveai:ok": false,
                    "waveai:durationms": failedResult.durationMs,
                    "waveai:error": failedResult.errorCode,
                } as any);
                return failedResult;
            }
            const { connName, cwd } = this.getTerminalExecutionContext(blockId);
            await RpcApi.ConnEnsureCommand(
                TabRpcClient,
                {
                    connname: connName,
                    logblockid: blockId,
                },
                { timeout: 60000 }
            );
            const runResult = await RpcApi.AgentRunCommandCommand(
                TabRpcClient,
                {
                    connname: connName,
                    cwd,
                    cmd: command,
                },
                { timeout: 15000 }
            );
            const jobId = runResult.jobid;
            this.dispatchAgentEvent({
                type: "TOOL_CALL_STARTED",
                tool: {
                    ...tool,
                    jobId,
                    hostScope: { type: connName === "local" ? "local" : "remote", hostId: connName },
                },
            });

            let commandResult: CommandAgentGetCommandResultRtnData | null = null;
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                commandResult = await RpcApi.AgentGetCommandResultCommand(
                    TabRpcClient,
                    {
                        jobid: jobId,
                        tailbytes: 32768,
                    },
                    { timeout: 10000 }
                );
                if (commandResult.status !== "running") {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            if (!commandResult) {
                commandResult = {
                    jobid: jobId,
                    status: "error",
                    error: "No command result received",
                };
            }
            if (commandResult.status === "running") {
                commandResult = {
                    ...commandResult,
                    status: "error",
                    error: "Timed out waiting for command completion",
                };
            }
            const exitCode = typeof commandResult.exitcode === "number" ? commandResult.exitcode : 1;
            const ok = commandResult.status === "done" && exitCode === 0 && !commandResult.error;

            const result: ToolResultEnvelope = {
                requestId: tool.requestId,
                taskId: tool.taskId,
                toolName: tool.toolName,
                jobId,
                ok,
                exitCode,
                stdout: commandResult.output,
                stderr: commandResult.error,
                durationMs: Date.now() - startedAt,
            };
            if (ok) {
                this.dispatchAgentEvent({ type: "TOOL_CALL_FINISHED", result });
            } else {
                this.dispatchAgentEvent({ type: "TOOL_CALL_FAILED", result, retryable: true });
            }
            recordTEvent("waveai:perf:tool:done", {
                "waveai:tool": tool.toolName,
                "waveai:requestid": tool.requestId,
                "waveai:taskid": tool.taskId,
                "waveai:ok": ok,
                "waveai:durationms": result.durationMs,
                "waveai:exitcode": result.exitCode,
            } as any);
            return result;
        } catch (error) {
            const failedResult: ToolResultEnvelope = {
                requestId: tool.requestId,
                taskId: tool.taskId,
                toolName: tool.toolName,
                ok: false,
                exitCode: 1,
                stderr: error instanceof Error ? error.message : String(error),
                durationMs: Date.now() - startedAt,
                errorCode: "TOOL_INVOCATION_FAILED",
            };
            this.dispatchAgentEvent({ type: "TOOL_CALL_FAILED", result: failedResult, retryable: true });
            recordTEvent("waveai:perf:tool:done", {
                "waveai:tool": tool.toolName,
                "waveai:requestid": tool.requestId,
                "waveai:taskid": tool.taskId,
                "waveai:ok": false,
                "waveai:durationms": failedResult.durationMs,
                "waveai:error": failedResult.errorCode,
            } as any);
            return failedResult;
        }
    }

    async retryLastAction(scope: "step" | "round" = "step"): Promise<boolean> {
        const runtime = globalStore.get(this.agentRuntimeAtom);
        const currentRetry = runtime.retry?.retryCount ?? 0;
        const nextRetryCount = currentRetry + 1;
        const retry = this.buildRetryMeta(nextRetryCount, runtime.lastToolResult?.errorCode);

        this.dispatchAgentEvent({
            type: "RETRY_REQUESTED",
            retry,
            reason: scope === "round" ? "Retrying the full round" : "Retrying the last step",
        });
        recordTEvent("waveai:perf:retry", {
            "waveai:scope": scope,
            "waveai:retrycount": retry.retryCount,
            "waveai:maxretries": retry.maxRetries,
            "waveai:lasterror": retry.lastErrorCode ?? "",
        } as any);

        if (scope === "round" && this.lastSubmittedMessage && this.useChatSendMessage) {
            this.realMessage = this.lastSubmittedMessage;
            await this.useChatSendMessage({ parts: this.buildRetryParts(this.lastSubmittedMessage) });
            return true;
        }

        if (runtime.lastToolCall) {
            await this.invokeTool({
                ...runtime.lastToolCall,
                jobId: undefined,
                retry,
            });
            return true;
        }

        if (runtime.lastCommand) {
            return this.executeCommandInTerminal(runtime.lastCommand, { source: "manual" });
        }

        return false;
    }

    isValidMode(mode: string): boolean {
        const telemetryEnabled = globalStore.get(getSettingsKeyAtom("telemetry:enabled")) ?? false;
        if (mode.startsWith("waveai@") && !telemetryEnabled) {
            return false;
        }

        const aiModeConfigs = globalStore.get(this.aiModeConfigs);
        if (aiModeConfigs == null || !(mode in aiModeConfigs)) {
            return false;
        }

        return true;
    }

    setAIMode(mode: string) {
        if (!this.isValidMode(mode)) {
            this.setAIModeToDefault();
        } else {
            globalStore.set(this.currentAIMode, mode);
            RpcApi.SetRTInfoCommand(TabRpcClient, {
                oref: this.orefContext,
                data: { "waveai:mode": mode },
            });
        }
    }

    setAIModeToDefault() {
        const defaultMode = globalStore.get(this.defaultModeAtom);
        globalStore.set(this.currentAIMode, defaultMode);
        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "waveai:mode": null },
        });
    }

    async fixModeAfterConfigChange(): Promise<void> {
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
        });
        const mode = rtInfo?.["waveai:mode"];
        if (mode == null || !this.isValidMode(mode)) {
            this.setAIModeToDefault();
        }
    }

    async getRTInfo(): Promise<Record<string, any>> {
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
        });
        return rtInfo ?? {};
    }

    async loadInitialChat(): Promise<WaveUIMessage[]> {
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
        });
        let chatIdValue = rtInfo?.["waveai:chatid"];
        if (chatIdValue == null) {
            chatIdValue = crypto.randomUUID();
            RpcApi.SetRTInfoCommand(TabRpcClient, {
                oref: this.orefContext,
                data: { "waveai:chatid": chatIdValue },
            });
        }
        globalStore.set(this.chatId, chatIdValue);

        const aiModeValue = rtInfo?.["waveai:mode"];
        if (aiModeValue == null) {
            const defaultMode = globalStore.get(this.defaultModeAtom);
            globalStore.set(this.currentAIMode, defaultMode);
        } else if (this.isValidMode(aiModeValue)) {
            globalStore.set(this.currentAIMode, aiModeValue);
        } else {
            this.setAIModeToDefault();
        }

        try {
            return await this.reloadChatFromBackend(chatIdValue);
        } catch (error) {
            console.error("Failed to load chat:", error);
            this.setError("Failed to load chat. Starting new chat...");

            this.clearChat();
            return [];
        }
    }

    async handleSubmit() {
        const input = globalStore.get(this.inputAtom);
        const droppedFiles = globalStore.get(this.droppedFiles);

        if (input.trim() === "/clear" || input.trim() === "/new") {
            this.clearChat();
            globalStore.set(this.inputAtom, "");
            return;
        }

        if (
            (!input.trim() && droppedFiles.length === 0) ||
            (this.useChatStatus !== "ready" && this.useChatStatus !== "error") ||
            globalStore.get(this.isLoadingChatAtom)
        ) {
            return;
        }

        this.clearError();
        this.dispatchAgentEvent({ type: "USER_SUBMIT" });

        const aiMessageParts: AIMessagePart[] = [];
        const uiMessageParts: WaveUIMessagePart[] = [];

        if (input.trim()) {
            aiMessageParts.push({ type: "text", text: input.trim() });
            uiMessageParts.push({ type: "text", text: input.trim() });
        }

        for (const droppedFile of droppedFiles) {
            const normalizedMimeType = normalizeMimeType(droppedFile.file);
            const dataUrl = await createDataUrl(droppedFile.file);

            aiMessageParts.push({
                type: "file",
                filename: droppedFile.name,
                mimetype: normalizedMimeType,
                url: dataUrl,
                size: droppedFile.file.size,
                previewurl: droppedFile.previewUrl,
            });

            uiMessageParts.push({
                type: "data-userfile",
                data: {
                    filename: droppedFile.name,
                    mimetype: normalizedMimeType,
                    size: droppedFile.file.size,
                    previewurl: droppedFile.previewUrl,
                },
            });
        }

        const realMessage: AIMessage = {
            messageid: crypto.randomUUID(),
            parts: aiMessageParts,
        };
        this.realMessage = realMessage;
        this.lastSubmittedMessage = realMessage;

        // console.log("SUBMIT MESSAGE", realMessage);

        this.useChatSendMessage?.({ parts: uiMessageParts });

        globalStore.set(this.isChatEmptyAtom, false);
        globalStore.set(this.inputAtom, "");
        this.clearFiles();
    }

    async uiLoadInitialChat() {
        globalStore.set(this.isLoadingChatAtom, true);
        const messages = await this.loadInitialChat();
        this.useChatSetMessages?.(messages);
        globalStore.set(this.isLoadingChatAtom, false);
        setTimeout(() => {
            this.scrollToBottom();
        }, 100);
    }

    async ensureRateLimitSet() {
        const currentInfo = globalStore.get(atoms.waveAIRateLimitInfoAtom);
        if (currentInfo != null) {
            return;
        }
        try {
            const rateLimitInfo = await RpcApi.GetWaveAIRateLimitCommand(TabRpcClient);
            if (rateLimitInfo != null) {
                globalStore.set(atoms.waveAIRateLimitInfoAtom, rateLimitInfo);
            }
        } catch (error) {
            console.error("Failed to fetch rate limit info:", error);
        }
    }

    handleAIFeedback(feedback: "good" | "bad") {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "waveai:feedback",
                props: {
                    "waveai:feedback": feedback,
                },
            },
            { noresponse: true }
        );
    }

    requestWaveAIFocus() {
        if (this.inBuilder) {
            BuilderFocusManager.getInstance().setWaveAIFocused();
        } else {
            FocusManager.getInstance().requestWaveAIFocus();
        }
    }

    requestNodeFocus() {
        if (this.inBuilder) {
            BuilderFocusManager.getInstance().setAppFocused();
        } else {
            FocusManager.getInstance().requestNodeFocus();
        }
    }

    getChatId(): string {
        return globalStore.get(this.chatId);
    }

    toolUseSendApproval(toolcallid: string, approval: string) {
        if (approval === "user-approved") {
            this.dispatchAgentEvent({ type: "APPROVAL_RESOLVED", approved: true });
        } else if (approval === "user-denied") {
            this.dispatchAgentEvent({
                type: "APPROVAL_RESOLVED",
                approved: false,
                reason: "User denied tool approval",
            });
        }
        RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
            toolcallid: toolcallid,
            approval: approval,
        });
    }

    async openDiff(fileName: string, toolcallid: string) {
        const chatId = this.getChatId();

        if (!chatId || !fileName) {
            console.error("Missing chatId or fileName for opening diff", chatId, fileName);
            return;
        }

        const blockDef: BlockDef = {
            meta: {
                view: "aifilediff",
                file: fileName,
                "aifilediff:chatid": chatId,
                "aifilediff:toolcallid": toolcallid,
            },
        };
        await createBlock(blockDef, false, true);
    }

    async openWaveAIConfig() {
        const blockDef: BlockDef = {
            meta: {
                view: "waveconfig",
                file: "waveai.json",
            },
        };
        await createBlock(blockDef, false, true);
    }

    openRestoreBackupModal(toolcallid: string) {
        globalStore.set(this.restoreBackupModalToolCallId, toolcallid);
    }

    closeRestoreBackupModal() {
        globalStore.set(this.restoreBackupModalToolCallId, null);
        globalStore.set(this.restoreBackupStatus, "idle");
        globalStore.set(this.restoreBackupError, null);
    }

    async restoreBackup(toolcallid: string, backupFilePath: string, restoreToFileName: string) {
        globalStore.set(this.restoreBackupStatus, "processing");
        globalStore.set(this.restoreBackupError, null);
        try {
            await RpcApi.FileRestoreBackupCommand(TabRpcClient, {
                backupfilepath: backupFilePath,
                restoretofilename: restoreToFileName,
            });
            console.log("Backup restored successfully:", { toolcallid, backupFilePath, restoreToFileName });
            globalStore.set(this.restoreBackupStatus, "success");
        } catch (error) {
            console.error("Failed to restore backup:", error);
            const errorMsg = error?.message || String(error);
            globalStore.set(this.restoreBackupError, errorMsg);
            globalStore.set(this.restoreBackupStatus, "error");
        }
    }

    canCloseWaveAIPanel(): boolean {
        if (this.inBuilder) {
            return false;
        }
        return true;
    }

    closeWaveAIPanel() {
        if (this.inBuilder) {
            return;
        }
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(false);
    }
}
