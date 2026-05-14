// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createImagePreview, formatFileSizeError, isAcceptableFile, resizeImage, validateFileSize } from "@/app/aipanel/ai-utils";
import { waveAIHasFocusWithin } from "@/app/aipanel/waveai-focus-utils";
import { type WaveAIModel } from "@/app/aipanel/waveai-model";
import { kbEnsureRoot } from "@/app/store/kb-api";
import { FocusManager } from "@/app/store/focusManager";
import { Tooltip } from "@/element/tooltip";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ContextChips } from "./aipanel-context-chips";
import { ContextPicker } from "./aipanel-context-picker";
import type { ContextItem, FileContextData } from "./aitypes";

interface AIPanelInputProps {
    onSubmit: (e: React.SyntheticEvent) => void;
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
    const canStopSession =
        isThinking ||
        status === "streaming" ||
        runtime.state === "executing" ||
        runtime.state === "awaiting_approval" ||
        runtime.state === "interacting";
    const isFocused = useAtomValue(model.isWaveAIFocusedAtom);
    const isChatEmpty = useAtomValue(model.isChatEmptyAtom);
    const contextItems = useAtomValue(model.contextItemsAtom);
    const queuedSubmissions = useAtomValue(model.queuedSubmissionsAtom);
    const terminalTarget = useAtomValue(model.terminalTargetAtom);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const focusedBlockId = useAtomValue(FocusManager.getInstance().blockFocusAtom);
    const [contextPickerVisible, setContextPickerVisible] = useState(false);
    const [contextFilterText, setContextFilterText] = useState("");
    const [kbEnabled, setKbEnabled] = useState(false);
    const atTriggerRef = useRef<{ position: number } | null>(null);
    const canSubmit = Boolean(input.trim()) || contextItems.length > 0;

    useEffect(() => {
        kbEnsureRoot().then(() => setKbEnabled(true)).catch(() => setKbEnabled(false));
    }, []);

