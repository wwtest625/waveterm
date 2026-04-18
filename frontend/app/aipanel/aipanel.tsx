// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { atoms, getFocusedBlockId, getSettingsKeyAtom, recordTEvent } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { maybeUseTabModel } from "@/app/store/tab-model";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import { Popover, PopoverButton, PopoverContent } from "../element/popover";
import { deriveAgentRuntimeStatus } from "./agentstatus";
import { formatFileSizeError, isAcceptableFile, validateFileSize } from "./ai-utils";
import { AIDroppedFiles } from "./aidroppedfiles";
import { AIModeDropdown } from "./aimode";
import { loadInitialChatForPanel } from "./aipanel-loadutil";
import { AIPanelInput } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";
import { shouldHideProgressStatusLines } from "./aitooluse";
import {
    AgentTaskState,
    AskUserData,
    WaveChatSessionMeta,
    WaveUIMessage,
    getLatestAskPart,
    getLatestTaskStatePart,
    getLatestToolProgressPart,
    getLatestToolUsePart,
    toolCallFromPart,
    toolResultFromPart,
} from "./aitypes";
import { AskUserCard } from "./askusercard";
import { TaskProgressPanel } from "./taskprogresspanel";
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

const AIWelcomeMessage = memo(() => {
    return (
        <div className="text-secondary py-8">
            <div className="text-center">
                <i className="fa fa-sparkles text-4xl text-accent mb-2 block"></i>
                <p className="text-lg font-bold text-primary">欢迎使用 Wiz AI</p>
            </div>
            <div className="mt-4 text-left max-w-md mx-auto">
                <p className="text-sm">
                    Wiz AI 是你的终端智能助手，具备上下文能力。我可以读取终端输出、分析组件、访问文件，并更快帮助你解决问题。
                </p>
            </div>
        </div>
    );
});

AIWelcomeMessage.displayName = "AIWelcomeMessage";

type ContextUsageStats = {
    usedTokens: number;
    totalTokens: number;
    usedPercent: number;
};

const MODEL_CONTEXT_TOKEN_LIMITS: Array<{ pattern: RegExp; limit: number }> = [
    { pattern: /gpt-5|gpt-4\.1|o1|o3|o4/i, limit: 256000 },
    { pattern: /claude-4|claude-sonnet|claude-opus|claude-haiku/i, limit: 200000 },
    { pattern: /gemini-2\.5|gemini-2\.0/i, limit: 1000000 },
    { pattern: /gemini-1\.5/i, limit: 1000000 },
    { pattern: /qwen|deepseek|llama|mixtral|mistral|yi|phi/i, limit: 128000 },
];

function resolveModelContextLimit(modelName: string | undefined): number {
    const normalized = (modelName ?? "").trim();
    if (!normalized) {
        return 128000;
    }
    for (const item of MODEL_CONTEXT_TOKEN_LIMITS) {
        if (item.pattern.test(normalized)) {
            return item.limit;
        }
    }
    return 128000;
}

function estimateTokensFromText(text: string | undefined): number {
    const normalized = (text ?? "").trim();
    if (!normalized) {
        return 0;
    }
    // Heuristic only: mixed CJK/Latin conversations are usually between 1 token per 2-4 chars.
    return Math.ceil(normalized.length / 3);
}

function estimateMessageTokens(message: WaveUIMessage): number {
    if (!message?.parts || message.parts.length === 0) {
        return 0;
    }
    let tokens = 0;
    for (const part of message.parts) {
        if (part.type === "text" || part.type === "reasoning") {
            tokens += estimateTokensFromText(part.text);
            continue;
        }
        if (part.type === "data-tooluse") {
            const toolData = part.data as any;
            tokens += estimateTokensFromText(toolData?.tooldesc);
            tokens += estimateTokensFromText(toolData?.outputtext);
            tokens += estimateTokensFromText(toolData?.errormessage);
            continue;
        }
        if (part.type === "data-toolprogress") {
            const progressData = part.data as any;
            const lines = Array.isArray(progressData?.statuslines) ? progressData.statuslines : [];
            for (const line of lines) {
                tokens += estimateTokensFromText(line);
            }
            continue;
        }
        if (part.type === "data-ask") {
            const askData = part.data as any;
            tokens += estimateTokensFromText(askData?.prompt);
            continue;
        }
    }
    return tokens;
}

