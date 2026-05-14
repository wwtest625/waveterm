// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    AgentFocusChainState,
    AgentRuntimeEvent,
    AgentRuntimeSnapshot,
    AgentRuntimeSnapshotPatch,
    AgentTaskState,
    AskUserData,
    ChatBackgroundJobDetail,
    CommandInteractionState,
    ContextItem,
    ContextItemContent,
    ContextItemType,
    FileContextData,
    KBContextData,
    SkillContextData,
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
import { type AIPanelChatContextValue } from "@/app/aipanel/aipanel-chat-context";
import { type WaveAIAction, getActionLogEnabled } from "@/app/aipanel/waveai-actions";
import { AgentRuntimeModule } from "@/app/aipanel/waveai-agent-runtime";
import { FileServiceModule, type DroppedFile as DroppedFileType } from "@/app/aipanel/waveai-file-service";
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
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { getWebServerEndpoint } from "@/util/endpoints";
import { base64ToArrayBuffer } from "@/util/util";
import * as jotai from "jotai";
import type React from "react";
import {
    createDataUrl,
    normalizeMimeType,
} from "./ai-utils";
import type { AIPanelInputRef } from "./aipanelinput";
import {
    sortSessions as sortSessionsUtil,
    sortBackgroundJobs as sortBackgroundJobsUtil,
    summarizeSessionText as summarizeSessionTextUtil,
    isReusableNewChatSession as isReusableNewChatSessionUtil,
    buildRetryMeta as buildRetryMetaUtil,
    shouldRunInteractively as shouldRunInteractivelyUtil,
    buildInteractivePromptHint as buildInteractivePromptHintUtil,
    hasSubmittableContent as hasSubmittableContentUtil,
} from "./waveai-utils";

export type DroppedFile = DroppedFileType;

export type AgentMode = "default" | "planning" | "auto-approve";

export type QueuedSubmissionStatus = "queued" | "sending" | "canceling";

export type QueuedSubmission = {
    id: string;
    text: string;
    files: DroppedFile[];
    createdAt: number;
    status: QueuedSubmissionStatus;
};

export type TerminalTargetInfo = {
    blockId: string;
    connName: string;
    cwd?: string;
};

export class WaveAIModel {
    private static instance: WaveAIModel | null = null;

    // ─── UI Refs ────────────────────────────────────────────────────────────────
    inputRef: React.RefObject<AIPanelInputRef> | null = null;
    scrollToBottomCallback: (() => void) | null = null;
    orefContext: ORef;
    private scrollTargetRegistry = new Map<string, HTMLElement>();

    // ─── Chat Session ──────────────────────────────────────────────────────────
    chatId!: jotai.PrimitiveAtom<string>;
    sessionsAtom: jotai.PrimitiveAtom<WaveChatSessionMeta[]> = jotai.atom([]);
    hiddenSessionIdsAtom: jotai.PrimitiveAtom<string[]> = jotai.atom([]);
    isLoadingChatAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    isChatEmptyAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(true);
    realMessage: AIMessage | null = null;
    lastSubmittedMessage: AIMessage | null = null;

    // ─── Message Input & Queue ─────────────────────────────────────────────────
    inputAtom: jotai.PrimitiveAtom<string> = jotai.atom("");
    queuedSubmissionsAtom: jotai.PrimitiveAtom<QueuedSubmission[]> = jotai.atom([]);
    contextItemsAtom: jotai.PrimitiveAtom<ContextItem[]> = jotai.atom([]);

    // ─── Sub-Modules ───────────────────────────────────────────────────────────
    readonly agentRuntime: AgentRuntimeModule;
    readonly fileService: FileServiceModule;

    // ─── Agent Runtime (delegated) ─────────────────────────────────────────────
    get isAIStreaming() { return this.agentRuntime.isAIStreaming; }
    get agentRuntimeAtom() { return this.agentRuntime.agentRuntimeAtom; }
    get taskStateAtom() { return this.agentRuntime.taskStateAtom; }
    get focusChainAtom() { return this.agentRuntime.focusChainAtom; }
    get contextUsageAtom() { return this.agentRuntime.contextUsageAtom; }
    get securityBlockedAtom() { return this.agentRuntime.securityBlockedAtom; }
    get askUserAtom() { return this.agentRuntime.askUserAtom; }
    get errorMessage() { return this.agentRuntime.errorMessage; }
    get droppedFiles() { return this.fileService.droppedFiles; }

    // ─── Tool Execution & Command Interaction ──────────────────────────────────
    commandInteractionAtom: jotai.PrimitiveAtom<CommandInteractionState | null> = jotai.atom(
        null
    ) as jotai.PrimitiveAtom<CommandInteractionState | null>;
    backgroundJobsAtom: jotai.PrimitiveAtom<ChatBackgroundJobDetail[]> = jotai.atom([]);
    terminalTargetAtom: jotai.PrimitiveAtom<TerminalTargetInfo | null> = jotai.atom(
        null
    ) as jotai.PrimitiveAtom<TerminalTargetInfo | null>;
    private activePollJobs = new Set<string>();
    private isFlushingQueuedSubmission = false;

