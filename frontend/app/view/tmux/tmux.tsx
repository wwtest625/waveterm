// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWidgetWidthMenuItems } from "@/app/workspace/widgetsettings";
import { WOS } from "@/store/global";
import { sendCommandToFocusedTerminal } from "@/util/previewutil";
import clsx from "clsx";
import { atom } from "jotai";
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    buildTmuxEnterOrCreateSessionCommand,
    buildTmuxEnterSessionCommand,
    buildTmuxEnterWindowCommand,
    formatDangerConfirmText,
    getNextSuffixName,
    getTmuxErrorHeadline,
    trimNameInput,
} from "./tmux-util";

const TmuxViewComponent = memo(function TmuxViewWithBoundary(props: ViewComponentProps<TmuxViewModel>) {
    return (
        <TmuxErrorBoundary>
            <TmuxView {...props} />
        </TmuxErrorBoundary>
    );
});

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
    onToggle,
    onEnter,
    onSelect,
    onContextMenu,
}: {
    session: TmuxSessionSummary;
    windows: TmuxWindowSummary[];
    isExpanded: boolean;
    isSelected: boolean;
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
                        {session.attached} 已连接
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
                <span className="hidden md:inline">进入</span>
                <i className="fa-solid fa-arrow-right text-accent" />
            </div>
        </div>
    );
}

