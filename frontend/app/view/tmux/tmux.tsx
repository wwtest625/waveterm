// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/store/global";
import { sendCommandToFocusedTerminal } from "@/util/previewutil";
import clsx from "clsx";
import { atom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ============================================================================
// Types for Tree View
// ============================================================================

type TreeNodeType = "session" | "window";

interface TreeNode {
    id: string; // session:sessionName or window:sessionName:windowIndex
    type: TreeNodeType;
    session: TmuxSessionSummary;
    window?: TmuxWindowSummary;
}

// ============================================================================
// Helper Components
// ============================================================================

function SessionNode({
    session,
    windows,
    isExpanded,
    isSelected,
    isFocused,
    onToggle,
    onEnter,
    onSelect,
    onContextMenu,
}: {
    session: TmuxSessionSummary;
    windows: TmuxWindowSummary[];
    isExpanded: boolean;
    isSelected: boolean;
    isFocused: boolean;
    onToggle: () => void;
    onEnter: () => void;
    onSelect: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}) {
    return (
        <div
            className={clsx(
                "group relative flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3.5 transition-all duration-200",
                isSelected
                    ? "bg-gradient-to-r from-accent/20 to-accent/5 border border-accent/30 shadow-lg shadow-accent/5"
                    : "hover:bg-zinc-800/50 border border-transparent hover:border-zinc-700/50"
            )}
            onClick={(e) => {
                e.stopPropagation();
                onSelect();
                onToggle();
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                onEnter();
            }}
            onContextMenu={onContextMenu}
        >
            {/* Left accent bar */}
            {isSelected && (
                <div className="absolute left-0 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r-full bg-accent" />
            )}

            {/* Expand/Collapse Button */}
            <div
                className={clsx(
                    "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200",
                    isExpanded
                        ? "bg-accent/20 text-accent"
                        : "bg-zinc-800/70 text-zinc-500 group-hover:bg-zinc-700/70 group-hover:text-zinc-300"
                )}
            >
                <i className={clsx("fa-solid text-xs", isExpanded ? "fa-chevron-down" : "fa-chevron-right")} />
            </div>

            {/* Session Icon */}
            <div
                className={clsx(
                    "flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200",
                    isExpanded
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-zinc-800/70 text-zinc-400 group-hover:bg-zinc-700/70"
                )}
            >
                <i className={clsx("fa-solid text-lg", isExpanded ? "fa-folder-open" : "fa-folder")} />
            </div>

            {/* Session Info */}
            <div className="flex flex-1 flex-col gap-1 min-w-0">
                <div
                    className={clsx(
                        "truncate text-[15px] font-semibold transition-colors",
                        isSelected ? "text-white" : "text-zinc-200 group-hover:text-white"
                    )}
                >
                    {session.name}
                </div>
                <div className="flex items-center gap-4 text-xs">
                    <span
                        className={clsx(
                            "flex items-center gap-1.5 transition-colors",
                            isSelected ? "text-zinc-400" : "text-zinc-500 group-hover:text-zinc-400"
                        )}
                    >
                        <i className="fa-regular fa-window-maximize" />
                        {windows.length} window{windows.length !== 1 ? "s" : ""}
                    </span>
                    <span
                        className={clsx(
                            "flex items-center gap-1.5 transition-colors",
                            session.attached > 0
                                ? isSelected
                                    ? "text-emerald-400"
                                    : "text-emerald-500/80"
                                : "text-zinc-600"
                        )}
                    >
                        <i className={clsx("fa-solid", session.attached > 0 ? "fa-link" : "fa-unlink")} />
                        {session.attached} connected
                    </span>
                </div>
            </div>

            {/* Hover hint */}
            <div
                className={clsx(
                    "flex items-center gap-2 text-xs transition-all duration-200",
                    isSelected ? "text-zinc-500 opacity-100" : "text-zinc-600 opacity-0 group-hover:opacity-100"
                )}
            >
                <span className="hidden md:inline">Enter</span>
                <i className="fa-solid fa-arrow-right text-accent" />
            </div>
        </div>
    );
}

function WindowNode({
    session,
    window,
    isSelected,
    isFocused,
    onEnter,
    onSelect,
    onContextMenu,
}: {
    session: TmuxSessionSummary;
    window: TmuxWindowSummary;
    isSelected: boolean;
    isFocused: boolean;
    onEnter: () => void;
    onSelect: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}) {
    return (
        <div
            className={clsx(
                "group relative ml-5 flex cursor-pointer items-center gap-3 rounded-xl border-l-2 px-4 py-3 transition-all duration-200",
                isSelected
                    ? "border-accent/60 bg-accent/10"
                    : "border-zinc-700/50 hover:border-zinc-500/80 hover:bg-zinc-800/40"
            )}
            onClick={(e) => {
                e.stopPropagation();
                onSelect();
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                onEnter();
            }}
            onContextMenu={onContextMenu}
        >
            {/* Window Icon */}
            <div
                className={clsx(
                    "flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200",
                    window.active
                        ? "bg-emerald-500/20 text-emerald-400 shadow-lg shadow-emerald-500/10"
                        : "bg-zinc-800/70 text-zinc-500 group-hover:bg-zinc-700/70 group-hover:text-zinc-400"
                )}
            >
                <i className={clsx("fa-solid text-sm", window.active ? "fa-terminal" : "fa-grip")} />
            </div>

            {/* Window Index Badge */}
            <div
                className={clsx(
                    "flex h-9 w-9 items-center justify-center rounded-lg font-mono text-sm font-bold transition-colors",
                    window.active
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-zinc-800/70 text-zinc-500 group-hover:bg-zinc-700/70"
                )}
            >
                {window.index}
            </div>

            {/* Window Name & Status */}
            <div className="flex flex-1 items-center gap-3 min-w-0">
                <span
                    className={clsx(
                        "truncate text-sm font-medium transition-colors",
                        isSelected ? "text-white" : "text-zinc-300 group-hover:text-zinc-100"
                    )}
                >
                    {window.name || "bash"}
                </span>
                {window.active && (
                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        active
                    </span>
                )}
            </div>

            {/* Panes count placeholder */}
            <div className="hidden md:flex items-center gap-1.5 text-zinc-600">
                <i className="fa-solid fa-columns text-xs" />
                <span className="text-xs">panes</span>
            </div>
        </div>
    );
}

function TmuxTreeView({
    sessions,
    windowsBySession,
    expandedSessionIds,
    selectedNodeId,
    onToggleSession,
    onSelectNode,
    onEnterNode,
    onSessionContextMenu,
    onWindowContextMenu,
}: {
    sessions: TmuxSessionSummary[];
    windowsBySession: Record<string, TmuxWindowSummary[]>;
    expandedSessionIds: Set<string>;
    selectedNodeId: string | null;
    onToggleSession: (sessionName: string) => void;
    onSelectNode: (nodeId: string) => void;
    onEnterNode: (nodeId: string) => void;
    onSessionContextMenu: (session: TmuxSessionSummary, e: React.MouseEvent) => void;
    onWindowContextMenu: (session: TmuxSessionSummary, window: TmuxWindowSummary, e: React.MouseEvent) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Keyboard navigation
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && selectedNodeId) {
                onEnterNode(selectedNodeId);
            }
        },
        [selectedNodeId, onEnterNode]
    );

    return (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-3" onKeyDown={handleKeyDown} tabIndex={0}>
            {sessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-zinc-800 bg-zinc-900/50 text-sm">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800/50">
                        <i className="fa-solid fa-folder-open text-3xl text-zinc-600" />
                    </div>
                    <div className="text-zinc-500">No tmux sessions</div>
                    <div className="text-xs text-zinc-600">Create one using the form below</div>
                </div>
            ) : (
                <div className="space-y-2">
                    {sessions.map((session) => {
                        const sessionId = `session:${session.name}`;
                        const sessionWindows = windowsBySession[session.name] ?? [];
                        const isExpanded = expandedSessionIds.has(session.name);
                        const isSelected = selectedNodeId === sessionId;

                        return (
                            <div key={session.name} className="space-y-1.5">
                                <SessionNode
                                    session={session}
                                    windows={sessionWindows}
                                    isExpanded={isExpanded}
                                    isSelected={isSelected}
                                    isFocused={selectedNodeId === sessionId}
                                    onToggle={() => onToggleSession(session.name)}
                                    onEnter={() => onEnterNode(sessionId)}
                                    onSelect={() => onSelectNode(sessionId)}
                                    onContextMenu={(e) => onSessionContextMenu(session, e)}
                                />

                                {/* Windows Children */}
                                {isExpanded && sessionWindows.length > 0 && (
                                    <div className="space-y-1.5">
                                        {sessionWindows.map((window) => {
                                            const windowId = `window:${session.name}:${window.index}`;
                                            return (
                                                <WindowNode
                                                    key={windowId}
                                                    session={session}
                                                    window={window}
                                                    isSelected={selectedNodeId === windowId}
                                                    isFocused={selectedNodeId === windowId}
                                                    onEnter={() => onEnterNode(windowId)}
                                                    onSelect={() => onSelectNode(windowId)}
                                                    onContextMenu={(e) => onWindowContextMenu(session, window, e)}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function TmuxView({ blockId }: ViewComponentProps<TmuxViewModel>) {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const connection = (blockData?.meta?.connection as string) ?? "";
    const cwd = (blockData?.meta?.["cmd:cwd"] as string) ?? "";

    const [sessions, setSessions] = useState<TmuxSessionSummary[]>([]);
    const [windowsBySession, setWindowsBySession] = useState<Record<string, TmuxWindowSummary[]>>({});
    const [selectedSession, setSelectedSession] = useState<string>("");
    const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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
                    setWindowsBySession({});
                    return;
                }
                const nextSessions = sessionResp?.sessions ?? [];
                setSessions(nextSessions);
                setLoadingError(null);

                // Keep current selection if still valid, otherwise select first
                const nextSelectedSession =
                    nextSessions.find((session) => session.name === selectedSession)?.name ??
                    nextSessions[0]?.name ??
                    "";
                setSelectedSession(nextSelectedSession);

                // Auto-expand the selected session
                if (nextSelectedSession) {
                    setExpandedSessionIds((prev) => new Set([...prev, nextSelectedSession]));
                }

                if (nextSessions.length === 0) {
                    setWindowsBySession({});
                    return;
                }

                // Fetch windows for all sessions in parallel
                const windowPromises = nextSessions.map(async (session) => {
                    try {
                        const windowResp = await RpcApi.TmuxListWindowsCommand(TabRpcClient, {
                            connection,
                            session: session.name,
                        });
                        return { sessionName: session.name, windows: windowResp?.windows ?? [] };
                    } catch {
                        return { sessionName: session.name, windows: [] };
                    }
                });

                const windowResults = await Promise.all(windowPromises);
                const nextWindowsBySession: Record<string, TmuxWindowSummary[]> = {};
                for (const result of windowResults) {
                    nextWindowsBySession[result.sessionName] = result.windows;
                }
                setWindowsBySession(nextWindowsBySession);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setLoadingError({ code: "unknown", message } as TmuxError);
                setSessions([]);
                setWindowsBySession({});
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

    const enterSession = useCallback(
        async (sessionName: string) => {
            if (pendingAction != null) {
                return;
            }
            const ok = await sendCommand(buildTmuxEnterSessionCommand(sessionName), `进入 Session ${sessionName}`);
            if (ok) {
                setSelectedSession(sessionName);
            }
        },
        [pendingAction, sendCommand]
    );

    const enterOrCreateSession = useCallback(
        async (sessionName: string) => {
            if (pendingAction != null) {
                return;
            }
            const ok = await sendCommand(
                buildTmuxEnterOrCreateSessionCommand(sessionName),
                `进入 Session ${sessionName}`
            );
            if (ok) {
                setSelectedSession(sessionName);
            }
        },
        [pendingAction, sendCommand]
    );

    const enterWindow = useCallback(
        async (sessionName: string, windowItem: TmuxWindowSummary) => {
            if (pendingAction != null) {
                return;
            }
            await sendCommand(
                buildTmuxEnterWindowCommand(sessionName, windowItem.index),
                `进入 Window ${windowItem.index}:${windowItem.name}`
            );
        },
        [pendingAction, sendCommand]
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
            setSelectedSession(resolvedName);
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
        async (sessionName: string, windowItem: TmuxWindowSummary) => {
            const nextName = trimNameInput(
                window.prompt(`重命名 Window "${windowItem.name}" 为：`, windowItem.name) ?? ""
            );
            if (nextName === "" || nextName === windowItem.name) {
                return;
            }
            await sendCommand(
                buildTmuxRenameWindowCommand(sessionName, windowItem.index, nextName),
                `重命名 Window ${windowItem.name} -> ${nextName}`
            );
        },
        [sendCommand]
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
        async (sessionName: string, windowItem: TmuxWindowSummary) => {
            const windowTitle = `${windowItem.index}:${windowItem.name}`;
            if (!confirmDangerousAction("Kill Window", sessionName, windowTitle)) {
                return;
            }
            await sendCommand(buildTmuxKillWindowCommand(sessionName, windowItem.index), `Kill Window ${windowTitle}`);
        },
        [confirmDangerousAction, sendCommand]
    );

    // ============================================================================
    // Tree View Handlers
    // ============================================================================

    const toggleSession = useCallback((sessionName: string) => {
        setExpandedSessionIds((prev) => {
            const next = new Set(prev);
            if (next.has(sessionName)) {
                next.delete(sessionName);
            } else {
                next.add(sessionName);
            }
            return next;
        });
    }, []);

    const selectNode = useCallback((nodeId: string) => {
        setSelectedNodeId(nodeId);
        // If selecting a session, also update selectedSession
        if (nodeId.startsWith("session:")) {
            const sessionName = nodeId.replace("session:", "");
            setSelectedSession(sessionName);
        }
    }, []);

    const enterNode = useCallback(
        (nodeId: string) => {
            if (pendingAction != null) {
                return;
            }
            if (nodeId.startsWith("session:")) {
                const sessionName = nodeId.replace("session:", "");
                void enterSession(sessionName);
            } else if (nodeId.startsWith("window:")) {
                const parts = nodeId.split(":");
                const sessionName = parts[1];
                const windowIndex = parseInt(parts[2], 10);
                const sessionWindows = windowsBySession[sessionName] ?? [];
                const windowItem = sessionWindows.find((w) => w.index === windowIndex);
                if (windowItem) {
                    void enterWindow(sessionName, windowItem);
                }
            }
        },
        [pendingAction, enterSession, enterWindow, windowsBySession]
    );

    const showSessionContextMenu = useCallback(
        (session: TmuxSessionSummary, e: React.MouseEvent) => {
            e.preventDefault();
            const menu: ContextMenuItem[] = [
                {
                    label: "进入该 Session",
                    click: () => void enterSession(session.name),
                },
                {
                    label: "重命名 Session",
                    click: () => void renameSession(session.name),
                },
                { type: "separator" },
                {
                    label: "Detach Session",
                    click: () => void detachSession(session.name),
                },
                {
                    label: "Kill Session",
                    click: () => void killSession(session.name),
                },
            ];
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [enterSession, renameSession, detachSession, killSession]
    );

    const showWindowContextMenu = useCallback(
        (session: TmuxSessionSummary, windowItem: TmuxWindowSummary, e: React.MouseEvent) => {
            e.preventDefault();
            const menu: ContextMenuItem[] = [
                {
                    label: "进入该 Window",
                    click: () => void enterWindow(session.name, windowItem),
                },
                {
                    label: "重命名 Window",
                    click: () => void renameWindow(session.name, windowItem),
                },
                { type: "separator" },
                {
                    label: "Kill Window",
                    click: () => void killWindow(session.name, windowItem),
                },
            ];
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [enterWindow, renameWindow, killWindow]
    );

    // ============================================================================
    // Render
    // ============================================================================

    if (loading) {
        return <div className="flex h-full items-center justify-center text-sm text-zinc-400">正在加载 tmux...</div>;
    }

    return (
        <div className="flex h-full w-full min-w-0 flex-col bg-gradient-to-b from-zinc-900 via-zinc-900 to-zinc-950 text-zinc-100">
            {/* Error/Status Messages */}
            <div className="shrink-0 p-4 pb-0">
                {loadingError ? (
                    <div className="mb-3 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        <i className="fa-solid fa-circle-exclamation text-red-400" />
                        <div>
                            <div className="font-medium">{getTmuxErrorHeadline(loadingError)}</div>
                            {loadingError.detail && <div className="mt-0.5 text-red-200/80">{loadingError.detail}</div>}
                        </div>
                    </div>
                ) : null}
                {actionError ? (
                    <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                        <i className="fa-solid fa-triangle-exclamation text-amber-400" />
                        {actionError}
                    </div>
                ) : null}
                {statusMessage ? (
                    <div className="mb-3 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                        <i className="fa-solid fa-check-circle text-emerald-400" />
                        {statusMessage}
                    </div>
                ) : null}
            </div>

            {/* Header */}
            <div className="mx-4 mt-0 shrink-0">
                <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800/80 bg-gradient-to-r from-zinc-800/40 via-zinc-800/20 to-zinc-800/40 p-5 backdrop-blur-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4">
                            {/* Logo */}
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 shadow-lg shadow-amber-500/10">
                                <i className="fa-brands fa-twitter text-2xl text-amber-400" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white">Tmux Manager</h1>
                                <div className="mt-1 flex items-center gap-3 text-sm text-zinc-400">
                                    <span className="flex items-center gap-1.5">
                                        <i className="fa-solid fa-server text-zinc-500" />
                                        {connection === "" ? "Local" : connection}
                                    </span>
                                    {cwd && (
                                        <span className="hidden sm:flex items-center gap-1.5 font-mono text-xs text-zinc-500">
                                            <i className="fa-solid fa-folder" />
                                            {cwd.length > 30 ? `...${cwd.slice(-27)}` : cwd}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {!serverRunning && (
                                <div className="rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
                                    <i className="fa-solid fa-info-circle mr-1.5" />
                                    Server Offline
                                </div>
                            )}
                            <Button className="!h-10 !gap-2 !px-4 grey" onClick={() => void refreshData(true)}>
                                <i className="fa-solid fa-rotate" />
                                <span className="hidden sm:inline">刷新</span>
                            </Button>
                            <Button
                                className="!h-10 !gap-2 !px-4"
                                onClick={() => void enterOrCreateSession("main")}
                                disabled={pendingAction != null}
                            >
                                <i className="fa-solid fa-arrow-right-to-bracket" />
                                进入 main
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tree View */}
            <div className="mx-4 mt-4 flex flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm">
                <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
                        <i className="fa-solid fa-layer-group text-accent" />
                        Sessions & Windows
                    </div>
                    <div className="text-xs text-zinc-600">
                        {sessions.length} session{sessions.length !== 1 ? "s" : ""}
                    </div>
                </div>
                <TmuxTreeView
                    sessions={sessions}
                    windowsBySession={windowsBySession}
                    expandedSessionIds={expandedSessionIds}
                    selectedNodeId={selectedNodeId}
                    onToggleSession={toggleSession}
                    onSelectNode={selectNode}
                    onEnterNode={enterNode}
                    onSessionContextMenu={showSessionContextMenu}
                    onWindowContextMenu={showWindowContextMenu}
                />
            </div>

            {/* Create Section */}
            <div className="mx-4 mb-4 mt-4 shrink-0">
                <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-5 backdrop-blur-sm">
                    <div className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-400">
                        <i className="fa-solid fa-plus-circle text-emerald-500" />
                        Create New
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {/* Session Input */}
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                                <i className="fa-solid fa-folder text-amber-500/70" />
                                Session Name
                            </label>
                            <div className="flex gap-2">
                                <input
                                    className="flex-1 rounded-xl border border-zinc-700/80 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 outline-none transition-all placeholder:text-zinc-600 focus:border-accent/50 focus:bg-zinc-800/70 focus:shadow-lg focus:shadow-accent/5"
                                    value={newSessionName}
                                    placeholder="main"
                                    onChange={(e) => setNewSessionName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            void createSession();
                                        }
                                    }}
                                />
                                <Button
                                    className="!h-[46px] !gap-2 !px-4"
                                    onClick={() => void createSession()}
                                    disabled={pendingAction != null}
                                >
                                    <i className="fa-solid fa-plus" />
                                    <span className="hidden lg:inline">创建</span>
                                </Button>
                            </div>
                            {willAutoSuffixSessionName && (
                                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                    <i className="fa-solid fa-info-circle text-amber-500/70" />
                                    Will create: "{resolvedSessionName}"
                                </div>
                            )}
                        </div>

                        {/* Divider */}
                        <div className="hidden lg:flex items-center justify-center">
                            <div className="h-10 w-px bg-zinc-800" />
                        </div>

                        {/* Window Input */}
                        <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-2">
                            <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                                <i className="fa-solid fa-window-maximize text-emerald-500/70" />
                                Window Name <span className="text-zinc-600">(optional)</span>
                            </label>
                            <div className="flex gap-2">
                                <input
                                    className="flex-1 rounded-xl border border-zinc-700/80 bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-100 outline-none transition-all placeholder:text-zinc-600 focus:border-accent/50 focus:bg-zinc-800/70 focus:shadow-lg focus:shadow-accent/5 disabled:opacity-50"
                                    value={newWindowName}
                                    placeholder="dev, server, editor..."
                                    onChange={(e) => setNewWindowName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            void createWindow();
                                        }
                                    }}
                                    disabled={selectedSession === ""}
                                />
                                <Button
                                    className="!h-[46px] !gap-2 !px-4"
                                    onClick={() => void createWindow()}
                                    disabled={selectedSession === "" || pendingAction != null}
                                >
                                    <i className="fa-solid fa-plus" />
                                    <span className="hidden lg:inline">创建</span>
                                </Button>
                            </div>
                            {selectedSession === "" && (
                                <div className="flex items-center gap-1.5 text-xs text-zinc-600">
                                    <i className="fa-solid fa-lock" />
                                    Select a session first
                                </div>
                            )}
                        </div>
                    </div>
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