const messageTokenEstimateCache = new WeakMap<WaveUIMessage, number>();

function estimateMessageTokensCached(message: WaveUIMessage): number {
    const cached = messageTokenEstimateCache.get(message);
    if (cached != null) {
        return cached;
    }
    const estimated = estimateMessageTokens(message);
    messageTokenEstimateCache.set(message, estimated);
    return estimated;
}

function computeContextUsageStats(messages: WaveUIMessage[], modelName: string | undefined): ContextUsageStats {
    let usedTokens = 0;
    for (const message of messages) {
        usedTokens += estimateMessageTokensCached(message);
    }
    const totalTokens = resolveModelContextLimit(modelName);
    const usedPercent = totalTokens > 0 ? Math.min(100, Math.round((usedTokens / totalTokens) * 100)) : 0;
    return {
        usedTokens,
        totalTokens,
        usedPercent,
    };
}

function formatTokensCompact(tokens: number): string {
    if (tokens >= 1000000) {
        return `${Math.round(tokens / 10000) / 100}M`;
    }
    if (tokens >= 1000) {
        return `${Math.round(tokens / 10) / 100}K`;
    }
    return `${tokens}`;
}

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
    const aiModeConfigs = jotai.useAtomValue(model.aiModeConfigs);

    useEffect(() => {
        model.fixModeAfterConfigChange();
    }, [aiModeConfigs, model]);

    return null;
});

ConfigChangeModeFixer.displayName = "ConfigChangeModeFixer";

export function getHorizontalSessionTabs(
    sessions: WaveChatSessionMeta[],
    hiddenSessionIds: string[],
    activeChatId: string | null | undefined,
    maxTabs = 3
): WaveChatSessionMeta[] {
    const visibleSessions = sessions.filter((session) => !hiddenSessionIds.includes(session.chatid));
    const normalizedMaxTabs = Math.max(1, maxTabs);
    const defaultTabs = visibleSessions.slice(0, normalizedMaxTabs);
    if (!activeChatId) {
        return defaultTabs;
    }
    if (defaultTabs.some((session) => session.chatid === activeChatId)) {
        return defaultTabs;
    }
    const activeSession = visibleSessions.find((session) => session.chatid === activeChatId);
    if (!activeSession) {
        return defaultTabs;
    }
    const tabsWithActive = [...defaultTabs.slice(0, normalizedMaxTabs - 1), activeSession];
    const visibleIndexByChatId = new Map(visibleSessions.map((session, index) => [session.chatid, index]));
    return tabsWithActive.sort((left, right) => {
        const leftIndex = visibleIndexByChatId.get(left.chatid) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = visibleIndexByChatId.get(right.chatid) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
    });
}

type SessionHistoryGroup = {
    label: string;
    sessions: WaveChatSessionMeta[];
};

function normalizeSessionTs(ts: number | undefined): number {
    if (!ts || ts <= 0) {
        return 0;
    }
    return ts < 1_000_000_000_000 ? ts * 1000 : ts;
}

function getSessionSortTs(session: WaveChatSessionMeta): number {
    return normalizeSessionTs(session.updatedts ?? session.createdts);
}

