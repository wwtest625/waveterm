// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { cn } from "@/app/shadcn/lib/utils";
import type { TermViewModel } from "@/app/view/term/term-model";
import { useAtom } from "jotai";
import * as React from "react";
import { TermQuickInputCompletion } from "./term-quickinput-completion";

type TermQuickInputBarProps = {
    model: TermViewModel;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    notifyEnabled: boolean;
    setNotifyEnabled: (enabled: boolean) => void;
    notifyAvailable: boolean;
    placeholder: string;
    submitLabel: string;
    submitTitle: string;
    className?: string;
    compact?: boolean;
};

export function TermQuickInputBar({
    model,
    value,
    onChange,
    onSubmit,
    notifyEnabled,
    setNotifyEnabled,
    notifyAvailable,
    placeholder,
    submitLabel,
    submitTitle,
    className,
    compact = false,
}: TermQuickInputBarProps) {
    const [collapsed, setCollapsed] = useAtom(model.quickInputCollapsedAtom);
    const notifyClassName = cn("term-quick-input-notify-toggle", {
        active: notifyEnabled,
        disabled: !notifyAvailable,
    });

    const toggleCollapsed = React.useCallback(() => {
        if (collapsed) {
            model.focusQuickInput();
            return;
        }
        model.quickInputRef.current?.blur();
        model.nodeModel.focusNode();
        setCollapsed(true);
    }, [collapsed, model, setCollapsed]);

    return (
        <div
            className={cn("term-quick-input", className, {
                "term-quick-input-collapsed": collapsed,
                "term-quick-input-compact": compact,
            })}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <button
                type="button"
                className="term-quick-input-collapse-toggle"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleCollapsed}
                title={collapsed ? "展开输入框" : "收起输入框"}
                aria-label={collapsed ? "展开输入框" : "收起输入框"}
            >
                <i className={cn("fa-solid text-[10px]", collapsed ? "fa-chevron-up" : "fa-chevron-down")} />
            </button>

            {collapsed ? (
                <div className="term-quick-input-collapsed-hint" aria-hidden="true" />
            ) : (
                <div className="term-quick-input-main">
                    <div className="term-quick-input-editor">
                        <div className="term-quick-input-shell">
                            <div className="term-quick-input-completion">
                                <TermQuickInputCompletion
                                    model={model}
                                    value={value}
                                    onChange={onChange}
                                    onSubmit={onSubmit}
                                    onFocus={() => model.nodeModel.focusNode()}
                                    placeholder={placeholder}
                                    className={cn("term-quick-input-field text-sm", compact && "term-quick-input-field-compact")}
                                />
                            </div>
                            <button
                                type="button"
                                className={notifyClassName}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                    if (!notifyAvailable) {
                                        return;
                                    }
                                    setNotifyEnabled(!notifyEnabled);
                                }}
                                disabled={!notifyAvailable}
                                title={model.getQuickInputCompletionNotificationTitle()}
                            >
                                <i className="fa-solid fa-bell text-[10px]" />
                                <span>通知</span>
                            </button>
                        </div>
                    </div>
                    <Button
                        className={cn("term-quick-input-send", compact && "term-quick-input-send-compact")}
                        onClick={onSubmit}
                        disabled={value.trim() === ""}
                        title={submitTitle}
                    >
                        {submitLabel}
                    </Button>
                </div>
            )}
        </div>
    );
}
