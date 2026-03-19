// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { FlyoutMenu } from "@/app/element/flyoutmenu";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/store/global";
import { sendCommandToFocusedTerminal } from "@/util/previewutil";
import { atom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
    buildTmuxCreateSessionCommand,
    buildTmuxCreateWindowCommand,
    buildTmuxDetachSessionCommand,
    buildTmuxEnterOrCreateSessionCommand,
    buildTmuxEnterSessionCommand,
    buildTmuxEnterWindowCommand,
    buildTmuxKillSessionCommand,
    buildTmuxKillWindowCommand,
    buildTmuxRenameSessionCommand,
    buildTmuxRenameWindowCommand,
    formatDangerConfirmText,
    getNextSuffixName,
    getTmuxErrorHeadline,
    trimNameInput,
} from "./tmux-util";

const panelClass = "rounded-xl border border-zinc-800 bg-zinc-950/70 p-4";
const rowPrimaryButtonClass = "!h-[28px] !px-2 !text-xs";
const rowSecondaryButtonClass = "grey !h-[28px] !px-2 !text-xs";
const rowDangerButtonClass =
    "!h-[28px] !px-2 !text-xs !bg-red-500/10 !border-red-500/30 !text-red-300 hover:!bg-red-500/20";
const rowMenuButtonClass = "grey !h-[28px] !px-2 !text-xs";
const TmuxViewComponent = memo(TmuxView);

