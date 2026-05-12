import { cn } from "@/util/util";
import { memo, useCallback, useMemo, useState } from "react";
import { Popover, PopoverButton, PopoverContent } from "../element/popover";
import { computeContextUsageStats, escapeMarkdown } from "./ai-context-estimation";
import { isInternalAssistantToolName } from "./aitypes";
import {
    formatHistoryGroupLabel,
    getSessionSortTs,
    type SessionHistoryGroup,
} from "./ai-session-utils";
import { t } from "./aipanel-i18n";
import { AIModeDropdown } from "./aimode";
import { WaveAIModel } from "./waveai-model";
import type { WaveChatSessionMeta, WaveUIMessage } from "./aitypes";
import { useAtomValue } from "jotai";

type AISessionToolbarProps = {
    messages: WaveUIMessage[];
    onRename: (chatid: string, title: string) => void;
    onDelete: (chatid: string, title: string) => void;
};

export const AISessionToolbar = memo(({ messages, onRename, onDelete }: AISessionToolbarProps) => {
    const model = WaveAIModel.getInstance();
    const sessions = useAtomValue(model.sessionsAtom);
    const hiddenSessionIds = useAtomValue(model.hiddenSessionIdsAtom);
    const activeChatId = useAtomValue(model.chatId);
    const [query, setQuery] = useState("");
    const currentMode = useAtomValue(model.currentAIMode);
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);
    const currentModelName = aiModeConfigs?.[currentMode]?.["ai:model"];
    const activeSession = useMemo(
        () => sessions.find((session) => session.chatid === activeChatId) ?? null,
        [activeChatId, sessions]
    );
    const contextUsage = useMemo(
        () => computeContextUsageStats(messages, currentModelName),
        [messages, currentModelName]
    );

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
            const bucketTs =
                sessionTs > 0
                    ? (() => {
                          const bucketDate = new Date(sessionTs);
                          bucketDate.setHours(0, 0, 0, 0);
                          return bucketDate.getTime();
                      })()
                    : 0;
            const bucket = groups.get(bucketTs);
            if (bucket) {
                bucket.push(session);
            } else {
                groups.set(bucketTs, [session]);
            }
        }
        const orderedBuckets = [...groups.entries()].sort((left, right) => right[0] - left[0]);
        return orderedBuckets.map(([bucketTs, bucketSessions]) => ({
            label: bucketTs > 0 ? formatHistoryGroupLabel(bucketTs, todayStartTs) : t.aipanel.earlier,
            sessions: bucketSessions,
        }));
    }, [displaySessions]);

    const exportChat = useCallback(() => {
        if (!messages || messages.length === 0) {
            return;
        }
        const title = activeSession?.title || "New Chat";
        const safeTitle = title
            .slice(0, 30)
            .replace(/[/\\?%*:|"<>]/g, "-")
            .trim();
        const header = `# ${title}\n\n> ${new Date().toLocaleString()} from Wave AI\n\n---\n\n`;
        const body = messages
            .map((msg) => {
                const roleLabel = msg.role === "user" ? "User" : "Wave AI";
                const textParts: string[] = [];
                const toolParts: string[] = [];
                for (const part of msg.parts ?? []) {
                    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
                        textParts.push(escapeMarkdown(part.text));
                    }
                    if (part.type === "data-tooluse" && !isInternalAssistantToolName(part.data?.toolname)) {
                        const toolName = part.data?.toolname ?? "unknown";
                        const status = part.data?.status ?? "";
                        const output = part.data?.outputtext ?? "";
                        const error = part.data?.errormessage ?? "";
                        let toolLine = `**[${toolName}]** ${status}`;
                        if (output) {
                            toolLine += `\n\`\`\`\n${output}\n\`\`\``;
                        }
                        if (error) {
                            toolLine += `\n\`\`\`\n${error}\n\`\`\``;
                        }
                        toolParts.push(toolLine);
                    }
                }
                const sections: string[] = [];
                if (textParts.length > 0) {
                    sections.push(`**${roleLabel}:**\n\n${textParts.join("\n\n")}`);
                }
                if (toolParts.length > 0) {
                    sections.push(toolParts.join("\n\n"));
                }
                return sections.length > 0 ? sections.join("\n\n") : "";
            })
            .filter(Boolean)
            .join("\n\n---\n\n");
        const markdown = header + body;
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeTitle}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, [messages, activeSession?.title]);

    return (
        <div className="border-b border-white/[0.04] bg-black/[0.06] px-3 py-2">
            <div className="flex items-center gap-2">
                <AIModeDropdown />
                <div className="ml-auto flex items-center gap-0.5 text-zinc-500">
                    <span className="text-[10px]">{contextUsage.usedPercent}%</span>
                    <button
                        type="button"
                        onClick={exportChat}
                        disabled={!messages || messages.length === 0}
                        className={cn(
                            "flex items-center justify-center transition-colors hover:opacity-80 cursor-pointer",
                            "w-5 h-5 rounded text-zinc-500 bg-transparent border-none",
                            !messages || messages.length === 0 ? "opacity-30" : "opacity-100"
                        )}
                        aria-label={t.aipanel.exportSession}
                    >
                        <i className="fa-solid fa-download text-[10px]" />
                    </button>
                    <Popover className="min-w-0" placement="bottom-end" onDismiss={() => setQuery("")}>
                        <PopoverButton
                            className="ghost grey flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80 w-5 h-5 rounded text-zinc-500 border-none"
                            as="div"
                            aria-label={t.aipanel.history}
                        >
                            <i className="fa-solid fa-clock-rotate-left text-[10px]" />
                        </PopoverButton>
                        <PopoverContent className="flex w-[320px] max-w-[calc(100vw-24px)] flex-col rounded-xl border border-white/[0.06] bg-zinc-900/96 p-2 shadow-2xl backdrop-blur">
                            <div className="flex w-full items-center rounded-md bg-white/[0.04] px-2 text-zinc-400 focus-within:bg-white/[0.06] focus-within:text-zinc-300">
                                <i className="fa-solid fa-magnifying-glass text-[11px]" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={t.aipanel.searchPlaceholder}
                                    className="w-full bg-transparent px-2 py-1.5 text-xs text-white outline-none placeholder:text-zinc-500"
                                />
                            </div>
                            <div className="mt-2 w-full max-h-[420px] overflow-y-auto pr-1">
                                {groupedHistorySessions.map((group) => (
                                    <div
                                        key={group.label}
                                        className="border-b border-white/8 py-2 last:border-b-0 last:pb-0"
                                    >
                                        <div className="mb-2 px-1 text-[11px] text-zinc-500">{group.label}</div>
                                        <div className="flex flex-col">
                                            {group.sessions.map((session) => (
                                                <div
                                                    key={session.chatid}
                                                    className={cn(
                                                        "group flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
                                                        session.chatid === activeChatId
                                                            ? "bg-white/8"
                                                            : "hover:bg-white/6"
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => void model.switchSession(session.chatid)}
                                                        className={cn(
                                                            "min-w-0 flex-1 truncate text-left text-[13px] font-medium transition-colors",
                                                            session.chatid === activeChatId
                                                                ? "text-white"
                                                                : "text-zinc-200 hover:text-white"
                                                        )}
                                                        title={session.summary || session.title || "New Chat"}
                                                    >
                                                        {session.title || "New Chat"}
                                                    </button>
                                                    <div
                                                        className={cn(
                                                            "flex items-center gap-0.5 transition-opacity",
                                                            session.chatid === activeChatId
                                                                ? "opacity-100"
                                                                : "opacity-0 group-hover:opacity-100"
                                                        )}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onRename(session.chatid, session.title ?? "New Chat");
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
                                                                onDelete(session.chatid, session.title || "New Chat");
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
                    <button
                        type="button"
                        onClick={() => model.clearChat()}
                        className="flex items-center justify-center transition-colors hover:opacity-80 cursor-pointer w-5 h-5 rounded text-zinc-500 bg-transparent border-none"
                        aria-label={t.aipanel.newSession}
                    >
                        <i className="fa-solid fa-plus text-[10px]" />
                    </button>
                </div>
            </div>
        </div>
    );
});

AISessionToolbar.displayName = "AISessionToolbar";
