// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { WaveAIModel } from "./waveai-model";

export const AIPanelHeader = memo(() => {
    const model = WaveAIModel.getInstance();
    const widgetAccess = useAtomValue(model.widgetAccessAtom);
    const autoExecute = useAtomValue(model.autoExecuteAtom);
    const isLocalAgent = useAtomValue(model.isLocalAgentAtom);
    const localAgentProvider = useAtomValue(model.localAgentProviderAtom);
    const inBuilder = model.inBuilder;

    const handleKebabClick = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    const handleControlMenuClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const localLabel = localAgentProvider === "claude-code" ? "Local Agent (Claude Code)" : "Local Agent (Codex)";
        const menu: ContextMenuItem[] = [
            {
                label: "Provider",
                submenu: [
                    {
                        label: "Wave AI",
                        type: "checkbox",
                        checked: !isLocalAgent,
                        click: () => model.setLocalAgentEnabled(false),
                    },
                    {
                        label: "Local Agent (Codex)",
                        type: "checkbox",
                        checked: isLocalAgent && localAgentProvider === "codex",
                        click: () => model.setLocalAgentProvider("codex"),
                    },
                    {
                        label: "Local Agent (Claude Code)",
                        type: "checkbox",
                        checked: isLocalAgent && localAgentProvider === "claude-code",
                        click: () => model.setLocalAgentProvider("claude-code"),
                    },
                ],
            },
            { type: "separator" },
            {
                label: "Widget Context",
                type: "checkbox",
                checked: widgetAccess,
                click: () => model.setWidgetAccess(!widgetAccess),
            },
            {
                label: "Auto Execute",
                type: "checkbox",
                checked: autoExecute,
                click: () => model.setAutoExecute(!autoExecute),
            },
            { type: "separator" },
            {
                label: isLocalAgent ? localLabel : "Wave AI",
                enabled: false,
            },
        ];

        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    return (
        <div
            className="py-2 pl-3 pr-1 @xs:p-2 @xs:pl-4 border-b border-gray-600 flex items-center justify-between min-w-0"
            onContextMenu={handleContextMenu}
        >
            <h2 className="text-white text-sm @xs:text-lg font-semibold flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <i className="fa fa-sparkles text-accent"></i>
                {isLocalAgent ? "Local Agent" : "Wave AI"}
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                {!inBuilder && (
                    <button
                        onClick={handleControlMenuClick}
                        className="text-[12px] px-2 py-1 rounded border border-zinc-600 text-gray-200 hover:text-white hover:border-zinc-400 transition-colors cursor-pointer"
                        title="AI Control"
                    >
                        {isLocalAgent ? (localAgentProvider === "claude-code" ? "Claude Code" : "Codex") : "Wave AI"}
                        <i className="fa fa-chevron-down ml-2 text-[10px]"></i>
                    </button>
                )}

                <button
                    onClick={handleKebabClick}
                    className="text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none"
                    title="More options"
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

AIPanelHeader.displayName = "AIPanelHeader";
