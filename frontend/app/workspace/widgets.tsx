// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { uxCloseBlock } from "@/app/store/keymodel";
import { getActiveTabModel, getTabModelByTabId } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { getLayoutStateAtomFromTab } from "@/layout/lib/layoutAtom";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
import { findParent } from "@/layout/lib/layoutNode";
import { FlexDirection, LayoutTreeActionType, type LayoutTreeResizeNodeAction } from "@/layout/lib/types";
import { atoms, createBlock, createBlockSplitHorizontally, globalStore, isDev, refocusNode, WOS } from "@/store/global";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import {
    autoUpdate,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { buildWidgetBlockDef } from "./widgetblockdef";
import { getTrackedWidgetBlockIds } from "./widgetopenstate";
import { getWidgetToggleAction, isWidgetOpen } from "./widgettoggle";
import { getHorizontalSplitSizes, getOpenWidgetWidthPercent, getWidgetPreferredWidth } from "./widgetwidth";

type WidgetListEntry = {
    key: string;
    widget: WidgetConfigType;
};

const WidgetWidthDebugKey = "defwidget@files";

function logWidgetWidthDebug(widgetKey: string, message: string, details?: Record<string, unknown>) {
    if (widgetKey !== WidgetWidthDebugKey) {
        return;
    }
    console.log(`[widget-width-debug] ${message}`, details ?? {});
}

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType }): WidgetListEntry[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.entries(wmap).map(([key, widget]) => ({ key, widget }));
    wlist.sort((a, b) => {
        return (a.widget["display:order"] ?? 0) - (b.widget["display:order"] ?? 0);
    });
    return wlist;
}

async function handleWidgetSelect(widgetKey: string, widget: WidgetConfigType) {
    const tabModel = getActiveTabModel();
    if (tabModel == null) {
        return;
    }

    const tabData = globalStore.get(tabModel.tabAtom);
    const trackedBlockIds = getTrackedWidgetBlockIds(tabModel.tabId);
    const trackedBlockId = trackedBlockIds[widgetKey];
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    const toggleAction = getWidgetToggleAction(trackedBlockId, tabData?.blockids ?? [], focusedNode?.data?.blockId);
    const targetBlockId = getOpenTargetBlockId(tabData?.blockids ?? [], focusedNode?.data?.blockId);
    logWidgetWidthDebug(widgetKey, "handleWidgetSelect", {
        configuredWidth: widget["display:width"],
        trackedBlockId,
        toggleAction,
        focusedBlockId: focusedNode?.data?.blockId,
        targetBlockId,
        activeBlockIds: tabData?.blockids ?? [],
    });

    if (toggleAction.type === "close") {
        delete trackedBlockIds[widgetKey];
        logWidgetWidthDebug(widgetKey, "closing widget block", { blockId: toggleAction.blockId });
        uxCloseBlock(toggleAction.blockId);
        return;
    }

    if (toggleAction.type === "focus") {
        applyPreferredWidthToOpenWidget(widgetKey, widget, toggleAction.blockId, tabModel);
        refocusNode(toggleAction.blockId);
        return;
    }

    const focusedBlock = getFocusedBlockContext(targetBlockId);
    const blockDef = buildWidgetBlockDef(widget, focusedBlock);
    const blockId = await createWidgetBlock(widgetKey, widget, blockDef, targetBlockId);
    trackedBlockIds[widgetKey] = blockId;
    schedulePreferredWidthApply(widgetKey, widget, blockId, tabModel);
}

function getOpenTargetBlockId(activeBlockIds: string[], focusedBlockId?: string): string | undefined {
    const layoutModel = getLayoutModelForStaticTab();
    if (focusedBlockId != null && layoutModel.getNodeByBlockId(focusedBlockId) != null) {
        return focusedBlockId;
    }
    return activeBlockIds.find((blockId) => layoutModel.getNodeByBlockId(blockId) != null);
}

