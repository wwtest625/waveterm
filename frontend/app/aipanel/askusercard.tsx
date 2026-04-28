import { AskUserOption } from "@/app/aipanel/aitypes";
import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";

export const AskUserCard = memo(() => {
    const model = WaveAIModel.getInstance();
    const askData = jotai.useAtomValue(model.askUserAtom);
    const [input, setInput] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const firstControlRef = useRef<HTMLElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        setInput("");
        setSelectedIds(new Set());
    }, [askData?.actionid]);

    useEffect(() => {
        if (!askData || askData.status !== "pending") {
            return;
        }
        const timer = window.setTimeout(() => {
            if (askData.kind === "freeform") {
                inputRef.current?.focus();
                return;
            }
            firstControlRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [askData]);

    const handleSubmit = useCallback(
        (answer: string) => {
            if (!askData) return;
            void model.submitAskUserAnswer(askData.actionid, answer);
        },
        [askData]
    );

    const handleConfirm = useCallback(
        (yes: boolean) => {
            if (!askData) return;
            const confirmValues = askData.options || [];
            const yesOption = confirmValues.find((o) => o.id === "yes" || o.value === "yes");
            const noOption = confirmValues.find((o) => o.id === "no" || o.value === "no");
            const answer = yes ? (yesOption?.value ?? "yes") : (noOption?.value ?? "no");
            void model.submitAskUserAnswer(askData.actionid, answer);
        },
        [askData]
    );

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    if (!askData || askData.status !== "pending") {
        return null;
    }

    const isConfirm = askData.kind === "confirm";
    const isFreeform = askData.kind === "freeform";
    const isSelect = askData.kind === "select";
    const isMultiSelect = askData.kind === "multiselect";
    const canSendFreeform = input.trim().length > 0;
    const hasSelection = selectedIds.size > 0;

    return (
        <div
            className={cn(
                "mx-3 mb-2 rounded-xl border px-3 py-3 text-sm text-zinc-200",
                isConfirm ? "border-red-300/12 bg-red-300/[0.04]" : "border-blue-300/12 bg-blue-300/[0.04]"
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-base">{isConfirm ? "⚠️" : "❓"}</span>
                        <span className={cn("font-medium", isConfirm ? "text-red-100" : "text-blue-100")}>
                            {isConfirm ? "确认操作" : "需要补充信息"}
                        </span>
                    </div>
                    <div className="mt-1.5 text-sm text-zinc-200">{askData.prompt}</div>
                    {askData.taskid && <div className="mt-1 text-[10px] text-zinc-500">关联任务: {askData.taskid}</div>}
                </div>
                <button
                    type="button"
                    onClick={() => {
                        if (askData) {
                            void model.submitAskUserAnswer(askData.actionid, "__canceled__");
                        }
                    }}
                    className="rounded-lg border border-red-300/12 bg-red-300/[0.06] px-2.5 py-1 text-[11px] text-red-200/70"
                >
                    跳过
                </button>
            </div>

            {isSelect && askData.options && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {askData.options.map((opt: AskUserOption) => (
                        <button
                            key={opt.id}
                            ref={(node) => {
                                if (opt === askData.options?.[0]) {
                                    firstControlRef.current = node;
                                }
                            }}
                            type="button"
                            onClick={() => handleSubmit(opt.value || opt.id)}
                            className={cn(
                                "relative rounded-lg border px-2.5 py-1.5 text-sm",
                                opt.recommended
                                    ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100 hover:bg-emerald-400/12"
                                    : "border-blue-300/12 bg-blue-300/[0.05] text-blue-100 hover:bg-blue-300/10"
                            )}
                        >
                            {opt.recommended && (
                                <span className="mr-1.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                                    推荐
                                </span>
                            )}
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}

            {isMultiSelect && askData.options && (
                <>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {askData.options.map((opt: AskUserOption) => (
                            <button
                                key={opt.id}
                                ref={(node) => {
                                    if (opt === askData.options?.[0]) {
                                        firstControlRef.current = node;
                                    }
                                }}
                                type="button"
                                onClick={() => toggleSelect(opt.id)}
                                className={cn(
                                    "rounded-lg border px-3 py-1.5 text-sm",
                                    selectedIds.has(opt.id)
                                        ? opt.recommended
                                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                                            : "border-blue-400/20 bg-blue-400/10 text-blue-100"
                                        : opt.recommended
                                          ? "border-emerald-400/12 bg-emerald-400/[0.04] text-emerald-200"
                                          : "border-white/[0.06] bg-white/[0.03] text-zinc-400"
                                )}
                            >
                                {selectedIds.has(opt.id) ? "✓ " : "○ "}
                                {opt.recommended && (
                                    <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                                        推荐
                                    </span>
                                )}
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <div className="mt-2 flex justify-end">
                        <button
                            type="button"
                            onClick={() => {
                                const values = askData.options
                                    .filter((opt: AskUserOption) => selectedIds.has(opt.id))
                                    .map((opt: AskUserOption) => opt.value || opt.id);
                                handleSubmit(values.join(","));
                            }}
                            disabled={!hasSelection}
                            className={cn(
                                "rounded-lg px-2.5 py-1.5 text-sm",
                                hasSelection
                                    ? "bg-blue-300/[0.08] text-blue-100 hover:bg-blue-300/12"
                                    : "bg-white/[0.02] text-zinc-600"
                            )}
                        >
                            确认选择
                        </button>
                    </div>
                </>
            )}

            {isConfirm && (
                <div className="mt-3 flex gap-2">
                    <button
                        ref={(node) => {
                            firstControlRef.current = node;
                        }}
                        type="button"
                        onClick={() => handleConfirm(true)}
                        className="rounded-lg border border-red-400/15 bg-red-400/[0.06] px-3 py-1.5 text-sm text-red-100 hover:bg-red-400/10"
                    >
                        确认
                    </button>
                    <button
                        type="button"
                        onClick={() => handleConfirm(false)}
                        className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-sm text-zinc-400 hover:bg-white/[0.06]"
                    >
                        取消
                    </button>
                </div>
            )}

            {isFreeform && (
                <div className="mt-3 flex gap-2">
                    <input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && canSendFreeform) {
                                handleSubmit(input.trim());
                            }
                        }}
                        placeholder={askData.default || "请输入..."}
                        className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-black/15 px-3 py-1.5 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                    <button
                        ref={(node) => {
                            firstControlRef.current = node;
                        }}
                        type="button"
                        onClick={() => handleSubmit(input.trim())}
                        disabled={!canSendFreeform}
                        className={cn(
                            "rounded-lg px-3 py-1.5 text-sm",
                            canSendFreeform
                                ? "bg-blue-300/[0.08] text-blue-100 hover:bg-blue-300/12"
                                : "bg-white/[0.02] text-zinc-600"
                        )}
                    >
                        发送
                    </button>
                </div>
            )}
        </div>
    );
});

AskUserCard.displayName = "AskUserCard";
