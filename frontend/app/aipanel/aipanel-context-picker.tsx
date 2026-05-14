import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContextItem, ContextItemType } from "./aitypes";

interface ContextTypeOption {
    type: ContextItemType;
    icon: string;
    label: string;
    description: string;
}

const CONTEXT_TYPE_OPTIONS: ContextTypeOption[] = [
    { type: "skill", icon: "fa-bolt", label: "Skill", description: "引用 AI 技能" },
    { type: "kb", icon: "fa-book", label: "Knowledge Base", description: "引用知识库文件" },
];

interface ContextPickerProps {
    visible: boolean;
    onSelect: (item: ContextItem) => void;
    onClose: () => void;
    filterText: string;
    onFilterChange: (text: string) => void;
    kbEnabled?: boolean;
}

export const ContextPicker = memo(({ visible, onSelect, onClose, filterText, onFilterChange, kbEnabled }: ContextPickerProps) => {
    const [selectedType, setSelectedType] = useState<ContextItemType | null>(null);
    const [skills, setSkills] = useState<SkillListItem[]>([]);
    const [kbResults, setKbResults] = useState<KBFileSearchResult[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!visible) {
            setSelectedType(null);
            setSearchQuery("");
            setSelectedIndex(0);
            setSkills([]);
            setKbResults([]);
            setError(null);
        }
    }, [visible]);

    useEffect(() => {
        if (visible && selectedType === "skill") {
            setIsLoading(true);
            setError(null);
            fireAndForget(async () => {
                try {
                    const result = await RpcApi.ListSkillsCommand(TabRpcClient, {});
                    setSkills(result || []);
                } catch (e) {
                    setSkills([]);
                    setError(e instanceof Error ? e.message : String(e));
                } finally {
                    setIsLoading(false);
                }
            });
        }
    }, [visible, selectedType]);

    useEffect(() => {
        if (visible && selectedType === "kb" && searchQuery.length > 0) {
            setIsLoading(true);
            setError(null);
            const timer = setTimeout(() => {
                fireAndForget(async () => {
                    try {
                        const result = await RpcApi.SearchKBFilesCommand(TabRpcClient, { query: searchQuery });
                        setKbResults(result || []);
                    } catch (e) {
                        setKbResults([]);
                        setError(e instanceof Error ? e.message : String(e));
                    } finally {
                        setIsLoading(false);
                    }
                });
            }, 200);
            return () => clearTimeout(timer);
        }
        if (visible && selectedType === "kb" && searchQuery.length === 0) {
            setKbResults([]);
        }
    }, [visible, selectedType, searchQuery]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [filterText, selectedType, searchQuery, skills, kbResults]);

    useEffect(() => {
        if (selectedType && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [selectedType]);

    const filteredTypeOptions = useMemo(() => {
        const baseOptions = kbEnabled ? CONTEXT_TYPE_OPTIONS : CONTEXT_TYPE_OPTIONS.filter((opt) => opt.type !== "kb");
        if (!filterText) return baseOptions;
        return baseOptions.filter(
            (opt) =>
                opt.label.toLowerCase().includes(filterText.toLowerCase()) ||
                opt.type.toLowerCase().includes(filterText.toLowerCase())
        );
    }, [filterText, kbEnabled]);

    const filteredSkills = useMemo(() => {
        if (!searchQuery) return skills;
        return skills.filter(
            (s) =>
                s.skillName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                s.description?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [skills, searchQuery]);

    const currentItems = useMemo(() => {
        if (!selectedType) return filteredTypeOptions;
        if (selectedType === "skill") return filteredSkills;
        if (selectedType === "kb") return kbResults;
        return [];
    }, [selectedType, filteredTypeOptions, filteredSkills, kbResults]);

    const handleSelectType = useCallback((type: ContextItemType) => {
        setSelectedType(type);
        setSearchQuery("");
        setSelectedIndex(0);
        setError(null);
    }, []);

    const handleSelectItem = useCallback(
        (item: any) => {
            if (!selectedType) {
                handleSelectType(item.type);
                return;
            }
            let contextItem: ContextItem;
            if (selectedType === "skill") {
                const skill = item as SkillListItem;
                contextItem = {
                    id: `skill-${skill.skillId}`,
                    type: "skill",
                    label: skill.skillName,
                    icon: "fa-bolt",
                    data: {
                        skillName: skill.skillName,
                        skillId: skill.skillId,
                        description: skill.description || "",
                    },
                };
            } else {
                const kb = item as KBFileSearchResult;
                contextItem = {
                    id: `kb-${kb.path}`,
                    type: "kb",
                    label: kb.fileName,
                    icon: "fa-book",
                    data: {
                        path: kb.path,
                        fileName: kb.fileName,
                        size: kb.size,
                    },
                };
            }
            onSelect(contextItem);
        },
        [selectedType, onSelect, handleSelectType]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((idx) => Math.min(idx + 1, currentItems.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((idx) => Math.max(idx - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                const item = currentItems[selectedIndex];
                if (item) {
                    handleSelectItem(item);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                if (selectedType) {
                    setSelectedType(null);
                    setSearchQuery("");
                    setSelectedIndex(0);
                } else {
                    onClose();
                }
            }
        },
        [currentItems, selectedIndex, selectedType, handleSelectItem, onClose]
    );

    const handleClickOutside = useCallback(
        (e: React.MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose();
            }
        },
        [onClose]
    );

    if (!visible) return null;

    return (
        <>
            <div className="fixed inset-0 z-40" onClick={handleClickOutside} />
            <div
                ref={containerRef}
                className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-xl border border-zinc-700 bg-zinc-800/90 shadow-2xl backdrop-blur overflow-hidden"
                onKeyDown={handleKeyDown}
            >
                {selectedType ? (
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-2">
                            <button
                                onClick={() => {
                                    setSelectedType(null);
                                    setSearchQuery("");
                                    setSelectedIndex(0);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 cursor-pointer transition-colors"
                            >
                                <i className="fa fa-arrow-left text-xs" />
                            </button>
                            <i
                                className={cn(
                                    "text-xs",
                                    selectedType === "skill" ? "fa fa-bolt text-amber-400" : "fa fa-book text-blue-400"
                                )}
                            />
                            <span className="text-xs text-zinc-300">
                                {selectedType === "skill" ? "Select Skill" : "Search Knowledge Base"}
                            </span>
                        </div>
                        <div className="px-3 py-2">
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setError(null);
                                }}
                                placeholder={selectedType === "skill" ? "Search skills..." : "Search files..."}
                                className="w-full rounded-lg border border-zinc-600 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                            />
                            {error && (
                                <div className="mt-1 text-[10px] text-red-400 truncate" title={error}>
                                    {error}
                                </div>
                            )}
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                            {isLoading ? (
                                <div className="flex items-center justify-center py-4 text-xs text-zinc-500">
                                    <i className="fa fa-spinner fa-spin mr-2" />
                                    Loading...
                                </div>
                            ) : currentItems.length === 0 ? (
                                <div className="py-4 text-center text-xs text-zinc-500">
                                    {selectedType === "kb" && !searchQuery
                                        ? "Type to search knowledge base files"
                                        : "No results found"}
                                </div>
                            ) : (
                                currentItems.map((item, index) => {
                                    if (selectedType === "skill") {
                                        const skill = item as SkillListItem;
                                        return (
                                            <button
                                                key={skill.skillId}
                                                onClick={() => handleSelectItem(skill)}
                                                className={cn(
                                                    "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer",
                                                    index === selectedIndex
                                                        ? "bg-white/[0.08] text-zinc-100"
                                                        : "text-zinc-300 hover:bg-white/[0.06]"
                                                )}
                                            >
                                                <i className="fa fa-bolt text-xs text-amber-400" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs truncate">{skill.skillName}</div>
                                                    {skill.description && (
                                                        <div className="text-[10px] text-zinc-500 truncate">
                                                            {skill.description}
                                                        </div>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    }
                                    const kb = item as KBFileSearchResult;
                                    return (
                                        <button
                                            key={kb.path}
                                            onClick={() => handleSelectItem(kb)}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer",
                                                index === selectedIndex
                                                    ? "bg-white/[0.08] text-zinc-100"
                                                    : "text-zinc-300 hover:bg-white/[0.06]"
                                            )}
                                        >
                                            <i className="fa fa-book text-xs text-blue-400" />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs truncate">{kb.fileName}</div>
                                                <div className="text-[10px] text-zinc-500 truncate">{kb.path}</div>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="py-1">
                        {filteredTypeOptions.length === 0 ? (
                            <div className="py-4 text-center text-xs text-zinc-500">No matching types</div>
                        ) : (
                            filteredTypeOptions.map((opt, index) => (
                                <button
                                    key={opt.type}
                                    onClick={() => handleSelectType(opt.type)}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer",
                                        index === selectedIndex
                                            ? "bg-white/[0.08] text-zinc-100"
                                            : "text-zinc-300 hover:bg-white/[0.06]"
                                    )}
                                >
                                    <i
                                        className={cn(
                                            "text-xs",
                                            opt.type === "skill" ? "fa fa-bolt text-amber-400" : "fa fa-book text-blue-400"
                                        )}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs">@{opt.type}</div>
                                        <div className="text-[10px] text-zinc-500">{opt.description}</div>
                                    </div>
                                    <span className="text-[10px] text-zinc-600">{opt.label}</span>
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>
        </>
    );
});

ContextPicker.displayName = "ContextPicker";
