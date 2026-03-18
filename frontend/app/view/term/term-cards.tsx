// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import AnsiLine from "@/app/element/ansiline";
import { Button } from "@/app/element/button";
import { MultiLineInput } from "@/app/element/multilineinput";
import { cn } from "@/app/shadcn/lib/utils";
import type { TermViewModel } from "@/app/view/term/term-model";
import { getBlockMetaKeyAtom } from "@/store/global";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import { isQuickInputSubmitKeyEvent } from "./term-quickinput";
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
    const [quickInputValue, setQuickInputValue] = useAtom(model.quickInputValueAtom);
    const cwd = useAtomValue(getBlockMetaKeyAtom(blockId, "cmd:cwd"));
    const connName = useAtomValue(getBlockMetaKeyAtom(blockId, "connection"));
    const shellIntegrationStatus = useAtomValueSafe(termWrap?.shellIntegrationStatusAtom);
    const runtimeInfoReady = useAtomValueSafe(termWrap?.runtimeInfoReadyAtom);

    const containerRef = React.useRef<HTMLDivElement>(null);
    const prevCardsLenRef = React.useRef(cards.length);
    const [shouldAutoScroll, setShouldAutoScroll] = React.useState(true);

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

    const onKeyDown = React.useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (!isQuickInputSubmitKeyEvent(e)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            onSend();
        },
        [onSend]
    );

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
                {filteredCards.length === 0 ? (
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
                        const maxLines = 60;
                        const shownLines = card.collapsed ? card.outputLines.slice(0, maxLines) : card.outputLines;
                        const hasMore = card.outputLines.length > maxLines;
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
                                    </div>
                                    <div className="term-cards-cmd">{card.cmdText}</div>
                                </div>

                                <div className="term-cards-bubble term-cards-bubble-left">
                                    <div className="term-cards-bubble-header">
                                        <span className="term-cards-bubble-title">Output</span>
                                        <Button
                                            className="!h-[26px] !px-2 !text-xs"
                                            onClick={() => fireAndForget(() => onCopyOutput(card.output))}
                                        >
                                            Copy
                                        </Button>
                                        {hasMore && (
                                            <Button
                                                className="!h-[26px] !px-2 !text-xs"
                                                onClick={() => toggleCardCollapsed(card.id)}
                                            >
                                                {card.collapsed ? `Expand (${card.outputLines.length})` : "Collapse"}
                                            </Button>
                                        )}
                                    </div>
                                    <div className="term-cards-output">
                                        {shownLines.length === 0 ? (
                                            <div className="text-muted-foreground">This command has no output yet.</div>
                                        ) : (
                                            shownLines.map((line, idx) => <AnsiLine key={idx} line={line} />)
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
                    <MultiLineInput
                        ref={model.quickInputRef}
                        value={quickInputValue}
                        onChange={(e) => setQuickInputValue(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Enter a command. Ctrl+Enter sends it."
                        rows={2}
                        maxRows={6}
                        className="term-quick-input-field text-sm"
                    />
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
