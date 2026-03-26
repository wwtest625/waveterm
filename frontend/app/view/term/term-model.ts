// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { appHandleKeyDown } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import type { TabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { DefaultRouter, TabRpcClient } from "@/app/store/wshrpcutil";
import { TerminalView } from "@/app/view/term/term";
import { TermWshClient } from "@/app/view/term/term-wsh";
import { VDomModel } from "@/app/view/vdom/vdom-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getBlockMetaKeyAtom,
    getBlockTermDurableAtom,
    getConnStatusAtom,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    readAtom,
    recordTEvent,
    useBlockAtom,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import { isMacOS, isWindows } from "@/util/platformutil";
import { boundNumber, fireAndForget, stringToBase64 } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import type { ShellIntegrationStatus } from "./osc-handlers";
import { getBlockingCommand } from "./shellblocking";
import { buildBackfilledTermCard } from "./term-cards-backfill";
import { normalizeQuickInputForSend } from "./term-quickinput";
import { computeTheme, DefaultTermTheme } from "./termutil";
import { TermWrap } from "./termwrap";

type TermCardState = "pending" | "streaming" | "done";

type TermCard = {
    id: string;
    cmdText: string;
    cwd?: string | null;
    createdTs: number;
    startTs: number | null;
    endTs: number | null;
    exitCode: number | null;
    state: TermCardState;
    output: string;
    outputLines: string[];
    collapsed: boolean;
};

type PendingCompletionNotification = {
    startTs: number | null;
    thresholdMs: number;
    commandText?: string | null;
};

type QueuedQuickInputDispatch = {
    data: string;
    notifyOnCompletion: boolean;
    thresholdMs: number;
    commandText: string;
};

type QuickInputRuntimeState = {
    isCurrentTermWrap: boolean;
    runtimeInfoReady: boolean;
    integrationKnown: boolean;
    integrationStatus: ShellIntegrationStatus | null;
};

const DefaultCompletionNotificationThresholdMs = 30_000;
const CompletionNotificationPresetThresholds = [10_000, 30_000, 60_000];
const CompletionNotificationLogPrefix = "[term-notify]";

function formatCompletionNotificationThreshold(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatCompletionDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
}

function truncateNotificationCommand(commandText: string | null | undefined): string {
    const normalized = (commandText ?? "").replace(/\s+/g, " ").trim();
    if (normalized === "") {
        return "命令";
    }
    if (normalized.length <= 120) {
        return normalized;
    }
    return `${normalized.slice(0, 117)}...`;
}

function logCompletionNotification(blockId: string, message: string, details?: Record<string, unknown>) {
    if (details == null) {
        console.info(`${CompletionNotificationLogPrefix}[${blockId}] ${message}`);
        return;
    }
    console.info(`${CompletionNotificationLogPrefix}[${blockId}] ${message}`, details);
}

function getNotificationElapsedMs(startTs: number | null | undefined): number | null {
    if (startTs == null) {
        return null;
    }
    return Math.max(0, Date.now() - startTs);
}

