// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { useAtomValue } from "jotai";
import { memo, useEffect } from "react";
import { AgentMode, WaveAIModel } from "./waveai-model";

export const AIPanelHeader = memo(() => {
    const model = WaveAIModel.getInstance();
    const widgetAccess = useAtomValue(model.widgetAccessAtom);
    const autoExecute = useAtomValue(model.autoExecuteAtom);
    const isLocalAgent = useAtomValue(model.isLocalAgentAtom);
    const localAgentProvider = useAtomValue(model.localAgentProviderAtom);
    const agentMode = useAtomValue(model.agentModeAtom);
    const localAgentHealth = useAtomValue(model.localAgentHealthAtom);
    const inBuilder = model.inBuilder;
    const agentModeLabel = (() => {
        switch (agentMode) {
            case "planning":
                return "Planning";
            case "auto-approve":
                return "Auto-Approve";
            default:
                return "Default";
        }
    })();

    useEffect(() => {
        if (!isLocalAgent || inBuilder) {
            return;
        }
        model.refreshLocalAgentHealth();
        const timer = setInterval(() => {
            model.refreshLocalAgentHealth();
        }, 15000);
        return () => clearInterval(timer);
    }, [isLocalAgent, localAgentProvider, inBuilder, model]);

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
        const agentModeItems: ContextMenuItem[] = (["default", "planning", "auto-approve"] as AgentMode[]).map((mode) => ({
            label:
                mode === "planning"
                    ? "Planning"
                    : mode === "auto-approve"
                      ? "Auto-Approve"
                      : "Default",
            type: "checkbox",
            checked: agentMode === mode,
            click: () => model.setAgentMode(mode),
        }));
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
            {
                label: "Agent Mode",
                submenu: agentModeItems,
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
                label: isLocalAgent ? `${localLabel} · ${agentModeLabel}` : `Wave AI · ${agentModeLabel}`,
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
                {isLocalAgent && (
                    <span
                        className={`inline-block h-2 w-2 rounded-full ${
                            localAgentHealth?.available ? "bg-green-500" : "bg-yellow-500"
                        }`}
                        title={localAgentHealth?.message ?? "Checking local agent"}
                    ></span>
                )}
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                {!inBuilder && (
                    <button
                        onClick={handleControlMenuClick}
                        className="text-[12px] px-2 py-1 rounded border border-zinc-600 text-gray-200 hover:text-white hover:border-zinc-400 transition-colors cursor-pointer"
                        title="AI Control"
                    >
                        {isLocalAgent ? (localAgentProvider === "claude-code" ? "Claude Code" : "Codex") : "Wave AI"}
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-400">{agentModeLabel}</span>
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
