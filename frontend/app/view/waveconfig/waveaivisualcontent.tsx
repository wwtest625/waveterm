// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { ModelSelector } from "@/app/aipanel/modelselector";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useMemo, useState } from "react";

interface ToggleSwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}

const ToggleSwitch = memo(({ checked, onChange, disabled }: ToggleSwitchProps) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 focus:ring-offset-zinc-900",
                checked ? "bg-accent-600" : "bg-zinc-600",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            <span
                className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                    checked ? "translate-x-4" : "translate-x-0"
                )}
            />
        </button>
    );
});
ToggleSwitch.displayName = "ToggleSwitch";

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

interface SelectInputProps {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
}

const SelectInput = memo(({ value, onChange, options, disabled }: SelectInputProps) => {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={cn(
                "w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500 appearance-none cursor-pointer",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
    );
});
SelectInput.displayName = "SelectInput";

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

type WaveAIModesData = Record<string, any>;

interface WaveAIVisualContentProps {
    model: WaveConfigViewModel;
}

export const WaveAIVisualContent = memo(({ model }: WaveAIVisualContentProps) => {
    const fileContent = useAtomValue(model.fileContentAtom);
    const setFileContent = useSetAtom(model.fileContentAtom);
    const [selectedMode, setSelectedMode] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newModeName, setNewModeName] = useState("");
    const [showModelSelector, setShowModelSelector] = useState(false);

    const aiModes: WaveAIModesData = useMemo(() => {
        try {
            return JSON.parse(fileContent || "{}");
        } catch {
            return {};
        }
    }, [fileContent]);

    const modeNames = useMemo(() => {
        return Object.keys(aiModes).sort((a, b) => {
            const orderA = aiModes[a]?.["display:order"] ?? 0;
            const orderB = aiModes[b]?.["display:order"] ?? 0;
            return orderA - orderB;
        });
    }, [aiModes]);

    const currentMode = selectedMode ? aiModes[selectedMode] : null;

    const isBuiltInMode = (name: string) => {
        return name.startsWith("waveai@");
    };

    const updateMode = useCallback(
        (modeName: string, field: string, value: any) => {
            const newModes = {
                ...aiModes,
                [modeName]: {
                    ...aiModes[modeName],
                    [field]: value,
                },
            };
            setFileContent(JSON.stringify(newModes, null, 2));
            model.markAsEdited();
        },
        [aiModes, setFileContent, model]
    );

    const deleteMode = useCallback(
        (modeName: string) => {
            if (isBuiltInMode(modeName)) {
                return;
            }
            const newModes = { ...aiModes };
            delete newModes[modeName];
            setFileContent(JSON.stringify(newModes, null, 2));
            model.markAsEdited();
            if (selectedMode === modeName) {
                setSelectedMode(null);
            }
        },
        [aiModes, setFileContent, model, selectedMode]
    );

    const createMode = useCallback(() => {
        if (!newModeName.trim()) return;
        const modeKey = newModeName.trim().toLowerCase().replace(/\s+/g, "-");
        const newModes = {
            ...aiModes,
            [modeKey]: {
                "display:name": newModeName.trim(),
                "display:order": 0,
                "display:icon": "robot",
                "display:description": "",
                "ai:provider": "openai",
                "ai:apitype": "openai-chat",
                "ai:model": "gpt-4",
                "ai:thinkinglevel": "low",
                "ai:verbosity": "low",
                "ai:capabilities": [],
            },
        };
        setFileContent(JSON.stringify(newModes, null, 2));
        model.markAsEdited();
        setSelectedMode(modeKey);
        setIsCreating(false);
        setNewModeName("");
    }, [aiModes, newModeName, setFileContent, model]);

    const renderModeList = () => (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b border-zinc-700">
                <button
                    onClick={() => setIsCreating(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded text-sm font-medium transition-colors"
                >
                    <i className="fa-sharp fa-solid fa-plus" />
                    新建模式
                </button>
            </div>
            {isCreating && (
                <div className="p-4 border-b border-zinc-700 bg-zinc-800/50">
                    <div className="flex flex-col gap-2">
                        <TextInput
                            value={newModeName}
                            onChange={setNewModeName}
                            placeholder="模式名称 (如: My GPT-4)"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setIsCreating(false);
                                    setNewModeName("");
                                }}
                                className="flex-1 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={createMode}
                                disabled={!newModeName.trim()}
                                className="flex-1 px-3 py-2 bg-accent-600 hover:bg-accent-500 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                创建
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="flex-1 overflow-y-auto">
                {modeNames.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-zinc-500">
                        <i className="fa-sharp fa-solid fa-robot text-4xl mb-2" />
                        <p>暂无 AI 模式</p>
                        <p className="text-xs">点击上方按钮创建新模式</p>
                    </div>
                ) : (
                    modeNames.map((name) => (
                        <div
                            key={name}
                            onClick={() => setSelectedMode(name)}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-zinc-700/50",
                                selectedMode === name ? "bg-accentbg" : "hover:bg-zinc-800/50"
                            )}
                        >
                            <i className={`fa-sharp fa-solid fa-${aiModes[name]?.["display:icon"] || "robot"} text-zinc-400`} />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-zinc-200 truncate">
                                    {aiModes[name]?.["display:name"] || name}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-zinc-500">
                                    <span className="truncate">{aiModes[name]?.["ai:provider"]}</span>
                                    {aiModes[name]?.["ai:model"] && (
                                        <>
                                            <span>•</span>
                                            <span className="text-accent-400/70 truncate">{aiModes[name]?.["ai:model"]}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            {isBuiltInMode(name) && (
                                <span className="text-xs px-2 py-0.5 bg-zinc-700 text-zinc-400 rounded">内置</span>
                            )}
                            <i className="fa-sharp fa-solid fa-chevron-right text-zinc-500 text-sm" />
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderModeForm = () => {
        if (!currentMode || !selectedMode) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 p-8">
                    <i className="fa-sharp fa-solid fa-arrow-left text-4xl mb-4" />
                    <p className="text-center">选择一个 AI 模式进行编辑</p>
                </div>
            );
        }

        const isBuiltIn = isBuiltInMode(selectedMode);

        return (
            <div className="h-full overflow-y-auto">
                <div className="sticky top-0 bg-zinc-900 border-b border-zinc-700 p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-2">
                        <i className={`fa-sharp fa-solid fa-${currentMode?.["display:icon"] || "robot"} text-zinc-400`} />
                        <span className="font-semibold text-zinc-200">{currentMode?.["display:name"] || selectedMode}</span>
                    </div>
                    {!isBuiltIn && (
                        <button
                            onClick={() => deleteMode(selectedMode)}
                            className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm transition-colors"
                        >
                            <i className="fa-sharp fa-solid fa-trash mr-1" />
                            删除
                        </button>
                    )}
                </div>

                <div className="p-4 space-y-4">
                    <SettingSection title="基本信息" icon="fa-info">
                        <FormField label="显示名称">
                            <TextInput
                                value={currentMode?.["display:name"] || ""}
                                onChange={(v) => updateMode(selectedMode, "display:name", v || undefined)}
                                placeholder="My AI Mode"
                                disabled={isBuiltIn}
                            />
                        </FormField>
                        <FormField label="图标">
                            <SelectInput
                                value={currentMode?.["display:icon"] || "robot"}
                                onChange={(v) => updateMode(selectedMode, "display:icon", v)}
                                options={[
                                    { value: "robot", label: "机器人" },
                                    { value: "bolt", label: "闪电" },
                                    { value: "sparkles", label: "闪光" },
                                    { value: "brain", label: "大脑" },
                                    { value: "lightbulb", label: "灯泡" },
                                    { value: "microchip", label: "芯片" },
                                    { value: "magic", label: "魔法" },
                                ]}
                                disabled={isBuiltIn}
                            />
                        </FormField>
                        <FormField label="描述">
                            <textarea
                                value={currentMode?.["display:description"] || ""}
                                onChange={(e) => updateMode(selectedMode, "display:description", e.target.value || undefined)}
                                placeholder="描述这个 AI 模式..."
                                disabled={isBuiltIn}
                                rows={3}
                                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-200 focus:outline-none focus:border-accent-500 resize-none"
                            />
                        </FormField>
                    </SettingSection>

                    <SettingSection title="API 配置" icon="fa-key">
                        <FormField label="提供商">
                            <SelectInput
                                value={currentMode?.["ai:provider"] || "openai"}
                                onChange={(v) => updateMode(selectedMode, "ai:provider", v)}
                                options={[
                                    { value: "wave", label: "Wave AI" },
                                    { value: "openai", label: "OpenAI" },
                                    { value: "google", label: "Google Gemini" },
                                    { value: "anthropic", label: "Anthropic Claude" },
                                    { value: "groq", label: "Groq" },
                                    { value: "openrouter", label: "OpenRouter" },
                                    { value: "azure", label: "Azure OpenAI" },
                                    { value: "custom", label: "自定义" },
                                ]}
                            />
                        </FormField>
                        <FormField label="API 类型">
                            <SelectInput
                                value={currentMode?.["ai:apitype"] || "openai-chat"}
                                onChange={(v) => updateMode(selectedMode, "ai:apitype", v)}
                                options={[
                                    { value: "openai-chat", label: "OpenAI Chat" },
                                    { value: "openai-responses", label: "OpenAI Responses" },
                                    { value: "google-gemini", label: "Google Gemini" },
                                ]}
                            />
                        </FormField>
                        <FormField label="模型">
                            <div className="flex flex-col gap-2">
                                <div className="flex gap-2">
                                    <TextInput
                                        value={currentMode?.["ai:model"] || ""}
                                        onChange={(v) => updateMode(selectedMode, "ai:model", v || undefined)}
                                        placeholder="gpt-4, gpt-4o, claude-3-opus..."
                                    />
                                    <button
                                        onClick={() => setShowModelSelector(true)}
                                        className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors whitespace-nowrap"
                                        title="获取模型列表"
                                    >
                                        <i className="fa-solid fa-download mr-1" />
                                        获取
                                    </button>
                                </div>
                                {currentMode?.["ai:model"] && (
                                    <div className="flex flex-wrap gap-1">
                                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-accent-600/20 border border-accent-500/30 rounded text-xs text-zinc-300">
                                            <i className="fa-solid fa-robot text-[10px]" />
                                            {currentMode["ai:model"]}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </FormField>
                        <FormField label="API 端点">
                            <TextInput
                                value={currentMode?.["ai:endpoint"] || ""}
                                onChange={(v) => updateMode(selectedMode, "ai:endpoint", v || undefined)}
                                placeholder="自定义 API 端点 URL"
                            />
                        </FormField>
                        <FormField label="API Token 密钥名">
                            <TextInput
                                value={currentMode?.["ai:apitokensecretname"] || ""}
                                onChange={(v) => updateMode(selectedMode, "ai:apitokensecretname", v || undefined)}
                                placeholder="密钥名称"
                            />
                        </FormField>
                    </SettingSection>

                    <SettingSection title="模型选项" icon="fa-sliders">
                        <FormField label="思考深度">
                            <SelectInput
                                value={currentMode?.["ai:thinkinglevel"] || "low"}
                                onChange={(v) => updateMode(selectedMode, "ai:thinkinglevel", v)}
                                options={[
                                    { value: "low", label: "低 - 快速响应" },
                                    { value: "medium", label: "中 - 平衡" },
                                    { value: "high", label: "高 - 深度思考" },
                                ]}
                            />
                        </FormField>
                    </SettingSection>

                    <SettingSection title="能力" icon="fa-rocket">
                        <p className="text-xs text-zinc-500 mb-2">选择 AI 模式支持的功能，默认启用工具</p>
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { key: "tools", label: "工具", desc: "文件读写、终端命令" },
                                { key: "images", label: "图片", desc: "分析上传的图片" },
                                { key: "pdfs", label: "PDF", desc: "读取 PDF 文件" }
                            ].map((cap) => (
                                <label key={cap.key} className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-zinc-800/50 border border-transparent hover:border-zinc-700">
                                    <input
                                        type="checkbox"
                                        checked={currentMode?.["ai:capabilities"]?.includes(cap.key) || (cap.key === "tools" && !currentMode?.["ai:capabilities"])}
                                        onChange={(e) => {
                                            const current = currentMode?.["ai:capabilities"] || ["tools"];
                                            const newCaps = e.target.checked
                                                ? [...current, cap.key]
                                                : current.filter((c: string) => c !== cap.key);
                                            const capsToSave = newCaps.length > 0 ? [...new Set(newCaps)] : undefined;
                                            updateMode(selectedMode, "ai:capabilities", capsToSave);
                                        }}
                                        className="w-4 h-4 mt-0.5 rounded bg-zinc-800 border-zinc-600 text-accent-500 focus:ring-accent-500"
                                    />
                                    <div>
                                        <span className="text-sm text-zinc-300">{cap.label}</span>
                                        <div className="text-xs text-zinc-500">{cap.desc}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </SettingSection>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full bg-zinc-900">
            <div className="w-72 border-r border-zinc-700 flex-shrink-0">{renderModeList()}</div>
            <div className="flex-1 min-w-0">{renderModeForm()}</div>
            {showModelSelector && currentMode && (
                <ModelSelector
                    provider={currentMode?.["ai:provider"] || "openai"}
                    endpoint={currentMode?.["ai:endpoint"]}
                    secretName={currentMode?.["ai:apitokensecretname"]}
                    modeKey={selectedMode || undefined}
                    selectedModel={currentMode?.["ai:model"] || ""}
                    onModelSelected={(model) => {
                        if (model) {
                            updateMode(selectedMode, "ai:model", model);
                        }
                    }}
                    onClose={() => setShowModelSelector(false)}
                />
            )}
        </div>
    );
});

WaveAIVisualContent.displayName = "WaveAIVisualContent";
