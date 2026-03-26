// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import AnsiLine from "@/app/element/ansiline";
import { Button } from "@/app/element/button";
import { cn } from "@/app/shadcn/lib/utils";
import type { TermViewModel } from "@/app/view/term/term-model";
import { getBlockMetaKeyAtom } from "@/store/global";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import { TermQuickInputCompletion } from "./term-quickinput-completion";
import type { TermWrap } from "./termwrap";

type TermCardsViewProps = {
    blockId: string;
    model: TermViewModel;
    termWrap: TermWrap | null;
};

function formatDurationMs(startTs: number | null, endTs: number | null): string {
    if (startTs == null || endTs == null) {
        return "";
    }
    const ms = Math.max(0, endTs - startTs);
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const s = ms / 1000;
    if (s < 60) {
        return `${s.toFixed(1)}s`;
    }
    const m = Math.floor(s / 60);
    const rs = Math.round(s % 60);
    return `${m}m${rs}s`;
}

function stripAnsiForCopy(input: string): string {
    // eslint-disable-next-line no-control-regex
    return input.replace(/\x1b\[[0-9;]*m/g, "");
}

function inferContextLabelFromCommand(cmdText: string): string | null {
    if (!cmdText) {
        return null;
    }
    const parts = cmdText.trim().split(/\s+/);
    if (parts.length < 2) {
        return null;
    }
    if ((parts[0] === "docker" || parts[0] === "podman") && parts[1] === "exec") {
        for (let i = 2; i < parts.length; i++) {
            const p = parts[i];
            if (p.startsWith("-")) {
                continue;
            }
            return p;
        }
    }
    if (parts[0] === "kubectl" && parts[1] === "exec") {
        for (let i = 2; i < parts.length; i++) {
            const p = parts[i];
            if (p.startsWith("-")) {
                continue;
            }
            return p;
        }
    }
    return null;
}

export function TermCardsView({ blockId, model, termWrap }: TermCardsViewProps) {
    const [cards, setCards] = useAtom(model.cardsAtom);
    const [contextLabel] = useAtom(model.cardsContextLabelAtom);
    const [search, setSearch] = useAtom(model.cardsSearchAtom);
    const quickInputValue = useAtomValue(model.quickInputValueAtom);
    const [quickInputNotifyEnabled, setQuickInputNotifyEnabled] = useAtom(model.quickInputNotifyEnabledAtom);
    const cwd = useAtomValue(getBlockMetaKeyAtom(blockId, "cmd:cwd"));
    const connName = useAtomValue(getBlockMetaKeyAtom(blockId, "connection"));
    const shellIntegrationStatus = useAtomValueSafe(termWrap?.shellIntegrationStatusAtom);
    const runtimeInfoReady = useAtomValueSafe(termWrap?.runtimeInfoReadyAtom);

    const containerRef = React.useRef<HTMLDivElement>(null);
    const prevCardsLenRef = React.useRef(cards.length);
    const [shouldAutoScroll, setShouldAutoScroll] = React.useState(true);
    const [cardSearches, setCardSearches] = React.useState<Record<string, string>>({});

    const checkIfAtBottom = React.useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            return true;
        }
        const threshold = 80;
        const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return scrollBottom <= threshold;
    }, []);

    const handleScroll = React.useCallback(() => {
        setShouldAutoScroll(checkIfAtBottom());
    }, [checkIfAtBottom]);

    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        container.addEventListener("scroll", handleScroll);
        return () => container.removeEventListener("scroll", handleScroll);
    }, [handleScroll]);

    React.useEffect(() => {
        if (!shouldAutoScroll) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }
        container.scrollTop = container.scrollHeight;
        container.scrollLeft = 0;
    }, [cards, shouldAutoScroll]);

    React.useEffect(() => {
        const prevLen = prevCardsLenRef.current;
        prevCardsLenRef.current = cards.length;
        if (cards.length > prevLen) {
            setShouldAutoScroll(true);
        }
    }, [cards.length]);

    React.useEffect(() => {
        setCardSearches((prev) => {
            const next: Record<string, string> = {};
            for (const card of cards) {
                if (prev[card.id] != null) {
                    next[card.id] = prev[card.id];
                }
            }
            const prevKeys = Object.keys(prev).sort();
            const nextKeys = Object.keys(next).sort();
            const changed = prevKeys.length !== nextKeys.length || prevKeys.some((key, idx) => key !== nextKeys[idx]);
            if (!changed) {
                return prev;
            }
            return next;
        });
    }, [cards]);

    const filteredCards = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) {
            return cards;
        }
        return cards.filter((c) => {
            if (c.cmdText?.toLowerCase().includes(q)) {
                return true;
            }
            return c.outputLines?.some((l) => stripAnsiForCopy(l).toLowerCase().includes(q));
        });
    }, [cards, search]);

    const emptyState = React.useMemo(() => {
        if (!runtimeInfoReady) {
            return {
                title: "Preparing cards view",
                body: "Loading terminal context and the most recent command snapshot.",
            };
        }
        if (search.trim()) {
            return {
                title: "No matching cards",
                body: "Try a shorter keyword, or clear the search to see every card.",
            };
        }
        return {
            title: "No cards yet",
            body: "If there is no recent command to backfill, new commands run here will appear as cards.",
        };
    }, [runtimeInfoReady, search]);

    const onSend = React.useCallback(() => {
        const cmd = quickInputValue;
        if (!cmd.trim()) {
            return;
        }
        model.createPendingCard(cmd.trim());
        const inferred = inferContextLabelFromCommand(cmd);
        if (inferred && inferred !== contextLabel) {
            model.setCardsContextLabel(inferred);
        }
        model.submitQuickInput();
        setShouldAutoScroll(true);
    }, [model, quickInputValue, contextLabel]);

    const onCopyOutput = React.useCallback(async (output: string) => {
        const text = stripAnsiForCopy(output);
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            console.error("copy failed", e);
        }
    }, []);

    const toggleCardCollapsed = React.useCallback(
        (cardId: string) => {
            const idx = cards.findIndex((c) => c.id === cardId);
            if (idx === -1) {
                return;
            }
            const nextCards = [...cards];
            nextCards[idx] = { ...nextCards[idx], collapsed: !nextCards[idx].collapsed };
            setCards(nextCards);
        },
        [cards, setCards]
    );

    const setCardSearch = React.useCallback((cardId: string, value: string) => {
        setCardSearches((prev) => ({
            ...prev,
            [cardId]: value,
        }));
    }, []);

    return (
        <div className="term-cards-overlay">
            <div className="term-cards-topbar">
                <div className="term-cards-context">
                    <div className="term-cards-context-line">
                        <span className="term-cards-context-label">Conn</span>
                        <span className="term-cards-context-value">{connName || "local"}</span>
                    </div>
                    <div className="term-cards-context-line">
                        <span className="term-cards-context-label">Cwd</span>
                        <span className="term-cards-context-value">{cwd || ""}</span>
                    </div>
                    {shellIntegrationStatus == null ? (
                        <div className="term-cards-context-line">
                            <span className="term-cards-context-label">Info</span>
                            <span className="term-cards-context-value">
                                Shell integration is unavailable. Cards mode will switch back to the normal terminal.
                            </span>
                        </div>
                    ) : null}
                </div>
                <div className="term-cards-controls">
                    <input
                        className="term-cards-input"
                        value={contextLabel}
                        onChange={(e) => model.setCardsContextLabel(e.target.value)}
                        placeholder="Context label, e.g. container"
                    />
                    <input
                        className="term-cards-input"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search cards"
                    />
                    <Button className="!h-[32px] !px-3 !text-xs" onClick={() => model.setTermMode("term")}>
                        Terminal
                    </Button>
                </div>
            </div>
            <div ref={containerRef} className="term-cards-list">
                {filteredCards.length === 0 && (!runtimeInfoReady || search.trim()) ? (
                    <div className="term-cards-item">
                        <div className="term-cards-bubble term-cards-bubble-left">
                            <div className="term-cards-bubble-header">
                                <span className="term-cards-bubble-title">{emptyState.title}</span>
                            </div>
                            <div className="term-cards-output">
                                <div>{emptyState.body}</div>
                            </div>
                        </div>
                    </div>
                ) : (
                    filteredCards.map((card) => {
                        const duration = formatDurationMs(card.startTs, card.endTs);
                        const maxLines = 40;
                        const cardSearch = cardSearches[card.id] ?? "";
                        const normalizedCardSearch = cardSearch.trim().toLowerCase();
                        const searchMatches =
                            normalizedCardSearch === ""
                                ? card.outputLines
                                : card.outputLines.filter((line) =>
                                      stripAnsiForCopy(line).toLowerCase().includes(normalizedCardSearch)
                                  );
                        const shownLines =
                            card.collapsed && normalizedCardSearch === ""
                                ? searchMatches.slice(0, maxLines)
                                : searchMatches;
                        const hasMore = normalizedCardSearch === "" && searchMatches.length > maxLines;
                        return (
                            <div key={card.id} className="term-cards-item">
                                <div className="term-cards-bubble term-cards-bubble-right">
                                    <div className="term-cards-bubble-header">
                                        <span className="term-cards-bubble-title">$</span>
                                        {card.state === "done" && (
                                            <span
                                                className={cn(
                                                    "term-cards-bubble-meta",
                                                    card.exitCode === 0 ? "text-success" : "text-error"
                                                )}
                                            >
                                                exit {card.exitCode ?? "?"}
                                            </span>
                                        )}
                                        {duration && <span className="term-cards-bubble-meta">{duration}</span>}
                                        {card.cwd && <span className="term-cards-bubble-meta">{card.cwd}</span>}
                                    </div>
                                    <div className="term-cards-cmd">{card.cmdText}</div>
                                </div>

                                <div className="term-cards-bubble term-cards-bubble-left">
                                    <div className="term-cards-bubble-header">
                                        <span className="term-cards-bubble-title">Output</span>
                                        <input
                                            className="term-cards-input term-cards-input-small"
                                            value={cardSearch}
                                            onChange={(e) => setCardSearch(card.id, e.target.value)}
                                            placeholder="Search in card"
                                        />
                                        <Button
                                            className="!h-[26px] !px-2 !text-xs"
                                            onClick={() => fireAndForget(() => onCopyOutput(card.output))}
                                        >
                                            Copy
                                        </Button>
                                        {normalizedCardSearch !== "" && (
                                            <span className="term-cards-bubble-meta">
                                                {searchMatches.length} match{searchMatches.length === 1 ? "" : "es"}
                                            </span>
                                        )}
                                        {hasMore && (
                                            <Button
                                                className="!h-[26px] !px-2 !text-xs"
                                                onClick={() => toggleCardCollapsed(card.id)}
                                            >
                                                {card.collapsed ? `Expand (${searchMatches.length})` : "Collapse"}
                                            </Button>
                                        )}
                                    </div>
                                    <div className="term-cards-output">
                                        {shownLines.length === 0 ? (
                                            <div className="text-muted-foreground">
                                                {normalizedCardSearch !== ""
                                                    ? "No matches in this card."
                                                    : "This command has no output yet."}
                                            </div>
                                        ) : (
                                            shownLines.map((line, idx) => (
                                                <AnsiLine key={idx} line={line} searchTerm={cardSearch} />
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
            <div className="term-cards-inputbar" onMouseDown={(e) => e.stopPropagation()}>
                <div className="term-cards-inputbar-editor">
                    <div className="term-quick-input-shell">
                        <div className="term-quick-input-completion">
                            <TermQuickInputCompletion
                                model={model}
                                value={quickInputValue}
                                onChange={(value) => model.setQuickInputValue(value)}
                                onSubmit={onSend}
                                placeholder="Enter a command. Ctrl+Enter sends it."
                                className="term-quick-input-field text-sm"
                            />
                        </div>
                        <button
                            type="button"
                            className={cn("term-quick-input-notify-toggle", {
                                active: quickInputNotifyEnabled,
                            })}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setQuickInputNotifyEnabled(!quickInputNotifyEnabled)}
                            title={`为下一条输入框命令发送完成通知（阈值 ${model.getCompletionNotificationThresholdLabel()}）`}
                        >
                            <i className="fa-solid fa-bell text-[10px]" />
                            <span>通知</span>
                        </button>
                    </div>
                </div>
                <Button
                    className="!h-[36px] !px-3 !text-xs"
                    onClick={onSend}
                    disabled={quickInputValue.trim() === ""}
                    title="Send (Ctrl+Enter)"
                >
                    Send
                </Button>
            </div>
        </div>
    );
}
