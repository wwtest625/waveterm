// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useMemo } from "react";

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

interface WidgetVisualContentProps {
    model: WaveConfigViewModel;
}

const defaultWidgets: Record<string, any> = {
    "defwidget@terminal": {
        "display:order": -5,
        icon: "square-terminal",
        label: "terminal",
    },
    "defwidget@files": {
        "display:order": -4,
        icon: "folder",
        label: "files",
    },
    "defwidget@web": {
        "display:order": -3,
        icon: "globe",
        label: "web",
    },
    "defwidget@ai": {
        "display:order": -2,
        icon: "sparkles",
        label: "ai",
    },
    "defwidget@sysinfo": {
        "display:order": -1,
        icon: "chart-line",
        label: "sysinfo",
    },
    "defwidget@quickcommands": {
        "display:order": 0,
        icon: "bolt",
        label: "commands",
    },
    "defwidget@transfer": {
        "display:order": 1,
        icon: "arrow-right-arrow-left",
        label: "transfer",
    },
};

const widgetLabels: Record<string, string> = {
    "defwidget@terminal": "终端",
    "defwidget@files": "文件浏览器",
    "defwidget@web": "网页",
    "defwidget@ai": "AI 助手",
    "defwidget@sysinfo": "系统信息",
    "defwidget@quickcommands": "快捷命令",
    "defwidget@transfer": "文件传输",
};

export const WidgetsVisualContent = memo(({ model }: WidgetsVisualContentProps) => {
    const fileContent = useAtomValue(model.fileContentAtom);
    const setFileContent = useSetAtom(model.fileContentAtom);

    const widgets: Record<string, any> = useMemo(() => {
        try {
            return JSON.parse(fileContent || "{}");
        } catch {
            return {};
        }
    }, [fileContent]);

    const widgetNames = useMemo(() => {
        const allWidgets = { ...defaultWidgets, ...widgets };
        return Object.keys(allWidgets).sort((a, b) => {
            const orderA = allWidgets[a]?.["display:order"] ?? 0;
            const orderB = allWidgets[b]?.["display:order"] ?? 0;
            return orderA - orderB;
        });
    }, [widgets]);

    const updateWidget = useCallback(
        (widgetKey: string, enabled: boolean) => {
            if (enabled) {
                const newWidgets = {
                    ...widgets,
                    [widgetKey]: defaultWidgets[widgetKey],
                };
                setFileContent(JSON.stringify(newWidgets, null, 2));
            } else {
                const newWidgets = { ...widgets };
                newWidgets[widgetKey] = null;
                setFileContent(JSON.stringify(newWidgets, null, 2));
            }
            model.markAsEdited();
        },
        [widgets, setFileContent, model]
    );

    const moveWidget = useCallback(
        (widgetKey: string, direction: "up" | "down") => {
            const currentOrder = widgets[widgetKey]?.["display:order"] ?? defaultWidgets[widgetKey]?.["display:order"] ?? 0;
            const newOrder = direction === "up" ? currentOrder - 1 : currentOrder + 1;

            const newWidgets = {
                ...widgets,
                [widgetKey]: {
                    ...widgets[widgetKey],
                    "display:order": newOrder,
                },
            };
            setFileContent(JSON.stringify(newWidgets, null, 2));
            model.markAsEdited();
        },
        [widgets, setFileContent, model]
    );

    return (
        <div className="h-full overflow-y-auto bg-zinc-900 p-6">
            <div className="max-w-2xl mx-auto space-y-4">
                <div className="mb-6">
                    <h2 className="text-lg font-semibold text-zinc-200">侧边栏小组件</h2>
                    <p className="text-sm text-zinc-500 mt-1">选择要在侧边栏中显示的小组件</p>
                </div>

                <div className="border border-zinc-700/50 rounded-lg overflow-hidden">
                    {widgetNames.map((widgetKey, index) => {
                        const isEnabled = widgets[widgetKey] !== undefined;
                        const isExplicitlyDisabled = widgets[widgetKey] === null;
                        const shouldShowEnabled = !isExplicitlyDisabled;
                        const defaultWidget = defaultWidgets[widgetKey];
                        const label = widgetLabels[widgetKey] || defaultWidget?.label || widgetKey;

                        return (
                            <div
                                key={widgetKey}
                                className={cn(
                                    "flex items-center gap-4 px-4 py-3 border-b border-zinc-700/50 last:border-b-0",
                                    shouldShowEnabled ? "bg-zinc-800/30" : "bg-zinc-900/50 opacity-60"
                                )}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <i className={`fa-sharp fa-solid fa-${defaultWidget?.icon || "square"} text-zinc-400`} />
                                        <span className="text-sm font-medium text-zinc-200">{label}</span>
                                        <span className="text-xs text-zinc-500 font-mono ml-2">{widgetKey}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => moveWidget(widgetKey, "up")}
                                        disabled={index === 0 || !shouldShowEnabled}
                                        className="p-1.5 hover:bg-zinc-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        title="上移"
                                    >
                                        <i className="fa-sharp fa-solid fa-chevron-up text-zinc-400 text-xs" />
                                    </button>
                                    <button
                                        onClick={() => moveWidget(widgetKey, "down")}
                                        disabled={index === widgetNames.length - 1 || !shouldShowEnabled}
                                        className="p-1.5 hover:bg-zinc-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        title="下移"
                                    >
                                        <i className="fa-sharp fa-solid fa-chevron-down text-zinc-400 text-xs" />
                                    </button>
                                    <ToggleSwitch
                                        checked={shouldShowEnabled}
                                        onChange={(enabled) => updateWidget(widgetKey, enabled)}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="text-xs text-zinc-500 mt-4">
                    <p>提示：拖动上移/下移按钮可以调整小组件在侧边栏中的显示顺序</p>
                </div>
            </div>
        </div>
    );
});

WidgetsVisualContent.displayName = "WidgetsVisualContent";
