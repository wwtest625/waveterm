// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

interface ModelInfo {
    id: string;
    name: string;
    object: string;
}

interface ModelListResponse {
    models: ModelInfo[];
    error?: string;
}

interface ModelSelectorProps {
    provider: string;
    endpoint?: string;
    secretName?: string;
    modeKey?: string;
    selectedModel: string;
    onModelSelected: (model: string) => void;
    onClose: () => void;
}

export const ModelSelector = memo(({ provider, endpoint, secretName, modeKey, selectedModel, onModelSelected, onClose }: ModelSelectorProps) => {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const fetchModels = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (provider) params.set("provider", provider);
            if (endpoint) params.set("endpoint", endpoint);
            if (secretName) params.set("secret", secretName);
            if (modeKey) params.set("modeKey", modeKey);

            const url = `${getWebServerEndpoint()}/api/get-model-list?${params.toString()}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = (await response.json()) as ModelListResponse;

            if (data.error) {
                setError(data.error);
            } else {
                setModels(data.models || []);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [provider, endpoint, secretName, modeKey]);

    useEffect(() => {
        fetchModels();
    }, [fetchModels]);

    const filteredModels = useMemo(() => {
        if (!searchQuery.trim()) return models;
        const query = searchQuery.toLowerCase();
        return models.filter((m) => m.id.toLowerCase().includes(query) || (m.name && m.name.toLowerCase().includes(query)));
    }, [models, searchQuery]);

    const handleSelect = useCallback((modelId: string) => {
        onModelSelected(modelId);
        onClose();
    }, [onModelSelected, onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-100">选择模型</h3>
                        <p className="text-sm text-zinc-400">{provider} - 共 {models.length} 个模型</p>
                    </div>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
                        <i className="fa-solid fa-times text-lg" />
                    </button>
                </div>

                <div className="px-4 py-3 border-b border-zinc-700">
                    <div className="flex gap-2">
                        <div className="flex-1 relative">
                            <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                            <input
                                type="text"
                                placeholder="搜索模型名称..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-accent-500"
                            />
                        </div>
                        <button
                            onClick={fetchModels}
                            className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
                            title="刷新模型列表"
                        >
                            <i className="fa-solid fa-refresh" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: "400px" }}>
                    {loading && (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" />
                        </div>
                    )}

                    {error && !loading && (
                        <div className="flex flex-col items-center justify-center py-8 text-red-400">
                            <i className="fa-solid fa-circle-exclamation text-2xl mb-2" />
                            <p className="text-sm">{error}</p>
                            <button
                                onClick={fetchModels}
                                className="mt-2 px-3 py-1.5 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-300 hover:bg-zinc-700"
                            >
                                重试
                            </button>
                        </div>
                    )}

                    {!loading && !error && filteredModels.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-8 text-zinc-500">
                            <i className="fa-solid fa-robot text-2xl mb-2" />
                            <p className="text-sm">没有找到匹配的模型</p>
                        </div>
                    )}

                    {!loading && !error && filteredModels.length > 0 && (
                        <div className="space-y-1">
                            {filteredModels.map((model) => {
                                const isSelected = selectedModel === model.id;
                                return (
                                    <div
                                        key={model.id}
                                        onClick={() => handleSelect(model.id)}
                                        className={cn(
                                            "flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors",
                                            isSelected ? "bg-accent-600/20 border border-accent-500/50" : "hover:bg-zinc-800 border border-transparent"
                                        )}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-zinc-200 truncate">{model.id}</div>
                                            {model.name && model.name !== model.id && (
                                                <div className="text-xs text-zinc-500 truncate">{model.name}</div>
                                            )}
                                        </div>
                                        {isSelected && <i className="fa-solid fa-check text-accent-500 text-sm" />}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-700">
                    <div className="text-sm text-zinc-400">
                        {selectedModel && <span className="text-zinc-200">已选择: {selectedModel}</span>}
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
});

ModelSelector.displayName = "ModelSelector";