    // ─── AI Mode & Settings ────────────────────────────────────────────────────
    currentAIMode!: jotai.PrimitiveAtom<string>;
    aiModeConfigs!: jotai.Atom<Record<string, AIModeConfigType>>;
    hasPremiumAtom!: jotai.Atom<boolean>;
    defaultModeAtom!: jotai.Atom<string>;
    agentModeAtom!: jotai.Atom<AgentMode>;
    widgetAccessAtom!: jotai.Atom<boolean>;
    autoExecuteAtom!: jotai.Atom<boolean>;

    // ─── Layout & Visibility ───────────────────────────────────────────────────
    containerWidth: jotai.PrimitiveAtom<number> = jotai.atom(0);
    codeBlockMaxWidth!: jotai.Atom<number>;
    isWaveAIFocusedAtom!: jotai.Atom<boolean>;
    panelVisibleAtom!: jotai.Atom<boolean>;

    // ─── Backup & Restore ──────────────────────────────────────────────────────
    restoreBackupModalToolCallId: jotai.PrimitiveAtom<string | null> = jotai.atom(null) as jotai.PrimitiveAtom<
        string | null
    >;
    restoreBackupStatus: jotai.PrimitiveAtom<"idle" | "processing" | "success" | "error"> = jotai.atom("idle");
    restoreBackupError: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;