function schedulePreferredWidthApply(
    widgetKey: string,
    widget: WidgetConfigType,
    widgetBlockId: string,
    tabModel: ReturnType<typeof getActiveTabModel>
) {
    if (tabModel == null) {
        return;
    }
    setTimeout(() => {
        logWidgetWidthDebug(widgetKey, "scheduled width apply (0ms)", { widgetBlockId });
        applyPreferredWidthToOpenWidget(widgetKey, widget, widgetBlockId, tabModel);
    }, 0);
    setTimeout(() => {
        logWidgetWidthDebug(widgetKey, "scheduled width apply (50ms)", { widgetBlockId });
        applyPreferredWidthToOpenWidget(widgetKey, widget, widgetBlockId, tabModel);
    }, 50);
}

async function createWidgetBlock(
    widgetKey: string,
    widget: WidgetConfigType,
    blockDef: BlockDef,
    focusedBlockId?: string
): Promise<string> {
    const preferredWidth = getWidgetPreferredWidth(widget);
    logWidgetWidthDebug(widgetKey, "createWidgetBlock start", {
        preferredWidth,
        focusedBlockId,
        magnified: widget.magnified ?? false,
    });
    if (widget.magnified || preferredWidth == null || focusedBlockId == null) {
        logWidgetWidthDebug(widgetKey, "createWidgetBlock fallback to createBlock", {
            reason: widget.magnified ? "magnified" : preferredWidth == null ? "no-preferred-width" : "no-focused-block",
        });
        return createBlock(blockDef, widget.magnified);
    }

    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = layoutModel.getNodeByBlockId(focusedBlockId);
    if (focusedNode == null) {
        logWidgetWidthDebug(widgetKey, "createWidgetBlock fallback because focused node missing", { focusedBlockId });
        return createBlock(blockDef, widget.magnified);
    }

    const splitSizes = getHorizontalSplitSizes(focusedNode.size, preferredWidth);
    logWidgetWidthDebug(widgetKey, "createWidgetBlock split sizes", {
        focusedNodeId: focusedNode.id,
        focusedNodeSize: focusedNode.size,
        splitSizes,
    });
    const blockId = await createBlockSplitHorizontally(blockDef, focusedBlockId, "after");
    const insertedNode = layoutModel.getNodeByBlockId(blockId);
    const resizedFocusedNode = layoutModel.getNodeByBlockId(focusedBlockId);
    if (insertedNode == null || resizedFocusedNode == null) {
        logWidgetWidthDebug(widgetKey, "createWidgetBlock could not find nodes after split", {
            blockId,
            insertedNodeFound: insertedNode != null,
            focusedNodeFound: resizedFocusedNode != null,
        });
        return blockId;
    }

    const resizeAction: LayoutTreeResizeNodeAction = {
        type: LayoutTreeActionType.ResizeNode,
        resizeOperations: [
            { nodeId: resizedFocusedNode.id, size: splitSizes.currentSize },
            { nodeId: insertedNode.id, size: splitSizes.newSize },
        ],
    };
    layoutModel.treeReducer(resizeAction);
    logWidgetWidthDebug(widgetKey, "createWidgetBlock applied initial resize", {
        blockId,
        insertedNodeId: insertedNode.id,
        resizedFocusedNodeId: resizedFocusedNode.id,
        insertedNodeSize: insertedNode.size,
        resizedFocusedNodeSize: resizedFocusedNode.size,
    });
    return blockId;
}