function TmuxView({ blockId }: ViewComponentProps<TmuxViewModel>) {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const connection = (blockData?.meta?.connection as string) ?? "";
    const cwd = (blockData?.meta?.["cmd:cwd"] as string) ?? "";

    const [sessions, setSessions] = useState<TmuxSessionSummary[]>([]);
    const [windows, setWindows] = useState<TmuxWindowSummary[]>([]);
    const [selectedSession, setSelectedSession] = useState<string>("");
    const [newSessionName, setNewSessionName] = useState("main");
    const [newWindowName, setNewWindowName] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadingError, setLoadingError] = useState<TmuxError | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const [serverRunning, setServerRunning] = useState(true);

    const selectedSessionSummary = useMemo(
        () => sessions.find((session) => session.name === selectedSession) ?? null,
        [sessions, selectedSession]
    );
    const baseSessionName = useMemo(() => trimNameInput(newSessionName) || "main", [newSessionName]);
    const resolvedSessionName = useMemo(
        () =>
            getNextSuffixName(
                baseSessionName,
                sessions.map((session) => session.name)
            ),
        [baseSessionName, sessions]
    );
    const willAutoSuffixSessionName = resolvedSessionName !== baseSessionName;

    const refreshData = useCallback(
        async (showLoading = false) => {
            if (showLoading) {
                setLoading(true);
            }
            try {
                const sessionResp = await RpcApi.TmuxListSessionsCommand(TabRpcClient, { connection });
                setServerRunning(sessionResp?.serverRunning !== false);
                if (sessionResp?.error) {
                    setLoadingError(sessionResp.error);
                    setSessions([]);
                    setWindows([]);
                    return;
                }
                const nextSessions = sessionResp?.sessions ?? [];
                setSessions(nextSessions);
                setLoadingError(null);

                const nextSelectedSession =
                    nextSessions.find((session) => session.name === selectedSession)?.name ??
                    nextSessions[0]?.name ??
                    "";
                setSelectedSession(nextSelectedSession);

                if (nextSelectedSession === "") {
                    setWindows([]);
                    return;
                }
                const windowResp = await RpcApi.TmuxListWindowsCommand(TabRpcClient, {
                    connection,
                    session: nextSelectedSession,
                });
                if (windowResp?.error) {
                    setWindows([]);
                    setLoadingError(windowResp.error);
                    return;
                }
                setWindows(windowResp?.windows ?? []);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setLoadingError({ code: "unknown", message } as TmuxError);
                setSessions([]);
                setWindows([]);
            } finally {
                setLoading(false);
            }
        },
        [connection, selectedSession]
    );

    useEffect(() => {
        setActionError(null);
        setStatusMessage(null);
        void refreshData(true);
        const timerId = window.setInterval(() => {
            void refreshData(false);
        }, 2000);
        return () => {
            window.clearInterval(timerId);
        };
    }, [refreshData]);

    const sendCommand = useCallback(
        async (command: string, actionLabel: string) => {
            setPendingAction(actionLabel);
            setActionError(null);
            setStatusMessage(null);
            try {
                const result = await sendCommandToFocusedTerminal(command, connection);
                if (!result.ok) {
                    setActionError("message" in result ? result.message : "发送命令失败。");
                    return false;
                }
                setStatusMessage(`命令已发送到终端：${actionLabel}`);
                setTimeout(() => {
                    void refreshData(false);
                }, 300);
                return true;
            } catch (err) {
                setActionError(`发送命令失败：${err instanceof Error ? err.message : String(err)}`);
                return false;
            } finally {
                setPendingAction(null);
            }
        },
        [connection, refreshData]
    );

    const confirmDangerousAction = useCallback(
        (actionLabel: string, sessionName: string, windowName?: string) => {
            return window.confirm(formatDangerConfirmText(actionLabel, connection, sessionName, windowName));
        },
        [connection]
    );

    const createSession = useCallback(async () => {
        const baseName = baseSessionName;
        const resolvedName = resolvedSessionName;
        const ok = await sendCommand(buildTmuxCreateSessionCommand(resolvedName), `创建并进入 Session ${resolvedName}`);
        if (ok) {
            setNewSessionName(baseName);
        }
    }, [baseSessionName, resolvedSessionName, sendCommand]);

    const createWindow = useCallback(async () => {
        if (selectedSession === "") {
            setActionError("请先选择一个 Session 再创建 Window。");
            return;
        }
        const trimmedWindowName = trimNameInput(newWindowName);
        const label =
            trimmedWindowName === ""
                ? `在 ${selectedSession} 新建并进入 Window`
                : `在 ${selectedSession} 新建并进入 Window ${trimmedWindowName}`;
        const ok = await sendCommand(buildTmuxCreateWindowCommand(selectedSession, trimmedWindowName), label);
        if (ok) {
            setNewWindowName("");
        }
    }, [newWindowName, selectedSession, sendCommand]);

    const renameSession = useCallback(
        async (sessionName: string) => {
            const nextName = trimNameInput(window.prompt(`重命名 Session "${sessionName}" 为：`, sessionName) ?? "");
            if (nextName === "" || nextName === sessionName) {
                return;
            }
            await sendCommand(
                buildTmuxRenameSessionCommand(sessionName, nextName),
                `重命名 Session ${sessionName} -> ${nextName}`
            );
        },
        [sendCommand]
    );

    const renameWindow = useCallback(
        async (windowItem: TmuxWindowSummary) => {
            if (selectedSession === "") {
                setActionError("请先选择 Session。");
                return;
            }
            const nextName = trimNameInput(
                window.prompt(`重命名 Window "${windowItem.name}" 为：`, windowItem.name) ?? ""
            );
            if (nextName === "" || nextName === windowItem.name) {
                return;
            }
            await sendCommand(
                buildTmuxRenameWindowCommand(selectedSession, windowItem.index, nextName),
                `重命名 Window ${windowItem.name} -> ${nextName}`
            );
        },
        [selectedSession, sendCommand]
    );

    const detachSession = useCallback(
        async (sessionName: string) => {
            if (!confirmDangerousAction("Detach", sessionName)) {
                return;
            }
            await sendCommand(buildTmuxDetachSessionCommand(sessionName), `Detach Session ${sessionName}`);
        },
        [confirmDangerousAction, sendCommand]
    );

    const killSession = useCallback(
        async (sessionName: string) => {
            if (!confirmDangerousAction("Kill Session", sessionName)) {
                return;
            }
            await sendCommand(buildTmuxKillSessionCommand(sessionName), `Kill Session ${sessionName}`);
        },
        [confirmDangerousAction, sendCommand]
    );

    const killWindow = useCallback(
        async (windowItem: TmuxWindowSummary) => {
            if (selectedSession === "") {
                setActionError("请先选择 Session。");
                return;
            }
            const windowTitle = `${windowItem.index}:${windowItem.name}`;
            if (!confirmDangerousAction("Kill Window", selectedSession, windowTitle)) {
                return;
            }
            await sendCommand(
                buildTmuxKillWindowCommand(selectedSession, windowItem.index),
                `Kill Window ${windowItem.index}:${windowItem.name}`
            );
        },
        [confirmDangerousAction, selectedSession, sendCommand]
    );

    if (loading) {
        return <div className="flex h-full items-center justify-center text-sm text-zinc-400">正在加载 tmux...</div>;
    }

    return (
        <div className="h-full w-full min-w-0 overflow-y-auto bg-zinc-900 p-4 text-zinc-100">
            <div className="flex w-full min-w-0 flex-col gap-4">
                {loadingError ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        <div className="font-medium">{getTmuxErrorHeadline(loadingError)}</div>
                        {loadingError.detail ? <div className="mt-1 text-red-200/80">{loadingError.detail}</div> : null}
                    </div>
                ) : null}
                {actionError ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                        {actionError}
                    </div>
                ) : null}
                {statusMessage ? (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                        {statusMessage}
                    </div>
                ) : null}

                <div className={panelClass}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-lg font-semibold text-zinc-100">Tmux Manager</div>
                            <div className="text-sm text-zinc-400">
                                连接：{connection === "" ? "本机" : connection}
                                {cwd ? ` | cwd: ${cwd}` : ""}
                            </div>
                            {!serverRunning ? (
                                <div className="text-xs text-zinc-500">
                                    当前连接暂无 tmux server，执行进入/创建时会自动拉起。
                                </div>
                            ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button className="grey" onClick={() => void refreshData(true)}>
                                刷新
                            </Button>
                            <Button
                                className="grey"
                                onClick={() =>
                                    void sendCommand(buildTmuxEnterOrCreateSessionCommand("main"), "进入 main")
                                }
                                disabled={pendingAction != null}
                            >
                                进入 main
                            </Button>
                        </div>
                    </div>
                </div>

                <div className={panelClass}>
                    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-base font-semibold text-zinc-100">Sessions</div>
                            <div className="text-sm text-zinc-500">管理会话</div>
                        </div>
                        <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
                            <div className="flex-1">
                                <label className="mb-1 block text-xs font-medium text-zinc-400">Session name</label>
                                <input
                                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent"
                                    value={newSessionName}
                                    placeholder="Session name"
                                    onChange={(e) => setNewSessionName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            void createSession();
                                        }
                                    }}
                                />
                            </div>
                            <Button onClick={() => void createSession()} disabled={pendingAction != null}>
                                创建并进入
                            </Button>
                        </div>
                    </div>
                    {willAutoSuffixSessionName ? (
                        <div className="mb-3 text-xs text-zinc-500">
                            将创建 "{resolvedSessionName}"。
                        </div>
                    ) : null}
                    {sessions.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-6 text-center text-sm text-zinc-500">
                            当前连接没有 Session。
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {sessions.map((session) => {
                                const isSelected = selectedSession === session.name;
                                return (
                                    <div
                                        key={session.name}
                                        className={[
                                            "rounded-lg border px-3 py-2.5 transition-colors",
                                            isSelected
                                                ? "border-accent/40 bg-zinc-900"
                                                : "border-zinc-800 bg-zinc-950/70 hover:border-zinc-700",
                                        ].join(" ")}
                                    >
                                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                            <div
                                                className="min-w-0 flex-1 cursor-pointer"
                                                onClick={() => setSelectedSession(session.name)}
                                            >
                                                <div className="truncate text-base font-semibold text-zinc-100">
                                                    {session.name}
                                                </div>
                                                <div className="mt-1 text-xs text-zinc-500">
                                                    windows: {session.windows} | clients: {session.attached}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                                <Button
                                                    className={rowPrimaryButtonClass}
                                                    onClick={() =>
                                                        void sendCommand(
                                                            buildTmuxEnterSessionCommand(session.name),
                                                            `进入 Session ${session.name}`
                                                        )
                                                    }
                                                    disabled={pendingAction != null}
                                                >
                                                    进入
                                                </Button>
                                                <Button
                                                    className={rowSecondaryButtonClass}
                                                    onClick={() => void detachSession(session.name)}
                                                    disabled={pendingAction != null}
                                                >
                                                    Detach
                                                </Button>
                                                {pendingAction != null ? (
                                                    <Button className={rowMenuButtonClass} disabled>
                                                        更多
                                                    </Button>
                                                ) : (
                                                    <FlyoutMenu
                                                        items={[
                                                            {
                                                                label: "重命名",
                                                                onClick: () => void renameSession(session.name),
                                                            },
                                                        ]}
                                                    >
                                                        <Button className={rowMenuButtonClass}>更多</Button>
                                                    </FlyoutMenu>
                                                )}
                                                <Button
                                                    className={rowDangerButtonClass}
                                                    onClick={() => void killSession(session.name)}
                                                    disabled={pendingAction != null}
                                                >
                                                    Kill
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className={panelClass}>
                    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-base font-semibold text-zinc-100">Windows</div>
                            <div className="text-sm text-zinc-500">
                                {selectedSessionSummary
                                    ? `当前 Session: ${selectedSessionSummary.name}`
                                    : "请选择 Session 后查看并管理 Window。"}
                            </div>
                            {selectedSessionSummary ? (
                                <div className="mt-1 text-xs text-zinc-500">已在列表中高亮该 Session。</div>
                            ) : null}
                        </div>
                        <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
                            <input
                                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent"
                                value={newWindowName}
                                placeholder="Window 名（可选）"
                                onChange={(e) => setNewWindowName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        void createWindow();
                                    }
                                }}
                                disabled={selectedSessionSummary == null}
                            />
                            <Button
                                onClick={() => void createWindow()}
                                disabled={selectedSessionSummary == null || pendingAction != null}
                            >
                                新建并进入
                            </Button>
                        </div>
                    </div>

                    {selectedSessionSummary == null ? (
                        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-6 text-center text-sm text-zinc-500">
                            请选择一个 Session。
                        </div>
                    ) : windows.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-6 text-center text-sm text-zinc-500">
                            当前 Session 没有 Window。
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {windows.map((windowItem) => (
                                <div
                                    key={`${windowItem.index}:${windowItem.name}`}
                                    className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5"
                                >
                                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <div className="truncate text-sm font-semibold text-zinc-100">
                                                    {windowItem.index}:{windowItem.name}
                                                </div>
                                                {windowItem.active ? (
                                                    <span className="text-xs text-zinc-500">(active)</span>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 lg:justify-end">
                                            <Button
                                                className={rowPrimaryButtonClass}
                                                onClick={() =>
                                                    void sendCommand(
                                                        buildTmuxEnterWindowCommand(
                                                            selectedSessionSummary.name,
                                                            windowItem.index
                                                        ),
                                                        `进入 Window ${windowItem.index}:${windowItem.name}`
                                                    )
                                                }
                                                disabled={pendingAction != null}
                                            >
                                                进入
                                            </Button>
                                            <Button
                                                className={rowSecondaryButtonClass}
                                                onClick={() => void renameWindow(windowItem)}
                                                disabled={pendingAction != null}
                                            >
                                                重命名
                                            </Button>
                                            <Button
                                                className={rowDangerButtonClass}
                                                onClick={() => void killWindow(windowItem)}
                                                disabled={pendingAction != null}
                                            >
                                                Kill
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export class TmuxViewModel implements ViewModel {
    viewType = "tmux";
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon = atom("terminal");
    viewName = atom("Tmux");
    manageConnection = atom(true);
    filterOutNowsh = atom(true);
    noPadding = atom(true);

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
    }

    get viewComponent(): ViewComponent {
        return TmuxViewComponent;
    }
}