    private constructor(orefContext: ORef) {
        this.orefContext = orefContext;
        this.chatId = jotai.atom(null) as jotai.PrimitiveAtom<string>;
        this.aiModeConfigs = atoms.waveaiModeConfigAtom;

        this.agentRuntime = new AgentRuntimeModule(orefContext, (action) => this.dispatch(action));
        this.fileService = new FileServiceModule((action) => this.dispatch(action), (msg) => this.agentRuntime.setError(msg));

        this.hasPremiumAtom = jotai.atom((get) => {
            const rateLimitInfo = get(atoms.waveAIRateLimitInfoAtom);
            return !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;
        });

        this.widgetAccessAtom = jotai.atom((get) => {
            const widgetAccessMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:widgetcontext" as keyof MetaType);
            const value = get(widgetAccessMetaAtom) as boolean | undefined;
            return value ?? true;
        });

        this.autoExecuteAtom = jotai.atom((get) => {
            const autoExecuteMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:autoexecute" as keyof MetaType);
            const value = get(autoExecuteMetaAtom) as boolean | undefined;
            return value ?? true;
        });

        this.agentModeAtom = jotai.atom((get) => {
            const modeMetaAtom = getOrefMetaKeyAtom(this.orefContext, "waveai:agentmode");
            const value = get(modeMetaAtom);
            if (value === "planning" || value === "auto-approve" || value === "default") {
                return value;
            }
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
            return get(FocusManager.getInstance().focusType) === "waveai";
        });

        this.panelVisibleAtom = jotai.atom((get) => {
            return get(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
        });

        this.defaultModeAtom = jotai.atom((get) => {
            const aiModeConfigs = get(this.aiModeConfigs);
            const byokConfigs = Object.entries(aiModeConfigs ?? {})
                .filter(([, config]) => config["ai:provider"] !== "wave")
                .sort(([, a], [, b]) => (a["display:order"] ?? 0) - (b["display:order"] ?? 0));
            const firstByokMode = byokConfigs.length > 0 ? byokConfigs[0][0] : null;
            let mode = get(getSettingsKeyAtom("waveai:defaultmode")) ?? firstByokMode ?? "waveai@quick";
            if (mode.startsWith("waveai@") && firstByokMode) {
                mode = firstByokMode;
            }
            const modeExists = aiModeConfigs != null && mode in aiModeConfigs;
            if (!modeExists) {
                mode = firstByokMode ?? "waveai@quick";
            }
            return mode;
        });

        const defaultMode = globalStore.get(this.defaultModeAtom);
        this.currentAIMode = jotai.atom(defaultMode);
    }

    dispatch(action: WaveAIAction): void {
        if (getActionLogEnabled()) {
            console.log("[WaveAI:dispatch]", action.type, action);
        }
        switch (action.type) {
            case "SET_CHAT_ID":
                globalStore.set(this.chatId, action.chatId);
                break;
            case "SET_SESSIONS":
                globalStore.set(this.sessionsAtom, action.sessions);
                break;
            case "SET_HIDDEN_SESSION_IDS":
                globalStore.set(this.hiddenSessionIdsAtom, action.ids);
                break;
            case "SET_IS_LOADING_CHAT":
                globalStore.set(this.isLoadingChatAtom, action.value);
                break;
            case "SET_IS_CHAT_EMPTY":
                globalStore.set(this.isChatEmptyAtom, action.value);
                break;
            case "SET_INPUT":
                globalStore.set(this.inputAtom, action.value);
                break;
            case "SET_DROPPED_FILES":
                globalStore.set(this.droppedFiles, action.files);
                break;
            case "SET_QUEUED_SUBMISSIONS":
                globalStore.set(this.queuedSubmissionsAtom, action.submissions);
                break;
            case "SET_ERROR_MESSAGE":
                globalStore.set(this.errorMessage, action.message);
                break;
            case "SET_IS_AI_STREAMING":
                globalStore.set(this.isAIStreaming, action.value);
                break;
            case "SET_AGENT_RUNTIME":
                globalStore.set(this.agentRuntimeAtom, action.snapshot);
                break;
            case "SET_TASK_STATE":
                globalStore.set(this.taskStateAtom, action.taskState);
                break;
            case "SET_FOCUS_CHAIN":
                globalStore.set(this.focusChainAtom, action.focusChain);
                break;
            case "SET_CONTEXT_USAGE":
                globalStore.set(this.contextUsageAtom, action.usage);
                break;
            case "SET_SECURITY_BLOCKED":
                globalStore.set(this.securityBlockedAtom, action.blocked);
                break;
            case "SET_ASK_USER":
                globalStore.set(this.askUserAtom, action.data);
                break;
            case "SET_COMMAND_INTERACTION":
                globalStore.set(this.commandInteractionAtom, action.interaction);
                break;
            case "SET_BACKGROUND_JOBS":
                globalStore.set(this.backgroundJobsAtom, action.jobs);
                break;
            case "SET_TERMINAL_TARGET":
                globalStore.set(this.terminalTargetAtom, action.info);
                break;
            case "SET_CURRENT_AI_MODE":
                globalStore.set(this.currentAIMode, action.mode);
                break;
            case "SET_CONTAINER_WIDTH":
                globalStore.set(this.containerWidth, action.width);
                break;
            case "SET_RESTORE_BACKUP_MODAL":
                globalStore.set(this.restoreBackupModalToolCallId, action.toolCallId);
                break;
            case "SET_RESTORE_BACKUP_STATUS":
                globalStore.set(this.restoreBackupStatus, action.status);
                break;
            case "SET_RESTORE_BACKUP_ERROR":
                globalStore.set(this.restoreBackupError, action.error);
                break;
            case "SET_CONTEXT_ITEMS":
                globalStore.set(this.contextItemsAtom, action.items);
                break;
            case "CLEAR_CHAT_STATE":
                globalStore.set(this.isChatEmptyAtom, true);
                globalStore.set(this.backgroundJobsAtom, []);
                globalStore.set(this.agentRuntimeAtom, getDefaultAgentRuntimeSnapshot());
                globalStore.set(this.taskStateAtom, null);
                globalStore.set(this.focusChainAtom, null);
                globalStore.set(this.contextUsageAtom, 0);
                globalStore.set(this.securityBlockedAtom, false);
                globalStore.set(this.commandInteractionAtom, null);
                this.dispatch({ type: "SET_ASK_USER", data: null });
                break;
        }
    }

    getPanelVisibleAtom(): jotai.Atom<boolean> {
        return this.panelVisibleAtom;
    }

    static getInstance(): WaveAIModel {
        if (!WaveAIModel.instance) {
            let orefContext: ORef;
            const tabId = globalStore.get(atoms.staticTabId);
            orefContext = WOS.makeORef("tab", tabId);
            WaveAIModel.instance = new WaveAIModel(orefContext);
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
        return globalStore.get(atoms.staticTabId);
    }

    private sortSessions(sessions: WaveChatSessionMeta[]): WaveChatSessionMeta[] {
        return sortSessionsUtil(sessions);
    }

    private sortBackgroundJobs(jobs: ChatBackgroundJobDetail[]): ChatBackgroundJobDetail[] {
        return sortBackgroundJobsUtil(jobs);
    }

    private setBackgroundJobs(jobs: ChatBackgroundJobDetail[] | null | undefined): void {
        this.dispatch({ type: "SET_BACKGROUND_JOBS", jobs: this.sortBackgroundJobs(jobs ?? []) });
    }

    private summarizeSessionText(text: string, limit: number): string {
        return summarizeSessionTextUtil(text, limit);
    }

    private isReusableNewChatSession(session: WaveChatSessionMeta | null | undefined): boolean {
        return isReusableNewChatSessionUtil(session);
    }

    private findReusableNewChatSession(): WaveChatSessionMeta | null {
        const currentChatId = globalStore.get(this.chatId);
        const sessions = globalStore.get(this.sessionsAtom);
        const candidates = sessions.filter(
            (session) =>
                this.isReusableNewChatSession(session) && session.chatid !== currentChatId
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
        this.dispatch({ type: "SET_SESSIONS", sessions: this.sortSessions(next) });
    }

    private removeLocalSession(chatId: string): void {
        const current = globalStore.get(this.sessionsAtom);
        this.dispatch({
            type: "SET_SESSIONS",
            sessions: current.filter((item) => item.chatid !== chatId),
        });
    }

    async addFile(file: File): Promise<DroppedFile> {
        return this.fileService.addFile(file);
    }

    async addFileFromRemoteUri(draggedFile: DraggedFile): Promise<void> {
        return this.fileService.addFileFromRemoteUri(draggedFile);
    }

    removeFile(fileId: string) {
        this.fileService.removeFile(fileId);
    }

    clearFiles() {
        this.fileService.clearFiles();
    }

    addContextItem(item: ContextItem) {
        const current = globalStore.get(this.contextItemsAtom);
        this.dispatch({ type: "SET_CONTEXT_ITEMS", items: [...current, item] });
    }

    removeContextItem(id: string) {
        const current = globalStore.get(this.contextItemsAtom);
        this.dispatch({ type: "SET_CONTEXT_ITEMS", items: current.filter((item) => item.id !== id) });
    }

    clearContextItems() {
        this.dispatch({ type: "SET_CONTEXT_ITEMS", items: [] });
    }

    async resolveContextContent(item: ContextItem): Promise<ContextItemContent> {
        if (item.type === "skill") {
            const skillData = item.data as SkillContextData;
            const result = await RpcApi.GetSkillDefinitionCommand(TabRpcClient, { skillId: skillData.skillId });
            return { text: result.definition, identifier: skillData.skillName, type: "skill" };
        }
        if (item.type === "kb") {
            const kbData = item.data as KBContextData;
            const result = await RpcApi.ReadKBFileCommand(TabRpcClient, { path: kbData.path });
            return { text: result.content, identifier: kbData.path, type: "kb" };
        }
        if (item.type === "file") {
            const fileData = item.data as FileContextData;
            if (fileData.file) {
                const text = await fileData.file.text();
                return { text, identifier: fileData.path, type: "file" };
            }
            return { text: "", identifier: fileData.path, type: "file" };
        }
        return { text: "", identifier: "", type: item.type };
    }

    async loadSessions(opts?: { includeArchived?: boolean; includeDeleted?: boolean }): Promise<WaveChatSessionMeta[]> {
        const sessions = await RpcApi.ListWaveAISessionsCommand(
            TabRpcClient,
            {
                tabid: "",
                includearchived: opts?.includeArchived,
                includedeleted: opts?.includeDeleted,
            },
            null
        );
        const normalized = this.sortSessions(sessions ?? []);
        this.dispatch({ type: "SET_SESSIONS", sessions: normalized });
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
        this.dispatch({ type: "SET_CHAT_ID", chatId });
        this.dispatch({ type: "SET_COMMAND_INTERACTION", interaction: null });
        await RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "waveai:chatid": chatId },
        });
        const messages = await this.reloadChatFromBackend(chatId);
        this.getChatSetMessages()?.(messages);
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
                this.dispatch({
                    type: "SET_HIDDEN_SESSION_IDS",
                    ids: hiddenSessionIds.filter((id) => id !== chatId),
                });
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
            this.dispatch({ type: "SET_HIDDEN_SESSION_IDS", ids: [...hiddenSessionIds, chatId] });
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
        this.dispatch({ type: "CLEAR_CHAT_STATE" });
        const reusableSession = this.findReusableNewChatSession();
        const newChatId = reusableSession?.chatid ?? crypto.randomUUID();
        this.dispatch({ type: "SET_CHAT_ID", chatId: newChatId });
        const newSession: WaveChatSessionMeta = {
            chatid: newChatId,
            tabid: this.getSessionTabId(),
            title: "New Chat",
            updatedts: Date.now(),
            isempty: !reusableSession,
        };
        this.upsertLocalSession(newSession);

        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "waveai:chatid": newChatId },
        });
        if (reusableSession) {
            void this.persistSessionUpdate({
                chatid: newChatId,
                tabid: newSession.tabid,
                title: newSession.title,
                lasttaskstate: "idle",
            });
        }
    }

    setError(message: string) {
        this.agentRuntime.setError(message);
    }

    clearError() {
        this.agentRuntime.clearError();
    }

    setAgentRuntimeSnapshot(snapshot: AgentRuntimeSnapshot) {
        this.agentRuntime.setAgentRuntimeSnapshot(snapshot);
    }

    private shouldThrottleExecutingRuntimeUpdate(current: AgentRuntimeSnapshot, next: AgentRuntimeSnapshot): boolean {
        return false;
    }

    mergeAgentRuntimeSnapshot(patch: AgentRuntimeSnapshotPatch) {
        this.agentRuntime.mergeAgentRuntimeSnapshot(patch);
    }

    dispatchAgentEvent(event: AgentRuntimeEvent) {
        this.agentRuntime.dispatchAgentEvent(event);
    }

    registerInputRef(ref: React.RefObject<AIPanelInputRef>) {
        this.inputRef = ref;
    }

    registerScrollToBottom(callback: () => void) {
        this.scrollToBottomCallback = callback;
    }

    private chatContextValue: AIPanelChatContextValue | null = null;

    registerChatContext(value: AIPanelChatContextValue): void {
        this.chatContextValue = value;
    }

    private getChatContext(): AIPanelChatContextValue | null {
        return this.chatContextValue;
    }

    private getChatSendMessage(): UseChatSendMessageType | null {
        return this.getChatContext()?.sendMessage ?? null;
    }

    private getChatSetMessages(): UseChatSetMessagesType | null {
        return this.getChatContext()?.setMessages ?? null;
    }

    private getChatStatus(): string {
        return this.getChatContext()?.status ?? "ready";
    }

    private getChatStop(): (() => void) | null {
        return this.getChatContext()?.stop ?? null;
    }

    scrollToBottom() {
        this.scrollToBottomCallback?.();
    }

    focusInput() {
        if (!WorkspaceLayoutModel.getInstance().getAIPanelVisible()) {
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
            this.setBackgroundJobs((chatData.sessionmeta as WaveChatSessionMeta).backgroundjobs ?? []);
            const taskState = (chatData.sessionmeta as WaveChatSessionMeta).taskstate ?? null;
            this.dispatch({ type: "SET_TASK_STATE", taskState });
            this.dispatch({ type: "SET_FOCUS_CHAIN", focusChain: taskState?.focuschain ?? null });
            this.dispatch({ type: "SET_CONTEXT_USAGE", usage: taskState?.focuschain?.currentcontextusage ?? 0 });
            this.dispatch({ type: "SET_SECURITY_BLOCKED", blocked: Boolean(taskState?.securityblocked) });
        } else {
            this.setBackgroundJobs([]);
            this.dispatch({ type: "SET_TASK_STATE", taskState: null });
            this.dispatch({ type: "SET_FOCUS_CHAIN", focusChain: null });
            this.dispatch({ type: "SET_CONTEXT_USAGE", usage: 0 });
            this.dispatch({ type: "SET_SECURITY_BLOCKED", blocked: false });
        }
        this.dispatch({ type: "SET_IS_CHAT_EMPTY", value: messages.length === 0 });
        return messages as WaveUIMessage[];
    }

    async refreshBackgroundJobs(chatIdValue?: string): Promise<ChatBackgroundJobDetail[]> {
        const chatId = chatIdValue ?? globalStore.get(this.chatId);
        if (!chatId) {
            this.setBackgroundJobs([]);
            return [];
        }
        const jobs = await RpcApi.ListWaveAIBackgroundJobsCommand(TabRpcClient, { chatid: chatId }, null);
        this.setBackgroundJobs(jobs ?? []);
        const session = globalStore.get(this.sessionsAtom).find((item) => item.chatid === chatId);
        if (session) {
            this.upsertLocalSession({
                ...session,
                backgroundjobs: jobs ?? [],
            });
        }
        return jobs ?? [];
    }

    upsertBackgroundJobFromEvent(job: UIChatBackgroundJobInfo): void {
        const currentJobs = globalStore.get(this.backgroundJobsAtom) ?? [];
        const existingIdx = currentJobs.findIndex(
            (j) => j.jobid === job.jobid || j.toolcallid === job.toolcallid
        );
        let updatedJobs: ChatBackgroundJobDetail[];
        if (existingIdx >= 0) {
            updatedJobs = [...currentJobs];
            updatedJobs[existingIdx] = job as ChatBackgroundJobDetail;
        } else {
            updatedJobs = [...currentJobs, job as ChatBackgroundJobDetail];
        }
        this.setBackgroundJobs(updatedJobs);
        const chatId = globalStore.get(this.chatId);
        if (chatId) {
            const session = globalStore.get(this.sessionsAtom).find((item) => item.chatid === chatId);
            if (session) {
                this.upsertLocalSession({
                    ...session,
                    backgroundjobs: updatedJobs,
                });
            }
        }
    }

    async cancelBackgroundJobs(jobIds: string[]): Promise<void> {
        const chatId = globalStore.get(this.chatId);
        const normalizedJobIds = [...new Set(jobIds.filter(Boolean))];
        if (!chatId || normalizedJobIds.length === 0) {
            return;
        }
        const jobs = await RpcApi.CancelWaveAIBackgroundJobsCommand(
            TabRpcClient,
            {
                chatid: chatId,
                jobids: normalizedJobIds,
            },
            null
        );
        this.setBackgroundJobs(jobs ?? []);
        const session = globalStore.get(this.sessionsAtom).find((item) => item.chatid === chatId);
        if (session) {
            this.upsertLocalSession({
                ...session,
                backgroundjobs: jobs ?? [],
            });
        }
    }

    async clearFinishedBackgroundJobs(): Promise<void> {
        const chatId = globalStore.get(this.chatId);
        if (!chatId) {
            return;
        }
        const jobs = await RpcApi.ClearWaveAIBackgroundJobsCommand(TabRpcClient, { chatid: chatId }, null);
        this.setBackgroundJobs(jobs ?? []);
        const session = globalStore.get(this.sessionsAtom).find((item) => item.chatid === chatId);
        if (session) {
            this.upsertLocalSession({
                ...session,
                backgroundjobs: jobs ?? [],
            });
        }
    }

    async cancelAllRunningBackgroundJobs(): Promise<void> {
        const jobs = globalStore.get(this.backgroundJobsAtom);
        const runningJobIds = jobs
            .filter((job) => job.status === "running")
            .map((job) => job.jobid)
            .filter(Boolean);
        await this.cancelBackgroundJobs(runningJobIds);
    }

    registerScrollTarget(key: string, element: HTMLElement | null): void {
        if (element) {
            this.scrollTargetRegistry.set(key, element);
        } else {
            this.scrollTargetRegistry.delete(key);
        }
    }

    scrollToBackgroundJob(job: ChatBackgroundJobDetail): void {
        const toolCallId = job.toolcallid?.trim();
        const turnId = job.turnid?.trim();
        const keys = [toolCallId, turnId].filter(Boolean);
        for (const key of keys) {
            const element = this.scrollTargetRegistry.get(key);
            if (element) {
                element.scrollIntoView({ behavior: "smooth", block: "center" });
                return;
            }
        }
        this.scrollToBottom();
    }

    async cancelGeneration() {
        const chatIdAtEntry = globalStore.get(this.chatId);
        this.dispatchAgentEvent({ type: "CANCEL_GENERATION" });
        this.getChatStop()?.();
        const cancelPollInterval = 100;
        const cancelMaxWait = 3000;
        const cancelDeadline = Date.now() + cancelMaxWait;
        while (this.getChatStatus() !== "ready" && this.getChatStatus() !== "error" && Date.now() < cancelDeadline) {
            await new Promise((resolve) => setTimeout(resolve, cancelPollInterval));
        }

        if (globalStore.get(this.chatId) !== chatIdAtEntry) {
            return;
        }

        const chatIdValue = globalStore.get(this.chatId);
        if (!chatIdValue) {
            return;
        }
        try {
            const messages = await this.reloadChatFromBackend(chatIdValue);

            if (globalStore.get(this.chatId) !== chatIdAtEntry) {
                return;
            }

            this.getChatSetMessages()?.(messages);
        } catch (error) {
            console.error("Failed to reload chat after stop:", error);
        }
    }

    async cancelExecution() {
        const runtime = globalStore.get(this.agentRuntimeAtom);
        const activeJobIds = Array.from(
            new Set(
                [...(runtime.activeJobIds ?? []), runtime.activeJobId, runtime.lastToolResult?.jobId].filter(
                    (jobId): jobId is string => Boolean(jobId)
                )
            )
        );
        for (const jobId of activeJobIds) {
            try {
                await RpcApi.AgentCancelCommand(TabRpcClient, jobId);
            } catch (error) {
                console.error(`Failed to stop execution job ${jobId}:`, error);
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
        return buildRetryMetaUtil(retryCount, lastErrorCode);
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
        this.dispatch({ type: "SET_INPUT", value: newInput });

        if (opts?.scrollToBottom && this.inputRef?.current) {
            setTimeout(() => this.inputRef.current.scrollToBottom(), 10);
        }
    }

    setModel(model: string) {
        this.agentRuntime.setModel(model);
    }

    setWidgetAccess(enabled: boolean) {
        this.agentRuntime.setWidgetAccess(enabled);
    }

    setAutoExecute(enabled: boolean) {
        this.agentRuntime.setAutoExecute(enabled);
    }

    setAgentMode(mode: AgentMode) {
        this.agentRuntime.setAgentMode(mode);
    }

    refreshTerminalTargetInfo(): TerminalTargetInfo | null {
        const target = this.getTargetTerminalModel();
        if (target == null) {
            this.dispatch({ type: "SET_TERMINAL_TARGET", info: null });
            return null;
        }
        const info = {
            blockId: target.blockId,
            ...this.getTerminalExecutionContext(target.blockId),
        };
        this.dispatch({ type: "SET_TERMINAL_TARGET", info });
        return info;
    }

    private getTargetTerminalModel(): {
        blockId: string;
        sendDataToController: (data: string) => void;
    } | null {
        const focusedBlockId = getFocusedBlockId();
        if (focusedBlockId) {
            const bcm = getBlockComponentModel(focusedBlockId);
            const viewModel = bcm?.viewModel;
            if (viewModel?.viewType === "term" && "sendDataToController" in viewModel && typeof viewModel.sendDataToController === "function") {
                return {
                    blockId: focusedBlockId,
                    sendDataToController: (viewModel as ViewModel & { sendDataToController: (data: string) => void }).sendDataToController.bind(viewModel),
                };
            }
        }

        for (const bcm of getAllBlockComponentModels()) {
            const viewModel = bcm.viewModel;
            if (viewModel?.viewType === "term" && "sendDataToController" in viewModel && typeof viewModel.sendDataToController === "function") {
                const termVm = viewModel as ViewModel & { blockId: string; sendDataToController: (data: string) => void };
                return {
                    blockId: termVm.blockId,
                    sendDataToController: termVm.sendDataToController.bind(termVm),
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
        return shouldRunInteractivelyUtil(command);
    }

    private buildInteractivePromptHint(command: string): string {
        return buildInteractivePromptHintUtil(command);
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
        this.dispatch({ type: "SET_COMMAND_INTERACTION", interaction });
        this.dispatchAgentEvent({
            type: "INTERACTION_REQUIRED",
            reason: interaction.promptHint,
        });
    }

    private clearInteractionResult(): void {
        this.dispatch({ type: "SET_COMMAND_INTERACTION", interaction: null });
    }

    private async pollCommandJob(
        tool: ToolCallEnvelope,
        jobId: string,
        startedAt: number
    ): Promise<{ result?: ToolResultEnvelope; requiresInteraction?: boolean }> {
        if (this.activePollJobs.has(jobId)) {
            return {};
        }
        this.activePollJobs.add(jobId);
        try {
            return await this.pollCommandJobInner(tool, jobId, startedAt);
        } finally {
            this.activePollJobs.delete(jobId);
        }
    }

    private async pollCommandJobInner(
        tool: ToolCallEnvelope,
        jobId: string,
        startedAt: number
    ): Promise<{ result?: ToolResultEnvelope; requiresInteraction?: boolean }> {
        let commandResult: CommandAgentGetCommandResultRtnData | null = null;
        let outputOffset = 0;
        let combinedOutput = "";
        let pollDelayMs = 250;
        const absoluteDeadline = Date.now() + 30 * 60 * 1000;
        const inactivityTimeoutMs = 3 * 60 * 1000;
        let lastActivityAt = Date.now();
        let lastStatus = "running";
        while (Date.now() < absoluteDeadline && Date.now() - lastActivityAt <= inactivityTimeoutMs) {
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
        const interactionToolCall =
            Object.values(runtime.activeToolCalls ?? {}).find((tool) => tool.jobId === interaction.jobId) ??
            runtime.lastToolCall;
        if (!interactionToolCall) {
            return;
        }
        this.dispatchAgentEvent({
            type: "TOOL_CALL_STARTED",
            tool: {
                ...interactionToolCall,
                jobId: interaction.jobId,
            },
        });
        const polled = await this.pollCommandJob(interactionToolCall, interaction.jobId, Date.now());
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
        await RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
            toolcallid: "",
            actionid: actionId,
            approval: "answered",
            value: answer,
        });
        this.dispatch({ type: "SET_ASK_USER", data: null });
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
        });
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
                });
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
                });
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
                });
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
            });
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
            });
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
            scope === "round" ||
            (scope === "step" && (lastResultWasChatStream || (!runtime.lastToolCall && !runtime.lastCommand)));

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
        });

        if (shouldRetryRound && this.lastSubmittedMessage && this.getChatSendMessage()) {
            this.realMessage = this.lastSubmittedMessage;
            await this.getChatSendMessage()!({ parts: this.buildRetryParts(this.lastSubmittedMessage) });
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
            this.dispatch({ type: "SET_CURRENT_AI_MODE", mode });
            RpcApi.SetRTInfoCommand(TabRpcClient, {
                oref: this.orefContext,
                data: { "waveai:mode": mode },
            });
        }
    }

    setAIModeToDefault() {
        const defaultMode = globalStore.get(this.defaultModeAtom);
        this.dispatch({ type: "SET_CURRENT_AI_MODE", mode: defaultMode });
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
        this.dispatch({ type: "SET_CHAT_ID", chatId: chatIdValue });

        const aiModeValue = rtInfo?.["waveai:mode"];
        if (aiModeValue == null) {
            const defaultMode = globalStore.get(this.defaultModeAtom);
            this.dispatch({ type: "SET_CURRENT_AI_MODE", mode: defaultMode });
        } else if (this.isValidMode(aiModeValue)) {
            this.dispatch({ type: "SET_CURRENT_AI_MODE", mode: aiModeValue });
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

    private hasSubmittableContent(input: string, droppedFiles: DroppedFile[]): boolean {
        return hasSubmittableContentUtil(input, droppedFiles);
    }

    private isChatBusy(): boolean {
        return (
            (this.getChatStatus() !== "ready" && this.getChatStatus() !== "error") ||
            globalStore.get(this.isLoadingChatAtom)
        );
    }

    private enqueueSubmission(text: string, files: DroppedFile[]): void {
        const current = globalStore.get(this.queuedSubmissionsAtom);
        this.dispatch({
            type: "SET_QUEUED_SUBMISSIONS",
            submissions: [
                ...current,
                {
                    id: crypto.randomUUID(),
                    text,
                    files,
                    createdAt: Date.now(),
                    status: "queued" as QueuedSubmissionStatus,
                },
            ],
        });
        this.dispatch({ type: "SET_INPUT", value: "" });
        this.clearFiles();
        this.clearError();
    }

    cancelQueuedSubmission(submissionId: string): void {
        const current = globalStore.get(this.queuedSubmissionsAtom);
        this.dispatch({
            type: "SET_QUEUED_SUBMISSIONS",
            submissions: current.filter((s) => s.id !== submissionId),
        });
    }

    cancelAllQueuedSubmissions(): void {
        this.dispatch({ type: "SET_QUEUED_SUBMISSIONS", submissions: [] });
    }

    async sendQueuedSubmissionNow(submissionId: string): Promise<void> {
        const queued = globalStore.get(this.queuedSubmissionsAtom);
        const target = queued.find((s) => s.id === submissionId);
        if (!target) return;

        this.dispatch({
            type: "SET_QUEUED_SUBMISSIONS",
            submissions: queued.filter((s) => s.id !== submissionId),
        });

        if (this.isChatBusy()) {
            await this.cancelGeneration();
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 100));
                if (!this.isChatBusy()) break;
            }
        }

        await this.sendSubmission(target.text, target.files);
    }

    async flushQueuedSubmissions(): Promise<void> {
        if (this.isFlushingQueuedSubmission || this.isChatBusy()) {
            return;
        }
        const queued = globalStore.get(this.queuedSubmissionsAtom);
        const next = queued[0];
        if (!next) {
            return;
        }

        if (next.status === "canceling") {
            this.dispatch({ type: "SET_QUEUED_SUBMISSIONS", submissions: queued.slice(1) });
            void this.flushQueuedSubmissions();
            return;
        }

        this.isFlushingQueuedSubmission = true;
        this.dispatch({ type: "SET_QUEUED_SUBMISSIONS", submissions: queued.slice(1) });
        try {
            await this.sendSubmission(next.text, next.files);
        } finally {
            this.isFlushingQueuedSubmission = false;
        }
    }

    private async sendSubmission(input: string, droppedFiles: DroppedFile[]): Promise<void> {
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
                isempty: false,
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

        if (trimmedInput) {
            aiMessageParts.push({ type: "text", text: trimmedInput });
            uiMessageParts.push({ type: "text", text: trimmedInput });
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

        this.getChatSendMessage()?.({ parts: uiMessageParts });

        this.dispatch({ type: "SET_IS_CHAT_EMPTY", value: false });
    }

    async handleSubmit() {
        const input = globalStore.get(this.inputAtom);

        if (input.trim() === "/clear" || input.trim() === "/new") {
            this.clearChat();
            this.dispatch({ type: "SET_INPUT", value: "" });
            return;
        }

        const contextItems = globalStore.get(this.contextItemsAtom);
        const fileContextItems = contextItems.filter((item) => item.type === "file");
        const otherContextItems = contextItems.filter((item) => item.type !== "file");

        const contextDroppedFiles: DroppedFile[] = fileContextItems
            .filter((item) => (item.data as FileContextData).file != null)
            .map((item) => {
                const fileData = item.data as FileContextData;
                return {
                    id: item.id,
                    file: fileData.file!,
                    name: item.label,
                    type: fileData.mimetype || "application/octet-stream",
                    size: fileData.size,
                    previewUrl: fileData.previewUrl,
                };
            });

        const atomDroppedFiles = globalStore.get(this.droppedFiles);
        const allDroppedFiles = [...contextDroppedFiles, ...atomDroppedFiles];

        if (!this.hasSubmittableContent(input, allDroppedFiles) && otherContextItems.length === 0) {
            return;
        }

        let contextPrefix = "";
        if (otherContextItems.length > 0) {
            const resolvedParts: string[] = [];
            for (const item of otherContextItems) {
                const resolved = await this.resolveContextContent(item);
                if (resolved.text) {
                    resolvedParts.push(`--- ${resolved.type}: ${resolved.identifier} ---\n${resolved.text}\n--- End ${resolved.type} ---`);
                }
            }
            contextPrefix = resolvedParts.join("\n\n") + "\n\n";
        }

        const finalInput = contextPrefix + input;

        if (this.isChatBusy()) {
            this.enqueueSubmission(finalInput, allDroppedFiles);
        } else {
            await this.sendSubmission(finalInput, allDroppedFiles);
        }

        this.dispatch({ type: "SET_INPUT", value: "" });
        this.clearFiles();
        this.clearContextItems();
    }

    async uiLoadInitialChat() {
        this.dispatch({ type: "SET_IS_LOADING_CHAT", value: true });
        const messages = await this.loadInitialChat();
        this.getChatSetMessages()?.(messages);
        this.dispatch({ type: "SET_IS_LOADING_CHAT", value: false });
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
        FocusManager.getInstance().requestWaveAIFocus();
    }

    requestNodeFocus() {
        FocusManager.getInstance().requestNodeFocus();
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
        this.dispatch({ type: "SET_RESTORE_BACKUP_MODAL", toolCallId: toolcallid });
    }

    closeRestoreBackupModal() {
        this.dispatch({ type: "SET_RESTORE_BACKUP_MODAL", toolCallId: null });
        this.dispatch({ type: "SET_RESTORE_BACKUP_STATUS", status: "idle" });
        this.dispatch({ type: "SET_RESTORE_BACKUP_ERROR", error: null });
    }

    async restoreBackup(toolcallid: string, backupFilePath: string, restoreToFileName: string) {
        this.dispatch({ type: "SET_RESTORE_BACKUP_STATUS", status: "processing" });
        this.dispatch({ type: "SET_RESTORE_BACKUP_ERROR", error: null });
        try {
            await RpcApi.FileRestoreBackupCommand(TabRpcClient, {
                backupfilepath: backupFilePath,
                restoretofilename: restoreToFileName,
            });
            console.log("Backup restored successfully:", { toolcallid, backupFilePath, restoreToFileName });
            this.dispatch({ type: "SET_RESTORE_BACKUP_STATUS", status: "success" });
        } catch (error) {
            console.error("Failed to restore backup:", error);
            const errorMsg = error?.message || String(error);
            this.dispatch({ type: "SET_RESTORE_BACKUP_ERROR", error: errorMsg });
            this.dispatch({ type: "SET_RESTORE_BACKUP_STATUS", status: "error" });
        }
    }

    canCloseWaveAIPanel(): boolean {
        return true;
    }

    closeWaveAIPanel() {
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(false);
    }
}
