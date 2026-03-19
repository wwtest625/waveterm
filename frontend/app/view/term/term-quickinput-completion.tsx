// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MultiLineInput } from "@/app/element/multilineinput";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore } from "@/store/global";
import { isBlank, makeConnRoute, makeIconClass } from "@/util/util";
import React, { memo, useEffect, useRef, useState } from "react";
import {
    applyQuickInputCompletion,
    formatQuickInputCompletion,
    getQuickInputCompletionRange,
    isQuickInputSubmitKeyEvent,
    type QuickInputCompletionRange,
} from "./term-quickinput";
import type { TermViewModel } from "./term-model";

type QuickInputCompletionState = {
    open: boolean;
    loading: boolean;
    reqNum: number;
    range: QuickInputCompletionRange;
    query: string;
    suggestions: SuggestionType[];
    selectedIndex: number;
};

interface TermQuickInputCompletionProps {
    model: TermViewModel;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder: string;
    className?: string;
    rows?: number;
    maxRows?: number;
}

function getCompletionContext(model: TermViewModel): {
    cwd: string;
    connection: string;
    route: string | null;
    cmdEnv?: Record<string, string>;
} {
    const blockData = globalStore.get(model.blockAtom);
    const connection = blockData?.meta?.connection ?? "";
    const route = isBlank(connection) ? null : makeConnRoute(connection);
    const cmdEnv = blockData?.meta?.["cmd:env"] as Record<string, string> | undefined;
    return {
        cwd: blockData?.meta?.["cmd:cwd"] ?? "",
        connection,
        route,
        cmdEnv,
    };
}

function getCompletionText(suggestion: SuggestionType): string {
    const rawText = suggestion["file:name"] || suggestion.display || "";
    if (suggestion["file:mimetype"] === "directory" && rawText !== "") {
        return `${rawText}/`;
    }
    return rawText;
}

function QuickInputSuggestionIcon({ suggestion }: { suggestion: SuggestionType }) {
    if (suggestion.type === "command") {
        return <i className="fa-solid fa-terminal text-emerald-400" />;
    }
    if (suggestion.iconsrc) {
        return <img src={suggestion.iconsrc} alt="" className="h-4 w-4 object-contain" />;
    }
    if (suggestion.icon) {
        return <i className={makeIconClass(suggestion.icon, true)} style={{ color: suggestion.iconcolor || "inherit" }} />;
    }
    if (suggestion["file:mimetype"] === "directory") {
        return <i className="fa-regular fa-folder text-amber-400" />;
    }
    return <i className="fa-regular fa-file text-slate-400" />;
}

function QuickInputSuggestionLabel({ suggestion }: { suggestion: SuggestionType }) {
    const text = suggestion.display || suggestion["file:name"] || "";
    const subText = suggestion.subtext || (suggestion["file:path"] && suggestion["file:path"] !== text ? suggestion["file:path"] : "");

    return (
        <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white">{text}</div>
            {subText ? <div className="truncate text-[11px] text-slate-400">{subText}</div> : null}
        </div>
    );
}

