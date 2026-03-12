// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getApi } from "@/app/store/global";
import { base64ToString, stringToBase64, cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useMemo, useState } from "react";

interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
}

const TextInput = memo(({ value, onChange, placeholder, disabled }: TextInputProps) => {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
                "w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        />
    );
});
TextInput.displayName = "TextInput";

interface FormFieldProps {
    label: string;
    description?: string;
    children: React.ReactNode;
}

const FormField = memo(({ label, description, children }: FormFieldProps) => {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-300">{label}</label>
            {description && <span className="text-xs text-zinc-500">{description}</span>}
            {children}
        </div>
    );
});
FormField.displayName = "FormField";

interface SettingSectionProps {
    title: string;
    icon: string;
    children: React.ReactNode;
}

const SettingSection = memo(({ title, icon, children }: SettingSectionProps) => {
    return (
        <div className="border border-zinc-700/50 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-zinc-800/50 border-b border-zinc-700/50">
                <i className={`fa-sharp fa-solid ${icon} text-zinc-400`} />
                <span className="font-semibold text-zinc-200">{title}</span>
            </div>
            <div className="p-4 space-y-4">{children}</div>
        </div>
    );
});
SettingSection.displayName = "SettingSection";

type BackgroundPresetsData = Record<string, any>;

interface BackgroundPresetsVisualContentProps {
    model: WaveConfigViewModel;
}

const defaultPresets: Record<string, any> = {
    "bg@default": {
        "display:name": "Default",
        "display:order": -1,
    },
    "bg@rainbow": {
        "display:name": "Rainbow",
        "display:order": 2.1,
    },
    "bg@green": {
        "display:name": "Green",
        "display:order": 1.2,
    },
    "bg@blue": {
        "display:name": "Blue",
        "display:order": 1.1,
    },
    "bg@red": {
        "display:name": "Red",
        "display:order": 1.3,
    },
    "bg@ocean-depths": {
        "display:name": "Ocean Depths",
        "display:order": 2.2,
    },
    "bg@aqua-horizon": {
        "display:name": "Aqua Horizon",
        "display:order": 2.3,
    },
    "bg@sunset": {
        "display:name": "Sunset",
        "display:order": 2.4,
    },
    "bg@enchantedforest": {
        "display:name": "Enchanted Forest",
        "display:order": 2.7,
    },
    "bg@twilight-mist": {
        "display:name": "Twilight Mist",
        "display:order": 2.9,
    },
    "bg@duskhorizon": {
        "display:name": "Dusk Horizon",
        "display:order": 3.1,
    },
    "bg@tropical-radiance": {
        "display:name": "Tropical Radiance",
        "display:order": 3.2,
    },
    "bg@twilight-ember": {
        "display:name": "Twilight Ember",
        "display:order": 3.3,
    },
    "bg@cosmic-tide": {
        "display:name": "Cosmic Tide",
        "display:order": 3.4,
    },
};

const presetColors: Record<string, string> = {
    "bg@default": "bg-zinc-800",
    "bg@rainbow": "bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 to-purple-500",
    "bg@green": "bg-green-600",
    "bg@blue": "bg-blue-600",
    "bg@red": "bg-red-600",
    "bg@ocean-depths": "bg-gradient-to-br from-purple-900 via-blue-800 to-teal-700",
    "bg@aqua-horizon": "bg-gradient-to-br from-slate-900 via-cyan-800 to-sky-600",
    "bg@sunset": "bg-gradient-to-br from-red-900 via-orange-600 to-purple-900",
    "bg@enchantedforest": "bg-gradient-to-br from-green-900 via-green-700 to-emerald-800",
    "bg@twilight-mist": "bg-gradient-to-b from-slate-700 via-slate-500 to-slate-700",
    "bg@duskhorizon": "bg-gradient-to-b from-red-900 via-orange-500 via-amber-500 to-purple-900",
    "bg@tropical-radiance": "bg-gradient-to-br from-yellow-400 via-orange-500 to-pink-600",
    "bg@twilight-ember": "bg-gradient-to-br from-purple-900 via-red-700 to-orange-600",
    "bg@cosmic-tide": "bg-gradient-to-br from-indigo-900 via-purple-800 to-blue-700",
};

const presetLabels: Record<string, string> = {
    "bg@default": "默认",
    "bg@rainbow": "彩虹",
    "bg@green": "绿色",
    "bg@blue": "蓝色",
    "bg@red": "红色",
    "bg@ocean-depths": "海洋深处",
    "bg@aqua-horizon": " Aqua 地平线",
    "bg@sunset": "日落",
    "bg@enchantedforest": "魔法森林",
    "bg@twilight-mist": "暮光薄雾",
    "bg@duskhorizon": "黄昏地平线",
    "bg@tropical-radiance": "热带光芒",
    "bg@twilight-ember": "暮光余烬",
    "bg@cosmic-tide": "宇宙潮汐",
};

