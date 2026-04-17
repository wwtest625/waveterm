// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    AgentFocusChainState,
    AgentRuntimeEvent,
    AgentRuntimeSnapshot,
    AgentRuntimeSnapshotPatch,
    AgentTaskState,
    AskUserData,
    CommandInteractionState,
    ToolCallEnvelope,
    ToolResultEnvelope,
    UseChatSendMessageType,
    UseChatSetMessagesType,
    WaveChatSessionMeta,
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
    sessionsAtom: jotai.PrimitiveAtom<WaveChatSessionMeta[]> = jotai.atom([]);
    hiddenSessionIdsAtom: jotai.PrimitiveAtom<string[]> = jotai.atom([]);
    commandInteractionAtom: jotai.PrimitiveAtom<CommandInteractionState | null> = jotai.atom(
        null
    ) as jotai.PrimitiveAtom<CommandInteractionState | null>;
    currentAIMode!: jotai.PrimitiveAtom<string>;
    aiModeConfigs!: jotai.Atom<Record<string, AIModeConfigType>>;
    hasPremiumAtom!: jotai.Atom<boolean>;
    defaultModeAtom!: jotai.Atom<string>;
    errorMessage: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    agentRuntimeAtom: jotai.PrimitiveAtom<AgentRuntimeSnapshot> = jotai.atom(getDefaultAgentRuntimeSnapshot());
    taskStateAtom: jotai.PrimitiveAtom<AgentTaskState | null> = jotai.atom(null) as jotai.PrimitiveAtom<AgentTaskState | null>;
    focusChainAtom: jotai.PrimitiveAtom<AgentFocusChainState | null> = jotai.atom(null) as jotai.PrimitiveAtom<AgentFocusChainState | null>;
    contextUsageAtom: jotai.PrimitiveAtom<number> = jotai.atom(0);
    securityBlockedAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    askUserAtom: jotai.PrimitiveAtom<AskUserData | null> = jotai.atom(null) as jotai.PrimitiveAtom<AskUserData | null>;
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
    private lastExecutingRuntimeUpdateAt = 0;
    private readonly executingRuntimeThrottleMs = 250;

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
            const widgetAccessMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:widgetcontext" as keyof MetaType);
            const value = get(widgetAccessMetaAtom) as boolean | undefined;
            // 默认为 true，如果用户没有明确设置过
            return value ?? true;
        });

        this.autoExecuteAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return true;
            }
            const autoExecuteMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:autoexecute" as keyof MetaType);
            const value = get(autoExecuteMetaAtom) as boolean | undefined;
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
            // When skip-approval is enabled in settings, default to auto-approve
            const skipApproval = get(getSettingsKeyAtom("waveai:skipapproval"));
            if (skipApproval === true) {
                return "auto-approve";
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
                const mode = get(getSettingsKeyAtom("waveai:defaultmode"));
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

    private getSessionTabId(): string {
        if (this.inBuilder) {
            return "";
        }
        return globalStore.get(atoms.staticTabId);
    }

    private sortSessions(sessions: WaveChatSessionMeta[]): WaveChatSessionMeta[] {
        return [...sessions].sort((left, right) => {
            if (Boolean(left.favorite) !== Boolean(right.favorite)) {
                return left.favorite ? -1 : 1;
            }
            const leftUpdated = left.updatedts ?? 0;
            const rightUpdated = right.updatedts ?? 0;
            if (leftUpdated !== rightUpdated) {
                return rightUpdated - leftUpdated;
            }
            const leftCreated = left.createdts ?? 0;
            const rightCreated = right.createdts ?? 0;
            if (leftCreated !== rightCreated) {
                return rightCreated - leftCreated;
            }
            return (left.title ?? "").localeCompare(right.title ?? "");
        });
    }

    private summarizeSessionText(text: string, limit: number): string {
        const normalized = text.trim().replace(/\s+/g, " ");
        if (normalized.length <= limit) {
            return normalized;
        }
        return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
    }

    private isReusableNewChatSession(session: WaveChatSessionMeta | null | undefined): boolean {
        if (!session) {
            return false;
        }
        return (session.title ?? "") === "New Chat" && !(session.summary ?? "").trim();
    }

    private findReusableNewChatSession(): WaveChatSessionMeta | null {
        const tabId = this.getSessionTabId();
        const currentChatId = globalStore.get(this.chatId);
        const sessions = globalStore.get(this.sessionsAtom);
        const candidates = sessions.filter(
            (session) =>
                session.tabid === tabId &&
                this.isReusableNewChatSession(session) &&
                session.chatid !== currentChatId
        );
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((left, right) => {
            const leftUpdated = left.updatedts ?? 0;
            const rightUpdated = right.updatedts ?? 0;
            if (leftUpdated !== rightUpdated) {
                return rightUpdated - leftUpdated;
            }
            const leftCreated = left.createdts ?? 0;
            const rightCreated = right.createdts ?? 0;
            if (leftCreated !== rightCreated) {
                return rightCreated - leftCreated;
            }
            return (right.chatid ?? "").localeCompare(left.chatid ?? "");
        });
        return candidates[0];
    }

    private upsertLocalSession(session: WaveChatSessionMeta | null | undefined): void {
        if (!session?.chatid) {
            return;
        }
        const current = globalStore.get(this.sessionsAtom);
        const next = current.filter((item) => item.chatid !== session.chatid);
        next.push(session);
        globalStore.set(this.sessionsAtom, this.sortSessions(next));
    }

    private removeLocalSession(chatId: string): void {
        const current = globalStore.get(this.sessionsAtom);
        globalStore.set(
            this.sessionsAtom,
            current.filter((item) => item.chatid !== chatId)
        );
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

    async loadSessions(opts?: { includeArchived?: boolean; includeDeleted?: boolean }): Promise<WaveChatSessionMeta[]> {
        if (this.inBuilder) {
            globalStore.set(this.sessionsAtom, []);
            return [];
        }
        const sessions = await RpcApi.ListWaveAISessionsCommand(
            TabRpcClient,
            {
                tabid: this.getSessionTabId(),
                includearchived: opts?.includeArchived,
                includedeleted: opts?.includeDeleted,
            },
            null
        );
        const normalized = this.sortSessions(sessions ?? []);
        globalStore.set(this.sessionsAtom, normalized);
        return normalized;
    }

    private async persistSessionUpdate(data: CommandUpdateWaveAISessionData): Promise<WaveChatSessionMeta | null> {
        const session = await RpcApi.UpdateWaveAISessionCommand(TabRpcClient, data, null);
        if (session) {
            if (session.deleted) {
                this.removeLocalSession(session.chatid);
            } else {
                this.upsertLocalSession(session);
            }
        }
        return session ?? null;
    }

    async switchSession(chatId: string): Promise<void> {
        if (!chatId) {
            return;
        }
        globalStore.set(this.chatId, chatId);
        globalStore.set(this.commandInteractionAtom, null);
        await RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "waveai:chatid": chatId },
        });
        const messages = await this.reloadChatFromBackend(chatId);
        this.useChatSetMessages?.(messages);
        this.scrollToBottom();
    }

    async renameSession(chatId: string, title: string): Promise<void> {
        const trimmed = title.trim();
        if (!chatId || !trimmed) {
            return;
        }
        await this.persistSessionUpdate({
            chatid: chatId,
            tabid: this.getSessionTabId(),
            title: trimmed,
        });
    }

    async updateSessionCheatsheet(
        chatId: string,
        cheatsheet: {
            currentwork?: string;
            completed?: string;
            blockedby?: string;
            nextstep?: string;
        }
    ): Promise<void> {
        if (!chatId) {
            return;
        }
        await this.persistSessionUpdate({
            chatid: chatId,
            tabid: this.getSessionTabId(),
            cheatsheet: {
                currentwork: cheatsheet.currentwork?.trim() || undefined,
                completed: cheatsheet.completed?.trim() || undefined,
                blockedby: cheatsheet.blockedby?.trim() || undefined,
                nextstep: cheatsheet.nextstep?.trim() || undefined,
            },
        });
    }

    async toggleSessionFavorite(chatId: string): Promise<void> {
        const session = globalStore.get(this.sessionsAtom).find((item) => item.chatid === chatId);
        await this.persistSessionUpdate({
            chatid: chatId,
            favorite: !session?.favorite,
        });
    }

    async archiveSession(chatId: string): Promise<void> {
        await this.persistSessionUpdate({
            chatid: chatId,
            archived: true,
        });
        if (globalStore.get(this.chatId) === chatId) {
            this.clearChat();
        }
    }

    async deleteSession(chatId: string): Promise<void> {
        if (!chatId) {
            return;
        }
        try {
            const deletingActiveSession = globalStore.get(this.chatId) === chatId;
            await RpcApi.DeleteWaveAISessionCommand(
                TabRpcClient,
                {
                    chatid: chatId,
                },
                null
            );
            const hiddenSessionIds = globalStore.get(this.hiddenSessionIdsAtom);
            if (hiddenSessionIds.includes(chatId)) {
                globalStore.set(
                    this.hiddenSessionIdsAtom,
                    hiddenSessionIds.filter((id) => id !== chatId)
                );
            }
            const sessions = await this.loadSessions();
            const remainingSessions = sessions.filter(
                (item) => item.chatid !== chatId && !globalStore.get(this.hiddenSessionIdsAtom).includes(item.chatid)
            );
            if (deletingActiveSession) {
                const nextSession = remainingSessions[0];
                if (nextSession) {
                    await this.switchSession(nextSession.chatid);
                } else {
                    this.clearChat();
                }
            }
        } catch (error) {
            console.error("Failed to delete session:", error);
            const message = error instanceof Error ? error.message : "Unknown error";
            this.setError(`Failed to delete session: ${message}`);
        }
    }

    async hideSession(chatId: string): Promise<void> {
        if (!chatId) {
            return;
        }
        const hiddenSessionIds = globalStore.get(this.hiddenSessionIdsAtom);
        if (!hiddenSessionIds.includes(chatId)) {
            globalStore.set(this.hiddenSessionIdsAtom, [...hiddenSessionIds, chatId]);
        }
        if (globalStore.get(this.chatId) === chatId) {
            const nextSession = globalStore
                .get(this.sessionsAtom)
                .find(
                    (item) =>
                        item.chatid !== chatId && !globalStore.get(this.hiddenSessionIdsAtom).includes(item.chatid)
                );
            if (nextSession) {
                await this.switchSession(nextSession.chatid);
            } else {
                this.clearChat();
            }
        }
    }

    async restoreSession(chatId: string): Promise<void> {
        await this.persistSessionUpdate({
            chatid: chatId,
            archived: false,
            deleted: false,
        });
        await this.loadSessions();
    }

    clearChat() {
        void this.cancelGeneration();
        this.clearFiles();
        this.clearError();
        globalStore.set(this.isChatEmptyAtom, true);
        globalStore.set(this.agentRuntimeAtom, getDefaultAgentRuntimeSnapshot());
        globalStore.set(this.taskStateAtom, null);
        globalStore.set(this.focusChainAtom, null);
        globalStore.set(this.contextUsageAtom, 0);
        globalStore.set(this.securityBlockedAtom, false);
        globalStore.set(this.commandInteractionAtom, null);
        globalStore.set(this.askUserAtom, null);
        const currentChatId = globalStore.get(this.chatId);
        const currentSession = globalStore.get(this.sessionsAtom).find((session) => session.chatid === currentChatId);
        const reusableSession = this.isReusableNewChatSession(currentSession)
            ? currentSession
            : this.findReusableNewChatSession();
        const newChatId = reusableSession?.chatid ?? crypto.randomUUID();
        globalStore.set(this.chatId, newChatId);
        const newSession: WaveChatSessionMeta = {
            chatid: newChatId,
            tabid: this.getSessionTabId(),
            title: "New Chat",
            updatedts: Date.now(),
        };
        this.upsertLocalSession(newSession);

        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "waveai:chatid": newChatId },
        });
        void this.persistSessionUpdate({
            chatid: newChatId,
            tabid: newSession.tabid,
            title: newSession.title,
            lasttaskstate: "idle",
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
        if (snapshot.state === "executing") {
            this.lastExecutingRuntimeUpdateAt = Date.now();
        }
        globalStore.set(this.agentRuntimeAtom, snapshot);
    }

    private shouldThrottleExecutingRuntimeUpdate(current: AgentRuntimeSnapshot, next: AgentRuntimeSnapshot): boolean {
        if (current.state !== "executing" || next.state !== "executing") {
            return false;
        }
        if (Date.now() - this.lastExecutingRuntimeUpdateAt >= this.executingRuntimeThrottleMs) {
            return false;
        }
        if (current.activeJobId !== next.activeJobId || current.activeTool !== next.activeTool || current.blockedReason !== next.blockedReason) {
            return false;
        }
        const currentResult = current.lastToolResult;
        const nextResult = next.lastToolResult;
        if (!currentResult || !nextResult) {
            return false;
        }
        return (
            currentResult.requestId === nextResult.requestId &&
            currentResult.taskId === nextResult.taskId &&
            currentResult.toolName === nextResult.toolName &&
            currentResult.jobId === nextResult.jobId &&
            currentResult.ok === nextResult.ok &&
            currentResult.exitCode === nextResult.exitCode &&
            currentResult.stdout === nextResult.stdout &&
            currentResult.stderr === nextResult.stderr &&
            currentResult.errorCode === nextResult.errorCode &&
            currentResult.artifacts?.diffPath === nextResult.artifacts?.diffPath &&
            currentResult.artifacts?.logPath === nextResult.artifacts?.logPath
        );
    }

    mergeAgentRuntimeSnapshot(patch: AgentRuntimeSnapshotPatch) {
        const current = globalStore.get(this.agentRuntimeAtom);
        const next = mergeAgentRuntimeSnapshot(current, patch);
        if (this.shouldThrottleExecutingRuntimeUpdate(current, next)) {
            return;
        }
        if (agentRuntimeSnapshotEquals(current, next)) {
            return;
        }
        if (next.state === "executing") {
            this.lastExecutingRuntimeUpdateAt = Date.now();
        }
        globalStore.set(this.agentRuntimeAtom, next);
    }

    dispatchAgentEvent(event: AgentRuntimeEvent) {
        const current = globalStore.get(this.agentRuntimeAtom);
        const next = reduceAgentRuntimeSnapshot(current, event);
        if (agentRuntimeSnapshotEquals(current, next)) {
            return;
        }
        if (next.state === "executing") {
            this.lastExecutingRuntimeUpdateAt = Date.now();
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
        if (chatData?.sessionmeta) {
            this.upsertLocalSession(chatData.sessionmeta);
            const taskState = ((chatData.sessionmeta as any).taskstate as AgentTaskState | undefined) ?? null;
            globalStore.set(this.taskStateAtom, taskState);
            if (taskState?.focuschain) {
                globalStore.set(this.focusChainAtom, taskState.focuschain);
            } else {
                globalStore.set(this.focusChainAtom, null);
            }
            if (taskState?.focuschain?.currentcontextusage != null) {
                globalStore.set(this.contextUsageAtom, taskState.focuschain.currentcontextusage);
            } else {
                globalStore.set(this.contextUsageAtom, 0);
            }
            if (taskState?.securityblocked) {
                globalStore.set(this.securityBlockedAtom, true);
            } else {
                globalStore.set(this.securityBlockedAtom, false);
            }
        } else {
            globalStore.set(this.taskStateAtom, null);
            globalStore.set(this.focusChainAtom, null);
            globalStore.set(this.contextUsageAtom, 0);
            globalStore.set(this.securityBlockedAtom, false);
        }
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
                await RpcApi.AgentCancelCommand(TabRpcClient, activeJobId);
            } catch (error) {
                console.error("Failed to stop execution job:", error);
            }
        }
        this.clearInteractionResult();
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
            meta: { "waveai:autoexecute": enabled } as MetaType,
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

    private shouldRunInteractively(command: string): boolean {
        const normalized = command.trim().toLowerCase();
        if (!normalized) {
            return false;
        }
        return [
            "ssh",
            "sudo",
            "mysql",
            "psql",
            "sqlite3",
            "python",
            "node",
            "less",
            "more",
            "top",
            "htop",
            "vim",
            "nano",
        ].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
    }

    private buildInteractivePromptHint(command: string): string {
        if (!this.shouldRunInteractively(command)) {
            return "";
        }
        return "Command is waiting for terminal input";
    }

    private handleInteractionResult(jobId: string, commandResult: CommandAgentGetCommandResultRtnData): void {
        const interaction: CommandInteractionState = {
            jobId,
            awaitingInput: Boolean(commandResult.awaitinginput),
            promptHint: commandResult.prompthint || "Command is waiting for terminal input",
            inputOptions: commandResult.inputoptions,
            tuiDetected: commandResult.tuidetected,
            tuiSuppressed: commandResult.tuisuppressed,
            outputPreview: commandResult.output,
        };
        globalStore.set(this.commandInteractionAtom, interaction);
        this.dispatchAgentEvent({
            type: "INTERACTION_REQUIRED",
            reason: interaction.promptHint,
        });
    }

    private clearInteractionResult(): void {
        globalStore.set(this.commandInteractionAtom, null);
    }

    private async pollCommandJob(
        tool: ToolCallEnvelope,
        jobId: string,
        startedAt: number
    ): Promise<{ result?: ToolResultEnvelope; requiresInteraction?: boolean }> {
        let commandResult: CommandAgentGetCommandResultRtnData | null = null;
        let outputOffset = 0;
        let combinedOutput = "";
        let pollDelayMs = 250;
        const absoluteDeadline = Date.now() + 5 * 60 * 1000;
        let lastActivityAt = Date.now();
        let lastStatus = "running";
        while (Date.now() < absoluteDeadline && Date.now() - lastActivityAt <= 30000) {
            commandResult = await RpcApi.AgentGetCommandResultCommand(
                TabRpcClient,
                {
                    jobid: jobId,
                    tailbytes: 8192,
                    offset: outputOffset,
                },
                { timeout: 10000 }
            );
            const currentStatus = commandResult.status || "running";
            const outputChunk = commandResult.output || "";
            const outputChanged = outputChunk.length > 0;
            if (outputChunk.length > 0) {
                if (commandResult.outputoffset === outputOffset && !commandResult.truncated) {
                    combinedOutput += outputChunk;
                } else {
                    combinedOutput = outputChunk;
                }
                if (combinedOutput.length > 24 * 1024) {
                    combinedOutput = combinedOutput.slice(-(24 * 1024));
                }
            }
            if (typeof commandResult.nextoffset === "number") {
                outputOffset = commandResult.nextoffset;
            } else if (outputChunk.length > 0) {
                outputOffset += outputChunk.length;
            }
            commandResult = {
                ...commandResult,
                output: combinedOutput,
            };
            if (commandResult.interactive && (commandResult.awaitinginput || commandResult.tuidetected)) {
                this.handleInteractionResult(jobId, commandResult);
                return { requiresInteraction: true };
            }
            if (commandResult.status !== "running") {
                break;
            }
            if (outputChanged || currentStatus !== lastStatus) {
                lastActivityAt = Date.now();
                pollDelayMs = 250;
            } else {
                pollDelayMs = Math.min(2000, pollDelayMs * 2);
            }
            lastStatus = currentStatus;
            await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
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
                error: "Timed out waiting for command completion (no recent output/activity)",
            };
        }
        if (commandResult.status === "gone") {
            commandResult = {
                ...commandResult,
                status: "error",
                error:
                    commandResult.error ||
                    "Command result is unavailable (it may have been cleaned up). Please run the command again.",
            };
        }
        this.clearInteractionResult();
        const exitCode = typeof commandResult.exitcode === "number" ? commandResult.exitcode : 1;
        const ok = commandResult.status === "done" && exitCode === 0 && !commandResult.error;
        return {
            result: {
                requestId: tool.requestId,
                taskId: tool.taskId,
                toolName: tool.toolName,
                jobId,
                ok,
                exitCode,
                stdout: commandResult.output,
                stderr: commandResult.error,
                durationMs: Date.now() - startedAt,
            },
        };
    }

    async submitCommandInteraction(input: string): Promise<void> {
        const interaction = globalStore.get(this.commandInteractionAtom);
        if (!interaction?.jobId) {
            return;
        }
        await RpcApi.AgentWriteStdinCommand(
            TabRpcClient,
            {
                jobid: interaction.jobId,
                input,
                appendnewline: true,
                clearprompthint: true,
            },
            { timeout: 10000 }
        );
        this.clearInteractionResult();
        const runtime = globalStore.get(this.agentRuntimeAtom);
        if (!runtime.lastToolCall) {
            return;
        }
        this.dispatchAgentEvent({
            type: "TOOL_CALL_STARTED",
            tool: {
                ...runtime.lastToolCall,
                jobId: interaction.jobId,
            },
        });
        const polled = await this.pollCommandJob(runtime.lastToolCall, interaction.jobId, Date.now());
        if (polled.requiresInteraction || !polled.result) {
            return;
        }
        if (polled.result.ok) {
            this.dispatchAgentEvent({ type: "TOOL_CALL_FINISHED", result: polled.result });
        } else {
            this.dispatchAgentEvent({ type: "TOOL_CALL_FAILED", result: polled.result, retryable: true });
        }
    }

    async submitAskUserAnswer(actionId: string, answer: string): Promise<void> {
        await RpcApi.WaveAIToolApproveCommand(
            TabRpcClient,
            {
                toolcallid: "",
                actionid: actionId,
                approval: "answered",
                value: answer,
            }
        );
        globalStore.set(this.askUserAtom, null);
    }

    executeCommandInTerminal(command: string, opts?: { source?: "manual" | "auto" }): boolean {
        const normalized = (command ?? "").replace(/\r/g, "").trim();
        if (normalized === "") {
            console.log("[waveai:execute] ignored empty command", {
                source: opts?.source ?? "manual",
            });
            return false;
        }

        const target = this.getTargetTerminalModel();
        if (target == null) {
            console.log("[waveai:execute] no active terminal available", {
                source: opts?.source ?? "manual",
                command: normalized,
                focusedBlockId: getFocusedBlockId(),
            });
            this.setError("No active terminal available. Focus a terminal and try again.");
            return false;
        }

        console.log("[waveai:execute] dispatching command", {
            source: opts?.source ?? "manual",
            blockId: target.blockId,
            command: normalized,
        });

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
        } as any);
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
            const interactive = this.shouldRunInteractively(command);
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
                    interactive,
                    prompthint: this.buildInteractivePromptHint(command),
                    suppresstui: true,
                },
                { timeout: 15000 }
            );
            const jobId = runResult.jobid;
            const runningTool: ToolCallEnvelope = {
                ...tool,
                jobId,
                hostScope: { type: connName === "local" ? "local" : "remote", hostId: connName },
            };
            this.dispatchAgentEvent({
                type: "TOOL_CALL_STARTED",
                tool: runningTool,
            });
            const polled = await this.pollCommandJob(runningTool, jobId, startedAt);
            if (polled.requiresInteraction || !polled.result) {
                recordTEvent("waveai:perf:tool:interaction", {
                    "waveai:tool": tool.toolName,
                    "waveai:requestid": tool.requestId,
                    "waveai:taskid": tool.taskId,
                    "waveai:jobid": jobId,
                } as any);
                return {
                    requestId: tool.requestId,
                    taskId: tool.taskId,
                    toolName: tool.toolName,
                    jobId,
                    ok: false,
                    exitCode: 0,
                    durationMs: Date.now() - startedAt,
                    errorCode: "INTERACTION_REQUIRED",
                };
            }
            const result = polled.result;
            const ok = result.ok;
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
        const lastResultWasChatStream = runtime.lastToolResult?.toolName === "chat-stream";
        const shouldRetryRound =
            scope === "round" || (scope === "step" && (lastResultWasChatStream || (!runtime.lastToolCall && !runtime.lastCommand)));

        this.dispatchAgentEvent({
            type: "RETRY_REQUESTED",
            retry,
            reason: shouldRetryRound ? "Retrying the full round" : "Retrying the last step",
        });
        recordTEvent("waveai:perf:retry", {
            "waveai:scope": shouldRetryRound ? "round" : scope,
            "waveai:retrycount": retry.retryCount,
            "waveai:maxretries": retry.maxRetries,
            "waveai:lasterror": retry.lastErrorCode ?? "",
        } as any);

        if (shouldRetryRound && this.lastSubmittedMessage && this.useChatSendMessage) {
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
        const sessions = await this.loadSessions();
        if (!chatIdValue && sessions.length > 0) {
            const reusableSession = sessions.find((session) => this.isReusableNewChatSession(session));
            chatIdValue = reusableSession?.chatid ?? sessions[0].chatid;
        }
        if (chatIdValue == null) {
            chatIdValue = crypto.randomUUID();
            RpcApi.SetRTInfoCommand(TabRpcClient, {
                oref: this.orefContext,
                data: { "waveai:chatid": chatIdValue },
            });
            this.upsertLocalSession({
                chatid: chatIdValue,
                tabid: this.getSessionTabId(),
                title: "New Chat",
                updatedts: Date.now(),
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

        const currentChatId = this.getChatId();
        const trimmedInput = input.trim();
        if (currentChatId && trimmedInput) {
            const title = this.summarizeSessionText(trimmedInput, 48);
            const summary = this.summarizeSessionText(trimmedInput, 140);
            const session = globalStore.get(this.sessionsAtom).find((item) => item.chatid === currentChatId);
            this.upsertLocalSession({
                chatid: currentChatId,
                tabid: session?.tabid ?? this.getSessionTabId(),
                title: title || session?.title || "New Chat",
                summary,
                favorite: session?.favorite,
                updatedts: Date.now(),
                lasttaskstate: "submitting",
            });
            void this.persistSessionUpdate({
                chatid: currentChatId,
                tabid: this.getSessionTabId(),
                title,
                summary,
                lasttaskstate: "submitting",
            });
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