function applyPreferredWidthToOpenWidget(
    widgetKey: string,
    widget: WidgetConfigType,
    widgetBlockId: string,
    tabModel: ReturnType<typeof getActiveTabModel>
) {
    const preferredWidth = getWidgetPreferredWidth(widget);
    if (widget.magnified || preferredWidth == null || tabModel == null) {
        logWidgetWidthDebug(widgetKey, "applyPreferredWidthToOpenWidget skipped", {
            widgetBlockId,
            preferredWidth,
            magnified: widget.magnified ?? false,
            hasTabModel: tabModel != null,
        });
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    const widgetNode = layoutModel.getNodeByBlockId(widgetBlockId);
    if (widgetNode == null) {
        logWidgetWidthDebug(widgetKey, "applyPreferredWidthToOpenWidget missing widget node", { widgetBlockId });
        return;
    }

    const layoutStateAtom = getLayoutStateAtomFromTab(tabModel.tabAtom, globalStore.get);
    if (layoutStateAtom == null) {
        logWidgetWidthDebug(widgetKey, "applyPreferredWidthToOpenWidget missing layoutStateAtom", { widgetBlockId });
        return;
    }
    const rootNode = globalStore.get(layoutStateAtom)?.rootnode;
    const parentNode = rootNode == null ? null : findParent(rootNode, widgetNode.id);
    if (parentNode?.children == null || parentNode.flexDirection !== FlexDirection.Row) {
        logWidgetWidthDebug(widgetKey, "applyPreferredWidthToOpenWidget parent not horizontal", {
            widgetBlockId,
            parentFlexDirection: parentNode?.flexDirection,
            hasChildren: parentNode?.children != null,
        });
        return;
    }

    const widgetIndex = parentNode.children.findIndex((child) => child.id === widgetNode.id);
    if (widgetIndex === -1) {
        logWidgetWidthDebug(widgetKey, "applyPreferredWidthToOpenWidget widget index missing", { widgetBlockId });
        return;
    }

    const siblingNode = parentNode.children[widgetIndex - 1] ?? parentNode.children[widgetIndex + 1];
    if (siblingNode == null) {
        logWidgetWidthDebug(widgetKey, "applyPreferredWidthToOpenWidget missing sibling", { widgetBlockId });
        return;
    }

    const currentWidth = getOpenWidgetWidthPercent(rootNode, widgetNode);
    const splitSizes = getHorizontalSplitSizes(widgetNode.size + siblingNode.size, preferredWidth);
    const resizeAction: LayoutTreeResizeNodeAction = {
        type: LayoutTreeActionType.ResizeNode,
        resizeOperations: [
            { nodeId: siblingNode.id, size: splitSizes.currentSize },
            { nodeId: widgetNode.id, size: splitSizes.newSize },
        ],
    };
    layoutModel.treeReducer(resizeAction);
    const updatedRootNode = globalStore.get(layoutStateAtom)?.rootnode;
    const updatedWidgetNode = layoutModel.getNodeByBlockId(widgetBlockId);
    logWidgetWidthDebug(widgetKey, "applyPreferredWidthToOpenWidget applied resize", {
        widgetBlockId,
        preferredWidth,
        currentWidth,
        siblingNodeId: siblingNode.id,
        siblingNodeSizeBefore: siblingNode.size,
        widgetNodeSizeBefore: widgetNode.size,
        splitSizes,
        widthAfter: getOpenWidgetWidthPercent(updatedRootNode, updatedWidgetNode),
    });
}

function getFocusedBlockContext(blockId?: string): { view?: string; connection?: string; cwd?: string } | undefined {
    if (blockId == null) {
        return undefined;
    }
    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    const blockData = globalStore.get(blockAtom);
    const blockMeta = blockData?.meta;
    if (blockMeta == null) {
        return undefined;
    }
    return {
        view: blockMeta.view,
        connection: blockMeta.connection as string,
        cwd: blockMeta["cmd:cwd"] as string,
    };
}

const Widget = memo(
    ({
        widget,
        widgetKey,
        mode,
        isOpen,
    }: {
        widget: WidgetConfigType;
        widgetKey: string;
        mode: "normal" | "compact" | "supercompact";
        isOpen: boolean;
    }) => {
        const [isTruncated, setIsTruncated] = useState(false);
        const labelRef = useRef<HTMLDivElement>(null);

        useEffect(() => {
            if (mode === "normal" && labelRef.current) {
                const element = labelRef.current;
                setIsTruncated(element.scrollWidth > element.clientWidth);
            }
        }, [mode, widget.label]);

        const shouldDisableTooltip = mode !== "normal" ? false : !isTruncated;

        return (
            <Tooltip
                content={widget.description || widget.label}
                placement="left"
                disable={shouldDisableTooltip}
                divClassName={clsx(
                    "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                    mode === "supercompact" ? "text-sm" : "text-lg",
                    widget["display:hidden"] && "hidden"
                )}
                divOnClick={() => fireAndForget(async () => handleWidgetSelect(widgetKey, widget))}
                divStyle={
                    isOpen
                        ? {
                              color: "var(--accent-color)",
                              backgroundColor: "rgba(88, 193, 66, 0.12)",
                          }
                        : undefined
                }
            >
                <div style={{ color: isOpen ? "var(--accent-color)" : widget.color }}>
                    <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
                </div>
                {mode === "normal" && !isBlank(widget.label) ? (
                    <div
                        ref={labelRef}
                        className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis"
                    >
                        {widget.label}
                    </div>
                ) : null}
            </Tooltip>
        );
    }
);

function calculateGridSize(appCount: number): number {
    if (appCount <= 4) return 2;
    if (appCount <= 9) return 3;
    if (appCount <= 16) return 4;
    if (appCount <= 25) return 5;
    return 6;
}

const AppsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
    }) => {
        const [apps, setApps] = useState<AppInfo[]>([]);
        const [loading, setLoading] = useState(true);

        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        useEffect(() => {
            if (!isOpen) return;

            const fetchApps = async () => {
                setLoading(true);
                try {
                    const allApps = await RpcApi.ListAllAppsCommand(TabRpcClient);
                    const localApps = allApps
                        .filter((app) => !app.appid.startsWith("draft/"))
                        .sort((a, b) => {
                            const aName = a.appid.replace(/^local\//, "");
                            const bName = b.appid.replace(/^local\//, "");
                            return aName.localeCompare(bName);
                        });
                    setApps(localApps);
                } catch (error) {
                    console.error("Failed to fetch apps:", error);
                    setApps([]);
                } finally {
                    setLoading(false);
                }
            };

            fetchApps();
        }, [isOpen]);

        if (!isOpen) return null;

        const gridSize = calculateGridSize(apps.length);

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl p-4 z-50"
                >
                    {loading ? (
                        <div className="flex items-center justify-center p-8">
                            <i className="fa fa-solid fa-spinner fa-spin text-2xl text-muted"></i>
                        </div>
                    ) : apps.length === 0 ? (
                        <div className="text-muted text-sm p-4 text-center">没有本地应用</div>
                    ) : (
                        <div
                            className="grid gap-3"
                            style={{
                                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                                maxWidth: `${gridSize * 80}px`,
                            }}
                        >
                            {apps.map((app) => {
                                const appMeta = app.manifest?.appmeta;
                                const displayName = app.appid.replace(/^local\//, "");
                                const icon = appMeta?.icon || "cube";
                                const iconColor = appMeta?.iconcolor || "white";

                                return (
                                    <div
                                        key={app.appid}
                                        className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                        onClick={() => {
                                            const blockDef: BlockDef = {
                                                meta: {
                                                    view: "tsunami",
                                                    controller: "tsunami",
                                                    "tsunami:appid": app.appid,
                                                },
                                            };
                                            createBlock(blockDef);
                                            onClose();
                                        }}
                                    >
                                        <div style={{ color: iconColor }} className="text-3xl mb-1">
                                            <i className={makeIconClass(icon, false)}></i>
                                        </div>
                                        <div className="text-xxs text-center text-secondary break-words w-full px-1">
                                            {displayName}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </FloatingPortal>
        );
    }
);

const SettingsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
    }) => {
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        if (!isOpen) return null;

        const menuItems = [
            {
                icon: "gear",
                label: "Settings",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                        },
                    };
                    createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "lightbulb",
                label: "Tips",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "tips",
                        },
                    };
                    createBlock(blockDef, true, true);
                    onClose();
                },
            },
            {
                icon: "lock",
                label: "Secrets",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                            file: "secrets",
                        },
                    };
                    createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "circle-question",
                label: "Help",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "help",
                        },
                    };
                    createBlock(blockDef);
                    onClose();
                },
            },
        ];

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl p-2 z-50"
                >
                    {menuItems.map((item, idx) => (
                        <div
                            key={idx}
                            className="flex items-center gap-3 px-3 py-2 rounded hover:bg-hoverbg cursor-pointer transition-colors text-secondary hover:text-white"
                            onClick={item.onClick}
                        >
                            <div className="text-lg w-5 flex justify-center">
                                <i className={makeIconClass(item.icon, false)}></i>
                            </div>
                            <div className="text-sm whitespace-nowrap">{item.label}</div>
                        </div>
                    ))}
                </div>
            </FloatingPortal>
        );
    }
);

