// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatFileSizeError, isAcceptableFile, validateFileSize } from "@/app/aipanel/ai-utils";
import { waveAIHasFocusWithin } from "@/app/aipanel/waveai-focus-utils";
import { type WaveAIModel } from "@/app/aipanel/waveai-model";
import { Tooltip } from "@/element/tooltip";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef } from "react";

interface AIPanelInputProps {
    onSubmit: (e: React.FormEvent) => void;
    status: string;
    model: WaveAIModel;
}

export interface AIPanelInputRef {
    focus: () => void;
    resize: () => void;
    scrollToBottom: () => void;
}

export const AIPanelInput = memo(({ onSubmit, status, model }: AIPanelInputProps) => {
    const [input, setInput] = useAtom(model.inputAtom);
    const runtime = useAtomValue(model.agentRuntimeAtom);
    const isThinking = runtime.state === "submitting" || runtime.state === "planning";
    const isFocused = useAtomValue(model.isWaveAIFocusedAtom);
    const isChatEmpty = useAtomValue(model.isChatEmptyAtom);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());

    let placeholder: string;
    if (!isChatEmpty) {
        placeholder = "Continue...";
    } else {
        placeholder = "Ask Wave AI anything...";
    }

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        textarea.style.height = "auto";
        const scrollHeight = textarea.scrollHeight;
        const maxHeight = 7 * 24;
        textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }, []);

    useEffect(() => {
        const inputRefObject: React.RefObject<AIPanelInputRef> = {
            current: {
                focus: () => {
                    textareaRef.current?.focus();
                },
                resize: resizeTextarea,
                scrollToBottom: () => {
                    const textarea = textareaRef.current;
                    if (textarea) {
                        textarea.scrollTop = textarea.scrollHeight;
                    }
                },
            },
        };
        model.registerInputRef(inputRefObject);
    }, [model, resizeTextarea]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing = e.nativeEvent?.isComposing || e.keyCode == 229;
        if (e.key === "Enter" && !e.shiftKey && !isComposing) {
            e.preventDefault();
            onSubmit(e as any);
        }
    };

    const handleFocus = useCallback(() => {
        model.requestWaveAIFocus();
    }, [model]);

    const handleBlur = useCallback(
        (e: React.FocusEvent) => {
            if (e.relatedTarget === null) {
                return;
            }

            if (waveAIHasFocusWithin(e.relatedTarget)) {
                return;
            }

            model.requestNodeFocus();
        },
        [model]
    );

    useEffect(() => {
        resizeTextarea();
    }, [input, resizeTextarea]);

    useEffect(() => {
        if (isPanelOpen) {
            resizeTextarea();
        }
    }, [isPanelOpen, resizeTextarea]);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const acceptableFiles = files.filter(isAcceptableFile);

        for (const file of acceptableFiles) {
            const sizeError = validateFileSize(file);
            if (sizeError) {
                model.setError(formatFileSizeError(sizeError));
                if (e.target) {
                    e.target.value = "";
                }
                return;
            }
            await model.addFile(file);
        }

        if (acceptableFiles.length < files.length) {
            console.warn(`${files.length - acceptableFiles.length} files were rejected due to unsupported file types`);
        }

        if (e.target) {
            e.target.value = "";
        }
    };

    return (
        <div
            className={cn(
                "border-t border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-3 pb-3 pt-2",
                isFocused && "border-lime-300/30"
            )}
        >
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.js,.jsx,.ts,.tsx,.go,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.scss,.sass,.json,.xml,.yaml,.yml,.sh,.bat,.sql"
                onChange={handleFileChange}
                className="hidden"
            />
            <form onSubmit={onSubmit}>
                <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
                    <div className="truncate">{isChatEmpty ? "Ask, edit, run, verify" : "Continue the session"}</div>
                    <div className="shrink-0">
                        {isThinking
                            ? "Thinking"
                            : runtime.state === "executing" ||
                                runtime.state === "awaiting_approval" ||
                                runtime.state === "interacting"
                              ? "Executing"
                              : status === "streaming"
                                ? "Responding"
                                : "Ready"}
                    </div>
                </div>
                <div className="relative overflow-hidden rounded-[22px] border border-white/10 bg-black/20 shadow-[0_14px_32px_rgba(0,0,0,0.16)]">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        placeholder={placeholder}
                        className={cn(
                            "w-full resize-none overflow-auto bg-transparent px-4 py-3 pr-24 text-white focus:outline-none"
                        )}
                        style={{ fontSize: "13px" }}
                        rows={2}
                    />
                    <div className="absolute bottom-2 right-2 flex items-center gap-1">
                        <Tooltip content="Attach files" placement="top">
                            <button
                                type="button"
                                onClick={handleUploadClick}
                                className={cn(
                                    "flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/8 hover:text-lime-200"
                                )}
                            >
                                <i className="fa fa-paperclip text-sm"></i>
                            </button>
                        </Tooltip>
                        {runtime.state === "failed_retryable" ? (
                            <Tooltip content="Retry last step" placement="top">
                                <button
                                    type="button"
                                    onClick={() => void model.retryLastAction("step")}
                                    className={cn(
                                        "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors",
                                        "bg-amber-300/10 text-yellow-300 hover:bg-amber-300/15 hover:text-yellow-200"
                                    )}
                                >
                                    <i className="fa fa-rotate-right text-sm"></i>
                                </button>
                            </Tooltip>
                        ) : runtime.state === "executing" ||
                          runtime.state === "awaiting_approval" ||
                          runtime.state === "interacting" ? (
                            <Tooltip content="Stop execution" placement="top">
                                <button
                                    type="button"
                                    onClick={() => void model.cancelExecution()}
                                    className={cn(
                                        "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors",
                                        "bg-red-300/10 text-red-300 hover:bg-red-300/15 hover:text-red-200"
                                    )}
                                >
                                    <i className="fa fa-stop text-sm"></i>
                                </button>
                            </Tooltip>
                        ) : isThinking ? (
                            <Tooltip content="Thinking" placement="top">
                                <div
                                    className={cn(
                                        "flex h-9 w-9 items-center justify-center rounded-full",
                                        "border border-lime-300/20 bg-lime-300/10 text-lime-200"
                                    )}
                                >
                                    <i className="fa fa-spinner fa-spin text-sm"></i>
                                </div>
                            </Tooltip>
                        ) : status === "streaming" ? (
                            <Tooltip content="Stop Response" placement="top">
                                <button
                                    type="button"
                                    onClick={() => void model.cancelGeneration()}
                                    className={cn(
                                        "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors",
                                        "bg-emerald-300/10 text-emerald-300 hover:bg-emerald-300/15 hover:text-emerald-200"
                                    )}
                                >
                                    <i className="fa fa-square text-sm"></i>
                                </button>
                            </Tooltip>
                        ) : (
                            <Tooltip content="Send message (Enter)" placement="top">
                                <button
                                    type="submit"
                                    disabled={status !== "ready" || !input.trim()}
                                    className={cn(
                                        "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                                        status !== "ready" || !input.trim()
                                            ? "bg-white/[0.04] text-gray-500"
                                            : "cursor-pointer bg-lime-300/12 text-lime-200 hover:bg-lime-300/18 hover:text-lime-100"
                                    )}
                                >
                                    <i className="fa fa-paper-plane text-sm"></i>
                                </button>
                            </Tooltip>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
});

AIPanelInput.displayName = "AIPanelInput";