const TermQuickInputCompletion = memo(
    ({ model, value, onChange, onSubmit, onFocus, onBlur, placeholder, className, rows = 2, maxRows = 6 }: TermQuickInputCompletionProps) => {
        const textareaRef = model.quickInputRef;
        const widgetIdRef = useRef(`termquickinput-${Math.random().toString(36).slice(2)}`);
        const reqNumRef = useRef(0);
        const [completionState, setCompletionState] = useState<QuickInputCompletionState | null>(null);

        const closeCompletion = (disposeSuggestions = true) => {
            reqNumRef.current += 1;
            setCompletionState(null);
            if (!disposeSuggestions) {
                return;
            }
            const { route } = getCompletionContext(model);
            void RpcApi.DisposeSuggestionsCommand(TabRpcClient, widgetIdRef.current, {
                noresponse: true,
                route: route ?? undefined,
            });
        };

        useEffect(() => {
            if (completionState != null && value.trim() === "") {
                closeCompletion();
            }
        }, [value]);

        useEffect(() => {
            return () => {
                closeCompletion();
            };
        }, []);

        const applySuggestion = (suggestion: SuggestionType) => {
            if (!completionState?.range) {
                closeCompletion();
                return;
            }
            const replacement = formatQuickInputCompletion(getCompletionText(suggestion), completionState.range.kind);
            const applied = applyQuickInputCompletion(value, completionState.range, replacement);
            onChange(applied.value);
            closeCompletion();
            window.requestAnimationFrame(() => {
                const textarea = textareaRef.current;
                if (!textarea) {
                    return;
                }
                textarea.focus();
                textarea.setSelectionRange(applied.cursor, applied.cursor);
            });
        };

        const runCompletion = async () => {
            const textarea = textareaRef.current;
            if (!textarea) {
                return;
            }

            const selectionStart = textarea.selectionStart ?? value.length;
            const selectionEnd = textarea.selectionEnd ?? selectionStart;
            const range = getQuickInputCompletionRange(value, selectionStart, selectionEnd);
            if (range == null) {
                closeCompletion();
                return;
            }

            const reqNum = ++reqNumRef.current;
            const { cwd, connection, route, cmdEnv } = getCompletionContext(model);
            setCompletionState({
                open: true,
                loading: true,
                reqNum,
                range,
                query: range.query,
                suggestions: [],
                selectedIndex: 0,
            });

            try {
                const result = await RpcApi.FetchSuggestionsCommand(
                    TabRpcClient,
                    {
                        suggestiontype: range.kind,
                        query: range.query,
                        widgetid: widgetIdRef.current,
                        reqnum: reqNum,
                        "file:cwd": cwd,
                        "file:connection": connection || undefined,
                        "cmd:env": range.kind === "command" ? cmdEnv : undefined,
                    },
                    route ? { route } : undefined
                );

                if (reqNumRef.current !== reqNum) {
                    return;
                }

                const suggestions = result?.suggestions ?? [];
                if (suggestions.length === 0) {
                    closeCompletion();
                    return;
                }
                if (suggestions.length === 1) {
                    applySuggestion(suggestions[0]);
                    return;
                }
                setCompletionState({
                    open: true,
                    loading: false,
                    reqNum,
                    range,
                    query: range.query,
                    suggestions,
                    selectedIndex: 0,
                });
            } catch (error) {
                console.error("quick input completion failed", error);
                if (reqNumRef.current === reqNum) {
                    closeCompletion();
                }
            }
        };

        const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            if (completionState?.open) {
                closeCompletion();
            }
            onChange(e.target.value);
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (completionState?.open) {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    e.stopPropagation();
                    setCompletionState((prev) => {
                        if (!prev || prev.suggestions.length === 0) {
                            return prev;
                        }
                        return { ...prev, selectedIndex: Math.min(prev.selectedIndex + 1, prev.suggestions.length - 1) };
                    });
                    return;
                }
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    e.stopPropagation();
                    setCompletionState((prev) => {
                        if (!prev || prev.suggestions.length === 0) {
                            return prev;
                        }
                        return { ...prev, selectedIndex: Math.max(prev.selectedIndex - 1, 0) };
                    });
                    return;
                }
                if (e.key === "PageDown") {
                    e.preventDefault();
                    e.stopPropagation();
                    setCompletionState((prev) => {
                        if (!prev || prev.suggestions.length === 0) {
                            return prev;
                        }
                        return { ...prev, selectedIndex: Math.min(prev.selectedIndex + 10, prev.suggestions.length - 1) };
                    });
                    return;
                }
                if (e.key === "PageUp") {
                    e.preventDefault();
                    e.stopPropagation();
                    setCompletionState((prev) => {
                        if (!prev || prev.suggestions.length === 0) {
                            return prev;
                        }
                        return { ...prev, selectedIndex: Math.max(prev.selectedIndex - 10, 0) };
                    });
                    return;
                }
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    closeCompletion();
                    return;
                }
                if (e.key === "Tab" || e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    const selectedSuggestion = completionState.suggestions[completionState.selectedIndex] ?? completionState.suggestions[0];
                    if (selectedSuggestion) {
                        applySuggestion(selectedSuggestion);
                    } else {
                        closeCompletion();
                    }
                    return;
                }
            }

            if (e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                void runCompletion();
                return;
            }

            if (isQuickInputSubmitKeyEvent(e)) {
                e.preventDefault();
                e.stopPropagation();
                closeCompletion();
                onSubmit();
            }
        };

        return (
            <div className="relative min-w-0">
                <MultiLineInput
                    ref={textareaRef}
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    placeholder={placeholder}
                    rows={rows}
                    maxRows={maxRows}
                    className={className}
                />
                {completionState?.open ? (
                    <div className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900/98 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-[11px] text-slate-400">
                            <span>Tab completion</span>
                            <span>{completionState.loading ? "Loading..." : `${completionState.suggestions.length} candidates`}</span>
                        </div>
                        <div className="py-1">
                            {completionState.suggestions.map((suggestion, index) => {
                                const active = index === completionState.selectedIndex;
                                return (
                                    <div
                                        key={suggestion.suggestionid}
                                        className={[
                                            "flex cursor-pointer items-center gap-2 px-3 py-2",
                                            active ? "bg-accentbg text-white" : "text-slate-200 hover:bg-white/5",
                                        ].join(" ")}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => applySuggestion(suggestion)}
                                    >
                                        <QuickInputSuggestionIcon suggestion={suggestion} />
                                        <QuickInputSuggestionLabel suggestion={suggestion} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }
);

TermQuickInputCompletion.displayName = "TermQuickInputCompletion";

export { TermQuickInputCompletion };