SettingsFloatingWindow.displayName = "SettingsFloatingWindow";

const Widgets = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const workspace = useAtomValue(atoms.workspace);
    const tabId = useAtomValue(atoms.staticTabId);
    const tabModel = getTabModelByTabId(tabId);
    const tabData = useAtomValue(tabModel.tabAtom);
    const hasCustomAIPresets = useAtomValue(atoms.hasCustomAIPresetsAtom);
    const [mode, setMode] = useState<"normal" | "compact" | "supercompact">("normal");
    const containerRef = useRef<HTMLDivElement>(null);
    const measurementRef = useRef<HTMLDivElement>(null);

    const featureWaveAppBuilder = fullConfig?.settings?.["feature:waveappbuilder"] ?? false;
    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = Object.fromEntries(
        Object.entries(widgetsMap).filter(([key, widget]) => {
            if (!hasCustomAIPresets && key === "defwidget@ai") {
                return false;
            }
            return shouldIncludeWidgetForWorkspace(widget, workspace?.oid);
        })
    );
    const widgetEntries = sortByDisplayOrder(filteredWidgets);
    const activeBlockIds = tabData?.blockids ?? [];
    const trackedBlockIds = getTrackedWidgetBlockIds(tabId);

    const [isAppsOpen, setIsAppsOpen] = useState(false);
    const appsButtonRef = useRef<HTMLDivElement>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const settingsButtonRef = useRef<HTMLDivElement>(null);

    const checkModeNeeded = useCallback(() => {
        if (!containerRef.current || !measurementRef.current) return;

        const containerHeight = containerRef.current.clientHeight;
        const normalHeight = measurementRef.current.scrollHeight;
        const gracePeriod = 10;

        let newMode: "normal" | "compact" | "supercompact" = "normal";

        if (normalHeight > containerHeight - gracePeriod) {
            newMode = "compact";

            // Calculate total widget count for supercompact check
            const totalWidgets = widgetEntries.length + 1;
            const minHeightPerWidget = 32;
            const requiredHeight = totalWidgets * minHeightPerWidget;

            if (requiredHeight > containerHeight) {
                newMode = "supercompact";
            }
        }

        if (newMode !== mode) {
            setMode(newMode);
        }
    }, [mode, widgetEntries]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            checkModeNeeded();
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [checkModeNeeded]);

    useEffect(() => {
        checkModeNeeded();
    }, [widgetEntries, checkModeNeeded]);

    const handleWidgetsBarContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menu: ContextMenuItem[] = [
            {
                label: "Edit widgets.json",
                click: () => {
                    fireAndForget(async () => {
                        const blockDef: BlockDef = {
                            meta: {
                                view: "waveconfig",
                                file: "widgets.json",
                            },
                        };
                        await createBlock(blockDef, false, true);
                    });
                },
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    return (
        <>
            <div
                ref={containerRef}
                className="flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none"
                onContextMenu={handleWidgetsBarContextMenu}
            >
                {mode === "supercompact" ? (
                    <>
                        <div className="grid grid-cols-2 gap-0 w-full">
                            {widgetEntries.map(({ key, widget }) => (
                                <Widget
                                    key={key}
                                    widgetKey={key}
                                    widget={widget}
                                    mode={mode}
                                    isOpen={isWidgetOpen(trackedBlockIds[key], activeBlockIds)}
                                />
                            ))}
                        </div>
                        <div className="flex-grow" />
                        <div className="grid grid-cols-2 gap-0 w-full">
                            {isDev() || featureWaveAppBuilder ? (
                                <div
                                    ref={appsButtonRef}
                                    className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                    onClick={() => setIsAppsOpen(!isAppsOpen)}
                                >
                                    <Tooltip content="Local WaveApps" placement="left" disable={isAppsOpen}>
                                        <div>
                                            <i className={makeIconClass("cube", true)}></i>
                                        </div>
                                    </Tooltip>
                                </div>
                            ) : null}
                            <div
                                ref={settingsButtonRef}
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                            >
                                <Tooltip content="Settings & Help" placement="left" disable={isSettingsOpen}>
                                    <div>
                                        <i className={makeIconClass("gear", true)}></i>
                                    </div>
                                </Tooltip>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {widgetEntries.map(({ key, widget }) => (
                            <Widget
                                key={key}
                                widgetKey={key}
                                widget={widget}
                                mode={mode}
                                isOpen={isWidgetOpen(trackedBlockIds[key], activeBlockIds)}
                            />
                        ))}
                        <div className="flex-grow" />
                        {isDev() || featureWaveAppBuilder ? (
                            <div
                                ref={appsButtonRef}
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => setIsAppsOpen(!isAppsOpen)}
                            >
                                <Tooltip content="Local WaveApps" placement="left" disable={isAppsOpen}>
                                    <div className="flex flex-col items-center w-full">
                                        <div>
                                            <i className={makeIconClass("cube", true)}></i>
                                        </div>
                                        {mode === "normal" && (
                                            <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                                apps
                                            </div>
                                        )}
                                    </div>
                                </Tooltip>
                            </div>
                        ) : null}
                        <div
                            ref={settingsButtonRef}
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        >
                            <Tooltip content="Settings & Help" placement="left" disable={isSettingsOpen}>
                                <div>
                                    <i className={makeIconClass("gear", true)}></i>
                                </div>
                            </Tooltip>
                        </div>
                    </>
                )}
                {isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running Wave Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
            {(isDev() || featureWaveAppBuilder) && appsButtonRef.current && (
                <AppsFloatingWindow
                    isOpen={isAppsOpen}
                    onClose={() => setIsAppsOpen(false)}
                    referenceElement={appsButtonRef.current}
                />
            )}
            {settingsButtonRef.current && (
                <SettingsFloatingWindow
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    referenceElement={settingsButtonRef.current}
                />
            )}

            <div
                ref={measurementRef}
                className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
            >
                {widgetEntries.map(({ key, widget }) => (
                    <Widget
                        key={`measurement-${key}`}
                        widgetKey={key}
                        widget={widget}
                        mode="normal"
                        isOpen={isWidgetOpen(trackedBlockIds[key], activeBlockIds)}
                    />
                ))}
                <div className="flex-grow" />
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("gear", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">settings</div>
                </div>
                {isDev() ? (
                    <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                        <div>
                            <i className={makeIconClass("cube", true)}></i>
                        </div>
                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center">apps</div>
                    </div>
                ) : null}
                {isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running Wave Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
        </>
    );
});

export { Widgets };