function WindowNode({
    session,
    window,
    isSelected,
    onEnter,
    onSelect,
    onContextMenu,
}: {
    session: TmuxSessionSummary;
    window: TmuxWindowSummary;
    isSelected: boolean;
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
        <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto p-3" onKeyDown={handleKeyDown} tabIndex={0}>
            {sessions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-zinc-800 bg-zinc-900/50 text-sm">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800/50">
                        <i className="fa-solid fa-folder-open text-3xl text-zinc-600" />
                    </div>
                    <div className="text-zinc-500">暂无 tmux 会话</div>
                    <div className="text-xs text-zinc-600">使用下方表单创建一个</div>
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

class TmuxErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-full items-center justify-center p-8 text-sm text-zinc-400">
                    <div className="text-center">
                        <i className="fa-solid fa-circle-exclamation mb-2 text-2xl text-red-400" />
                        <div className="font-medium text-red-300">Tmux 组件渲染出错</div>
                        <div className="mt-1 text-xs text-zinc-500">请刷新页面重试</div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
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
    const refreshVersionRef = useRef(0);
    const selectedSessionRef = useRef(selectedSession);
    selectedSessionRef.current = selectedSession;

    const [confirmDialog, setConfirmDialog] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);
    const [promptDialog, setPromptDialog] = useState<{
        title: string;
        defaultValue: string;
        onSubmit: (value: string) => void;
    } | null>(null);
    const [promptInput, setPromptInput] = useState("");

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
            const thisVersion = ++refreshVersionRef.current;
            try {
                const sessionResp = await RpcApi.TmuxListSessionsCommand(TabRpcClient, { connection });
                if (thisVersion !== refreshVersionRef.current) {
                    return;
                }
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

                const currentSelected = selectedSessionRef.current;
                const hasCurrentSelection = nextSessions.some((session) => session.name === currentSelected);
                const nextSelectedSession = hasCurrentSelection ? currentSelected : nextSessions[0]?.name ?? "";
                setSelectedSession(nextSelectedSession);

                if (!hasCurrentSelection && nextSelectedSession) {
                    setExpandedSessionIds((prev) => new Set([...prev, nextSelectedSession]));
                }

                if (nextSessions.length === 0) {
                    setWindowsBySession({});
                    return;
                }

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
                if (thisVersion !== refreshVersionRef.current) {
                    return;
                }
                const nextWindowsBySession: Record<string, TmuxWindowSummary[]> = {};
                for (const result of windowResults) {
                    nextWindowsBySession[result.sessionName] = result.windows;
                }
                setWindowsBySession(nextWindowsBySession);
            } catch (err) {
                if (thisVersion !== refreshVersionRef.current) {
                    return;
                }
                const message = err instanceof Error ? err.message : String(err);
                setLoadingError({ code: "unknown", message } as TmuxError);
                setSessions([]);
                setWindowsBySession({});
            } finally {
                if (thisVersion === refreshVersionRef.current) {
                    setLoading(false);
                }
            }
        },
        [connection]
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

    const runTmuxAction = useCallback(
        async (request: TmuxActionRequest, actionLabel: string) => {
            setPendingAction(actionLabel);
            setActionError(null);
            setStatusMessage(null);
            try {
                const resp = await RpcApi.TmuxActionCommand(TabRpcClient, request);
                if (resp?.error) {
                    setActionError(getTmuxErrorHeadline(resp.error));
                    return false;
                }
                setStatusMessage(actionLabel);
                return true;
            } catch (err) {
                setActionError(`tmux 操作失败：${err instanceof Error ? err.message : String(err)}`);
                return false;
            } finally {
                setPendingAction(null);
            }
        },
        []
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
        (actionLabel: string, sessionName: string, windowName?: string): Promise<boolean> => {
            return new Promise((resolve) => {
                setConfirmDialog({
                    title: actionLabel,
                    message: formatDangerConfirmText(actionLabel, connection, sessionName, windowName),
                    onConfirm: () => {
                        setConfirmDialog(null);
                        resolve(true);
                    },
                });
            });
        },
        [connection]
    );

    const createSession = useCallback(async () => {
        const baseName = baseSessionName;
        const resolvedName = resolvedSessionName;
        const created = await runTmuxAction(
            {
                connection,
                action: "create_session",
                session: resolvedName,
            },
            `已创建 Session ${resolvedName}`
        );
        if (!created) {
            return;
        }
        setNewSessionName(baseName);
        setSelectedSession(resolvedName);
        setExpandedSessionIds((prev) => new Set([...prev, resolvedName]));
        setStatusMessage(`已创建 Session ${resolvedName}`);
        await refreshData(false);
    }, [baseSessionName, connection, refreshData, resolvedSessionName, runTmuxAction]);

    const createWindow = useCallback(async () => {
        if (selectedSession === "") {
            setActionError("请先选择一个 Session 再创建 Window。");
            return;
        }
        const trimmedWindowName = trimNameInput(newWindowName);
        const createLabel =
            trimmedWindowName === ""
                ? `已在 ${selectedSession} 创建 Window`
                : `已在 ${selectedSession} 创建 Window ${trimmedWindowName}`;
        const created = await runTmuxAction(
            {
                connection,
                action: "create_window",
                session: selectedSession,
                windowName: trimmedWindowName,
            },
            createLabel
        );
        if (!created) {
            return;
        }
        setNewWindowName("");
        const latestWindowResp = await RpcApi.TmuxListWindowsCommand(TabRpcClient, {
            connection,
            session: selectedSession,
        });
        const latestWindows = latestWindowResp?.windows ?? [];
        const nextWindow =
            trimmedWindowName === ""
                ? latestWindows.reduce<TmuxWindowSummary | null>(
                      (candidate, windowItem) => (candidate == null || windowItem.index > candidate.index ? windowItem : candidate),
                      null
                  )
                : latestWindows.find((windowItem) => windowItem.name === trimmedWindowName) ?? null;
        if (nextWindow == null) {
            setStatusMessage(
                trimmedWindowName === ""
                    ? `Window 已创建，但未能确定新窗口编号。`
                    : `Window ${trimmedWindowName} 已创建，但未能自动进入。`
            );
            await refreshData(false);
            return;
        }
        const entered = await sendCommand(
            buildTmuxEnterWindowCommand(selectedSession, nextWindow.index),
            `进入 Window ${nextWindow.index}:${nextWindow.name}`
        );
        if (!entered) {
            setStatusMessage(`Window ${nextWindow.index}:${nextWindow.name} 已创建，但未能自动进入。`);
        }
        await refreshData(false);
    }, [connection, newWindowName, refreshData, runTmuxAction, selectedSession, sendCommand]);

    const requestPromptInput = useCallback(
        (title: string, defaultValue: string): Promise<string | null> => {
            return new Promise((resolve) => {
                setPromptInput(defaultValue);
                setPromptDialog({
                    title,
                    defaultValue,
                    onSubmit: (value: string) => {
                        setPromptDialog(null);
                        resolve(trimNameInput(value));
                    },
                });
            });
        },
        []
    );

    const renameSession = useCallback(
        async (sessionName: string) => {
            const nextName = await requestPromptInput(`重命名 Session "${sessionName}"`, sessionName);
            if (nextName == null || nextName === "" || nextName === sessionName) {
                return;
            }
            const ok = await runTmuxAction(
                {
                    connection,
                    action: "rename_session",
                    session: sessionName,
                    newName: nextName,
                },
                `已重命名 Session ${sessionName} -> ${nextName}`
            );
            if (ok && selectedSession === sessionName) {
                setSelectedSession(nextName);
            }
            if (ok) {
                await refreshData(false);
            }
        },
        [connection, refreshData, requestPromptInput, runTmuxAction, selectedSession]
    );

    const renameWindow = useCallback(
        async (sessionName: string, windowItem: TmuxWindowSummary) => {
            const nextName = await requestPromptInput(`重命名 Window "${windowItem.name}"`, windowItem.name);
            if (nextName == null || nextName === "" || nextName === windowItem.name) {
                return;
            }
            const ok = await runTmuxAction(
                {
                    connection,
                    action: "rename_window",
                    session: sessionName,
                    windowIndex: windowItem.index,
                    newName: nextName,
                },
                `已重命名 Window ${windowItem.name} -> ${nextName}`
            );
            if (ok) {
                await refreshData(false);
            }
        },
        [connection, refreshData, requestPromptInput, runTmuxAction]
    );

    const detachSession = useCallback(
        async (sessionName: string) => {
            if (!confirmDangerousAction("Detach", sessionName)) {
                return;
            }
            const ok = await runTmuxAction(
                {
                    connection,
                    action: "detach_session",
                    session: sessionName,
                },
                `已 Detach Session ${sessionName}`
            );
            if (ok) {
                await refreshData(false);
            }
        },
        [confirmDangerousAction, connection, refreshData, runTmuxAction]
    );

    const killSession = useCallback(
        async (sessionName: string) => {
            if (!confirmDangerousAction("Kill Session", sessionName)) {
                return;
            }
            const ok = await runTmuxAction(
                {
                    connection,
                    action: "kill_session",
                    session: sessionName,
                },
                `已 Kill Session ${sessionName}`
            );
            if (ok) {
                await refreshData(false);
            }
        },
        [confirmDangerousAction, connection, refreshData, runTmuxAction]
    );

    const killWindow = useCallback(
        async (sessionName: string, windowItem: TmuxWindowSummary) => {
            const windowTitle = `${windowItem.index}:${windowItem.name}`;
            if (!confirmDangerousAction("Kill Window", sessionName, windowTitle)) {
                return;
            }
            const ok = await runTmuxAction(
                {
                    connection,
                    action: "kill_window",
                    session: sessionName,
                    windowIndex: windowItem.index,
                },
                `已 Kill Window ${windowTitle}`
            );
            if (ok) {
                await refreshData(false);
            }
        },
        [confirmDangerousAction, connection, refreshData, runTmuxAction]
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
        if (nodeId.startsWith("session:")) {
            const sessionName = nodeId.slice("session:".length);
            setSelectedSession(sessionName);
        }
    }, []);

    const enterNode = useCallback(
        (nodeId: string) => {
            if (pendingAction != null) {
                return;
            }
            if (nodeId.startsWith("session:")) {
                const sessionName = nodeId.slice("session:".length);
                void enterSession(sessionName);
            } else if (nodeId.startsWith("window:")) {
                const rest = nodeId.slice("window:".length);
                const colonIdx = rest.lastIndexOf(":");
                if (colonIdx < 0) {
                    return;
                }
                const sessionName = rest.slice(0, colonIdx);
                const windowIndex = parseInt(rest.slice(colonIdx + 1), 10);
                if (isNaN(windowIndex)) {
                    return;
                }
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
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-gradient-to-b from-zinc-900 via-zinc-900 to-zinc-950 text-zinc-100">
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

            {/* Confirm Dialog */}
            {confirmDialog && (
                <div className="shrink-0 px-4">
                    <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
                        <div className="mb-1 font-medium text-amber-200">{confirmDialog.title}</div>
                        <div className="whitespace-pre-line text-amber-100/80">{confirmDialog.message}</div>
                        <div className="mt-3 flex items-center gap-2">
                            <Button
                                className="!h-8 !gap-2 !px-3 !text-xs !bg-red-500/20 !border-red-500/30 !text-red-300 hover:!bg-red-500/30"
                                onClick={confirmDialog.onConfirm}
                            >
                                <i className="fa-solid fa-check" />
                                确认
                            </Button>
                            <Button
                                className="!h-8 !gap-2 !px-3 !text-xs grey"
                                onClick={() => setConfirmDialog(null)}
                            >
                                取消
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Prompt Dialog */}
            {promptDialog && (
                <div className="shrink-0 px-4">
                    <div className="mb-3 rounded-xl border border-zinc-700/50 bg-zinc-800/50 px-4 py-3 text-sm">
                        <div className="mb-2 font-medium text-zinc-200">{promptDialog.title}</div>
                        <div className="flex items-center gap-2">
                            <input
                                className="flex-1 rounded-lg border border-zinc-600/80 bg-zinc-700/50 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent/50"
                                value={promptInput}
                                onChange={(e) => setPromptInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        promptDialog.onSubmit(promptInput);
                                    } else if (e.key === "Escape") {
                                        setPromptDialog(null);
                                    }
                                }}
                                autoFocus
                            />
                            <Button
                                className="!h-8 !gap-2 !px-3 !text-xs"
                                onClick={() => promptDialog.onSubmit(promptInput)}
                            >
                                <i className="fa-solid fa-check" />
                                确定
                            </Button>
                            <Button
                                className="!h-8 !gap-2 !px-3 !text-xs grey"
                                onClick={() => setPromptDialog(null)}
                            >
                                取消
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="mx-4 mt-0 shrink-0">
                <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800/80 bg-gradient-to-r from-zinc-800/40 via-zinc-800/20 to-zinc-800/40 p-5 backdrop-blur-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4">
                            {/* Logo */}
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 shadow-lg shadow-amber-500/10">
                                <i className="fa-solid fa-terminal text-2xl text-amber-400" />
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
                                    服务离线
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
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/45 p-4">
                            <label className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
                                <i className="fa-solid fa-folder text-amber-500/70" />
                                会话名称
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
                                    <span className="hidden lg:inline">创建 Session</span>
                                </Button>
                            </div>
                            {willAutoSuffixSessionName && (
                                <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
                                    <i className="fa-solid fa-info-circle text-amber-500/70" />
                                    Will create: "{resolvedSessionName}"
                                </div>
                            )}
                        </div>

                        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/45 p-4">
                            <label className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
                                <i className="fa-solid fa-window-maximize text-emerald-500/70" />
                                窗口名称 <span className="text-zinc-600">（可选）</span>
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
                                    <span className="hidden lg:inline">创建 Window</span>
                                </Button>
                            </div>
                            {selectedSession === "" && (
                                <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600">
                                    <i className="fa-solid fa-lock" />
                                    请先选择一个会话
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tree View */}
            <div className="mx-4 mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm">
                <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
                        <i className="fa-solid fa-layer-group text-accent" />
                        会话与窗口
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

    getSettingsMenuItems(): ContextMenuItem[] {
        const widthSubMenu = getWidgetWidthMenuItems({
            blockId: this.blockId,
            tabModel: this.tabModel,
        });
        if (widthSubMenu.length === 0) {
            return [];
        }
        return [{ label: "Width", submenu: widthSubMenu }];
    }

    get viewComponent(): ViewComponent {
        return TmuxViewComponent;
    }
}