    let placeholder: string;
    if (queuedSubmissions.length > 0) {
        placeholder = "Add to queue...";
    } else if (!isChatEmpty) {
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

    const isInsideCodeBlock = (text: string, position: number): boolean => {
        const textBefore = text.slice(0, position);
        const backtickCount = (textBefore.match(/`/g) || []).length;
        return backtickCount % 2 !== 0;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing = e.nativeEvent?.isComposing || e.keyCode == 229;

        if (contextPickerVisible) {
            if (e.key === "Escape") {
                e.preventDefault();
                setContextPickerVisible(false);
                setContextFilterText("");
                atTriggerRef.current = null;
                return;
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                return;
            }
            if (e.key === "Enter" && !e.shiftKey && !isComposing) {
                e.preventDefault();
                return;
            }
        }

        if (e.key === "@" && !isComposing) {
            const cursorPos = textareaRef.current?.selectionStart ?? 0;
            if (!isInsideCodeBlock(input, cursorPos)) {
                atTriggerRef.current = { position: cursorPos };
                setContextPickerVisible(true);
                setContextFilterText("");
            }
        }

        if (e.key === "Enter" && !e.shiftKey && !isComposing && !contextPickerVisible) {
            e.preventDefault();
            onSubmit(e);
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

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setInput(newValue);

        if (contextPickerVisible && atTriggerRef.current != null) {
            const atPos = atTriggerRef.current.position;
            if (atPos < newValue.length && newValue[atPos] === "@") {
                const textAfterAt = newValue.slice(atPos + 1);
                const filterMatch = textAfterAt.match(/^[^\s]*/);
                const filterText = filterMatch ? filterMatch[0] : "";
                if (textAfterAt.length > 0 && /^\s/.test(textAfterAt[0])) {
                    setContextPickerVisible(false);
                    setContextFilterText("");
                    atTriggerRef.current = null;
                } else {
                    setContextFilterText(filterText);
                }
            } else {
                setContextPickerVisible(false);
                setContextFilterText("");
                atTriggerRef.current = null;
            }
        }
    };

    const handleContextSelect = useCallback(
        (item: ContextItem) => {
            model.addContextItem(item);
            if (atTriggerRef.current != null) {
                const atPos = atTriggerRef.current.position;
                const textAfterAt = input.slice(atPos + 1);
                const filterMatch = textAfterAt.match(/^[^\s]*/);
                const filterLength = filterMatch ? filterMatch[0].length : 0;
                const before = input.slice(0, atPos);
                const after = input.slice(atPos + 1 + filterLength);
                setInput(before + after);
                atTriggerRef.current = null;
            }
            setContextPickerVisible(false);
            setContextFilterText("");
            textareaRef.current?.focus();
        },
        [input, model, setInput]
    );

    const handleContextRemove = useCallback(
        (id: string) => {
            model.removeContextItem(id);
        },
        [model]
    );

    const handleFormSubmit = (e: React.SyntheticEvent) => {
        setContextPickerVisible(false);
        setContextFilterText("");
        atTriggerRef.current = null;
        onSubmit(e);
    };

    useEffect(() => {
        resizeTextarea();
    }, [input, resizeTextarea]);

    useEffect(() => {
        if (isPanelOpen) {
            resizeTextarea();
        }
    }, [isPanelOpen, resizeTextarea]);

    useEffect(() => {
        if (!isPanelOpen) {
            return;
        }
        model.refreshTerminalTargetInfo();
        const intervalId = window.setInterval(() => {
            model.refreshTerminalTargetInfo();
        }, 10000);
        return () => window.clearInterval(intervalId);
    }, [isPanelOpen, model]);

    useEffect(() => {
        if (!isPanelOpen || focusedBlockId == null) {
            return;
        }
        model.refreshTerminalTargetInfo();
    }, [isPanelOpen, focusedBlockId, model]);

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
            const processedFile = await resizeImage(file);
            let previewUrl: string | undefined;
            if (processedFile.type.startsWith("image/")) {
                const preview = await createImagePreview(processedFile);
                if (preview) previewUrl = preview;
            }
            model.addContextItem({
                id: crypto.randomUUID(),
                type: "file",
                label: processedFile.name,
                icon: "fa-file",
                data: {
                    path: processedFile.name,
                    connName: "local",
                    size: processedFile.size,
                    mimetype: processedFile.type,
                    file: processedFile,
                    previewUrl,
                } as FileContextData,
            });
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
                "border-t border-white/[0.03] bg-black/[0.04] px-3 pb-3 pt-2",
                isFocused && "border-lime-300/12"
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
            <form onSubmit={handleFormSubmit}>
                <div className="mb-2 flex items-center justify-between gap-3 text-[10px] text-zinc-500">
                    <div className="min-w-0 flex items-center gap-1.5 truncate">
                        <span className="shrink-0 text-zinc-500">Agent targets</span>
                        <span
                            className={cn(
                                "min-w-0 truncate rounded-md px-1.5 py-0.5",
                                terminalTarget
                                    ? "bg-lime-300/[0.04] text-zinc-300"
                                    : "bg-red-300/[0.04] text-red-200/70"
                            )}
                            title={
                                terminalTarget
                                    ? `${terminalTarget.connName}${terminalTarget.cwd ? ` - ${terminalTarget.cwd}` : ""}`
                                    : "No terminal target"
                            }
                        >
                            {terminalTarget
                                ? `${terminalTarget.connName}${terminalTarget.cwd ? ` - ${terminalTarget.cwd}` : ""}`
                                : "no terminal"}
                        </span>
                    </div>
                    <div className="shrink-0">
                        {queuedSubmissions.length > 0
                            ? `Queued ${queuedSubmissions.length}`
                            : canStopSession
                                ? "Executing"
                                : "Ready"}
                    </div>
                </div>
                <div className="relative">
                    <ContextPicker
                        visible={contextPickerVisible}
                        onSelect={handleContextSelect}
                        onClose={() => {
                            setContextPickerVisible(false);
                            setContextFilterText("");
                            atTriggerRef.current = null;
                        }}
                        filterText={contextFilterText}
                        onFilterChange={setContextFilterText}
                        kbEnabled={kbEnabled}
                    />
                    <div className="overflow-hidden rounded-2xl bg-black/20">
                        {contextItems.length > 0 && (
                            <div className="px-4 pt-2">
                                <ContextChips items={contextItems} onRemove={handleContextRemove} />
                            </div>
                        )}
                        <div className="relative">
                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={handleChange}
                                onKeyDown={handleKeyDown}
                                onFocus={handleFocus}
                                onBlur={handleBlur}
                                placeholder={placeholder}
                                className={cn(
                                    "w-full resize-none overflow-auto bg-transparent px-4 py-3 pr-24 text-white focus:outline-none text-[13px]"
                                )}
                                rows={2}
                            />
                            <div className="absolute bottom-2 right-2 flex items-center gap-1">
                                <Tooltip content="Attach files" placement="top">
                                    <button
                                        type="button"
                                        onClick={handleUploadClick}
                                        className={cn(
                                            "flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-300"
                                        )}
                                    >
                                        <i className="fa fa-paperclip text-xs"></i>
                                    </button>
                                </Tooltip>
                                {runtime.state === "failed_retryable" ? (
                                    <Tooltip content="Retry last step" placement="top">
                                        <button
                                            type="button"
                                            onClick={() => void model.retryLastAction("step")}
                                            className={cn(
                                                "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors",
                                                "bg-amber-300/[0.06] text-yellow-300/70 hover:bg-amber-300/10 hover:text-yellow-200"
                                            )}
                                        >
                                            <i className="fa fa-rotate-right text-xs"></i>
                                        </button>
                                    </Tooltip>
                                ) : canStopSession ? (
                                    <Tooltip content="Stop" placement="top">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                void (runtime.state === "executing" ||
                                                runtime.state === "awaiting_approval" ||
                                                runtime.state === "interacting"
                                                    ? model.cancelExecution()
                                                    : model.cancelGeneration())
                                            }
                                            className={cn(
                                                "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors",
                                                "bg-red-300/[0.06] text-red-300/70 hover:bg-red-300/10 hover:text-red-200"
                                            )}
                                        >
                                            <i className="fa fa-stop text-xs"></i>
                                        </button>
                                    </Tooltip>
                                ) : (
                                    <Tooltip content="Send message (Enter)" placement="top">
                                        <button
                                            type="submit"
                                            disabled={!canSubmit}
                                            className={cn(
                                                "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                                                !canSubmit
                                                    ? "bg-white/[0.02] text-zinc-600"
                                                    : "cursor-pointer bg-lime-300/[0.08] text-lime-200/80 hover:bg-lime-300/12 hover:text-lime-100"
                                            )}
                                        >
                                            <i className="fa fa-paper-plane text-xs"></i>
                                        </button>
                                    </Tooltip>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
});

AIPanelInput.displayName = "AIPanelInput";
