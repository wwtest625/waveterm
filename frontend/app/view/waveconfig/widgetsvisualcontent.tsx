// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { getTabModelByTabId } from "@/app/store/tab-model";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import type { WidgetConfigDraft, WidgetsFile } from "@/app/workspace/widgetconfig";
import { parseWidgetsFile } from "@/app/workspace/widgetconfig";
import { getTrackedWidgetBlockId } from "@/app/workspace/widgetopenstate";
import {
    clampWidgetWidth,
    getOpenWidgetWidthPercent,
    MaxWidgetWidthPercent,
    MinWidgetWidthPercent,
} from "@/app/workspace/widgetwidth";
import { getLayoutStateAtomFromTab } from "@/layout/lib/layoutAtom";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
import { cn, isBlank, makeIconClass } from "@/util/util";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useMemo } from "react";

interface ToggleSwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}

const fallbackWidgets: Record<string, WidgetConfigDraft> = {
    "defwidget@terminal": {
        "display:order": -5,
        icon: "square-terminal",
        label: "terminal",
        blockdef: { meta: { view: "term", controller: "shell" } },
    },
    "defwidget@files": {
        "display:order": -4,
        "display:width": 33,
        icon: "folder",
        label: "files",
        blockdef: { meta: { view: "preview", file: "~" } },
    },
    "defwidget@web": {
        "display:order": -3,
        icon: "globe",
        label: "web",
        blockdef: { meta: { view: "web" } },
    },
    "defwidget@docker": {
        "display:order": -2.5,
        icon: "brands@docker",
        label: "容器",
        blockdef: { meta: { view: "docker" } },
    },
    "defwidget@tmux": {
        "display:order": -2.4,
        icon: "terminal",
        label: "tmux",
        blockdef: { meta: { view: "tmux" } },
    },
    "defwidget@network": {
        "display:order": -2.25,
        icon: "network-wired",
        label: "网络",
        blockdef: { meta: { view: "network" } },
    },
    "defwidget@ai": {
        "display:order": -2,
        icon: "sparkles",
        label: "ai",
        blockdef: { meta: { view: "waveai" } },
    },
    "defwidget@sysinfo": {
        "display:order": -1,
        icon: "chart-line",
        label: "sysinfo",
        blockdef: { meta: { view: "sysinfo" } },
    },
    "defwidget@quickcommands": {
        "display:order": 0,
        icon: "bolt",
        label: "commands",
        blockdef: { meta: { view: "quickcommands" } },
    },
    "defwidget@transfer": {
        "display:order": 1,
        "display:hidden": true,
        icon: "arrow-right-arrow-left",
        label: "transfer",
        blockdef: { meta: { view: "transfer" } },
    },
};

const inputClassName =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent";

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
                disabled && "cursor-not-allowed opacity-50"
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