function makeCardId(ts: number): string {
    return `card-${ts}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeAnsiForCards(input: string): string {
    if (!input) {
        return "";
    }
    // remove OSC sequences (including our OSC 16162/7)
    // eslint-disable-next-line no-control-regex
    input = input.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
    // drop CSI sequences except SGR (m)
    // eslint-disable-next-line no-control-regex
    input = input.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, (seq) => (seq.endsWith("m") ? seq : ""));
    // drop other single-character ESC sequences
    // eslint-disable-next-line no-control-regex
    input = input.replace(/\x1b[@-Z\\-_]/g, "");
    input = input.replace(/\r/g, "\n");
    return input;
}

function stripAnsiForCardText(input: string): string {
    // eslint-disable-next-line no-control-regex
    return input.replace(/\x1b\[[0-9;]*m/g, "");
}

function trimLeadingCommandEcho(lines: string[], cmdText: string): string[] {
    if (lines.length === 0 || !cmdText?.trim()) {
        return lines;
    }
    const firstLine = stripAnsiForCardText(lines[0]).trim();
    const normalizedCmd = cmdText.trim();
    if (firstLine === normalizedCmd || firstLine.endsWith(` ${normalizedCmd}`) || firstLine.includes(normalizedCmd)) {
        return lines.slice(1);
    }
    return lines;
}

function isLikelyShellPromptLine(line: string): boolean {
    const text = stripAnsiForCardText(line).trim();
    if (text === "") {
        return false;
    }
    return /^[^\s@]+@[^\s:]+:[^\r\n]*[#$]$/.test(text) || /^[^\s]+[#$>]$/.test(text) || /^[A-Za-z]:\\.*>$/.test(text);
}

function normalizeCardOutputLines(lines: string[], cmdText: string, isDone: boolean): string[] {
    const nextLines = trimLeadingCommandEcho([...lines], cmdText);
    while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
        nextLines.pop();
    }
    if (isDone && nextLines.length > 0 && isLikelyShellPromptLine(nextLines[nextLines.length - 1])) {
        nextLines.pop();
    }
    return nextLines;
}

export class TermViewModel implements ViewModel {
    viewType: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    connected: boolean;
    termRef: React.RefObject<TermWrap> = { current: null };
    quickInputRef: React.RefObject<HTMLTextAreaElement> = { current: null };
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    autoTermModeAtom: jotai.PrimitiveAtom<"term" | "cards">;
    shellIntegrationAvailableAtom: jotai.PrimitiveAtom<boolean>;
    blockId: string;
    viewIcon: jotai.Atom<IconButtonDecl>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<HeaderElem[]>;
    blockBg: jotai.Atom<MetaType>;
    manageConnection: jotai.Atom<boolean>;
    filterOutNowsh?: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;
    useTermHeader: jotai.Atom<boolean>;
    termWshClient: TermWshClient;
    vdomBlockId: jotai.Atom<string>;
    vdomToolbarBlockId: jotai.Atom<string>;
    vdomToolbarTarget: jotai.PrimitiveAtom<VDomTargetToolbar>;
    fontSizeAtom: jotai.Atom<number>;
    quickInputValueAtom: jotai.PrimitiveAtom<string>;
    quickInputHistoryAtom: jotai.PrimitiveAtom<string[]>;
    quickInputHistoryIndexAtom: jotai.PrimitiveAtom<number | null>;
    quickInputNotifyEnabledAtom: jotai.PrimitiveAtom<boolean>;
    quickInputNotificationQueueAtom: jotai.PrimitiveAtom<PendingCompletionNotification[]>;
    quickInputPendingDispatchQueueAtom: jotai.PrimitiveAtom<QueuedQuickInputDispatch[]>;
    pendingCmdNotificationAtom: jotai.PrimitiveAtom<PendingCompletionNotification | null>;
    termThemeNameAtom: jotai.Atom<string>;
    termTransparencyAtom: jotai.Atom<number>;
    termBPMAtom: jotai.Atom<boolean>;
    noPadding: jotai.PrimitiveAtom<boolean>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    shellProcFullStatus: jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
    shellProcStatus: jotai.Atom<string>;
    shellProcStatusUnsubFn: () => void;
    blockJobStatusAtom: jotai.PrimitiveAtom<BlockJobStatusData>;
    blockJobStatusVersionTs: number;
    blockJobStatusUnsubFn: () => void;
    termBPMUnsubFn: () => void;
    termCursorUnsubFn: () => void;
    termCursorBlinkUnsubFn: () => void;
    isCmdController: jotai.Atom<boolean>;
    isRestarting: jotai.PrimitiveAtom<boolean>;
    termDurableStatus: jotai.Atom<BlockJobStatusData | null>;
    termConfigedDurable: jotai.Atom<null | boolean>;
    searchAtoms?: SearchAtoms;
    lastUserActivityUpdateTs: number = 0;

    cardsAtom: jotai.PrimitiveAtom<TermCard[]>;
    cardsSearchAtom: jotai.PrimitiveAtom<string>;
    cardsContextLabelAtom: jotai.PrimitiveAtom<string>;
    private cardOutputRemainder = "";
    private cardCaptureEnabled = false;
    private cardsUnsubFns: Array<() => void> = [];
    private cardsTextDecoder = new TextDecoder("utf-8", { fatal: false });
    private cardFallbackFinalizeTimer: ReturnType<typeof setTimeout> | null = null;
    private cardFallbackNoOutputTimer: ReturnType<typeof setTimeout> | null = null;
    private lastCardOutputTs = 0;

    private getPreVdomModeFromMeta(): "term" | "cards" {
        const blockData = globalStore.get(this.blockAtom);
        const pre = blockData?.meta?.["term:pre_vdom_mode"];
        return pre === "cards" ? "cards" : "term";
    }

    private getCurrentWorkingDir(): string {
        const blockData = globalStore.get(this.blockAtom);
        return blockData?.meta?.["cmd:cwd"] ?? "";
    }

    getCompletionNotificationThresholdMs(): number {
        const blockData = globalStore.get(this.blockAtom);
        const rawValue = blockData?.meta?.["cmd:notifythresholdms"];
        if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
            return DefaultCompletionNotificationThresholdMs;
        }
        return Math.max(0, Math.round(rawValue));
    }

    getCompletionNotificationThresholdLabel(): string {
        return formatCompletionNotificationThreshold(this.getCompletionNotificationThresholdMs());
    }

    isCmdCompletionNotificationEnabled(): boolean {
        const blockData = globalStore.get(this.blockAtom);
        return blockData?.meta?.["cmd:notifyoncompletion"] === true;
    }

    setQuickInputNotifyEnabled(enabled: boolean) {
        globalStore.set(this.quickInputNotifyEnabledAtom, enabled);
    }

    setCmdCompletionNotificationEnabled(enabled: boolean) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "cmd:notifyoncompletion": enabled },
        });
    }

    setCompletionNotificationThresholdMs(ms: number) {
        const normalized = Math.max(0, Math.round(ms));
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "cmd:notifythresholdms": normalized },
        });
    }

    promptForCustomCompletionNotificationThreshold() {
        const currentValue = String(this.getCompletionNotificationThresholdMs());
        const response = window.prompt("完成通知阈值（毫秒）", currentValue);
        if (response == null) {
            return;
        }
        const parsed = Number(response.trim());
        if (!Number.isFinite(parsed) || parsed < 0) {
            modalsModel.pushModal("MessageModal", { children: "请输入大于等于 0 的毫秒数。" });
            return;
        }
        this.setCompletionNotificationThresholdMs(parsed);
    }

    private async sendCompletionNotification(
        commandText: string | null | undefined,
        exitCode: number | null,
        durationMs: number
    ) {
        const uiContext = globalStore.get(atoms.uiContext);
        const workspace = globalStore.get(atoms.workspace);
        const statusText = exitCode == null ? "已完成" : exitCode === 0 ? "已成功完成" : `已结束（退出码 ${exitCode}）`;
        const body = `${truncateNotificationCommand(commandText)}\n耗时 ${formatCompletionDuration(durationMs)}`;
        const notificationOptions: WaveNotificationOptions = {
            title: `命令${statusText}`,
            body,
            clickwindowid: uiContext?.windowid,
            clickworkspaceid: workspace?.oid,
            clicktabid: globalStore.get(atoms.staticTabId),
            clickblockid: this.blockId,
        };
        logCompletionNotification(this.blockId, "sending completion notification", {
            commandText: truncateNotificationCommand(commandText),
            exitCode,
            durationMs,
            hasWindowId: notificationOptions.clickwindowid != null,
            hasWorkspaceId: notificationOptions.clickworkspaceid != null,
            hasTabId: notificationOptions.clicktabid != null,
            hasBlockId: notificationOptions.clickblockid != null,
        });
        try {
            await RpcApi.NotifyCommand(TabRpcClient, notificationOptions, { route: "electron", timeout: 2000 });
            logCompletionNotification(this.blockId, "completion notification sent");
        } catch (err) {
            logCompletionNotification(this.blockId, "completion notification failed", {
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }

    private enqueueQuickInputNotification(commandText: string, thresholdMs: number, startTs?: number | null) {
        globalStore.set(this.quickInputNotificationQueueAtom, [
            ...globalStore.get(this.quickInputNotificationQueueAtom),
            {
                startTs: startTs ?? null,
                thresholdMs,
                commandText,
            },
        ]);
    }

    private isCurrentTermWrap(termWrap: TermWrap | null | undefined): termWrap is TermWrap {
        return termWrap != null && this.termRef.current === termWrap;
    }

    private getQuickInputRuntimeState(termWrap?: TermWrap | null): QuickInputRuntimeState {
        if (!this.isCurrentTermWrap(termWrap)) {
            return {
                isCurrentTermWrap: false,
                runtimeInfoReady: false,
                integrationKnown: false,
                integrationStatus: null,
            };
        }
        return {
            isCurrentTermWrap: true,
            runtimeInfoReady: globalStore.get(termWrap.runtimeInfoReadyAtom),
            integrationKnown: globalStore.get(termWrap.shellIntegrationKnownAtom),
            integrationStatus: globalStore.get(termWrap.shellIntegrationStatusAtom),
        };
    }

    private tryFlushQueuedQuickInputDispatches(reason: string, termWrap?: TermWrap | null) {
        const runtimeState = this.getQuickInputRuntimeState(termWrap ?? this.termRef.current);
        if (!runtimeState.isCurrentTermWrap || !runtimeState.runtimeInfoReady || !runtimeState.integrationKnown) {
            return;
        }
        if (runtimeState.integrationStatus === "running-command") {
            return;
        }
        const queuedDispatches = globalStore.get(this.quickInputPendingDispatchQueueAtom);
        if (queuedDispatches.length === 0) {
            return;
        }
        globalStore.set(this.quickInputPendingDispatchQueueAtom, []);
        logCompletionNotification(this.blockId, "flushing queued quick input dispatches", {
            reason,
            queuedCount: queuedDispatches.length,
            integrationStatus: runtimeState.integrationStatus,
        });
        const integrationUnavailable = runtimeState.integrationStatus == null;
        if (integrationUnavailable) {
            modalsModel.pushModal("MessageModal", {
                children: "当前终端未启用 shell integration，输入框的完成通知无法触发。",
            });
        }
        for (const dispatch of queuedDispatches) {
            this.dispatchQuickInputSubmission(dispatch, {
                allowQueue: false,
                forceDisableNotification: integrationUnavailable,
            });
        }
    }

    private dispatchQuickInputSubmission(
        dispatch: QueuedQuickInputDispatch,
        opts?: { allowQueue?: boolean; forceDisableNotification?: boolean }
    ) {
        const allowQueue = opts?.allowQueue ?? true;
        const forceDisableNotification = opts?.forceDisableNotification ?? false;
        const termWrap = this.termRef.current;
        const runtimeState = this.getQuickInputRuntimeState(termWrap);
        if (
            dispatch.notifyOnCompletion &&
            !forceDisableNotification &&
            allowQueue &&
            (!runtimeState.runtimeInfoReady ||
                !runtimeState.integrationKnown ||
                runtimeState.integrationStatus === "running-command")
        ) {
            globalStore.set(this.quickInputPendingDispatchQueueAtom, [
                ...globalStore.get(this.quickInputPendingDispatchQueueAtom),
                dispatch,
            ]);
            logCompletionNotification(this.blockId, "queued quick input dispatch until runtime is ready", {
                queuedCount: globalStore.get(this.quickInputPendingDispatchQueueAtom).length,
                runtimeInfoReady: runtimeState.runtimeInfoReady,
                integrationKnown: runtimeState.integrationKnown,
                integrationStatus: runtimeState.integrationStatus,
                thresholdMs: dispatch.thresholdMs,
                commandText: truncateNotificationCommand(dispatch.commandText),
            });
            return;
        }
        if (dispatch.notifyOnCompletion && !forceDisableNotification) {
            logCompletionNotification(this.blockId, "arming quick input completion notification", {
                runtimeInfoReady: runtimeState.runtimeInfoReady,
                integrationKnown: runtimeState.integrationKnown,
                integrationStatus: runtimeState.integrationStatus,
                thresholdMs: dispatch.thresholdMs,
                commandText: truncateNotificationCommand(dispatch.commandText),
            });
            if (!runtimeState.isCurrentTermWrap) {
                logCompletionNotification(this.blockId, "quick input notification deferred: no active term wrap");
            } else if (runtimeState.integrationStatus == null) {
                logCompletionNotification(
                    this.blockId,
                    "quick input notification unavailable: shell integration is disabled"
                );
                modalsModel.pushModal("MessageModal", {
                    children: "当前终端未启用 shell integration，输入框的完成通知无法触发。",
                });
            } else {
                this.enqueueQuickInputNotification(dispatch.commandText, dispatch.thresholdMs);
            }
        }
        this.sendDataToController(dispatch.data);
        if (globalStore.get(this.tabModel.isTermMultiInput) && this.supportsQuickInput()) {
            this.multiInputHandler(dispatch.data);
        }
    }

    private handleQuickInputStatusChange(status: ShellIntegrationStatus | null, termWrap?: TermWrap | null) {
        if (!this.isCurrentTermWrap(termWrap ?? this.termRef.current)) {
            return;
        }
        const queue = globalStore.get(this.quickInputNotificationQueueAtom);
        const pending = queue[0];
        if (pending == null) {
            return;
        }
        logCompletionNotification(this.blockId, "quick input shell integration status changed", {
            status,
            pendingStartTs: pending.startTs,
            elapsedMs: getNotificationElapsedMs(pending.startTs),
            thresholdMs: pending.thresholdMs,
            commandText: truncateNotificationCommand(pending.commandText),
            queueLength: queue.length,
        });
        if (status === "running-command" && pending.startTs == null) {
            globalStore.set(this.quickInputNotificationQueueAtom, [
                { ...pending, startTs: Date.now() },
                ...queue.slice(1),
            ]);
            logCompletionNotification(this.blockId, "quick input notification timer started");
            return;
        }
        if (status !== "ready") {
            return;
        }
        this.completeQuickInputNotification("shell-ready");
    }

    private completeQuickInputNotification(reason: string, exitCodeOverride?: number | null) {
        const queue = globalStore.get(this.quickInputNotificationQueueAtom);
        const pending = queue[0];
        if (pending == null) {
            return;
        }
        globalStore.set(this.quickInputNotificationQueueAtom, queue.slice(1));
        const startTs = pending.startTs ?? Date.now();
        const durationMs = Math.max(0, Date.now() - startTs);
        if (durationMs < pending.thresholdMs) {
            logCompletionNotification(this.blockId, "quick input notification skipped by threshold", {
                reason,
                durationMs,
                thresholdMs: pending.thresholdMs,
            });
            return;
        }
        const activeTermWrap = this.termRef.current;
        const commandText = activeTermWrap ? globalStore.get(activeTermWrap.lastCommandAtom) : (pending.commandText ?? null);
        const exitCode =
            exitCodeOverride !== undefined
                ? exitCodeOverride
                : activeTermWrap
                  ? globalStore.get(activeTermWrap.lastCommandExitCodeAtom)
                  : null;
        logCompletionNotification(this.blockId, "quick input notification ready to send", {
            reason,
            durationMs,
            exitCode,
            commandText: truncateNotificationCommand(commandText),
        });
        fireAndForget(() => this.sendCompletionNotification(commandText, exitCode, durationMs));
    }

    private handleQuickInputExitCodeChange(
        previousExitCode: number | null,
        nextExitCode: number | null,
        termWrap?: TermWrap | null
    ) {
        if (!this.isCurrentTermWrap(termWrap ?? this.termRef.current)) {
            return;
        }
        if (nextExitCode == null || previousExitCode === nextExitCode) {
            return;
        }
        const pending = globalStore.get(this.quickInputNotificationQueueAtom)[0];
        if (pending == null || pending.startTs == null) {
            return;
        }
        const status = globalStore.get((termWrap ?? this.termRef.current).shellIntegrationStatusAtom);
        if (status !== "running-command") {
            return;
        }
        logCompletionNotification(this.blockId, "quick input exit code changed while still running", {
            previousExitCode,
            nextExitCode,
            pendingStartTs: pending.startTs,
            elapsedMs: getNotificationElapsedMs(pending.startTs),
        });
        setTimeout(() => {
            if (!this.isCurrentTermWrap(termWrap ?? this.termRef.current)) {
                return;
            }
            const currentStatus = globalStore.get((termWrap ?? this.termRef.current).shellIntegrationStatusAtom);
            if (currentStatus !== "running-command") {
                return;
            }
            this.completeQuickInputNotification("exit-code-fallback", nextExitCode);
        }, 150);
    }

    private handleCmdControllerStatusChange(
        previousStatus: string | null | undefined,
        nextStatus: string | null | undefined
    ) {
        if (!this.isCmdCompletionNotificationEnabled()) {
            if (nextStatus !== "running") {
                globalStore.set(this.pendingCmdNotificationAtom, null);
            }
            return;
        }
        if (nextStatus === "running" && previousStatus !== "running") {
            globalStore.set(this.pendingCmdNotificationAtom, {
                startTs: Date.now(),
                thresholdMs: this.getCompletionNotificationThresholdMs(),
                commandText: globalStore.get(this.blockAtom)?.meta?.cmd as string | undefined,
            });
            return;
        }
        if (nextStatus !== "done" || previousStatus === "done") {
            return;
        }
        const pending = globalStore.get(this.pendingCmdNotificationAtom);
        globalStore.set(this.pendingCmdNotificationAtom, null);
        if (pending == null) {
            return;
        }
        const durationMs = Math.max(0, Date.now() - (pending.startTs ?? Date.now()));
        if (durationMs < pending.thresholdMs) {
            return;
        }
        const exitCode = globalStore.get(this.shellProcFullStatus)?.shellprocexitcode ?? null;
        fireAndForget(() => this.sendCompletionNotification(pending.commandText, exitCode, durationMs));
    }

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.viewType = "term";
        this.blockId = blockId;
        this.tabModel = tabModel;
        this.termWshClient = new TermWshClient(blockId, this);
        DefaultRouter.registerRoute(makeFeBlockRouteId(blockId), this.termWshClient);
        this.nodeModel = nodeModel;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.vdomBlockId = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:vdomblockid"];
        });
        this.vdomToolbarBlockId = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:vdomtoolbarblockid"];
        });
        this.vdomToolbarTarget = jotai.atom<VDomTargetToolbar>(null) as jotai.PrimitiveAtom<VDomTargetToolbar>;
        this.autoTermModeAtom = useBlockAtom(blockId, "termautomode", () =>
            jotai.atom<"term" | "cards">("term")
        ) as jotai.PrimitiveAtom<"term" | "cards">;
        this.shellIntegrationAvailableAtom = useBlockAtom(blockId, "termshellintegrationavailable", () =>
            jotai.atom<boolean>(false)
        ) as jotai.PrimitiveAtom<boolean>;
        this.termMode = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const configured = blockData?.meta?.["term:mode"];
            if (configured != null) {
                if (configured === "term" || configured === "vdom" || configured === "cards") {
                    // Auto-downgrade: cards mode requires shell integration.
                    // If integration isn't available, show the normal terminal.
                    if (configured === "cards" && !get(this.shellIntegrationAvailableAtom)) {
                        return "term";
                    }
                    return configured;
                }
                return "term";
            }
            if (blockData?.meta?.controller === "cmd") {
                return "term";
            }
            return get(this.autoTermModeAtom);
        });
        this.isRestarting = jotai.atom(false);
        this.viewIcon = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return { elemtype: "iconbutton", icon: "bolt" };
            }
            if (termMode == "cards") {
                return { elemtype: "iconbutton", icon: "comment-dots" };
            }
            return { elemtype: "iconbutton", icon: "terminal" };
        });
        this.viewName = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return "Wave App";
            }
            if (blockData?.meta?.controller == "cmd") {
                return "";
            }
            return "";
        });
        this.viewText = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "square-terminal",
                        title: "Switch back to Terminal",
                        click: () => {
                            const pre = this.getPreVdomModeFromMeta();
                            RpcApi.SetMetaCommand(TabRpcClient, {
                                oref: WOS.makeORef("block", this.blockId),
                                meta: { "term:mode": pre, "term:pre_vdom_mode": null },
                            });
                        },
                    },
                ];
            }
            const vdomBlockId = get(this.vdomBlockId);
            const rtn: HeaderElem[] = [];
            if (vdomBlockId) {
                rtn.push({
                    elemtype: "iconbutton",
                    icon: "bolt",
                    title: "Switch to Wave App",
                    click: () => {
                        const configuredTermMode = get(this.termMode);
                        const pre = configuredTermMode === "cards" ? "cards" : "term";
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:pre_vdom_mode": pre, "term:mode": "vdom" },
                        });
                    },
                });
            }
            const isCmd = get(this.isCmdController);
            if (!isCmd) {
                if (termMode === "cards") {
                    rtn.push({
                        elemtype: "iconbutton",
                        icon: "terminal",
                        title: "切换到普通终端",
                        click: () => this.setTermMode("term"),
                    });
                } else {
                    rtn.push({
                        elemtype: "iconbutton",
                        icon: "comment-dots",
                        title: "切换到卡片终端",
                        click: () => this.setTermMode("cards"),
                    });
                }
            }
            if (isCmd) {
                const blockMeta = get(this.blockAtom)?.meta;
                let cmdText = blockMeta?.["cmd"];
                const cmdArgs = blockMeta?.["cmd:args"];
                if (cmdArgs != null && Array.isArray(cmdArgs) && cmdArgs.length > 0) {
                    cmdText += " " + cmdArgs.join(" ");
                }
                rtn.push({
                    elemtype: "text",
                    text: cmdText,
                    noGrow: true,
                });
                const isRestarting = get(this.isRestarting);
                if (isRestarting) {
                    rtn.push({
                        elemtype: "iconbutton",
                        icon: "refresh",
                        iconColor: "var(--success-color)",
                        iconSpin: true,
                        title: "Restarting Command",
                        noAction: true,
                    });
                } else {
                    const fullShellProcStatus = get(this.shellProcFullStatus);
                    if (fullShellProcStatus?.shellprocstatus == "done") {
                        if (fullShellProcStatus?.shellprocexitcode == 0) {
                            rtn.push({
                                elemtype: "iconbutton",
                                icon: "check",
                                iconColor: "var(--success-color)",
                                title: "Command Exited Successfully",
                                noAction: true,
                            });
                        } else {
                            rtn.push({
                                elemtype: "iconbutton",
                                icon: "xmark-large",
                                iconColor: "var(--error-color)",
                                title: "Exit Code: " + fullShellProcStatus?.shellprocexitcode,
                                noAction: true,
                            });
                        }
                    }
                }
            }
            const isMI = get(this.tabModel.isTermMultiInput);
            if (isMI && this.isBasicTerm(get)) {
                rtn.push({
                    elemtype: "textbutton",
                    text: "Multi Input ON",
                    className: "yellow !py-[2px] !px-[10px] text-[11px] font-[500]",
                    title: "Input will be sent to all connected terminals (click to disable)",
                    onClick: () => {
                        globalStore.set(this.tabModel.isTermMultiInput, false);
                    },
                });
            }
            return rtn;
        });
        this.manageConnection = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return false;
            }
            const isCmd = get(this.isCmdController);
            if (isCmd) {
                return false;
            }
            return true;
        });
        this.useTermHeader = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return false;
            }
            const isCmd = get(this.isCmdController);
            if (isCmd) {
                return false;
            }
            return true;
        });
        this.filterOutNowsh = jotai.atom(false);
        this.termBPMAtom = getOverrideConfigAtom(blockId, "term:allowbracketedpaste");
        this.termThemeNameAtom = useBlockAtom(blockId, "termthemeatom", () => {
            return jotai.atom<string>((get) => {
                return get(getOverrideConfigAtom(this.blockId, "term:theme")) ?? DefaultTermTheme;
            });
        });
        this.termTransparencyAtom = useBlockAtom(blockId, "termtransparencyatom", () => {
            return jotai.atom<number>((get) => {
                const value = get(getOverrideConfigAtom(this.blockId, "term:transparency")) ?? 0.5;
                return boundNumber(value, 0, 1);
            });
        });
        this.blockBg = jotai.atom((get) => {
            const fullConfig = get(atoms.fullConfigAtom);
            const themeName = get(this.termThemeNameAtom);
            const termTransparency = get(this.termTransparencyAtom);
            const [_, bgcolor] = computeTheme(fullConfig, themeName, termTransparency);
            if (bgcolor != null) {
                return { bg: bgcolor };
            }
            return null;
        });
        this.connStatus = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = getConnStatusAtom(connName);
            return get(connAtom);
        });
        this.fontSizeAtom = useBlockAtom(blockId, "fontsizeatom", () => {
            return jotai.atom<number>((get) => {
                const blockData = get(this.blockAtom);
                const fsSettingsAtom = getSettingsKeyAtom("term:fontsize");
                const settingsFontSize = get(fsSettingsAtom);
                const connName = blockData?.meta?.connection;
                const fullConfig = get(atoms.fullConfigAtom);
                const connFontSize = fullConfig?.connections?.[connName]?.["term:fontsize"];
                const rtnFontSize = blockData?.meta?.["term:fontsize"] ?? connFontSize ?? settingsFontSize ?? 12;
                if (typeof rtnFontSize != "number" || isNaN(rtnFontSize) || rtnFontSize < 4 || rtnFontSize > 64) {
                    return 12;
                }
                return rtnFontSize;
            });
        });
        this.quickInputValueAtom = useBlockAtom(blockId, "termquickinputvalue", () =>
            jotai.atom("")
        ) as jotai.PrimitiveAtom<string>;
        this.quickInputHistoryAtom = useBlockAtom(blockId, "termquickinputhistory", () =>
            jotai.atom<string[]>([])
        ) as jotai.PrimitiveAtom<string[]>;
        this.quickInputHistoryIndexAtom = useBlockAtom(blockId, "termquickinputhistoryindex", () =>
            jotai.atom<number | null>(null)
        ) as jotai.PrimitiveAtom<number | null>;
        this.quickInputNotifyEnabledAtom = useBlockAtom(blockId, "termquickinputnotifyenabled", () =>
            jotai.atom(false)
        ) as jotai.PrimitiveAtom<boolean>;
        this.quickInputNotificationQueueAtom = useBlockAtom(blockId, "termquickinputnotificationqueue", () =>
            jotai.atom<PendingCompletionNotification[]>([])
        ) as jotai.PrimitiveAtom<PendingCompletionNotification[]>;
        this.quickInputPendingDispatchQueueAtom = useBlockAtom(blockId, "termquickinputpendingdispatchqueue", () =>
            jotai.atom<QueuedQuickInputDispatch[]>([])
        ) as jotai.PrimitiveAtom<QueuedQuickInputDispatch[]>;
        this.pendingCmdNotificationAtom = useBlockAtom(blockId, "termpendingcmdnotification", () =>
            jotai.atom<PendingCompletionNotification | null>(null)
        ) as jotai.PrimitiveAtom<PendingCompletionNotification | null>;

        this.cardsAtom = useBlockAtom(blockId, "termcards", () => jotai.atom<TermCard[]>([])) as jotai.PrimitiveAtom<
            TermCard[]
        >;
        this.cardsSearchAtom = useBlockAtom(blockId, "termcardssearch", () =>
            jotai.atom("")
        ) as jotai.PrimitiveAtom<string>;
        this.cardsContextLabelAtom = useBlockAtom(blockId, "termcardscontextlabel", () =>
            jotai.atom("")
        ) as jotai.PrimitiveAtom<string>;
        this.noPadding = jotai.atom(true);
        this.endIconButtons = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const shellProcStatus = get(this.shellProcStatus);
            const connStatus = get(this.connStatus);
            const isCmd = get(this.isCmdController);
            const rtn: IconButtonDecl[] = [];

            const isAIPanelOpen = get(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
            if (isAIPanelOpen) {
                const shellIntegrationButton = this.getShellIntegrationIconButton(get);
                if (shellIntegrationButton) {
                    rtn.push(shellIntegrationButton);
                }
            }

            if (blockData?.meta?.["controller"] != "cmd" && shellProcStatus != "done") {
                return rtn;
            }
            if (connStatus?.status != "connected") {
                return rtn;
            }
            let iconName: string = null;
            let title: string = null;
            const noun = isCmd ? "Command" : "Shell";
            if (shellProcStatus == "init") {
                iconName = "play";
                title = "Click to Start " + noun;
            } else if (shellProcStatus == "running") {
                iconName = "refresh";
                title = noun + " Running. Click to Restart";
            } else if (shellProcStatus == "done") {
                iconName = "refresh";
                title = noun + " Exited. Click to Restart";
            }
            if (iconName != null) {
                const buttonDecl: IconButtonDecl = {
                    elemtype: "iconbutton",
                    icon: iconName,
                    click: () => fireAndForget(() => this.forceRestartController()),
                    title: title,
                };
                rtn.push(buttonDecl);
            }
            return rtn;
        });
        this.isCmdController = jotai.atom((get) => {
            const controllerMetaAtom = getBlockMetaKeyAtom(this.blockId, "controller");
            return get(controllerMetaAtom) == "cmd";
        });
        this.shellProcFullStatus = jotai.atom(null) as jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
        const initialShellProcStatus = services.BlockService.GetControllerStatus(blockId);
        initialShellProcStatus.then((rts) => {
            this.updateShellProcStatus(rts);
        });
        this.shellProcStatusUnsubFn = waveEventSubscribeSingle({
            eventType: "controllerstatus",
            scope: WOS.makeORef("block", blockId),
            handler: (event) => {
                this.updateShellProcStatus(event.data);
            },
        });
        this.shellProcStatus = jotai.atom((get) => {
            const fullStatus = get(this.shellProcFullStatus);
            return fullStatus?.shellprocstatus ?? "init";
        });
        this.termDurableStatus = jotai.atom((get) => {
            const isDurable = get(getBlockTermDurableAtom(this.blockId));
            if (!isDurable) {
                return null;
            }
            const blockJobStatus = get(this.blockJobStatusAtom);
            if (blockJobStatus?.jobid == null || blockJobStatus?.status == null) {
                return null;
            }
            return blockJobStatus;
        });
        this.termConfigedDurable = getBlockTermDurableAtom(this.blockId);
        this.blockJobStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<BlockJobStatusData>;
        this.blockJobStatusVersionTs = 0;
        const initialBlockJobStatus = RpcApi.BlockJobStatusCommand(TabRpcClient, blockId);
        initialBlockJobStatus
            .then((status) => {
                this.handleBlockJobStatusUpdate(status);
            })
            .catch((error) => {
                console.log("error getting initial block job status", error);
            });
        this.blockJobStatusUnsubFn = waveEventSubscribeSingle({
            eventType: "block:jobstatus",
            scope: `block:${blockId}`,
            handler: (event) => {
                this.handleBlockJobStatusUpdate(event.data);
            },
        });
        this.termBPMUnsubFn = globalStore.sub(this.termBPMAtom, () => {
            if (this.termRef.current?.terminal) {
                const allowBPM = globalStore.get(this.termBPMAtom) ?? true;
                this.termRef.current.terminal.options.ignoreBracketedPasteMode = !allowBPM;
            }
        });
        const termCursorAtom = getOverrideConfigAtom(blockId, "term:cursor");
        this.termCursorUnsubFn = globalStore.sub(termCursorAtom, () => {
            if (this.termRef.current?.terminal) {
                this.termRef.current.setCursorStyle(globalStore.get(termCursorAtom));
            }
        });
        const termCursorBlinkAtom = getOverrideConfigAtom(blockId, "term:cursorblink");
        this.termCursorBlinkUnsubFn = globalStore.sub(termCursorBlinkAtom, () => {
            if (this.termRef.current?.terminal) {
                this.termRef.current.setCursorBlink(globalStore.get(termCursorBlinkAtom) ?? false);
            }
        });
    }

    getShellIntegrationIconButton(get: jotai.Getter): IconButtonDecl | null {
        if (!this.termRef.current?.shellIntegrationStatusAtom) {
            return null;
        }
        const shellIntegrationStatus = get(this.termRef.current.shellIntegrationStatusAtom);
        if (shellIntegrationStatus == null) {
            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-muted",
                title: "No shell integration — Wave AI unable to run commands.",
                noAction: true,
            };
        }
        if (shellIntegrationStatus === "ready") {
            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-accent",
                title: "Shell ready — Wave AI can run commands in this terminal.",
                noAction: true,
            };
        }
        if (shellIntegrationStatus === "running-command") {
            let title = "Shell busy — Wave AI unable to run commands while another command is running.";

            if (this.termRef.current) {
                const inAltBuffer = this.termRef.current.terminal?.buffer?.active?.type === "alternate";
                const lastCommand = get(this.termRef.current.lastCommandAtom);
                const blockingCmd = getBlockingCommand(lastCommand, inAltBuffer);
                if (blockingCmd) {
                    title = `Wave AI integration disabled while you're inside ${blockingCmd}.`;
                }
            }

            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-warning",
                title: title,
                noAction: true,
            };
        }
        return null;
    }

    get viewComponent(): ViewComponent {
        return TerminalView as ViewComponent;
    }

    isBasicTerm(getFn: jotai.Getter): boolean {
        const termMode = getFn(this.termMode);
        if (termMode == "vdom") {
            return false;
        }
        const blockData = getFn(this.blockAtom);
        if (blockData?.meta?.controller == "cmd") {
            return false;
        }
        return true;
    }

    multiInputHandler(data: string) {
        const tvms = getAllBasicTermModels();
        for (const tvm of tvms) {
            if (tvm != this) {
                tvm.sendDataToController(data);
            }
        }
    }

    sendDataToController(data: string) {
        const now = Date.now();
        if (now - this.lastUserActivityUpdateTs >= 1000) {
            this.lastUserActivityUpdateTs = now;
            RpcApi.SetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
                data: { "term:lastuserinputts": now },
            });
        }
        const b64data = stringToBase64(data);
        RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, inputdata64: b64data });
    }

    attachToTermWrap(termWrap: TermWrap | null) {
        this.cardsUnsubFns.forEach((fn) => fn());
        this.cardsUnsubFns = [];
        this.cardOutputRemainder = "";
        this.cardCaptureEnabled = false;
        if (this.cardFallbackFinalizeTimer) {
            clearTimeout(this.cardFallbackFinalizeTimer);
            this.cardFallbackFinalizeTimer = null;
        }
        if (this.cardFallbackNoOutputTimer) {
            clearTimeout(this.cardFallbackNoOutputTimer);
            this.cardFallbackNoOutputTimer = null;
        }

        if (!termWrap) {
            return;
        }

        globalStore.set(this.cardsContextLabelAtom, globalStore.get(termWrap.contextLabelAtom) ?? "");

        this.cardsUnsubFns.push(
            globalStore.sub(termWrap.contextLabelAtom, () => {
                const nextLabel = globalStore.get(termWrap.contextLabelAtom) ?? "";
                globalStore.set(this.cardsContextLabelAtom, nextLabel);
            })
        );

        this.cardsUnsubFns.push(
            globalStore.sub(termWrap.runtimeInfoReadyAtom, () => {
                if (globalStore.get(termWrap.runtimeInfoReadyAtom)) {
                    this.tryFlushQueuedQuickInputDispatches("runtime-ready", termWrap);
                }
            })
        );

        this.cardsUnsubFns.push(
            globalStore.sub(termWrap.shellIntegrationKnownAtom, () => {
                this.tryFlushQueuedQuickInputDispatches("shell-known-change", termWrap);
                const integrationKnown = globalStore.get(termWrap.shellIntegrationKnownAtom);
                const status = globalStore.get(termWrap.shellIntegrationStatusAtom);
                if (!integrationKnown) {
                    return;
                }
                const hasIntegration = status != null;
                globalStore.set(this.shellIntegrationAvailableAtom, hasIntegration);
                globalStore.set(this.autoTermModeAtom, hasIntegration ? "cards" : "term");
            })
        );

        this.cardsUnsubFns.push(
            globalStore.sub(termWrap.shellIntegrationStatusAtom, () => {
                const status = globalStore.get(termWrap.shellIntegrationStatusAtom);
                this.handleQuickInputStatusChange(status, termWrap);
                this.tryFlushQueuedQuickInputDispatches("shell-status-change", termWrap);
                const integrationKnown = globalStore.get(termWrap.shellIntegrationKnownAtom);
                if (!integrationKnown) {
                    return;
                }
                const hasIntegration = status != null;
                globalStore.set(this.shellIntegrationAvailableAtom, hasIntegration);
                globalStore.set(this.autoTermModeAtom, hasIntegration ? "cards" : "term");
                if (status === "running-command") {
                    const termMode = globalStore.get(this.termMode);
                    if (termMode !== "cards") {
                        return;
                    }
                    const inAltBuffer = termWrap.terminal?.buffer?.active?.type === "alternate";
                    const lastCommand = globalStore.get(termWrap.lastCommandAtom);
                    const blockingCmd = getBlockingCommand(lastCommand, inAltBuffer);
                    if (blockingCmd) {
                        this.markLastPendingCardAsInteractive(blockingCmd);
                        this.setTermMode("term");
                        return;
                    }
                    this.beginCardFromShellIntegration();
                    this.cardCaptureEnabled = true;
                    return;
                }
                if (status === "ready") {
                    this.finalizeActiveCard();
                    this.cardCaptureEnabled = false;
                }
            })
        );

        let previousExitCode = globalStore.get(termWrap.lastCommandExitCodeAtom);
        this.cardsUnsubFns.push(
            globalStore.sub(termWrap.lastCommandExitCodeAtom, () => {
                const nextExitCode = globalStore.get(termWrap.lastCommandExitCodeAtom);
                this.handleQuickInputExitCodeChange(previousExitCode, nextExitCode, termWrap);
                previousExitCode = nextExitCode;
            })
        );

        this.tryFlushQueuedQuickInputDispatches("attach-termwrap", termWrap);
    }

    prepareCardsMode(termWrap: TermWrap) {
        if (!globalStore.get(termWrap.runtimeInfoReadyAtom)) {
            return;
        }

        if (!globalStore.get(termWrap.shellIntegrationKnownAtom)) {
            return;
        }

        const integrationStatus = globalStore.get(termWrap.shellIntegrationStatusAtom);
        if (integrationStatus == null) {
            globalStore.set(this.shellIntegrationAvailableAtom, false);
            globalStore.set(this.autoTermModeAtom, "term");
            return;
        }

        globalStore.set(this.shellIntegrationAvailableAtom, true);
        globalStore.set(this.autoTermModeAtom, "cards");

        const lastCommand = globalStore.get(termWrap.lastCommandAtom);
        const inAltBuffer = termWrap.terminal?.buffer?.active?.type === "alternate";
        const blockingCmd = getBlockingCommand(lastCommand, inAltBuffer);
        if (blockingCmd) {
            this.markLastPendingCardAsInteractive(blockingCmd);
            this.setTermMode("term");
            return;
        }

        const cards = globalStore.get(this.cardsAtom) ?? [];
        if (cards.length > 0) {
            this.cardCaptureEnabled = integrationStatus === "running-command";
            return;
        }

        const backfilledCard = buildBackfilledTermCard({
            buffer: termWrap.terminal.buffer.active,
            cmdText: lastCommand,
            cwd: this.getCurrentWorkingDir(),
            createdTs: Date.now(),
            exitCode: globalStore.get(termWrap.lastCommandExitCodeAtom),
            promptMarkers: termWrap.promptMarkers,
            shellIntegrationStatus: integrationStatus,
        });
        if (backfilledCard == null) {
            return;
        }

        globalStore.set(this.cardsAtom, [backfilledCard]);
        if (integrationStatus === "running-command") {
            this.cardCaptureEnabled = true;
            this.lastCardOutputTs = Date.now();
        }
    }

    private markLastPendingCardAsInteractive(blockingCmd: string) {
        const cards = globalStore.get(this.cardsAtom) ?? [];
        const lastIdx = cards.length - 1;
        if (lastIdx < 0 || cards[lastIdx].state !== "pending") {
            return;
        }
        const now = Date.now();
        const card = cards[lastIdx];
        const next: TermCard = {
            ...card,
            startTs: now,
            endTs: now,
            state: "done",
            output: `\nEntered interactive mode (${blockingCmd}). Switched back to the normal terminal.\n`,
            outputLines: [`Entered interactive mode (${blockingCmd}). Switched back to the normal terminal.`],
        };
        const nextCards = [...cards];
        nextCards[lastIdx] = next;
        globalStore.set(this.cardsAtom, nextCards);
    }

    handleControllerOutputChunk(data: Uint8Array) {
        if (globalStore.get(this.termMode) !== "cards") {
            return;
        }
        const activeId = this.getActiveCardId();
        if (!this.cardCaptureEnabled && activeId == null) {
            return;
        }
        const targetCardId = activeId;
        if (!targetCardId) {
            return;
        }

        const text = this.cardsTextDecoder.decode(data, { stream: true });
        const sanitized = sanitizeAnsiForCards(text);
        if (!sanitized) {
            return;
        }
        this.lastCardOutputTs = Date.now();
        this.appendOutputToCard(targetCardId, sanitized);

        const termWrap = this.termRef.current;
        const integrationStatus = termWrap ? globalStore.get(termWrap.shellIntegrationStatusAtom) : null;
        if (integrationStatus == null) {
            this.scheduleFallbackFinalize();
        }
    }

    private scheduleFallbackFinalize() {
        if (this.cardFallbackFinalizeTimer) {
            clearTimeout(this.cardFallbackFinalizeTimer);
        }
        this.cardFallbackFinalizeTimer = setTimeout(() => {
            this.cardFallbackFinalizeTimer = null;
            const termWrap = this.termRef.current;
            const integrationStatus = termWrap ? globalStore.get(termWrap.shellIntegrationStatusAtom) : null;
            if (integrationStatus != null) {
                return;
            }
            if (Date.now() - this.lastCardOutputTs < 650) {
                this.scheduleFallbackFinalize();
                return;
            }
            this.finalizeActiveCard();
            this.cardCaptureEnabled = false;
        }, 650);
    }

    private getActiveCardId(): string | null {
        const cards = globalStore.get(this.cardsAtom) ?? [];
        for (let i = cards.length - 1; i >= 0; i--) {
            const c = cards[i];
            if (c.state === "streaming" || c.state === "pending") {
                return c.id;
            }
        }
        return null;
    }

    private beginCardFromShellIntegration() {
        const termWrap = this.termRef.current;
        const cmdText = termWrap ? globalStore.get(termWrap.lastCommandAtom) : null;
        const now = Date.now();
        const cards = globalStore.get(this.cardsAtom) ?? [];

        const lastIdx = cards.length - 1;
        if (lastIdx >= 0 && cards[lastIdx].state === "pending") {
            const pending = cards[lastIdx];
            const next: TermCard = {
                ...pending,
                cmdText: cmdText ?? pending.cmdText,
                startTs: now,
                state: "streaming",
            };
            const nextCards = [...cards];
            nextCards[lastIdx] = next;
            globalStore.set(this.cardsAtom, nextCards);
            return;
        }

        const card: TermCard = {
            id: makeCardId(now),
            cmdText: cmdText ?? "",
            cwd: this.getCurrentWorkingDir(),
            createdTs: now,
            startTs: now,
            endTs: null,
            exitCode: null,
            state: "streaming",
            output: "",
            outputLines: [],
            collapsed: true,
        };
        globalStore.set(this.cardsAtom, [...cards, card]);
    }

    private finalizeActiveCard() {
        const termWrap = this.termRef.current;
        const exitCode = termWrap ? globalStore.get(termWrap.lastCommandExitCodeAtom) : null;
        const now = Date.now();
        const cards = globalStore.get(this.cardsAtom) ?? [];
        const idx = [...cards].reverse().findIndex((c) => c.state === "streaming");
        if (idx === -1) {
            return;
        }
        const realIdx = cards.length - 1 - idx;
        const card = cards[realIdx];
        const normalizedOutputLines = normalizeCardOutputLines(card.outputLines, card.cmdText, true);
        const next: TermCard = {
            ...card,
            endTs: now,
            exitCode: exitCode ?? null,
            state: "done",
            output: normalizedOutputLines.join("\n"),
            outputLines: normalizedOutputLines,
        };
        const nextCards = [...cards];
        nextCards[realIdx] = next;
        globalStore.set(this.cardsAtom, nextCards);
    }

    private appendOutputToCard(cardId: string, chunk: string) {
        const cards = globalStore.get(this.cardsAtom) ?? [];
        const idx = cards.findIndex((c) => c.id === cardId);
        if (idx === -1) {
            return;
        }
        const card = cards[idx];
        const combined = card.output + chunk;
        const lines = combined.split("\n");
        const normalizedLines = normalizeCardOutputLines(lines, card.cmdText, false);
        const cappedLines =
            normalizedLines.length > 2000 ? normalizedLines.slice(normalizedLines.length - 2000) : normalizedLines;
        const cappedOutput = cappedLines.join("\n");
        const next: TermCard = {
            ...card,
            output: cappedOutput,
            outputLines: cappedLines,
        };
        const nextCards = [...cards];
        nextCards[idx] = next;
        globalStore.set(this.cardsAtom, nextCards);
    }

    supportsQuickInput(): boolean {
        const termMode = globalStore.get(this.termMode);
        const blockData = globalStore.get(this.blockAtom);
        return termMode != "vdom" && blockData?.meta?.controller != "cmd";
    }

    private setQuickInputValueInternal(value: string, historyIndex: number | null) {
        globalStore.set(this.quickInputValueAtom, value ?? "");
        globalStore.set(this.quickInputHistoryIndexAtom, historyIndex);
    }

    setQuickInputValue(value: string) {
        this.setQuickInputValueInternal(value, null);
    }

    navigateQuickInputHistory(direction: "prev" | "next"): boolean {
        const history = globalStore.get(this.quickInputHistoryAtom);
        if (history.length === 0) {
            return false;
        }
        const currentIndex = globalStore.get(this.quickInputHistoryIndexAtom);
        if (direction === "prev") {
            const nextIndex = currentIndex == null ? history.length - 1 : Math.max(0, currentIndex - 1);
            this.setQuickInputValueInternal(history[nextIndex], nextIndex);
            return true;
        }
        if (currentIndex == null) {
            return false;
        }
        if (currentIndex >= history.length - 1) {
            this.setQuickInputValueInternal("", null);
            return true;
        }
        const nextIndex = currentIndex + 1;
        this.setQuickInputValueInternal(history[nextIndex], nextIndex);
        return true;
    }

    private appendQuickInputHistory(value: string) {
        const commandText = value.replace(/[\r\n]+$/, "");
        if (commandText.trim() === "") {
            return;
        }
        globalStore.set(this.quickInputHistoryAtom, [...globalStore.get(this.quickInputHistoryAtom), commandText]);
        globalStore.set(this.quickInputHistoryIndexAtom, null);
    }

    focusQuickInput(): boolean {
        if (!this.supportsQuickInput()) {
            return false;
        }
        this.nodeModel.focusNode();
        const inputElem = this.quickInputRef.current;
        if (inputElem == null) {
            return false;
        }
        requestAnimationFrame(() => {
            inputElem.focus();
            const length = inputElem.value.length;
            inputElem.setSelectionRange(length, length);
        });
        return true;
    }

    submitQuickInput(): boolean {
        const data = normalizeQuickInputForSend(globalStore.get(this.quickInputValueAtom));
        if (data == null) {
            return false;
        }
        this.appendQuickInputHistory(data);
        this.dispatchQuickInputSubmission({
            data,
            notifyOnCompletion: globalStore.get(this.quickInputNotifyEnabledAtom),
            thresholdMs: this.getCompletionNotificationThresholdMs(),
            commandText: data.trim(),
        });
        globalStore.set(this.quickInputNotifyEnabledAtom, false);
        this.setQuickInputValueInternal("", null);
        return true;
    }

    setTermMode(mode: "term" | "vdom" | "cards") {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:mode": mode },
        });
    }

    setCardsContextLabel(label: string) {
        const next = label ?? "";
        globalStore.set(this.cardsContextLabelAtom, next);
        if (this.termRef.current?.contextLabelAtom) {
            globalStore.set(this.termRef.current.contextLabelAtom, next);
        }
        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            data: { "term:contextlabel": next } as any,
        });
    }

    createPendingCard(cmdText: string) {
        if (!cmdText?.trim()) {
            return;
        }
        const now = Date.now();
        const card: TermCard = {
            id: makeCardId(now),
            cmdText,
            cwd: this.getCurrentWorkingDir(),
            createdTs: now,
            startTs: null,
            endTs: null,
            exitCode: null,
            state: "pending",
            output: "",
            outputLines: [],
            collapsed: true,
        };
        const cards = globalStore.get(this.cardsAtom) ?? [];
        globalStore.set(this.cardsAtom, [...cards, card]);
        this.cardCaptureEnabled = true;
        this.lastCardOutputTs = now;

        const termWrap = this.termRef.current;
        const integrationStatus = termWrap ? globalStore.get(termWrap.shellIntegrationStatusAtom) : null;
        if (integrationStatus == null) {
            if (this.cardFallbackNoOutputTimer) {
                clearTimeout(this.cardFallbackNoOutputTimer);
            }
            this.cardFallbackNoOutputTimer = setTimeout(() => {
                this.cardFallbackNoOutputTimer = null;
                const activeId = this.getActiveCardId();
                if (!activeId) {
                    return;
                }
                const cards = globalStore.get(this.cardsAtom) ?? [];
                const active = cards.find((c) => c.id === activeId);
                if (active?.outputLines?.length) {
                    return;
                }
                this.finalizeActiveCard();
                this.cardCaptureEnabled = false;
            }, 2500);
        }
    }

    triggerRestartAtom() {
        globalStore.set(this.isRestarting, true);
        setTimeout(() => {
            globalStore.set(this.isRestarting, false);
        }, 300);
    }

    handleBlockJobStatusUpdate(status: BlockJobStatusData) {
        if (status?.versionts == null) {
            return;
        }
        if (status.versionts <= this.blockJobStatusVersionTs) {
            return;
        }
        this.blockJobStatusVersionTs = status.versionts;
        globalStore.set(this.blockJobStatusAtom, status);
    }

    updateShellProcStatus(fullStatus: BlockControllerRuntimeStatus) {
        if (fullStatus == null) {
            return;
        }
        const curStatus = globalStore.get(this.shellProcFullStatus);
        if (curStatus == null || curStatus.version < fullStatus.version) {
            globalStore.set(this.shellProcFullStatus, fullStatus);
            if (globalStore.get(this.isCmdController)) {
                this.handleCmdControllerStatusChange(curStatus?.shellprocstatus, fullStatus.shellprocstatus);
            }
        }
    }

    getVDomModel(): VDomModel {
        const vdomBlockId = globalStore.get(this.vdomBlockId);
        if (!vdomBlockId) {
            return null;
        }
        const bcm = getBlockComponentModel(vdomBlockId);
        if (!bcm) {
            return null;
        }
        return bcm.viewModel as VDomModel;
    }

    getVDomToolbarModel(): VDomModel {
        const vdomToolbarBlockId = globalStore.get(this.vdomToolbarBlockId);
        if (!vdomToolbarBlockId) {
            return null;
        }
        const bcm = getBlockComponentModel(vdomToolbarBlockId);
        if (!bcm) {
            return null;
        }
        return bcm.viewModel as VDomModel;
    }

    dispose() {
        DefaultRouter.unregisterRoute(makeFeBlockRouteId(this.blockId));
        this.cardsUnsubFns.forEach((fn) => fn());
        this.shellProcStatusUnsubFn?.();
        this.blockJobStatusUnsubFn?.();
        this.termBPMUnsubFn?.();
        this.termCursorUnsubFn?.();
        this.termCursorBlinkUnsubFn?.();
    }

    giveFocus(): boolean {
        if (this.searchAtoms && globalStore.get(this.searchAtoms.isOpen)) {
            console.log("search is open, not giving focus");
            return true;
        }
        const termMode = globalStore.get(this.termMode);
        if (termMode == "term") {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.focus();
                return true;
            }
        }
        return false;
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:r")) {
            const shellIntegrationStatus = readAtom(this.termRef?.current?.shellIntegrationStatusAtom);
            if (shellIntegrationStatus === "ready") {
                recordTEvent("action:term", { "action:type": "term:ctrlr" });
            }
            // just for telemetry, we allow this keybinding through, back to the terminal
            return false;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:Escape")) {
            const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${this.blockId}`);
            const blockData = globalStore.get(blockAtom);
            const curMode = blockData?.meta?.["term:mode"];
            const newTermMode = curMode == "vdom" ? this.getPreVdomModeFromMeta() : "vdom";
            const vdomBlockId = globalStore.get(this.vdomBlockId);
            if (newTermMode == "vdom" && !vdomBlockId) {
                return;
            }
            if (newTermMode === "vdom") {
                const termMode = globalStore.get(this.termMode);
                const pre = termMode === "cards" ? "cards" : "term";
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:pre_vdom_mode": pre, "term:mode": "vdom" },
                });
            } else {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:mode": newTermMode, "term:pre_vdom_mode": null },
                });
            }
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:End")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollToBottom();
            }
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:Home")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollToLine(0);
            }
            return true;
        }
        if (isMacOS() && keyutil.checkKeyPressed(waveEvent, "Cmd:End")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollToBottom();
            }
            return true;
        }
        if (isMacOS() && keyutil.checkKeyPressed(waveEvent, "Cmd:Home")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollToLine(0);
            }
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:PageDown")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollPages(1);
            }
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:PageUp")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollPages(-1);
            }
            return true;
        }
        const blockData = globalStore.get(this.blockAtom);
        if (blockData.meta?.["term:mode"] == "vdom") {
            const vdomModel = this.getVDomModel();
            return vdomModel?.keyDownHandler(waveEvent);
        }
        return false;
    }

    shouldHandleCtrlVPaste(): boolean {
        // macOS never uses Ctrl-V for paste (uses Cmd-V)
        if (isMacOS()) {
            return false;
        }

        // Get the app:ctrlvpaste setting
        const ctrlVPasteAtom = getSettingsKeyAtom("app:ctrlvpaste");
        const ctrlVPasteSetting = globalStore.get(ctrlVPasteAtom);

        // If setting is explicitly set, use it
        if (ctrlVPasteSetting != null) {
            return ctrlVPasteSetting;
        }

        // Default behavior: Windows=true, Linux/other=false
        return isWindows();
    }

    handleTerminalKeydown(event: KeyboardEvent): boolean {
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
        if (waveEvent.type != "keydown") {
            return true;
        }

        // Handle Escape key during IME composition
        if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
            if (this.termRef.current?.isComposing) {
                // Reset composition state when Escape is pressed during composition
                this.termRef.current.resetCompositionState();
            }
        }

        if (this.keyDownHandler(waveEvent)) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }

        if (isMacOS()) {
            if (keyutil.checkKeyPressed(waveEvent, "Cmd:ArrowLeft")) {
                this.sendDataToController("\x01"); // Ctrl-A (beginning of line)
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Cmd:ArrowRight")) {
                this.sendDataToController("\x05"); // Ctrl-E (end of line)
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:Enter")) {
            const shiftEnterNewlineAtom = getOverrideConfigAtom(this.blockId, "term:shiftenternewline");
            const shiftEnterNewlineEnabled = globalStore.get(shiftEnterNewlineAtom) ?? true;
            if (shiftEnterNewlineEnabled) {
                this.sendDataToController("\n");
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        }

        // Check for Ctrl-V paste (platform-dependent)
        if (this.shouldHandleCtrlVPaste() && keyutil.checkKeyPressed(waveEvent, "Ctrl:v")) {
            event.preventDefault();
            event.stopPropagation();
            getApi().nativePaste();
            return false;
        }

        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:v")) {
            event.preventDefault();
            event.stopPropagation();
            getApi().nativePaste();
            // this.termRef.current?.pasteHandler();
            return false;
        } else if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:c")) {
            event.preventDefault();
            event.stopPropagation();
            const sel = this.termRef.current?.terminal.getSelection();
            if (!sel) {
                return false;
            }
            navigator.clipboard.writeText(sel);
            return false;
        } else if (keyutil.checkKeyPressed(waveEvent, "Cmd:k")) {
            event.preventDefault();
            event.stopPropagation();
            this.termRef.current?.terminal?.clear();
            return false;
        }
        const shellProcStatus = globalStore.get(this.shellProcStatus);
        if ((shellProcStatus == "done" || shellProcStatus == "init") && keyutil.checkKeyPressed(waveEvent, "Enter")) {
            fireAndForget(() => this.forceRestartController());
            return false;
        }
        const appHandled = appHandleKeyDown(waveEvent);
        if (appHandled) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        return true;
    }

    setTerminalTheme(themeName: string) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:theme": themeName },
        });
    }

    async forceRestartController() {
        if (globalStore.get(this.isRestarting)) {
            return;
        }
        globalStore.set(this.quickInputNotificationQueueAtom, []);
        globalStore.set(this.pendingCmdNotificationAtom, null);
        this.triggerRestartAtom();
        await RpcApi.ControllerDestroyCommand(TabRpcClient, this.blockId);
        const termsize = {
            rows: this.termRef.current?.terminal?.rows,
            cols: this.termRef.current?.terminal?.cols,
        };
        await RpcApi.ControllerResyncCommand(TabRpcClient, {
            tabid: globalStore.get(atoms.staticTabId),
            blockid: this.blockId,
            forcerestart: true,
            rtopts: { termsize: termsize },
        });
    }

    async restartSessionWithDurability(isDurable: boolean) {
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:durable": isDurable },
        });
        await RpcApi.ControllerDestroyCommand(TabRpcClient, this.blockId);
        const termsize = {
            rows: this.termRef.current?.terminal?.rows,
            cols: this.termRef.current?.terminal?.cols,
        };
        await RpcApi.ControllerResyncCommand(TabRpcClient, {
            tabid: globalStore.get(atoms.staticTabId),
            blockid: this.blockId,
            forcerestart: true,
            rtopts: { termsize: termsize },
        });
    }

    getContextMenuItems(): ContextMenuItem[] {
        const menu: ContextMenuItem[] = [];
        const hasSelection = this.termRef.current?.terminal?.hasSelection();
        const selection = hasSelection ? this.termRef.current?.terminal.getSelection() : null;

        if (hasSelection) {
            menu.push({
                label: "复制",
                click: () => {
                    if (selection) {
                        navigator.clipboard.writeText(selection);
                    }
                },
            });
            menu.push({ type: "separator" });
            menu.push({
                label: "发送到 Wave AI",
                click: () => {
                    if (selection) {
                        const aiModel = WaveAIModel.getInstance();
                        aiModel.appendText(selection, true, { scrollToBottom: true });
                        const layoutModel = WorkspaceLayoutModel.getInstance();
                        if (!layoutModel.getAIPanelVisible()) {
                            layoutModel.setAIPanelVisible(true);
                        }
                        aiModel.focusInput();
                    }
                },
            });

            menu.push({ type: "separator" });
        }

        const hoveredLinkUri = this.termRef.current?.hoveredLinkUri;
        if (hoveredLinkUri) {
            let hoveredURL: URL = null;
            try {
                hoveredURL = new URL(hoveredLinkUri);
            } catch {
                // not a valid URL
            }
            if (hoveredURL) {
                menu.push({
                    label: hoveredURL.hostname ? "打开链接 (" + hoveredURL.hostname + ")" : "打开链接",
                    click: () => {
                        createBlock({
                            meta: {
                                view: "web",
                                url: hoveredURL.toString(),
                            },
                        });
                    },
                });
                menu.push({
                    label: "在外部浏览器打开",
                    click: () => {
                        getApi().openExternal(hoveredURL.toString());
                    },
                });
                menu.push({ type: "separator" });
            }
        }

        menu.push({
            label: "粘贴",
            click: () => {
                getApi().nativePaste();
            },
        });

        menu.push({ type: "separator" });

        const magnified = globalStore.get(this.nodeModel.isMagnified);
        menu.push({
            label: magnified ? "取消放大" : "放大块",
            click: () => {
                this.nodeModel.toggleMagnify();
            },
        });

        menu.push({ type: "separator" });

        const settingsItems = this.getSettingsMenuItems();
        menu.push(...settingsItems);

        return menu;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemes = fullConfig?.termthemes ?? {};
        const termThemeKeys = Object.keys(termThemes);
        const curThemeName = globalStore.get(getBlockMetaKeyAtom(this.blockId, "term:theme"));
        const defaultFontSize = globalStore.get(getSettingsKeyAtom("term:fontsize")) ?? 12;
        const defaultAllowBracketedPaste = globalStore.get(getSettingsKeyAtom("term:allowbracketedpaste")) ?? true;
        const transparencyMeta = globalStore.get(getBlockMetaKeyAtom(this.blockId, "term:transparency"));
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["term:fontsize"];

        termThemeKeys.sort((a, b) => {
            return (termThemes[a]["display:order"] ?? 0) - (termThemes[b]["display:order"] ?? 0);
        });
        const defaultTermBlockDef: BlockDef = {
            meta: {
                view: "term",
                controller: "shell",
            },
        };

        const fullMenu: ContextMenuItem[] = [];
        fullMenu.push({
            label: "水平分割",
            click: () => {
                const blockData = globalStore.get(this.blockAtom);
                const blockDef: BlockDef = {
                    meta: blockData?.meta || defaultTermBlockDef.meta,
                };
                createBlockSplitHorizontally(blockDef, this.blockId, "after");
            },
        });
        fullMenu.push({
            label: "垂直分割",
            click: () => {
                const blockData = globalStore.get(this.blockAtom);
                const blockDef: BlockDef = {
                    meta: blockData?.meta || defaultTermBlockDef.meta,
                };
                createBlockSplitVertically(blockDef, this.blockId, "after");
            },
        });
        fullMenu.push({ type: "separator" });

        const shellIntegrationStatus = globalStore.get(this.termRef?.current?.shellIntegrationStatusAtom);
        const cwd = blockData?.meta?.["cmd:cwd"];
        const canShowFileBrowser = shellIntegrationStatus === "ready" && cwd != null;

        if (canShowFileBrowser) {
            fullMenu.push({
                label: "文件浏览器",
                click: () => {
                    const blockData = globalStore.get(this.blockAtom);
                    const connection = blockData?.meta?.connection;
                    const cwd = blockData?.meta?.["cmd:cwd"];
                    const meta: Record<string, any> = {
                        view: "preview",
                        file: cwd,
                    };
                    if (connection) {
                        meta.connection = connection;
                    }
                    const blockDef: BlockDef = { meta };
                    createBlock(blockDef);
                },
            });
            fullMenu.push({ type: "separator" });
        }

        fullMenu.push({
            label: "保存会话为...",
            click: () => {
                if (this.termRef.current) {
                    const content = this.termRef.current.getScrollbackContent();
                    if (content) {
                        fireAndForget(async () => {
                            try {
                                const success = await getApi().saveTextFile("session.log", content);
                                if (!success) {
                                    console.log("Save scrollback cancelled by user");
                                }
                            } catch (error) {
                                console.error("Failed to save scrollback:", error);
                                const errorMessage = error?.message || "发生未知错误";
                                modalsModel.pushModal("MessageModal", {
                                    children: `保存会话滚动历史失败：${errorMessage}`,
                                });
                            }
                        });
                    } else {
                        modalsModel.pushModal("MessageModal", {
                            children: "没有可保存的滚动历史内容。",
                        });
                    }
                }
            },
        });
        fullMenu.push({ type: "separator" });

        const submenu: ContextMenuItem[] = termThemeKeys.map((themeName) => {
            return {
                label: termThemes[themeName]["display:name"] ?? themeName,
                type: "checkbox",
                checked: curThemeName == themeName,
                click: () => this.setTerminalTheme(themeName),
            };
        });
        submenu.unshift({
            label: "默认",
            type: "checkbox",
            checked: curThemeName == null,
            click: () => this.setTerminalTheme(null),
        });
        const transparencySubMenu: ContextMenuItem[] = [];
        transparencySubMenu.push({
            label: "默认",
            type: "checkbox",
            checked: transparencyMeta == null,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": null },
                });
            },
        });
        transparencySubMenu.push({
            label: "透明背景",
            type: "checkbox",
            checked: transparencyMeta == 0.5,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": 0.5 },
                });
            },
        });
        transparencySubMenu.push({
            label: "不透明",
            type: "checkbox",
            checked: transparencyMeta == 0,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": 0 },
                });
            },
        });

        const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
            (fontSize: number) => {
                return {
                    label: fontSize.toString() + "px",
                    type: "checkbox",
                    checked: overrideFontSize == fontSize,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:fontsize": fontSize },
                        });
                    },
                };
            }
        );
        fontSizeSubMenu.unshift({
            label: "默认 (" + defaultFontSize + "px)",
            type: "checkbox",
            checked: overrideFontSize == null,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:fontsize": null },
                });
            },
        });
        const overrideCursor = blockData?.meta?.["term:cursor"] as string | null | undefined;
        const overrideCursorBlink = blockData?.meta?.["term:cursorblink"] as boolean | null | undefined;
        const isCursorDefault = overrideCursor == null && overrideCursorBlink == null;
        // normalize for comparison: null/undefined/"block" all mean "block"
        const effectiveCursor = overrideCursor === "underline" || overrideCursor === "bar" ? overrideCursor : "block";
        const effectiveCursorBlink = overrideCursorBlink === true;
        const cursorSubMenu: ContextMenuItem[] = [
            {
                label: "默认",
                type: "checkbox",
                checked: isCursorDefault,
                click: () => {
                    RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "term:cursor": null, "term:cursorblink": null },
                    });
                },
            },
            {
                label: "块状",
                type: "checkbox",
                checked: !isCursorDefault && effectiveCursor === "block" && !effectiveCursorBlink,
                click: () => {
                    RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "term:cursor": "block", "term:cursorblink": false },
                    });
                },
            },
            {
                label: "块状 (闪烁)",
                type: "checkbox",
                checked: !isCursorDefault && effectiveCursor === "block" && effectiveCursorBlink,
                click: () => {
                    RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "term:cursor": "block", "term:cursorblink": true },
                    });
                },
            },
            {
                label: "竖线",
                type: "checkbox",
                checked: !isCursorDefault && effectiveCursor === "bar" && !effectiveCursorBlink,
                click: () => {
                    RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "term:cursor": "bar", "term:cursorblink": false },
                    });
                },
            },
            {
                label: "竖线 (闪烁)",
                type: "checkbox",
                checked: !isCursorDefault && effectiveCursor === "bar" && effectiveCursorBlink,
                click: () => {
                    RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "term:cursor": "bar", "term:cursorblink": true },
                    });
                },
            },
            {
                label: "下划线",
                type: "checkbox",
                checked: !isCursorDefault && effectiveCursor === "underline" && !effectiveCursorBlink,
                click: () => {
                    RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "term:cursor": "underline", "term:cursorblink": false },
                    });
                },
            },
            {
                label: "下划线 (闪烁)",
                type: "checkbox",
                checked: !isCursorDefault && effectiveCursor === "underline" && effectiveCursorBlink,
                click: () => {
                    RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "term:cursor": "underline", "term:cursorblink": true },
                    });
                },
            },
        ];
        fullMenu.push({
            label: "主题",
            submenu: submenu,
        });
        fullMenu.push({
            label: "字体大小",
            submenu: fontSizeSubMenu,
        });
        fullMenu.push({
            label: "光标",
            submenu: cursorSubMenu,
        });
        fullMenu.push({
            label: "透明度",
            submenu: transparencySubMenu,
        });
        fullMenu.push({ type: "separator" });
        const advancedSubmenu: ContextMenuItem[] = [];
        const allowBracketedPaste = blockData?.meta?.["term:allowbracketedpaste"];
        advancedSubmenu.push({
            label: "允许括号粘贴模式",
            submenu: [
                {
                    label: "默认 (" + (defaultAllowBracketedPaste ? "开启" : "关闭") + ")",
                    type: "checkbox",
                    checked: allowBracketedPaste == null,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:allowbracketedpaste": null },
                        });
                    },
                },
                {
                    label: "开启",
                    type: "checkbox",
                    checked: allowBracketedPaste === true,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:allowbracketedpaste": true },
                        });
                    },
                },
                {
                    label: "关闭",
                    type: "checkbox",
                    checked: allowBracketedPaste === false,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:allowbracketedpaste": false },
                        });
                    },
                },
            ],
        });
        advancedSubmenu.push({
            label: "强制重启控制器",
            click: () => fireAndForget(() => this.forceRestartController()),
        });
        const isClearOnStart = blockData?.meta?.["cmd:clearonstart"];
        advancedSubmenu.push({
            label: "重启时清除输出",
            submenu: [
                {
                    label: "开启",
                    type: "checkbox",
                    checked: isClearOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:clearonstart": true },
                        });
                    },
                },
                {
                    label: "关闭",
                    type: "checkbox",
                    checked: !isClearOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:clearonstart": false },
                        });
                    },
                },
            ],
        });
        const runOnStart = blockData?.meta?.["cmd:runonstart"];
        advancedSubmenu.push({
            label: "启动时运行",
            submenu: [
                {
                    label: "开启",
                    type: "checkbox",
                    checked: runOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:runonstart": true },
                        });
                    },
                },
                {
                    label: "关闭",
                    type: "checkbox",
                    checked: !runOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:runonstart": false },
                        });
                    },
                },
            ],
        });
        const completionNotifyThresholdMs = this.getCompletionNotificationThresholdMs();
        advancedSubmenu.push({
            label: `完成通知阈值 (${formatCompletionNotificationThreshold(completionNotifyThresholdMs)})`,
            submenu: [
                ...CompletionNotificationPresetThresholds.map((thresholdMs) => ({
                    label: formatCompletionNotificationThreshold(thresholdMs),
                    type: "checkbox" as const,
                    checked: completionNotifyThresholdMs === thresholdMs,
                    click: () => this.setCompletionNotificationThresholdMs(thresholdMs),
                })),
                {
                    label: "自定义...",
                    click: () => this.promptForCustomCompletionNotificationThreshold(),
                },
            ],
        });
        if (blockData?.meta?.controller === "cmd") {
            const notifyOnCompletion = this.isCmdCompletionNotificationEnabled();
            advancedSubmenu.push({
                label: "完成后通知",
                submenu: [
                    {
                        label: "开启",
                        type: "checkbox",
                        checked: notifyOnCompletion,
                        click: () => this.setCmdCompletionNotificationEnabled(true),
                    },
                    {
                        label: "关闭",
                        type: "checkbox",
                        checked: !notifyOnCompletion,
                        click: () => this.setCmdCompletionNotificationEnabled(false),
                    },
                ],
            });
        }
        const debugConn = blockData?.meta?.["term:conndebug"];
        advancedSubmenu.push({
            label: "调试连接",
            submenu: [
                {
                    label: "关闭",
                    type: "checkbox",
                    checked: !debugConn,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": null },
                        });
                    },
                },
                {
                    label: "信息",
                    type: "checkbox",
                    checked: debugConn == "info",
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": "info" },
                        });
                    },
                },
                {
                    label: "详细",
                    type: "checkbox",
                    checked: debugConn == "debug",
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": "debug" },
                        });
                    },
                },
            ],
        });

        const isDurable = globalStore.get(getBlockTermDurableAtom(this.blockId));
        if (isDurable) {
            advancedSubmenu.push({
                label: "会话持久性",
                submenu: [
                    {
                        label: "以标准模式重启会话",
                        click: () => fireAndForget(() => this.restartSessionWithDurability(false)),
                    },
                ],
            });
        } else if (isDurable === false) {
            advancedSubmenu.push({
                label: "会话持久性",
                submenu: [
                    {
                        label: "以持久模式重启会话",
                        click: () => fireAndForget(() => this.restartSessionWithDurability(true)),
                    },
                ],
            });
        }

        fullMenu.push({
            label: "高级",
            submenu: advancedSubmenu,
        });
        if (blockData?.meta?.["term:vdomtoolbarblockid"]) {
            fullMenu.push({ type: "separator" });
            fullMenu.push({
                label: "关闭工具栏",
                click: () => {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: blockData.meta["term:vdomtoolbarblockid"] });
                },
            });
        }
        return fullMenu;
    }
}

export function getAllBasicTermModels(): TermViewModel[] {
    const termModels: TermViewModel[] = [];
    const bcms = getAllBlockComponentModels();
    for (const bcm of bcms) {
        if (bcm?.viewModel?.viewType == "term") {
            const tvm = bcm.viewModel as TermViewModel;
            if (tvm.isBasicTerm((atom) => globalStore.get(atom))) {
                termModels.push(tvm);
            }
        }
    }
    return termModels;
}
