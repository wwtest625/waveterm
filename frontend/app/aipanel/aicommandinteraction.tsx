import { cn } from "@/util/util";
import { memo, useEffect, useRef, useState } from "react";
import { t } from "./aipanel-i18n";
import { WaveAIModel } from "./waveai-model";
import { useAtomValue } from "jotai";

export const CommandInteractionInput = memo(() => {
    const model = WaveAIModel.getInstance();
    const interaction = useAtomValue(model.commandInteractionAtom);
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
        <div className="mx-3 mb-2 rounded-xl border border-amber-300/12 bg-amber-300/[0.04] px-3 py-3 text-sm text-zinc-200">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-medium text-amber-100/80 text-xs">
                        {interaction.tuiDetected
                            ? t.commandInteraction.interactiveTUIDetected
                            : interaction.promptHint || t.commandInteraction.waitingForInput}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-400">
                        {interaction.tuiSuppressed
                            ? t.commandInteraction.tuiSuppressed
                            : t.commandInteraction.submitHint}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void model.cancelExecution()}
                    className="rounded-lg border border-red-300/12 bg-red-300/[0.06] px-2.5 py-1 text-[11px] text-red-200/70"
                >
                    {t.aipanel.cancel}
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
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {interaction.inputOptions.map((option) => (
                                <button
                                    key={option === "" ? "__enter__" : option}
                                    type="button"
                                    onClick={() => void model.submitCommandInteraction(option)}
                                    className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-white/[0.06]"
                                >
                                    {option === "" ? t.aipanel.enter : option}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="mt-2 flex gap-2">
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={interaction.promptHint || t.commandInteraction.typeInput}
                            className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-black/15 px-3 py-1.5 text-sm text-white outline-none placeholder:text-zinc-500"
                        />
                        <button
                            type="button"
                            onClick={() => void model.submitCommandInteraction(input)}
                            disabled={!canSend}
                            className={cn(
                                "rounded-lg px-3 py-1.5 text-sm",
                                canSend
                                    ? "bg-amber-300/[0.08] text-amber-100 hover:bg-amber-300/12"
                                    : "bg-white/[0.02] text-zinc-600"
                            )}
                        >
                            {t.aipanel.send}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
});

CommandInteractionInput.displayName = "CommandInteractionInput";
