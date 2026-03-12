// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useMemo, useState } from "react";

interface SettingItemProps {
    label: string;
    description?: string;
    children: React.ReactNode;
}

const SettingItem = memo(({ label, description, children }: SettingItemProps) => {
    return (
        <div className="flex flex-col gap-1.5 py-3 px-4 border-b border-zinc-700/50">
            <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col">
                    <span className="text-sm font-medium text-zinc-200">{label}</span>
                    {description && <span className="text-xs text-zinc-500 mt-0.5">{description}</span>}
                </div>
                <div className="shrink-0">{children}</div>
            </div>
        </div>
    );
});
SettingItem.displayName = "SettingItem";

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

type ConnectionsData = Record<string, any>;

interface ConnectionsVisualContentProps {
    model: WaveConfigViewModel;
}

export const ConnectionsVisualContent = memo(({ model }: ConnectionsVisualContentProps) => {
    const fileContent = useAtomValue(model.fileContentAtom);
    const setFileContent = useSetAtom(model.fileContentAtom);
    const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newConnectionName, setNewConnectionName] = useState("");

    const connections: ConnectionsData = useMemo(() => {
        try {
            return JSON.parse(fileContent || "{}");
        } catch {
            return {};
        }
    }, [fileContent]);

    const connectionNames = useMemo(() => {
        return Object.keys(connections).sort();
    }, [connections]);

    const currentConnection = selectedConnection ? connections[selectedConnection] : null;

    const updateConnection = useCallback(
        (connName: string, field: string, value: any) => {
            const newConnections = {
                ...connections,
                [connName]: {
                    ...connections[connName],
                    [field]: value,
                },
            };
            setFileContent(JSON.stringify(newConnections, null, 2));
            model.markAsEdited();
        },
        [connections, setFileContent, model]
    );

    const deleteConnection = useCallback(
        (connName: string) => {
            const newConnections = { ...connections };
            delete newConnections[connName];
            setFileContent(JSON.stringify(newConnections, null, 2));
            model.markAsEdited();
            if (selectedConnection === connName) {
                setSelectedConnection(null);
            }
        },
        [connections, setFileContent, model, selectedConnection]
    );

    const createConnection = useCallback(() => {
        if (!newConnectionName.trim()) return;
        const newConnections = {
            ...connections,
            [newConnectionName.trim()]: {
                "ssh:user": "",
                "ssh:hostname": "",
                "ssh:port": "22",
                "term:theme": "default-dark",
                "term:fontsize": 14,
            },
        };
        setFileContent(JSON.stringify(newConnections, null, 2));
        model.markAsEdited();
        setSelectedConnection(newConnectionName.trim());
        setIsCreating(false);
        setNewConnectionName("");
    }, [connections, newConnectionName, setFileContent, model]);

    const renderConnectionList = () => (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b border-zinc-700">
                <button
                    onClick={() => setIsCreating(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded text-sm font-medium transition-colors"
                >
                    <i className="fa-sharp fa-solid fa-plus" />
                    新建连接
                </button>
            </div>
            {isCreating && (
                <div className="p-4 border-b border-zinc-700 bg-zinc-800/50">
                    <div className="flex flex-col gap-2">
                        <TextInput
                            value={newConnectionName}
                            onChange={setNewConnectionName}
                            placeholder="连接名称 (如: my-server)"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setIsCreating(false);
                                    setNewConnectionName("");
                                }}
                                className="flex-1 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-sm transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={createConnection}
                                disabled={!newConnectionName.trim()}
                                className="flex-1 px-3 py-2 bg-accent-600 hover:bg-accent-500 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                创建
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="flex-1 overflow-y-auto">
                {connectionNames.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-zinc-500">
                        <i className="fa-sharp fa-solid fa-network-wired text-4xl mb-2" />
                        <p>暂无连接</p>
                        <p className="text-xs">点击上方按钮创建新连接</p>
                    </div>
                ) : (
                    connectionNames.map((name) => (
                        <div
                            key={name}
                            onClick={() => setSelectedConnection(name)}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-zinc-700/50",
                                selectedConnection === name ? "bg-accentbg" : "hover:bg-zinc-800/50"
                            )}
                        >
                            <i className="fa-sharp fa-solid fa-server text-zinc-400" />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-zinc-200 truncate">{name}</div>
                                {connections[name] && (
                                    <div className="text-xs text-zinc-500 truncate">
                                        {connections[name]["ssh:user"]}@{connections[name]["ssh:hostname"]}
                                        {connections[name]["ssh:port"] && connections[name]["ssh:port"] !== "22"
                                            ? `:${connections[name]["ssh:port"]}`
                                            : ""}
                                    </div>
                                )}
                            </div>
                            <i className="fa-sharp fa-solid fa-chevron-right text-zinc-500 text-sm" />
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderConnectionForm = () => {
        if (!currentConnection) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 p-8">
                    <i className="fa-sharp fa-solid fa-arrow-left text-4xl mb-4" />
                    <p className="text-center">选择一个连接进行编辑</p>
                </div>
            );
        }

        return (
            <div className="h-full overflow-y-auto">
                <div className="sticky top-0 bg-zinc-900 border-b border-zinc-700 p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-2">
                        <i className="fa-sharp fa-solid fa-server text-zinc-400" />
                        <span className="font-semibold text-zinc-200">{selectedConnection}</span>
                    </div>
                    <button
                        onClick={() => deleteConnection(selectedConnection!)}
                        className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm transition-colors"
                    >
                        <i className="fa-sharp fa-solid fa-trash mr-1" />
                        删除
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <SettingSection title="SSH 连接" icon="fa-network-wired">
                        <FormField label="用户名" description="SSH 用户名">
                            <TextInput
                                value={currentConnection["ssh:user"] || ""}
                                onChange={(v) => updateConnection(selectedConnection!, "ssh:user", v || undefined)}
                                placeholder="root"
                            />
                        </FormField>
                        <FormField label="主机名" description="服务器地址或 IP">
                            <TextInput
                                value={currentConnection["ssh:hostname"] || ""}
                                onChange={(v) => updateConnection(selectedConnection!, "ssh:hostname", v || undefined)}
                                placeholder="192.168.1.1"
                            />
                        </FormField>
                        <FormField label="端口" description="SSH 端口号">
                            <TextInput
                                value={currentConnection["ssh:port"] || "22"}
                                onChange={(v) => updateConnection(selectedConnection!, "ssh:port", v || undefined)}
                                placeholder="22"
                            />
                        </FormField>
                        <FormField label="身份文件" description="SSH 私钥路径（逗号分隔多个）">
                            <TextInput
                                value={currentConnection["ssh:identityfile"]?.join(", ") || ""}
                                onChange={(v) =>
                                    updateConnection(
                                        selectedConnection!,
                                        "ssh:identityfile",
                                        v
                                            ? v.split(",").map((s) => s.trim())
                                            : undefined
                                    )
                                }
                                placeholder="~/.ssh/id_rsa"
                            />
                        </FormField>
                        <FormField label="密钥密码">
                            <TextInput
                                value={currentConnection["ssh:passwordsecretname"] || ""}
                                onChange={(v) =>
                                    updateConnection(selectedConnection!, "ssh:passwordsecretname", v || undefined)
                                }
                                placeholder="密钥名称"
                            />
                        </FormField>
                    </SettingSection>

                    <SettingSection title="认证" icon="fa-key">
                        <FormField>
                            <ToggleSwitch
                                checked={currentConnection["ssh:pubkeyauthentication"] !== false}
                                onChange={(v) =>
                                    updateConnection(selectedConnection!, "ssh:pubkeyauthentication", v)
                                }
                            />
                            <span className="text-sm text-zinc-300">公钥认证</span>
                        </FormField>
                        <FormField>
                            <ToggleSwitch
                                checked={currentConnection["ssh:passwordauthentication"] === true}
                                onChange={(v) =>
                                    updateConnection(selectedConnection!, "ssh:passwordauthentication", v)
                                }
                            />
                            <span className="text-sm text-zinc-300">密码认证</span>
                        </FormField>
                        <FormField>
                            <ToggleSwitch
                                checked={currentConnection["ssh:addkeystoagent"] !== false}
                                onChange={(v) => updateConnection(selectedConnection!, "ssh:addkeystoagent", v)}
                            />
                            <span className="text-sm text-zinc-300">添加密钥到 SSH Agent</span>
                        </FormField>
                        <FormField>
                            <ToggleSwitch
                                checked={currentConnection["ssh:identitiesonly"] === true}
                                onChange={(v) => updateConnection(selectedConnection!, "ssh:identitiesonly", v)}
                            />
                            <span className="text-sm text-zinc-300">仅使用指定身份文件</span>
                        </FormField>
                    </SettingSection>

                    <SettingSection title="终端" icon="fa-terminal">
                        <FormField label="主题">
                            <SelectInput
                                value={currentConnection["term:theme"] || "default-dark"}
                                onChange={(v) => updateConnection(selectedConnection!, "term:theme", v)}
                                options={[
                                    { value: "default-dark", label: "Default Dark" },
                                    { value: "onedarkpro", label: "One Dark Pro" },
                                    { value: "dracula", label: "Dracula" },
                                    { value: "monokai", label: "Monokai" },
                                    { value: "campbell", label: "Campbell" },
                                    { value: "warmyellow", label: "Warm Yellow" },
                                    { value: "rosepine", label: "Rose Pine" },
                                ]}
                            />
                        </FormField>
                        <FormField label="字体大小">
                            <TextInput
                                value={currentConnection["term:fontsize"]?.toString() || "14"}
                                onChange={(v) =>
                                    updateConnection(selectedConnection!, "term:fontsize", parseInt(v) || undefined)
                                }
                                placeholder="14"
                            />
                        </FormField>
                        <FormField>
                            <ToggleSwitch
                                checked={currentConnection["term:durable"] === true}
                                onChange={(v) => updateConnection(selectedConnection!, "term:durable", v)}
                            />
                            <span className="text-sm text-zinc-300">持久会话</span>
                        </FormField>
                    </SettingSection>

                    <SettingSection title="其他" icon="fa-gear">
                        <FormField label="Shell 路径">
                            <TextInput
                                value={currentConnection["conn:shellpath"] || ""}
                                onChange={(v) => updateConnection(selectedConnection!, "conn:shellpath", v || undefined)}
                                placeholder="/bin/bash"
                            />
                        </FormField>
                        <FormField label="初始化脚本">
                            <TextInput
                                value={currentConnection["cmd:initscript"] || ""}
                                onChange={(v) => updateConnection(selectedConnection!, "cmd:initscript", v || undefined)}
                                placeholder="连接后执行的脚本"
                            />
                        </FormField>
                    </SettingSection>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full bg-zinc-900">
            <div className="w-72 border-r border-zinc-700 flex-shrink-0">{renderConnectionList()}</div>
            <div className="flex-1 min-w-0">{renderConnectionForm()}</div>
        </div>
    );
});

ConnectionsVisualContent.displayName = "ConnectionsVisualContent";
