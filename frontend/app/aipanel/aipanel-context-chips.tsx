import { cn } from "@/util/util";
import { memo, useCallback } from "react";
import type { ContextItem } from "./aitypes";

interface ContextChipsProps {
    items: ContextItem[];
    onRemove: (id: string) => void;
}

const TYPE_STYLES: Record<string, string> = {
    skill: "bg-amber-400/[0.12] text-amber-300 border-amber-400/20",
    kb: "bg-blue-400/[0.12] text-blue-300 border-blue-400/20",
    file: "bg-emerald-400/[0.12] text-emerald-300 border-emerald-400/20",
    terminal: "bg-purple-400/[0.12] text-purple-300 border-purple-400/20",
    folder: "bg-orange-400/[0.12] text-orange-300 border-orange-400/20",
    git: "bg-rose-400/[0.12] text-rose-300 border-rose-400/20",
    web: "bg-cyan-400/[0.12] text-cyan-300 border-cyan-400/20",
};

const TYPE_ICONS: Record<string, string> = {
    skill: "fa-bolt",
    kb: "fa-book",
    file: "fa-file",
    terminal: "fa-terminal",
    folder: "fa-folder",
    git: "fa-code-branch",
    web: "fa-globe",
};

export const ContextChips = memo(({ items, onRemove }: ContextChipsProps) => {
    const handleRemove = useCallback(
        (id: string) => (e: React.MouseEvent) => {
            e.stopPropagation();
            onRemove(id);
        },
        [onRemove]
    );

    if (items.length === 0) return null;

    return (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            {items.map((item) => (
                <div
                    key={item.id}
                    className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                        TYPE_STYLES[item.type] || "bg-zinc-700/50 text-zinc-300 border-zinc-600"
                    )}
                >
                    <i className={cn("fa text-[9px]", TYPE_ICONS[item.type] || "fa-circle")} />
                    <span className="max-w-[120px] truncate">{item.label}</span>
                    <button
                        onClick={handleRemove(item.id)}
                        className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm opacity-60 hover:opacity-100 cursor-pointer transition-opacity"
                    >
                        <i className="fa fa-times text-[8px]" />
                    </button>
                </div>
            ))}
        </div>
    );
});

ContextChips.displayName = "ContextChips";