function trimOrUndefined(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

function updateDraftField<T extends keyof WidgetConfigDraft>(
    draft: WidgetConfigDraft,
    key: T,
    value: WidgetConfigDraft[T] | undefined
): WidgetConfigDraft {
    if (value == null || (typeof value === "string" && value.trim() === "")) {
        const { [key]: _removed, ...rest } = draft;
        return rest;
    }
    return {
        ...draft,
        [key]: value,
    };
}

function sortWidgetKeys(widgetMap: Record<string, WidgetConfigDraft>): string[] {
    return Object.keys(widgetMap).sort((a, b) => {
        const orderA = widgetMap[a]?.["display:order"] ?? 0;
        const orderB = widgetMap[b]?.["display:order"] ?? 0;
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        return a.localeCompare(b);
    });
}

export const WidgetsVisualContent = memo(({ model }: WidgetVisualContentProps) => {
    const fileContent = useAtomValue(model.fileContentAtom);
    const setFileContent = useSetAtom(model.fileContentAtom);
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const tabId = useAtomValue(atoms.staticTabId);
    const tabModel = getTabModelByTabId(tabId);
    const layoutStateAtom = useMemo(
        () => getLayoutStateAtomFromTab(tabModel.tabAtom, globalStore.get) ?? atom(null),
        [tabModel]
    );
    const layoutState = useAtomValue(layoutStateAtom) as { rootnode?: any } | null;
    const layoutModel = getLayoutModelForStaticTab();

    const widgetOverrides = useMemo(() => parseWidgetsFile(fileContent), [fileContent]);
    const defaultWidgets = useMemo<Record<string, WidgetConfigDraft>>(() => {
        return fullConfig?.defaultwidgets ?? fallbackWidgets;
    }, [fullConfig]);

    const widgetKeys = useMemo(() => {
        const combined = { ...defaultWidgets };
        for (const [widgetKey, widget] of Object.entries(widgetOverrides)) {
            if (widget !== null) {
                combined[widgetKey] = { ...(combined[widgetKey] ?? {}), ...widget };
            } else if (!(widgetKey in combined)) {
                combined[widgetKey] = {};
            }
        }
        return sortWidgetKeys(combined);
    }, [defaultWidgets, widgetOverrides]);

    const writeWidgetsFile = useCallback(
        (nextWidgets: WidgetsFile) => {
            setFileContent(JSON.stringify(nextWidgets, null, 2));
            model.markAsEdited();
        },
        [model, setFileContent]
    );

    const getEffectiveWidget = useCallback(
        (widgetKey: string): WidgetConfigDraft => {
            const override = widgetOverrides[widgetKey];
            return {
                ...(defaultWidgets[widgetKey] ?? {}),
                ...(override && override !== null ? override : {}),
            };
        },
        [defaultWidgets, widgetOverrides]
    );

    const setWidgetEnabled = useCallback(
        (widgetKey: string, enabled: boolean) => {
            const nextWidgets = { ...widgetOverrides };
            if (enabled) {
                nextWidgets[widgetKey] = { ...getEffectiveWidget(widgetKey) };
            } else {
                nextWidgets[widgetKey] = null;
            }
            writeWidgetsFile(nextWidgets);
        },
        [getEffectiveWidget, widgetOverrides, writeWidgetsFile]
    );

    const updateWidget = useCallback(
        (widgetKey: string, updater: (widget: WidgetConfigDraft) => WidgetConfigDraft) => {
            const nextWidgets = { ...widgetOverrides };
            nextWidgets[widgetKey] = updater({ ...getEffectiveWidget(widgetKey) });
            writeWidgetsFile(nextWidgets);
        },
        [getEffectiveWidget, widgetOverrides, writeWidgetsFile]
    );

    const moveWidget = useCallback(
        (widgetKey: string, direction: "up" | "down") => {
            const effectiveWidget = getEffectiveWidget(widgetKey);
            const currentOrder = effectiveWidget["display:order"] ?? 0;
            const newOrder = direction === "up" ? currentOrder - 1 : currentOrder + 1;
            updateWidget(widgetKey, (widget) => ({
                ...widget,
                "display:order": newOrder,
            }));
        },
        [getEffectiveWidget, updateWidget]
    );

    const resetWidget = useCallback(
        (widgetKey: string) => {
            const defaultWidget = defaultWidgets[widgetKey];
            if (defaultWidget == null) {
                return;
            }
            const nextWidgets = { ...widgetOverrides, [widgetKey]: { ...defaultWidget } };
            writeWidgetsFile(nextWidgets);
        },
        [defaultWidgets, widgetOverrides, writeWidgetsFile]
    );

    return (
        <div className="h-full overflow-y-auto bg-zinc-900 p-6">
            <div className="mx-auto max-w-4xl space-y-4">
                <div className="mb-6">
                    <h2 className="text-lg font-semibold text-zinc-200">侧边栏小组件</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                        控制哪些小组件会出现在侧边栏，以及它们的外观和展开宽度。
                    </p>
                </div>

                <div className="space-y-3">
                    {widgetKeys.map((widgetKey, index) => {
                        const effectiveWidget = getEffectiveWidget(widgetKey);
                        const isEnabled = widgetOverrides[widgetKey] !== null;
                        const iconClass = makeIconClass(effectiveWidget.icon, true, { defaultIcon: "square" });
                        const previewLabel = isBlank(effectiveWidget.label) ? widgetKey : effectiveWidget.label;
                        const trackedBlockId = getTrackedWidgetBlockId(tabId, widgetKey);
                        const openWidgetNode =
                            trackedBlockId == null ? undefined : layoutModel.getNodeByBlockId(trackedBlockId);
                        const currentOpenWidth = getOpenWidgetWidthPercent(layoutState?.rootnode, openWidgetNode);
                        const customColor =
                            trimOrUndefined(effectiveWidget.color ?? "") ?? "var(--secondary-text-color)";
                        const widthValue = effectiveWidget["display:width"];
                        const displayedWidthValue = widthValue ?? currentOpenWidth ?? "";
                        const displayedColorValue = effectiveWidget.color ?? "var(--secondary-text-color)";

                        return (
                            <div
                                key={widgetKey}
                                className={cn(
                                    "rounded-xl border border-zinc-700/60 px-4 py-4 transition-colors",
                                    isEnabled ? "bg-zinc-800/30" : "bg-zinc-900/50 opacity-70"
                                )}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-lg"
                                                style={customColor ? { color: customColor } : undefined}
                                            >
                                                <i className={iconClass}></i>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-zinc-100">
                                                    {previewLabel}
                                                </div>
                                                <div className="truncate text-xs font-mono text-zinc-500">
                                                    {widgetKey}
                                                </div>
                                            </div>
                                        </div>
                                        {effectiveWidget.description ? (
                                            <div className="mt-2 text-xs text-zinc-400">
                                                {effectiveWidget.description}
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <Tooltip content="Move up" placement="top">
                                            <button
                                                onClick={() => moveWidget(widgetKey, "up")}
                                                disabled={index === 0 || !isEnabled}
                                                className="rounded p-1.5 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
                                            >
                                                <i className="fa-sharp fa-solid fa-chevron-up text-xs text-zinc-400" />
                                            </button>
                                        </Tooltip>
                                        <Tooltip content="Move down" placement="top">
                                            <button
                                                onClick={() => moveWidget(widgetKey, "down")}
                                                disabled={index === widgetKeys.length - 1 || !isEnabled}
                                                className="rounded p-1.5 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
                                            >
                                                <i className="fa-sharp fa-solid fa-chevron-down text-xs text-zinc-400" />
                                            </button>
                                        </Tooltip>
                                        {defaultWidgets[widgetKey] ? (
                                            <button
                                                onClick={() => resetWidget(widgetKey)}
                                                disabled={!isEnabled}
                                                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                            >
                                                Reset
                                            </button>
                                        ) : null}
                                        <ToggleSwitch
                                            checked={isEnabled}
                                            onChange={(enabled) => setWidgetEnabled(widgetKey, enabled)}
                                        />
                                    </div>
                                </div>

                                {isEnabled ? (
                                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <label className="block">
                                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
                                                Label
                                            </div>
                                            <input
                                                className={inputClassName}
                                                type="text"
                                                value={effectiveWidget.label ?? ""}
                                                placeholder="Widget label"
                                                onChange={(e) =>
                                                    updateWidget(widgetKey, (widget) =>
                                                        updateDraftField(
                                                            widget,
                                                            "label",
                                                            trimOrUndefined(e.target.value)
                                                        )
                                                    )
                                                }
                                            />
                                        </label>

                                        <label className="block">
                                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
                                                Icon
                                            </div>
                                            <input
                                                className={inputClassName}
                                                type="text"
                                                value={effectiveWidget.icon ?? ""}
                                                placeholder="folder or brands@github"
                                                onChange={(e) =>
                                                    updateWidget(widgetKey, (widget) =>
                                                        updateDraftField(
                                                            widget,
                                                            "icon",
                                                            trimOrUndefined(e.target.value)
                                                        )
                                                    )
                                                }
                                            />
                                        </label>

                                        <label className="block">
                                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
                                                Color
                                            </div>
                                            <input
                                                className={inputClassName}
                                                type="text"
                                                value={displayedColorValue}
                                                placeholder="#58c142 or rgb(88, 193, 66)"
                                                onChange={(e) =>
                                                    updateWidget(widgetKey, (widget) =>
                                                        updateDraftField(
                                                            widget,
                                                            "color",
                                                            trimOrUndefined(e.target.value)
                                                        )
                                                    )
                                                }
                                            />
                                        </label>

                                        <label className="block">
                                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
                                                Default Width
                                            </div>
                                            <input
                                                className={inputClassName}
                                                type="number"
                                                min={MinWidgetWidthPercent}
                                                max={MaxWidgetWidthPercent}
                                                step={1}
                                                value={displayedWidthValue}
                                                placeholder={`${MinWidgetWidthPercent}-${MaxWidgetWidthPercent}`}
                                                onChange={(e) => {
                                                    const rawValue = e.target.value.trim();
                                                    updateWidget(widgetKey, (widget) =>
                                                        updateDraftField(
                                                            widget,
                                                            "display:width",
                                                            rawValue === "" ? undefined : Number(rawValue)
                                                        )
                                                    );
                                                }}
                                                onBlur={(e) => {
                                                    const rawValue = e.target.value.trim();
                                                    if (rawValue === "") {
                                                        return;
                                                    }
                                                    updateWidget(widgetKey, (widget) =>
                                                        updateDraftField(
                                                            widget,
                                                            "display:width",
                                                            clampWidgetWidth(Number(rawValue))
                                                        )
                                                    );
                                                }}
                                            />
                                            <div className="mt-1 text-xs text-zinc-500">
                                                Opens as a horizontal split using {MinWidgetWidthPercent}% to{" "}
                                                {MaxWidgetWidthPercent}% of the focused block width.
                                            </div>
                                        </label>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

WidgetsVisualContent.displayName = "WidgetsVisualContent";