export const BackgroundPresetsVisualContent = memo(({ model }: BackgroundPresetsVisualContentProps) => {
    const fileContent = useAtomValue(model.fileContentAtom);
    const setFileContent = useSetAtom(model.fileContentAtom);
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newPresetName, setNewPresetName] = useState("");
    const [isApplying, setIsApplying] = useState(false);

    const applyPreset = useCallback(async () => {
        if (!selectedPreset) return;
        setIsApplying(true);
        try {
            const configDir = getApi().getConfigDir();
            const settingsPath = `${configDir}/settings.json`;
            let settingsContent = "";
            try {
                const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                    info: { path: settingsPath },
                });
                settingsContent = fileData?.data64 ? base64ToString(fileData.data64) : "{}";
            } catch {
                settingsContent = "{}";
            }
            let settings = {};
            try {
                settings = JSON.parse(settingsContent);
            } catch {
                settings = {};
            }
            settings["tab:preset"] = selectedPreset;
            const newContent = JSON.stringify(settings, null, 2);
            await RpcApi.FileWriteCommand(TabRpcClient, {
                info: { path: settingsPath },
                data64: stringToBase64(newContent),
            });
            alert(`已应用预设: ${selectedPreset}`);
        } catch (error) {
            console.error("Failed to apply preset:", error);
            alert("应用预设失败");
        } finally {
            setIsApplying(false);
        }
    }, [selectedPreset]);

    const presets: BackgroundPresetsData = useMemo(() => {
        try {
            return JSON.parse(fileContent || "{}");
        } catch {
            return {};
        }
    }, [fileContent]);

    const presetNames = useMemo(() => {
        const allPresets = { ...defaultPresets, ...presets };
        return Object.keys(allPresets).sort((a, b) => {
            const orderA = allPresets[a]?.["display:order"] ?? 0;
            const orderB = allPresets[b]?.["display:order"] ?? 0;
            return orderA - orderB;
        });
    }, [presets]);

    const currentPreset = selectedPreset ? { ...defaultPresets[selectedPreset], ...presets[selectedPreset] } : null;

    const isBuiltInPreset = (name: string) => {
        return defaultPresets[name] !== undefined;
    };

    const updatePreset = useCallback(
        (presetName: string, field: string, value: any) => {
            const newPresets = {
                ...presets,
                [presetName]: {
                    ...presets[presetName],
                    [field]: value,
                },
            };
            setFileContent(JSON.stringify(newPresets, null, 2));
            model.markAsEdited();
        },
        [presets, setFileContent, model]
    );

    const deletePreset = useCallback(
        (presetName: string) => {
            if (isBuiltInPreset(presetName)) {
                return;
            }
            const newPresets = { ...presets };
            delete newPresets[presetName];
            setFileContent(JSON.stringify(newPresets, null, 2));
            model.markAsEdited();
            if (selectedPreset === presetName) {
                setSelectedPreset(null);
            }
        },
        [presets, setFileContent, model, selectedPreset]
    );

    const createPreset = useCallback(() => {
        if (!newPresetName.trim()) return;
        const presetKey = "bg@" + newPresetName.trim().toLowerCase().replace(/\s+/g, "-");
        const newPresets = {
            ...presets,
            [presetKey]: {
                "display:name": newPresetName.trim(),
                "display:order": 10,
                "bg:*": true,
                "bg": "#1a1a2e",
                "bg:opacity": 0.5,
            },
        };
        setFileContent(JSON.stringify(newPresets, null, 2));
        model.markAsEdited();
        setSelectedPreset(presetKey);
        setIsCreating(false);
        setNewPresetName("");
    }, [presets, newPresetName, setFileContent, model]);

    const renderPresetList = () => (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b border-zinc-700">
                <button
                    onClick={() => setIsCreating(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded text-sm font-medium transition-colors"
                >
                    <i className="fa-sharp fa-solid fa-plus" />
                    新建预设
                </button>
            </div>
            {isCreating && (
                <div className="p-4 border-b border-zinc-700 bg-zinc-800/50">
                    <div className="flex flex-col gap-2">
                        <TextInput
                            value={newPresetName}
                            onChange={setNewPresetName}
                            placeholder="预设名称 (如: My Theme)"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setIsCreating(false);
                                    setNewPresetName("");
                                }}
                                className="flex-1 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={createPreset}
                                disabled={!newPresetName.trim()}
                                className="flex-1 px-3 py-2 bg-accent-600 hover:bg-accent-500 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                创建
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="flex-1 overflow-y-auto p-2">
                {presetNames.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-zinc-500">
                        <i className="fa-sharp fa-solid fa-palette text-4xl mb-2" />
                        <p>暂无预设</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {presetNames.map((name) => {
                            const isEnabled = presets[name] !== undefined || (isBuiltInPreset(name) && !presets[name]?.["display:disabled"]);
                            const colorClass = presetColors[name] || "bg-zinc-800";

                            return (
                                <div
                                    key={name}
                                    onClick={() => setSelectedPreset(name)}
                                    className={cn(
                                        "relative rounded-lg overflow-hidden cursor-pointer transition-all border-2",
                                        selectedPreset === name ? "border-accent-500 ring-2 ring-accent-500/30" : "border-transparent hover:border-zinc-600"
                                    )}
                                >
                                    <div className={cn("h-16 w-full", colorClass)} />
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                                        <span className="text-xs text-white truncate block">
                                            {presets[name]?.["display:name"] || defaultPresets[name]?.["display:name"] || name}
                                        </span>
                                    </div>
                                    {isBuiltInPreset(name) && (
                                        <span className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 bg-zinc-800/80 text-zinc-400 rounded">
                                            内置
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );

    const renderPresetForm = () => {
        if (!currentPreset || !selectedPreset) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 p-8">
                    <i className="fa-sharp fa-solid fa-arrow-left text-4xl mb-4" />
                    <p className="text-center">选择一个预设进行编辑</p>
                </div>
            );
        }

        const isBuiltIn = isBuiltInPreset(selectedPreset);

        return (
            <div className="h-full overflow-y-auto">
                <div className="sticky top-0 bg-zinc-900 border-b border-zinc-700 p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-2">
                        <i className="fa-sharp fa-solid fa-palette text-zinc-400" />
                        <span className="font-semibold text-zinc-200">
                            {currentPreset?.["display:name"] || selectedPreset}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={applyPreset}
                            disabled={isApplying}
                            className="px-3 py-1.5 bg-accent-600 hover:bg-accent-500 text-white rounded text-sm transition-colors disabled:opacity-50"
                        >
                            {isApplying ? "应用中..." : "应用此预设"}
                        </button>
                        {!isBuiltIn && (
                            <button
                                onClick={() => deletePreset(selectedPreset)}
                                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm transition-colors"
                            >
                                <i className="fa-sharp fa-solid fa-trash mr-1" />
                                删除
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-4 space-y-4">
                    <div className="mb-4">
                        <div
                            className={cn(
                                "h-32 rounded-lg",
                                presetColors[selectedPreset] || "bg-zinc-800"
                            )}
                        />
                    </div>

                    <SettingSection title="基本信息" icon="fa-info">
                        <FormField label="显示名称">
                            <TextInput
                                value={currentPreset?.["display:name"] || ""}
                                onChange={(v) => updatePreset(selectedPreset, "display:name", v || undefined)}
                                placeholder="预设名称"
                                disabled={isBuiltIn}
                            />
                        </FormField>
                        <FormField label="排序">
                            <TextInput
                                value={currentPreset?.["display:order"]?.toString() || "0"}
                                onChange={(v) => updatePreset(selectedPreset, "display:order", parseFloat(v) || undefined)}
                                placeholder="0"
                                disabled={isBuiltIn}
                            />
                        </FormField>
                    </SettingSection>

                    <SettingSection title="背景颜色" icon="fa-paint-brush">
                        <FormField label="背景颜色/渐变">
                            <TextInput
                                value={presets[selectedPreset]?.["bg"] || ""}
                                onChange={(v) => updatePreset(selectedPreset, "bg", v || undefined)}
                                placeholder="#1a1a2e 或 linear-gradient(...)"
                            />
                        </FormField>
                        <FormField label="不透明度 (0-1)">
                            <TextInput
                                value={presets[selectedPreset]?.["bg:opacity"]?.toString() || ""}
                                onChange={(v) => updatePreset(selectedPreset, "bg:opacity", parseFloat(v) || undefined)}
                                placeholder="0.5"
                            />
                        </FormField>
                        <FormField label="混合模式">
                            <TextInput
                                value={presets[selectedPreset]?.["bg:blendmode"] || ""}
                                onChange={(v) => updatePreset(selectedPreset, "bg:blendmode", v || undefined)}
                                placeholder="normal, overlay, soft-light..."
                            />
                        </FormField>
                    </SettingSection>

                    <SettingSection title="边框颜色" icon="fa-border-all">
                        <FormField label="边框颜色">
                            <TextInput
                                value={presets[selectedPreset]?.["bg:bordercolor"] || ""}
                                onChange={(v) => updatePreset(selectedPreset, "bg:bordercolor", v || undefined)}
                                placeholder="rgba(255,255,255,0.1)"
                            />
                        </FormField>
                        <FormField label="激活边框颜色">
                            <TextInput
                                value={presets[selectedPreset]?.["bg:activebordercolor"] || ""}
                                onChange={(v) => updatePreset(selectedPreset, "bg:activebordercolor", v || undefined)}
                                placeholder="rgba(255,255,255,0.2)"
                            />
                        </FormField>
                    </SettingSection>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full bg-zinc-900">
            <div className="w-64 border-r border-zinc-700 flex-shrink-0">{renderPresetList()}</div>
            <div className="flex-1 min-w-0">{renderPresetForm()}</div>
        </div>
    );
});

BackgroundPresetsVisualContent.displayName = "BackgroundPresetsVisualContent";