function formatHistoryGroupLabel(dayStartTs: number, todayStartTs: number): string {
    if (dayStartTs === todayStartTs) {
        return "今天";
    }
    if (dayStartTs === todayStartTs - 24 * 60 * 60 * 1000) {
        return "昨天";
    }
    const date = new Date(dayStartTs);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}.${month}.${day}`;
}

const AISessionToolbar = memo(({ messages }: { messages: WaveUIMessage[] }) => {
    const model = WaveAIModel.getInstance();
    const sessions = jotai.useAtomValue(model.sessionsAtom);
    const hiddenSessionIds = jotai.useAtomValue(model.hiddenSessionIdsAtom);
    const activeChatId = jotai.useAtomValue(model.chatId);
    const [query, setQuery] = useState("");
    const [cheatsheetDraft, setCheatsheetDraft] = useState({
        currentwork: "",
        completed: "",
        blockedby: "",
        nextstep: "",
    });
    const currentMode = jotai.useAtomValue(model.currentAIMode);
    const aiModeConfigs = jotai.useAtomValue(model.aiModeConfigs);
    const currentModelName = aiModeConfigs?.[currentMode]?.["ai:model"];
    const activeSession = useMemo(
        () => sessions.find((session) => session.chatid === activeChatId) ?? null,
        [activeChatId, sessions]
    );
    const contextUsage = useMemo(
        () => computeContextUsageStats(messages, currentModelName),
        [messages, currentModelName]
    );

    useEffect(() => {
        const cheatsheet = activeSession?.cheatsheet;
        setCheatsheetDraft({
            currentwork: cheatsheet?.currentwork ?? "",
            completed: cheatsheet?.completed ?? "",
            blockedby: cheatsheet?.blockedby ?? "",
            nextstep: cheatsheet?.nextstep ?? "",
        });
    }, [activeSession?.chatid, activeSession?.cheatsheet?.blockedby, activeSession?.cheatsheet?.completed, activeSession?.cheatsheet?.currentwork, activeSession?.cheatsheet?.nextstep]);

    const filteredSessions = sessions.filter((session) => {
        if (hiddenSessionIds.includes(session.chatid)) {
            return false;
        }
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return true;
        }
        const haystack = `${session.title ?? ""} ${session.summary ?? ""}`.toLowerCase();
        return haystack.includes(needle);
    });
    const displaySessions = useMemo(() => {
        let seenDraftSession = false;
        return filteredSessions.filter((session) => {
            const isReusableDraftSession = (session.title ?? "") === "New Chat" && !(session.summary ?? "").trim();
            if (!isReusableDraftSession) {
                return true;
            }
            if (seenDraftSession) {
                return false;
            }
            seenDraftSession = true;
            return true;
        });
    }, [filteredSessions]);
    const groupedHistorySessions = useMemo<SessionHistoryGroup[]>(() => {
        if (displaySessions.length === 0) {
            return [];
        }
        const groups = new Map<number, WaveChatSessionMeta[]>();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStartTs = today.getTime();
        for (const session of displaySessions) {
            const sessionTs = getSessionSortTs(session);
            const bucketTs = sessionTs > 0 ? (() => {
                const bucketDate = new Date(sessionTs);
                bucketDate.setHours(0, 0, 0, 0);
                return bucketDate.getTime();
            })() : 0;
            const bucket = groups.get(bucketTs);
            if (bucket) {
                bucket.push(session);
            } else {
                groups.set(bucketTs, [session]);
            }
        }
        const orderedBuckets = [...groups.entries()].sort((left, right) => right[0] - left[0]);
        return orderedBuckets.map(([bucketTs, bucketSessions]) => ({
            label: bucketTs > 0 ? formatHistoryGroupLabel(bucketTs, todayStartTs) : "更早",
            sessions: bucketSessions,
        }));
    }, [displaySessions]);

    return (
        <div className="border-b border-white/8 bg-black/15 px-2 py-2">
            <div className="flex flex-wrap items-center gap-2">
                <AIModeDropdown />
                <Popover placement="bottom-start">
                    <PopoverButton
                        className="flex h-10 min-w-[118px] items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs text-zinc-200 transition-colors hover:bg-white/[0.07]"
                        as="div"
                    >
                        <span className="font-medium">会话小抄</span>
                        <i className="fa-solid fa-chevron-down ml-2 text-[10px] text-zinc-500" />
                    </PopoverButton>
                    <PopoverContent className="flex min-h-0 w-[360px] max-w-[calc(100vw-24px)] flex-col gap-0 rounded-xl border border-white/10 bg-zinc-900/96 p-3 shadow-2xl backdrop-blur">
                        <div className="mb-3">
                            <div className="text-sm font-medium text-white">会话小抄</div>
                            <div className="mt-1 text-[11px] text-zinc-400">这四项会重新注入模型请求，用户可以手动修正。</div>
                        </div>
                        <div className="space-y-3">
                            <label className="block">
                                <div className="mb-1 text-[11px] text-zinc-400">现在在做什么</div>
                                <input
                                    value={cheatsheetDraft.currentwork}
                                    onChange={(e) => setCheatsheetDraft((prev) => ({ ...prev, currentwork: e.target.value }))}
                                    className="w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
                                    placeholder="当前任务"
                                />
                            </label>
                            <label className="block">
                                <div className="mb-1 text-[11px] text-zinc-400">已经完成什么</div>
                                <input
                                    value={cheatsheetDraft.completed}
                                    onChange={(e) => setCheatsheetDraft((prev) => ({ ...prev, completed: e.target.value }))}
                                    className="w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
                                    placeholder="已完成项"
                                />
                            </label>
                            <label className="block">
                                <div className="mb-1 text-[11px] text-zinc-400">当前卡点</div>
                                <input
                                    value={cheatsheetDraft.blockedby}
                                    onChange={(e) => setCheatsheetDraft((prev) => ({ ...prev, blockedby: e.target.value }))}
                                    className="w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
                                    placeholder="阻塞点"
                                />
                            </label>
                            <label className="block">
                                <div className="mb-1 text-[11px] text-zinc-400">下一步</div>
                                <input
                                    value={cheatsheetDraft.nextstep}
                                    onChange={(e) => setCheatsheetDraft((prev) => ({ ...prev, nextstep: e.target.value }))}
                                    className="w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
                                    placeholder="下一步动作"
                                />
                            </label>
                        </div>
                        <div className="mt-3 flex w-full shrink-0 justify-end gap-2 border-t border-white/8 pt-3">
                            <button
                                type="button"
                                onClick={() =>
                                    setCheatsheetDraft({
                                        currentwork: activeSession?.cheatsheet?.currentwork ?? "",
                                        completed: activeSession?.cheatsheet?.completed ?? "",
                                        blockedby: activeSession?.cheatsheet?.blockedby ?? "",
                                        nextstep: activeSession?.cheatsheet?.nextstep ?? "",
                                    })
                                }
                                className="inline-flex h-9 min-w-16 items-center justify-center rounded-lg border border-white/8 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 whitespace-nowrap hover:bg-white/8"
                            >
                                重置
                            </button>
                            <button
                                type="button"
                                disabled={!activeSession?.chatid}
                                onClick={() =>
                                    void model.updateSessionCheatsheet(activeSession?.chatid ?? "", cheatsheetDraft)
                                }
                                className={cn(
                                    "inline-flex h-9 min-w-16 items-center justify-center rounded-lg px-3 py-1.5 text-xs whitespace-nowrap",
                                    activeSession?.chatid
                                        ? "bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/20"
                                        : "bg-white/5 text-zinc-500"
                                )}
                            >
                                保存
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>
                <Popover className="min-w-0" placement="bottom-start" onDismiss={() => setQuery("")}>
                    <PopoverButton
                        className="flex h-10 min-w-[118px] items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs text-zinc-200 transition-colors hover:bg-white/[0.07]"
                        as="div"
                    >
                        <span className="font-medium">History</span>
                        <i className="fa-solid fa-chevron-down ml-2 text-[10px] text-zinc-500" />
                    </PopoverButton>
                    <PopoverContent className="flex w-[320px] max-w-[calc(100vw-24px)] flex-col rounded-xl border border-white/10 bg-zinc-900/96 p-2 shadow-2xl backdrop-blur">
                        <div className="flex w-full items-center rounded-md border border-white/8 bg-white/5 px-2 text-zinc-400 focus-within:border-lime-300/35 focus-within:text-zinc-300">
                            <i className="fa-solid fa-magnifying-glass text-[11px]" />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="请输入"
                                className="w-full bg-transparent px-2 py-1.5 text-xs text-white outline-none placeholder:text-zinc-500"
                            />
                        </div>
                        <div className="mt-2 w-full max-h-[420px] overflow-y-auto pr-1">
                            {groupedHistorySessions.map((group) => (
                                <div key={group.label} className="border-b border-white/8 py-2 last:border-b-0 last:pb-0">
                                    <div className="mb-2 px-1 text-[11px] text-zinc-500">{group.label}</div>
                                    <div className="flex flex-col">
                                        {group.sessions.map((session) => (
                                            <div
                                                key={session.chatid}
                                                className={cn(
                                                    "group flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
                                                    session.chatid === activeChatId ? "bg-white/8" : "hover:bg-white/6"
                                                )}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => void model.switchSession(session.chatid)}
                                                    className={cn(
                                                        "min-w-0 flex-1 truncate text-left text-[13px] font-medium transition-colors",
                                                        session.chatid === activeChatId ? "text-white" : "text-zinc-200 hover:text-white"
                                                    )}
                                                    title={session.summary || session.title || "New Chat"}
                                                >
                                                    {session.title || "New Chat"}
                                                </button>
                                                <div
                                                    className={cn(
                                                        "flex items-center gap-0.5 transition-opacity",
                                                        session.chatid === activeChatId ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const nextTitle = window.prompt("Rename this session", session.title ?? "New Chat");
                                                            if (nextTitle && nextTitle.trim()) {
                                                                void model.renameSession(session.chatid, nextTitle);
                                                            }
                                                        }}
                                                        className="flex h-6 w-6 items-center justify-center rounded-md text-xs text-zinc-500 hover:bg-white/10 hover:text-white"
                                                        title="Rename"
                                                        aria-label="Rename session"
                                                    >
                                                        <i className="fa-regular fa-pen-to-square" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (window.confirm(`Delete "${session.title || "New Chat"}" permanently?`)) {
                                                                void model.deleteSession(session.chatid);
                                                            }
                                                        }}
                                                        className="flex h-6 w-6 items-center justify-center rounded-md text-xs text-zinc-500 hover:bg-red-400/10 hover:text-red-300"
                                                        title="Delete"
                                                        aria-label="Delete session"
                                                    >
                                                        <i className="fa-regular fa-trash-can" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {groupedHistorySessions.length === 0 && (
                                <div className="px-2 py-3 text-xs text-zinc-500">No matching history</div>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
                <div className="ml-auto flex items-center gap-2">
                    <div className="flex h-8 min-w-[146px] flex-col justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3">
                        <div className="mt-1 text-xs leading-none text-zinc-300">
                            <span className="text-lime-200">{contextUsage.usedPercent}% </span>
                            <span className="mx-1 text-zinc-500">·</span>
                            统计 {formatTokensCompact(contextUsage.usedTokens)} ，共{" "}
                            {formatTokensCompact(contextUsage.totalTokens)}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => model.clearChat()}
                        className="rounded-full border border-lime-300/20 bg-lime-300/10 px-3 py-1 text-xs text-lime-200 hover:bg-lime-300/15"
                    >
                        New
                    </button>
                </div>
            </div>
        </div>
    );
});

AISessionToolbar.displayName = "AISessionToolbar";

const CommandInteractionInput = memo(() => {
    const model = WaveAIModel.getInstance();
    const interaction = jotai.useAtomValue(model.commandInteractionAtom);
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        setInput("");
    }, [interaction?.jobId, interaction?.promptHint]);

    useEffect(() => {
        if (!interaction || interaction.tuiSuppressed) {
            return;
        }
        const timer = window.setTimeout(() => {
            inputRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [interaction]);

    if (!interaction) {
        return null;
    }
    const allowEmptyInput = Boolean(interaction.inputOptions?.some((option) => option === ""));
    const canSend = input.trim().length > 0 || allowEmptyInput;

    return (
        <div className="mx-2 mb-2 rounded-xl border border-amber-300/20 bg-amber-300/8 px-3 py-3 text-sm text-zinc-200">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-medium text-amber-100">
                        {interaction.tuiDetected
                            ? "Interactive TUI detected"
                            : interaction.promptHint || "Command is waiting for input"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                        {interaction.tuiSuppressed
                            ? "Wave suppressed the TUI so the session stays usable. Continue it in a terminal if you need the full screen app."
                            : "Submit input below to continue the running command."}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void model.cancelExecution()}
                    className="rounded-full border border-red-300/20 bg-red-300/10 px-3 py-1 text-xs text-red-200"
                >
                    Cancel
                </button>
            </div>
            {interaction.outputPreview && (
                <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-black/20 p-2 text-[11px] text-zinc-300">
                    {interaction.outputPreview}
                </pre>
            )}
            {!interaction.tuiSuppressed && (
                <>
                    {interaction.inputOptions && interaction.inputOptions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {interaction.inputOptions.map((option) => (
                                <button
                                    key={option === "" ? "__enter__" : option}
                                    type="button"
                                    onClick={() => void model.submitCommandInteraction(option)}
                                    className="rounded-full border border-white/8 bg-white/6 px-2 py-1 text-[11px] text-zinc-200"
                                >
                                    {option === "" ? "Enter" : option}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="mt-2 flex gap-2">
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={interaction.promptHint || "Type command input"}
                            className="min-w-0 flex-1 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
                        />
                        <button
                            type="button"
                            onClick={() => void model.submitCommandInteraction(input)}
                            disabled={!canSend}
                            className={cn(
                                "rounded-lg px-3 py-2 text-sm",
                                canSend
                                    ? "bg-amber-300/15 text-amber-100 hover:bg-amber-300/20"
                                    : "bg-white/5 text-zinc-500"
                            )}
                        >
                            Send
                        </button>
                    </div>
                </>
            )}
        </div>
    );
});

CommandInteractionInput.displayName = "CommandInteractionInput";

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
    const isPanelVisible = jotai.useAtomValue(model.getPanelVisibleAtom());
    const errorMessage = jotai.useAtomValue(model.errorMessage);
    const agentRuntimeSnapshot = jotai.useAtomValue(model.agentRuntimeAtom);
    const taskState = jotai.useAtomValue(model.taskStateAtom);
    const commandInteraction = jotai.useAtomValue(model.commandInteractionAtom);
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

    const derivedAgentStatusSnapshot = deriveAgentRuntimeStatus({
        provider: "Wave AI",
        mode: agentMode,
        chatStatus: status,
        messages,
        errorMessage,
    });

    useEffect(() => {
        if (commandInteraction || agentRuntimeSnapshot.activeJobId) {
            return;
        }
        model.mergeAgentRuntimeSnapshot(derivedAgentStatusSnapshot);
    }, [agentRuntimeSnapshot.activeJobId, commandInteraction, derivedAgentStatusSnapshot, model]);

    useEffect(() => {
        const currentChatId = globalStore.get(model.chatId);
        if (status !== "ready" || !currentChatId) {
            return;
        }
        void model.loadSessions();
    }, [status, model]);

    useEffect(() => {
        const taskId = globalStore.get(model.chatId) || "waveai";
        const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
        const latestTaskState = getLatestTaskStatePart(lastAssistantMessage);
        const latestToolUse = getLatestToolUsePart(lastAssistantMessage);
        const latestToolProgress = getLatestToolProgressPart(lastAssistantMessage);
        if (latestTaskState?.data) {
            const taskStateData = latestTaskState.data as AgentTaskState;
            globalStore.set(model.taskStateAtom, taskStateData);
            if (taskStateData.focuschain) {
                globalStore.set(model.focusChainAtom, taskStateData.focuschain);
            }
            if (taskStateData.focuschain?.currentcontextusage != null) {
                globalStore.set(model.contextUsageAtom, taskStateData.focuschain.currentcontextusage);
            }
            if (taskStateData.securityblocked) {
                globalStore.set(model.securityBlockedAtom, true);
            }
        }
        const currentInteraction = globalStore.get(model.commandInteractionAtom);
        if (
            latestToolUse?.data?.toolname === "wave_run_command" &&
            latestToolUse.data.status === "running" &&
            latestToolUse.data.jobid &&
            (latestToolUse.data.awaitinginput || latestToolUse.data.tuidetected)
        ) {
            // The backend detector is the single source of truth for interaction state.
            // The frontend only maps structured RPC fields into UI state.
            const nextInteraction = {
                jobId: latestToolUse.data.jobid,
                awaitingInput: Boolean(latestToolUse.data.awaitinginput),
                promptHint: latestToolUse.data.prompthint || "Command is waiting for terminal input",
                inputOptions: latestToolUse.data.inputoptions,
                tuiDetected: latestToolUse.data.tuidetected,
                tuiSuppressed: latestToolUse.data.tuisuppressed,
                outputPreview: latestToolUse.data.outputtext,
            };
            const changed =
                currentInteraction?.jobId !== nextInteraction.jobId ||
                currentInteraction?.awaitingInput !== nextInteraction.awaitingInput ||
                currentInteraction?.promptHint !== nextInteraction.promptHint ||
                currentInteraction?.tuiDetected !== nextInteraction.tuiDetected ||
                currentInteraction?.tuiSuppressed !== nextInteraction.tuiSuppressed ||
                JSON.stringify(currentInteraction?.inputOptions ?? []) !==
                    JSON.stringify(nextInteraction.inputOptions ?? []) ||
                currentInteraction?.outputPreview !== nextInteraction.outputPreview;
            if (changed) {
                globalStore.set(model.commandInteractionAtom, nextInteraction);
                model.dispatchAgentEvent({
                    type: "INTERACTION_REQUIRED",
                    reason: nextInteraction.promptHint,
                });
            }
        } else if (
            currentInteraction?.jobId &&
            latestToolUse?.data?.toolname === "wave_run_command" &&
            latestToolUse.data.jobid === currentInteraction.jobId &&
            (latestToolUse.data.status !== "running" ||
                (!latestToolUse.data.awaitinginput && !latestToolUse.data.tuidetected))
        ) {
            globalStore.set(model.commandInteractionAtom, null);
        }

        const latestAsk = getLatestAskPart(lastAssistantMessage);
        if (latestAsk?.data) {
            const askData = latestAsk.data as AskUserData;
            if (askData.status === "pending") {
                const currentAsk = globalStore.get(model.askUserAtom);
                if (currentAsk?.actionid !== askData.actionid) {
                    globalStore.set(model.askUserAtom, askData);
                    model.dispatchAgentEvent({ type: "ASK_USER", reason: askData.prompt });
                }
            } else if (askData.status === "answered" || askData.status === "canceled") {
                globalStore.set(model.askUserAtom, null);
            }
        }

        if (latestToolUse) {
            const lastToolCall = toolCallFromPart(latestToolUse, taskId);
            const lastToolResult = toolResultFromPart(latestToolUse, taskId) ?? undefined;
            const isRunningTool = latestToolUse.data.status === "running";
            const progressBlockedReason =
                !shouldHideProgressStatusLines(latestToolProgress?.data?.toolname) &&
                latestToolProgress?.data?.statuslines?.find((line) => Boolean(line?.trim()));
            model.mergeAgentRuntimeSnapshot({
                lastToolCall,
                lastToolResult,
                blockedReason: latestToolUse.data.errormessage ?? latestToolUse.data.tooldesc ?? progressBlockedReason,
                ...(isRunningTool && latestToolUse.data.jobid
                    ? {
                          state: "executing" as const,
                          phaseLabel: "Executing Command",
                          activeTool: latestToolUse.data.toolname,
                          activeJobId: latestToolUse.data.jobid,
                      }
                    : {
                          activeTool: undefined,
                          activeJobId: undefined,
                      }),
            });
            if (latestToolUse.data.approval === "needs-approval") {
                model.dispatchAgentEvent({
                    type: "APPROVAL_REQUIRED",
                    reason: latestToolUse.data.tooldesc || "Waiting for tool approval",
                });
            }
            if (
                latestToolUse.data.errormessage &&
                (latestToolUse.data.errormessage.includes("命令被安全机制阻止") ||
                    latestToolUse.data.errormessage.includes("command_blocked"))
            ) {
                globalStore.set(model.securityBlockedAtom, true);
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
        if (commandInteraction) {
            return;
        }
        if (messages.length > 0) {
            model.dispatchAgentEvent({ type: "VERIFY_FINISHED", ok: true });
        }
    }, [status, errorMessage, messages.length, commandInteraction, model]);

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
        const terminalStates = new Set([
            "completed",
            "success",
            "failed_retryable",
            "failed_fatal",
            "cancelled",
            "unavailable",
        ]);
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
                "mt-1 h-[calc(100%-4px)]",
                (isDragOver || isReactDndDragOver) && "bg-zinc-800 border-accent",
                isFocused ? "border-2 border-accent" : "border-2 border-transparent"
            )}
            style={{
                borderTopRightRadius: 10,
                borderBottomRightRadius: 10,
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
            {(isDragOver || isReactDndDragOver) && <AIDragOverlay />}
            {showBlockMask && <AIBlockMask />}
            <div key="main-content" className="flex-1 flex flex-col min-h-0">
                <AISessionToolbar messages={messages} />
                <TaskProgressPanel taskState={taskState} />
                {messages.length === 0 && initialLoadDone ? (
                    <div
                        className="flex-1 overflow-y-auto p-2 relative"
                        onContextMenu={(e) => handleWaveAIContextMenu(e, true)}
                    >
                                <AIWelcomeMessage />
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
                <CommandInteractionInput />
                <AskUserCard />
                <AIPanelInput onSubmit={handleSubmit} status={status} model={model} />
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
