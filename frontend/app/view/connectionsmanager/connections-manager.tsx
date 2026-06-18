// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { showConfirmModal } from "@/app/modals/promptmodal";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, getConnStatusAtom, loadConnStatus } from "@/store/global";
import { RpcApi } from "@/store/wshclientapi";
import { atom, useAtomValue } from "jotai";
import React, { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    buildConnectionHost,
    buildConnMetaFromForm,
    buildPasswordSecretName,
    ConnectionFormState,
    connectionMatchesQuery,
    getConnStatusBadgeInfo,
    getEnsureWshButtonLabel,
    getWshBadgeInfo,
    makeConnectionFormFromConfig,
    normalizeConnectionUser,
    parseConnectionHost,
    shouldReinstallWsh,
    sortConnectionHosts,
} from "./connections-manager-util";

function makeBlankForm(): ConnectionFormState {
    return {
        host: "",
        displayName: "",
        group: "",
        remark: "",
        user: "root",
        hostname: "",
        port: "22",
        password: "",
        passwordSecretName: "",
        hasStoredPassword: false,
        passwordAuth: false,
        pubkeyAuth: true,
        keyboardInteractiveAuth: false,
    };
}

const CONN_ICON_COLORS = [
    { bg: "rgba(83,180,234,0.12)", text: "#53b4ea" },
    { bg: "rgba(170,103,255,0.12)", text: "#aa67ff" },
    { bg: "rgba(255,162,78,0.12)", text: "#ffa24e" },
    { bg: "rgba(239,71,111,0.12)", text: "#ef476f" },
    { bg: "rgba(88,193,66,0.12)", text: "#58c142" },
    { bg: "rgba(73,123,248,0.12)", text: "#497bf8" },
    { bg: "rgba(219,222,82,0.12)", text: "#dbde52" },
    { bg: "rgba(253,167,253,0.12)", text: "#fda7fd" },
];

function getConnIconColor(host: string): { bg: string; text: string } {
    let hash = 0;
    for (let i = 0; i < host.length; i++) {
        hash = (hash * 31 + host.charCodeAt(i)) | 0;
    }
    return CONN_ICON_COLORS[Math.abs(hash) % CONN_ICON_COLORS.length];
}

function getStatusDotColor(connStatus: ConnStatus | null | undefined): string {
    if (connStatus?.status === "connected") return "#4ade80";
    if (connStatus?.status === "connecting") return "#fbbf24";
    if (connStatus?.status === "error") return "#f87171";
    return "#555960";
}

const AuthChip = React.memo(function AuthChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs border transition-colors ${
                active
                    ? "bg-zinc-700 text-white border-zinc-600"
                    : "bg-panel text-secondary border-border hover:text-primary hover:border-border"
            }`}
            onClick={onClick}
            role="switch"
            aria-checked={active}
        >
            <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                    active ? "bg-accent-400" : "bg-zinc-500"
                }`}
            />
            {label}
        </button>
    );
});

const ConnectionListItem = React.memo(function ConnectionListItem({
    host,
    meta,
    isSelected,
    latency,
    onSelect,
    onConnect,
    onMore,
}: {
    host: string;
    meta: ConnKeywords | undefined;
    isSelected: boolean;
    latency: number | null | undefined;
    onSelect: () => void;
    onConnect: (host: string) => void;
    onMore: (e: MouseEvent<HTMLButtonElement>, host: string) => void;
}) {
    const connStatus = useAtomValue(getConnStatusAtom(host));
    const iconColor = getConnIconColor(host);
    const parsedHost = parseConnectionHost(host);
    const addressUser = meta?.["ssh:user"] ?? parsedHost.user;
    const addressHost = meta?.["ssh:hostname"] ?? parsedHost.hostname;
    const addressLabel = addressHost ? `${addressUser}@${addressHost}` : host;
    const isConnecting = connStatus?.status === "connecting";
    const displayLabel = meta?.["display:name"] || host;
    const statusDotColor = getStatusDotColor(connStatus);
    const isConnected = connStatus?.status === "connected";

    return (
        <div
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 cursor-pointer border transition-colors ${
                isSelected
                    ? "bg-accent-400/8 border-accent-400/20"
                    : "border-transparent hover:bg-white/4"
            }`}
            role="button"
            tabIndex={0}
            aria-selected={isSelected}
            onClick={onSelect}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
        >
            <div
                className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 relative"
                style={{ background: iconColor.bg }}
            >
                <i className="fa fa-server text-xs" style={{ color: iconColor.text }} />
                <span
                    className="absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full border-2"
                    style={{
                        backgroundColor: statusDotColor,
                        borderColor: isSelected ? "var(--color-background)" : "var(--color-panel)",
                    }}
                />
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium leading-tight">{displayLabel}</div>
                <div className="truncate text-[11px] text-secondary font-mono leading-tight mt-0.5">{addressLabel}</div>
            </div>
            {/* Latency / Disconnect indicator */}
            {latency != null && latency > 0 && (
                <span className={`text-[10px] font-mono shrink-0 ${latency < 100 ? "text-green-400" : latency < 300 ? "text-yellow-400" : "text-red-400"}`}>
                    {latency}ms
                </span>
            )}
            {latency === null && !isConnected && !isConnecting && (
                <i className="fa fa-unlink text-[10px] text-red-400/60 shrink-0" title="网络不通" />
            )}
            {isConnecting && (
                <i className="fa fa-spinner fa-spin text-[10px] text-yellow-400 shrink-0" />
            )}
            <button
                type="button"
                className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border transition-all ${
                    isSelected
                        ? "opacity-100 bg-accent-400 border-accent-400 text-black hover:bg-accent-400"
                        : "opacity-0 bg-transparent border-border text-secondary hover:bg-white/8 hover:text-primary"
                }`}
                onClick={(e) => {
                    e.stopPropagation();
                    if (isConnecting) return;
                    onConnect(host);
                }}
                aria-label={isConnecting ? "连接中" : "快速连接"}
                title={isConnecting ? "连接中" : "快速连接"}
            >
                <i className={`fa ${isConnecting ? "fa-spinner fa-spin" : "fa-play"} text-[9px]`} />
            </button>
        </div>
    );
});

class ConnectionsManagerViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon = atom("server");
    viewName = atom("连接管理");

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "connectionsmanager";
    }

    get viewComponent(): ViewComponent {
        return ConnectionsManagerView;
    }
}

const ConnectionStatusBadge = React.memo(function ConnectionStatusBadge({ host }: { host: string }) {
    const connStatus = useAtomValue(getConnStatusAtom(host));
    const badge = getConnStatusBadgeInfo(connStatus);
    return (
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${badge.className}`} role="status" aria-label={badge.label}>
            {badge.label}
        </span>
    );
});

const WshStatusBadge = React.memo(function WshStatusBadge({ host }: { host: string }) {
    const connStatus = useAtomValue(getConnStatusAtom(host));
    const badge = getWshBadgeInfo(connStatus);
    return (
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${badge.className}`} title={badge.title} role="status" aria-label={badge.label}>
            {badge.label}
        </span>
    );
});

function getConnectionFailureGuidance(errorText: string): {
    summary: string;
    hints: string[];
    isHostKeyChanged: boolean;
} {
    const lowerError = errorText.toLowerCase();
    if (lowerError.includes("hostkey-changed") || lowerError.includes("remote host identification has changed")) {
        return {
            summary:
                "服务器的 SSH 主机密钥已更改。这可能表示合法变更（服务器重装）或安全问题。",
            hints: [
                "如果您最近重装了服务器，请点击「更新密钥」以信任新密钥。",
                "如果您未预期此变更，可能是安全问题 - 请勿更新密钥。",
                "更新后将自动信任新密钥。",
            ],
            isHostKeyChanged: true,
        };
    }
    if (lowerError.includes("unable to authenticate") || lowerError.includes("no supported methods remain")) {
        return {
            summary: "服务器拒绝了此连接提供的认证方法。",
            hints: [
                "请验证 SSH 用户名和凭据。",
                "如果服务器上禁用了密码认证，请使用公钥或键盘交互认证。",
                "如果使用 root 用户，请确认服务器策略允许 root SSH 登录。",
            ],
            isHostKeyChanged: false,
        };
    }
    if (lowerError.includes("connection refused")) {
        return {
            summary: "已连接到服务器主机，但 SSH 端口拒绝了连接。",
            hints: ["请确认目标主机上 SSH 服务正在运行。", "请检查此连接配置中的 SSH 端口。"],
            isHostKeyChanged: false,
        };
    }
    if (lowerError.includes("timed out") || lowerError.includes("timeout")) {
        return {
            summary: "SSH 测试在服务器完成握手前超时。",
            hints: [
                "请验证主机 IP 和端口是否正确。",
                "请检查防火墙、安全组和网络 ACL 规则。",
            ],
            isHostKeyChanged: false,
        };
    }
    if (lowerError.includes("no route to host") || lowerError.includes("network is unreachable")) {
        return {
            summary: "WaveTerm 无法到达目标网络端点。",
            hints: ["请检查路由/VPN 设置以及主机是否从此机器可达。"],
            isHostKeyChanged: false,
        };
    }
    return {
        summary: "WaveTerm 无法为此连接完成请求的操作。",
        hints: ["请查看下面的技术详情以获取服务器的确切响应。"],
        isHostKeyChanged: false,
    };
}

function ConnectionFailureModalContent({
    title,
    error,
    attemptedHost,
    onRetry,
}: {
    title: string;
    error: unknown;
    attemptedHost?: string | null;
    onRetry?: () => void;
}) {
    const rawError = String(error ?? "未知错误");
    const guidance = getConnectionFailureGuidance(rawError);
    const [updatingKey, setUpdatingKey] = useState(false);

    async function handleUpdateKey() {
        if (!attemptedHost) return;
        setUpdatingKey(true);
        try {
            await RpcApi.UpdateKnownHostKeyCommand(TabRpcClient, { host: attemptedHost });
            modalsModel.popModal();
            if (onRetry) {
                onRetry();
            }
        } catch (e) {
            console.error("Failed to update host key:", e);
        } finally {
            setUpdatingKey(false);
        }
    }

    return (
        <div className="w-[84vw] max-w-[720px] max-h-[68vh] overflow-y-auto">
            <div className="overflow-hidden rounded-xl border border-red-500/30 bg-gradient-to-b from-red-500/10 to-black/10">
                <div className="border-b border-red-500/20 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-500/40 bg-red-500/15 text-red-300">
                            <i className="fa-solid fa-triangle-exclamation text-xs" />
                        </div>
                        <div className="text-[15px] font-semibold tracking-[0.01em] text-primary">{title}</div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-secondary">{guidance.summary}</p>
                    {attemptedHost && (
                        <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-panel px-2 py-1 text-xs text-secondary">
                            <span className="uppercase tracking-wide text-[10px] text-secondary">目标</span>
                            <span className="truncate font-mono text-primary">{attemptedHost}</span>
                        </div>
                    )}
                </div>
                <div className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-secondary">建议检查</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-secondary">
                        {guidance.hints.map((hint) => (
                            <li key={hint}>{hint}</li>
                        ))}
                    </ul>
                </div>
                {guidance.isHostKeyChanged && attemptedHost && (
                    <div className="px-4 pb-3">
                        <Button className="!px-3" onClick={handleUpdateKey} disabled={updatingKey}>
                            {updatingKey ? "更新中..." : "更新密钥"}
                        </Button>
                        <div className="mt-2 text-xs text-secondary">
                            这将移除旧的主机密钥并信任新密钥。
                        </div>
                    </div>
                )}
                <div className="px-4 pb-4">
                    <div className="rounded-lg border border-border bg-black/30 p-3">
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-secondary">技术详情</div>
                        <pre className="m-0 whitespace-pre-wrap break-words text-xs leading-5 text-primary">
                            {rawError}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}

function SectionHeader({ icon, iconBg, iconColor, title }: { icon: string; iconBg: string; iconColor: string; title: string }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <div
                className="w-6 h-6 rounded flex items-center justify-center text-[10px]"
                style={{ background: iconBg, color: iconColor }}
            >
                <i className={`fa ${icon}`} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">{title}</div>
            <div className="flex-1 h-px bg-border" />
        </div>
    );
}

function ConnectionsManagerView({ model }: ViewComponentProps<ConnectionsManagerViewModel>) {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [query, setQuery] = useState("");
    const [selectedHost, setSelectedHost] = useState<string>("");
    const [activeGroup, setActiveGroup] = useState<string>("全部");
    const [form, setForm] = useState<ConnectionFormState>(makeBlankForm());
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [ensuringWsh, setEnsuringWsh] = useState(false);
    const [connectionsState, setConnectionsState] = useState<{ [key: string]: ConnKeywords }>({});
    const [latencyMap, setLatencyMap] = useState<Record<string, number | null>>({});
    const latencyMapRef = useRef<Record<string, number | null>>({});
    const [successMessage, setSuccessMessage] = useState<string>("");
    const [batchTesting, setBatchTesting] = useState(false);
    const [batchTestProgress, setBatchTestProgress] = useState(0);
    const [batchTestTotal, setBatchTestTotal] = useState(0);
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [pinging, setPinging] = useState(false);
    const [pingResult, setPingResult] = useState<{ latency: number | null; networkOk: boolean | null; error: string | null }>({ latency: null, networkOk: null, error: null });
    const selectedConnStatus = useAtomValue(getConnStatusAtom(selectedHost));

    function showSuccessMessage(msg: string) {
        setSuccessMessage(msg);
        setTimeout(() => setSuccessMessage(""), 3000);
    }

    function showConnectionFailureModal(title: string, error: unknown, attemptedHost?: string | null, onRetry?: () => void) {
        modalsModel.pushModal("MessageModal", {
            children: <ConnectionFailureModalContent title={title} error={error} attemptedHost={attemptedHost} onRetry={onRetry} />,
        });
    }

    useEffect(() => {
        setConnectionsState(fullConfig?.connections ?? {});
    }, [fullConfig?.connections]);

    // Auto-refresh connection statuses on mount and periodically
    useEffect(() => {
        void loadConnStatus();
        const interval = setInterval(() => void loadConnStatus(), 30000);
        return () => clearInterval(interval);
    }, []);

    // Auto-probe latency for all connections, re-run when connections change
    useEffect(() => {
        const hosts = Object.keys(connectionsState).filter((h) => !connectionsState[h]?.["display:hidden"]);
        if (hosts.length === 0) return;
        let cancelled = false;
        async function probeAll() {
            for (const host of hosts) {
                if (cancelled) break;
                // Skip if already probed recently (within 60s)
                const existing = latencyMapRef.current[host];
                if (existing != null && existing > 0) continue;
                const start = performance.now();
                try {
                    await RpcApi.ConnEnsureCommand(
                        TabRpcClient,
                        { connname: host, logblockid: model.blockId },
                        { timeout: 15000 }
                    );
                    if (!cancelled) {
                        const latency = Math.max(1, Math.round(performance.now() - start));
                        setLatencyMap((prev) => ({ ...prev, [host]: latency }));
                        latencyMapRef.current[host] = latency;
                    }
                } catch {
                    if (!cancelled) {
                        setLatencyMap((prev) => ({ ...prev, [host]: null }));
                        latencyMapRef.current[host] = null;
                    }
                }
            }
        }
        void probeAll();
        return () => { cancelled = true; };
    }, [connectionsState]);

    // Periodically refresh latency (every 60s)
    useEffect(() => {
        const interval = setInterval(() => {
            const hosts = Object.keys(connectionsState).filter((h) => !connectionsState[h]?.["display:hidden"]);
            for (const host of hosts) {
                const start = performance.now();
                RpcApi.ConnEnsureCommand(
                    TabRpcClient,
                    { connname: host, logblockid: model.blockId },
                    { timeout: 15000 }
                ).then(() => {
                    const latency = Math.max(1, Math.round(performance.now() - start));
                    setLatencyMap((prev) => ({ ...prev, [host]: latency }));
                    latencyMapRef.current[host] = latency;
                }).catch(() => {
                    setLatencyMap((prev) => ({ ...prev, [host]: null }));
                    latencyMapRef.current[host] = null;
                });
            }
        }, 60000);
        return () => clearInterval(interval);
    }, [connectionsState]);

    const groups = useMemo(() => {
        const set = new Set<string>();
        for (const host of Object.keys(connectionsState)) {
            if (connectionsState[host]?.["display:hidden"]) {
                continue;
            }
            const g = ((connectionsState[host] as any)?.["display:group"] as string) ?? "";
            if (g.trim() !== "") {
                set.add(g.trim());
            }
        }
        return ["全部", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
    }, [connectionsState]);

    const groupCounts = useMemo(() => {
        const counts: Record<string, number> = { "全部": 0 };
        for (const host of Object.keys(connectionsState)) {
            if (connectionsState[host]?.["display:hidden"]) continue;
            counts["全部"] = (counts["全部"] ?? 0) + 1;
            const g = ((connectionsState[host] as any)?.["display:group"] as string ?? "").trim();
            if (g) {
                counts[g] = (counts[g] ?? 0) + 1;
            }
        }
        return counts;
    }, [connectionsState]);

    const statusCounts = useMemo(() => {
        let connected = 0, connecting = 0, disconnected = 0, errored = 0;
        for (const host of Object.keys(connectionsState)) {
            if (connectionsState[host]?.["display:hidden"]) continue;
            const status = globalStore.get(getConnStatusAtom(host))?.status;
            if (status === "connected") connected++;
            else if (status === "connecting") connecting++;
            else if (status === "error") errored++;
            else disconnected++;
        }
        return { connected, connecting, disconnected, errored };
    }, [connectionsState, selectedConnStatus]);

    const filteredHosts = useMemo(() => {
        const sorted = sortConnectionHosts(connectionsState);
        return sorted.filter((host) => {
            const isHidden = !!connectionsState[host]?.["display:hidden"];
            if (isHidden) {
                return false;
            }
            const group = (((connectionsState[host] as any)?.["display:group"] as string) ?? "").trim();
            const groupMatch = activeGroup === "全部" || group === activeGroup;
            return groupMatch && connectionMatchesQuery(host, connectionsState[host], query);
        });
    }, [connectionsState, query, activeGroup]);

    useEffect(() => {
        if (selectedHost === "__new__") {
            return;
        }
        if (selectedHost === "" && filteredHosts.length > 0) {
            setSelectedHost(filteredHosts[0]);
            return;
        }
        if (selectedHost !== "" && !filteredHosts.includes(selectedHost)) {
            setSelectedHost(filteredHosts[0] ?? "");
        }
    }, [filteredHosts, selectedHost]);

    const prevSelectedHostRef = useRef(selectedHost);
    useEffect(() => {
        if (selectedHost === prevSelectedHostRef.current) {
            return;
        }
        prevSelectedHostRef.current = selectedHost;
        setPasswordVisible(false);
        setPingResult({ latency: null, networkOk: null, error: null });
        if (selectedHost === "__new__") {
            setForm(makeBlankForm());
            return;
        }
        if (selectedHost === "") {
            setForm(makeBlankForm());
            return;
        }
        setForm(makeConnectionFormFromConfig(selectedHost, connectionsState[selectedHost]));
    }, [selectedHost, connectionsState]);

    async function persistForm(): Promise<string | null> {
        const isNewConnection = selectedHost === "__new__";
        const normalizedUser = normalizeConnectionUser(form.user);
        const derivedHost = buildConnectionHost(normalizedUser, form.hostname);
        const currentHost = selectedHost !== "__new__" ? selectedHost : form.host.trim();
        const host = isNewConnection ? derivedHost : currentHost || derivedHost;

        if (host === "") {
            modalsModel.pushModal("MessageModal", { children: "保存前需要填写 SSH 主机名。" });
            return null;
        }
        if (isNewConnection && connectionsState[host] && !connectionsState[host]?.["display:hidden"]) {
            modalsModel.pushModal("MessageModal", {
                children: `连接 "${host}" 已存在。保存副本前请先修改 SSH 主机名。`,
            });
            return null;
        }

        const nextForm: ConnectionFormState = {
            ...form,
            host,
            user: normalizedUser,
        };
        const metaMap = buildConnMetaFromForm(nextForm);
        metaMap["display:hidden"] = false;

        // 将密码存入 secretstore（加密存储），配置中只保留 secret name 引用
        if (nextForm.password !== "") {
            const secretName = (metaMap["ssh:passwordsecretname"] as string) || buildPasswordSecretName(host);
            await RpcApi.SetSecretsCommand(TabRpcClient, { [secretName]: nextForm.password });
        }

        await RpcApi.SetConnectionsConfigCommand(TabRpcClient, {
            host: host,
            metamaptype: metaMap,
        });
        setConnectionsState((prev) => {
            const next = { ...prev };
            const oldHost = selectedHost !== "__new__" ? selectedHost : "";
            if (oldHost !== "" && oldHost !== host) {
                delete next[oldHost];
            }
            next[host] = { ...(next[host] ?? {}), ...metaMap };
            return next;
        });
        setSelectedHost(host);
        setForm(nextForm);
        // Probe latency for the new/updated connection
        void probeLatency(host);
        return host;
    }

    async function handleConnect(host: string) {
        try {
            await RpcApi.ConnEnsureCommand(
                TabRpcClient,
                {
                    connname: host,
                    logblockid: model.blockId,
                },
                { timeout: 60000 }
            );
            showSuccessMessage("连接成功");
        } catch (e) {
            showConnectionFailureModal("连接失败", e, host, () => void handleConnect(host));
        }
    }

    function handleCopy(host: string) {
        const sourceMeta = connectionsState[host];
        const copiedForm = makeConnectionFormFromConfig(host, sourceMeta);
        const nextDisplayName = copiedForm.displayName.trim() === "" ? "" : `${copiedForm.displayName} Copy`;
        setSelectedHost("__new__");
        setForm({
            ...copiedForm,
            host: "",
            displayName: nextDisplayName,
            password: "",
            passwordSecretName: "",
            hasStoredPassword: false,
        });
        modalsModel.pushModal("MessageModal", {
            children: "连接已复制到新草稿。如需要请修改 SSH 主机名，然后点击保存。",
        });
    }

    async function handleSoftDelete(host: string) {
        const confirmed = await showConfirmModal({
            title: `是否将连接 "${host}" 从列表中隐藏？`,
        });
        if (!confirmed) {
            return;
        }
        try {
            await RpcApi.SetConnectionsConfigCommand(TabRpcClient, {
                host,
                metamaptype: {
                    "display:hidden": true,
                },
            });
            setConnectionsState((prev) => ({
                ...prev,
                [host]: {
                    ...(prev[host] ?? {}),
                    "display:hidden": true,
                },
            }));
            if (selectedHost === host) {
                setSelectedHost("");
                setForm(makeBlankForm());
            }
        } catch (e) {
            showConnectionFailureModal("删除失败", e, host);
        }
    }

    function handleMoreActions(e: MouseEvent<HTMLButtonElement>, host: string) {
        ContextMenuModel.getInstance().showContextMenu(
            [
                {
                    label: "复制",
                    click: () => handleCopy(host),
                },
                {
                    label: "Ping",
                    click: () => {
                        void probeLatency(host);
                    },
                },
                {
                    type: "separator",
                },
                {
                    label: "删除",
                    click: () => {
                        void handleSoftDelete(host);
                    },
                },
            ],
            e
        );
    }

    async function handleSave() {
        setSaving(true);
        try {
            await persistForm();
            showSuccessMessage("保存成功");
        } catch (e) {
            showConnectionFailureModal("保存失败", e);
        } finally {
            setSaving(false);
        }
    }

    async function handleTestConnection() {
        let attemptedHost: string | null = null;
        setTesting(true);
        try {
            const host = await persistForm();
            if (!host) {
                return;
            }
            attemptedHost = host;
            await RpcApi.ConnEnsureCommand(
                TabRpcClient,
                {
                    connname: host,
                    logblockid: model.blockId,
                },
                { timeout: 60000 }
            );
            showSuccessMessage("连接测试成功");
        } catch (e) {
            showConnectionFailureModal("连接测试失败", e, attemptedHost, () => void handleTestConnection());
        } finally {
            setTesting(false);
        }
    }

    async function handleEnsureWsh() {
        let attemptedHost: string | null = null;
        setEnsuringWsh(true);
        try {
            const host = await persistForm();
            if (!host) {
                return;
            }
            attemptedHost = host;
            const connStatus = globalStore.get(getConnStatusAtom(host));
            if (shouldReinstallWsh(connStatus)) {
                await RpcApi.ConnReinstallWshCommand(
                    TabRpcClient,
                    {
                        connname: host,
                        logblockid: model.blockId,
                    },
                    { timeout: 60000 }
                );
                await RpcApi.ConnDisconnectCommand(TabRpcClient, host, { timeout: 10000 });
            }
            await RpcApi.ConnEnsureCommand(
                TabRpcClient,
                {
                    connname: host,
                    logblockid: model.blockId,
                },
                { timeout: 60000 }
            );
            showSuccessMessage("WSH 设置成功");
        } catch (e) {
            showConnectionFailureModal("WSH 设置失败", e, attemptedHost, () => void handleEnsureWsh());
        } finally {
            setEnsuringWsh(false);
        }
    }

    async function handlePing() {
        if (!selectedHost || selectedHost === "__new__") return;
        setPinging(true);
        setPingResult({ latency: null, networkOk: null, error: null });
        const start = performance.now();
        try {
            await RpcApi.ConnEnsureCommand(
                TabRpcClient,
                { connname: selectedHost, logblockid: model.blockId },
                { timeout: 30000 }
            );
            const latency = Math.max(1, Math.round(performance.now() - start));
            setPingResult({ latency, networkOk: true, error: null });
            setLatencyMap((prev) => ({ ...prev, [selectedHost]: latency }));
        } catch (e) {
            const elapsed = Math.round(performance.now() - start);
            const errMsg = String(e ?? "").toLowerCase();
            const isNetworkError =
                errMsg.includes("timed out") ||
                errMsg.includes("timeout") ||
                errMsg.includes("no route to host") ||
                errMsg.includes("network is unreachable") ||
                errMsg.includes("connection refused") ||
                errMsg.includes("connection reset") ||
                (elapsed > 10000 && errMsg.includes("error"));
            if (isNetworkError) {
                setPingResult({ latency: null, networkOk: false, error: String(e) });
            } else {
                const latency = Math.max(1, elapsed);
                setPingResult({ latency, networkOk: true, error: String(e) });
                setLatencyMap((prev) => ({ ...prev, [selectedHost]: latency }));
            }
        } finally {
            setPinging(false);
        }
    }

    async function probeLatency(host: string) {
        const start = performance.now();
        try {
            await RpcApi.ConnEnsureCommand(
                TabRpcClient,
                { connname: host, logblockid: model.blockId },
                { timeout: 20000 }
            );
            const latency = Math.max(1, Math.round(performance.now() - start));
            setLatencyMap((prev) => ({ ...prev, [host]: latency }));
        } catch {
            setLatencyMap((prev) => ({ ...prev, [host]: null }));
        }
    }

    async function handleBatchTest() {
        const hosts = filteredHosts;
        if (hosts.length === 0) return;
        setBatchTesting(true);
        setBatchTestProgress(0);
        setBatchTestTotal(hosts.length);
        let successCount = 0;
        let failCount = 0;
        for (let i = 0; i < hosts.length; i++) {
            const host = hosts[i];
            try {
                await RpcApi.ConnEnsureCommand(
                    TabRpcClient,
                    { connname: host, logblockid: model.blockId },
                    { timeout: 30000 }
                );
                successCount++;
            } catch {
                failCount++;
            }
            setBatchTestProgress(i + 1);
        }
        setBatchTesting(false);
        showSuccessMessage(`测试完成：${successCount} 成功，${failCount} 失败`);
        void loadConnStatus();
    }

    const selectedIconColor = selectedHost ? getConnIconColor(selectedHost) : CONN_ICON_COLORS[0];
    const selectedParsedHost = selectedHost ? parseConnectionHost(selectedHost) : { user: "", hostname: "" };
    const selectedMeta = selectedHost ? connectionsState[selectedHost] : undefined;
    const selectedAddrUser = selectedMeta?.["ssh:user"] ?? selectedParsedHost.user;
    const selectedAddrHost = selectedMeta?.["ssh:hostname"] ?? selectedParsedHost.hostname;
    const selectedAddrLabel = selectedAddrHost ? `${selectedAddrUser}@${selectedAddrHost}` : selectedHost;
    const selectedLatency = selectedHost ? latencyMap[selectedHost] : null;
    const isConnecting = selectedConnStatus?.status === "connecting";

    return (
        <div className="h-full w-full flex overflow-hidden">
            {/* ====== Left Panel ====== */}
            <div className="w-[300px] border-r border-border flex flex-col shrink-0 bg-panel/50">
                {/* Header */}
                <div className="p-4 pb-3">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div
                                className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold"
                                style={{ background: "linear-gradient(135deg, #53b4ea, #58c142)", color: "#000" }}
                            >
                                <i className="fa fa-bolt" />
                            </div>
                            <span className="text-[15px] font-bold">连接管理</span>
                        </div>
                        <button
                            type="button"
                            className="w-[30px] h-[30px] rounded-md border border-dashed border-border hover:border-accent-400 text-accent-400 hover:bg-accent-400/8 flex items-center justify-center transition-colors text-base shrink-0"
                            onClick={() => {
                                setSelectedHost("__new__");
                                setForm(makeBlankForm());
                            }}
                            title="新建连接"
                        >
                            <i className="fa fa-plus text-xs" />
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <i className="fa fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500" />
                            <input
                                className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-xs outline-none focus:border-accent-400 transition-colors"
                                placeholder="搜索主机 / 名称 / 用户 / 地址"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                        <button
                            type="button"
                            className={`h-[30px] px-2 rounded-md border text-[11px] flex items-center justify-center transition-colors shrink-0 whitespace-nowrap ${
                                batchTesting
                                    ? "border-accent-400/30 bg-accent-400/8 text-accent-400"
                                    : "border-border text-secondary hover:text-primary hover:border-border"
                            }`}
                            onClick={handleBatchTest}
                            disabled={batchTesting}
                            title="一键测试所有连接"
                        >
                            <i className={`fa ${batchTesting ? "fa-spinner fa-spin" : "fa-heartbeat"} mr-1 text-[9px]`} />
                            {batchTesting ? `${batchTestProgress}/${batchTestTotal}` : "测试"}
                        </button>
                    </div>
                </div>

                {/* Group Tabs */}
                <div className="flex border-b border-border overflow-x-auto">
                    {groups.map((g) => (
                        <button
                            key={g}
                            type="button"
                            className={`flex-1 min-w-[60px] py-2 text-center text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                                activeGroup === g
                                    ? "text-accent-400 border-accent-400"
                                    : "text-secondary border-transparent hover:text-primary"
                            }`}
                            onClick={() => setActiveGroup(g)}
                        >
                            {g}
                            <span className={`ml-1 text-[9px] px-1.5 py-px rounded-full ${
                                activeGroup === g ? "bg-accent-400/15 text-accent-400" : "bg-white/6"
                            }`}>
                                {groupCounts[g] ?? 0}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Connection List */}
                <div className="flex-1 overflow-auto px-2 py-1.5">
                    {filteredHosts.length === 0 ? (
                        <div className="text-secondary text-xs px-2 py-4 text-center">暂无连接</div>
                    ) : (
                        filteredHosts.map((host) => {
                            const meta = connectionsState[host];
                            const isSelected = selectedHost === host;
                            return (
                                <ConnectionListItem
                                    key={host}
                                    host={host}
                                    meta={meta}
                                    isSelected={isSelected}
                                    latency={latencyMap[host]}
                                    onSelect={() => setSelectedHost(host)}
                                    onConnect={(nextHost) => void handleConnect(nextHost)}
                                    onMore={handleMoreActions}
                                />
                            );
                        })
                    )}
                </div>

                {/* Footer Stats */}
                <div className="px-4 py-2.5 border-t border-border flex items-center gap-3 text-[11px] text-secondary">
                    <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        {statusCounts.connected} 已连接
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                        {statusCounts.connecting} 连接中
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                        {statusCounts.disconnected} 离线
                    </span>
                    {statusCounts.errored > 0 && (
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            {statusCounts.errored} 错误
                        </span>
                    )}
                </div>
            </div>

            {/* ====== Right Panel ====== */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                {/* Success Toast */}
                {successMessage && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg border border-accent-400/30 bg-accent-400/10 text-accent-400 text-xs font-medium shadow-md transition-opacity duration-300">
                        <i className="fa fa-check-circle" />
                        {successMessage}
                    </div>
                )}
                {/* Right Header */}
                <div className="px-6 pt-5 pb-4 border-b border-border">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-11 h-11 rounded-lg flex items-center justify-center text-lg relative"
                                style={{ background: selectedIconColor.bg, color: selectedIconColor.text }}
                            >
                                <i className="fa fa-server" />
                                {selectedConnStatus?.status === "connected" && (
                                    <span className="absolute -inset-0.5 rounded-lg border-2 border-accent-400 shadow-[0_0_8px_rgba(88,193,66,0.3)]" />
                                )}
                            </div>
                            <div>
                                <div className="text-lg font-bold leading-tight">
                                    {selectedHost === "__new__" ? "新建连接" : (form.displayName || selectedHost)}
                                </div>
                                {selectedHost && selectedHost !== "__new__" && (
                                    <div className="text-xs text-secondary font-mono mt-0.5">
                                        {selectedAddrLabel}{form.port !== "22" ? ` :${form.port}` : ""}
                                    </div>
                                )}
                            </div>
                        </div>
                        {selectedHost && selectedHost !== "__new__" && (
                            <div className="flex items-center gap-1.5">
                                <Button
                                    className="green !h-7 !px-3 !text-xs"
                                    onClick={() => void handleConnect(selectedHost)}
                                    disabled={isConnecting}
                                >
                                    <i className={`fa ${isConnecting ? "fa-spinner fa-spin" : "fa-play"} mr-1 text-[9px]`} />
                                    {isConnecting ? "连接中" : "连接"}
                                </Button>
                                <Button
                                    className="!h-7 !px-3 !text-xs"
                                    onClick={handlePing}
                                    disabled={pinging}
                                >
                                    <i className={`fa ${pinging ? "fa-spinner fa-spin" : "fa-signal"} mr-1 text-[9px]`} />
                                    {pinging ? "Ping..." : "Ping"}
                                </Button>
                                <Button
                                    className="!h-7 !px-3 !text-xs"
                                    onClick={handleTestConnection}
                                    disabled={testing}
                                >
                                    <i className="fa fa-plug mr-1 text-[9px]" />
                                    {testing ? "测试中..." : "测试连接"}
                                </Button>
                                <Button
                                    className="!h-7 !px-3 !text-xs"
                                    onClick={handleEnsureWsh}
                                    disabled={ensuringWsh}
                                >
                                    <i className="fa fa-cog mr-1 text-[9px]" />
                                    {ensuringWsh ? "设置中..." : getEnsureWshButtonLabel(selectedConnStatus)}
                                </Button>
                                <button
                                    type="button"
                                    className="w-7 h-7 rounded-md border border-border text-secondary hover:text-primary hover:border-border flex items-center justify-center transition-colors"
                                    onClick={(e) => handleMoreActions(e, selectedHost)}
                                    aria-label="更多操作"
                                >
                                    <i className="fa fa-ellipsis-h text-[10px]" />
                                </button>
                            </div>
                        )}
                        {selectedHost === "__new__" && (
                            <div className="flex items-center gap-1.5">
                                <Button
                                    className="!h-7 !px-3 !text-xs"
                                    onClick={handleTestConnection}
                                    disabled={testing}
                                >
                                    <i className="fa fa-plug mr-1 text-[9px]" />
                                    {testing ? "测试中..." : "测试并保存"}
                                </Button>
                            </div>
                        )}
                    </div>
                    {/* Status Badges Row */}
                    {selectedHost && selectedHost !== "__new__" && (
                        <div className="flex items-center gap-2">
                            <ConnectionStatusBadge host={selectedHost} />
                            <WshStatusBadge host={selectedHost} />
                            {pingResult.networkOk === true && pingResult.latency != null && (
                                <span className="px-2 py-0.5 rounded-full border text-[10px] font-medium text-green-400 border-green-400/20 bg-green-400/5">
                                    <i className="fa fa-signal mr-1" />{pingResult.latency} ms
                                </span>
                            )}
                            {pingResult.networkOk === true && pingResult.latency != null && pingResult.error && (
                                <span className="px-2 py-0.5 rounded-full border text-[10px] font-medium text-yellow-400 border-yellow-400/20 bg-yellow-400/5" title={pingResult.error}>
                                    <i className="fa fa-exclamation-triangle mr-1" />网络通，认证失败
                                </span>
                            )}
                            {pingResult.networkOk === false && (
                                <span className="px-2 py-0.5 rounded-full border text-[10px] font-medium text-red-400 border-red-400/20 bg-red-400/5" title={pingResult.error ?? undefined}>
                                    <i className="fa fa-times-circle mr-1" />网络不通
                                </span>
                            )}
                            {pingResult.networkOk === null && selectedLatency != null && (
                                <span className="px-2 py-0.5 rounded-full border text-[10px] font-medium text-blue-400 border-blue-400/20 bg-blue-400/5">
                                    {selectedLatency} ms
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Body */}
                <div className="flex-1 overflow-auto px-6 py-4">
                    {/* Section: 基本信息 - compact layout */}
                    <div className="mb-5">
                        <SectionHeader
                            icon="fa-info-circle"
                            iconBg="rgba(83,180,234,0.12)"
                            iconColor="#53b4ea"
                            title="基本信息"
                        />
                        <div className="space-y-2">
                            <div className="grid grid-cols-[80px_1fr_80px_1fr] gap-x-3 items-center">
                                <label className="text-[11px] text-secondary text-right">显示名称</label>
                                <input
                                    className="bg-background border border-border rounded px-2 py-1 text-sm outline-none focus:border-accent-400 transition-colors"
                                    value={form.displayName}
                                    onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
                                    placeholder="生产环境主机"
                                />
                                <label className="text-[11px] text-secondary text-right">分组</label>
                                <div className="relative">
                                    <input
                                        className="w-full bg-background border border-border rounded px-2 py-1 text-sm outline-none focus:border-accent-400 transition-colors"
                                        value={form.group}
                                        onChange={(e) => setForm((prev) => ({ ...prev, group: e.target.value }))}
                                        placeholder="生产 / 测试 / 实验"
                                        list="group-options"
                                    />
                                    <datalist id="group-options">
                                        {groups.filter((g) => g !== "全部").map((g) => (
                                            <option key={g} value={g} />
                                        ))}
                                    </datalist>
                                </div>
                            </div>
                            <div className="grid grid-cols-[80px_1fr_80px_1fr] gap-x-3 items-center">
                                <label className="text-[11px] text-secondary text-right">SSH 主机</label>
                                <input
                                    className="bg-background border border-border rounded px-2 py-1 text-sm outline-none focus:border-accent-400 transition-colors font-mono"
                                    value={form.hostname}
                                    onChange={(e) => setForm((prev) => ({ ...prev, hostname: e.target.value }))}
                                    placeholder="192.168.2.9"
                                />
                                <label className="text-[11px] text-secondary text-right">端口</label>
                                <input
                                    className="bg-background border border-border rounded px-2 py-1 text-sm outline-none focus:border-accent-400 transition-colors font-mono"
                                    value={form.port}
                                    onChange={(e) => setForm((prev) => ({ ...prev, port: e.target.value }))}
                                    placeholder="22"
                                />
                            </div>
                            <div className="grid grid-cols-[80px_1fr] gap-x-3 items-center">
                                <label className="text-[11px] text-secondary text-right">SSH 用户</label>
                                <input
                                    className="bg-background border border-border rounded px-2 py-1 text-sm outline-none focus:border-accent-400 transition-colors font-mono"
                                    value={form.user}
                                    onChange={(e) => setForm((prev) => ({ ...prev, user: e.target.value }))}
                                    placeholder="root"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Section: 认证方式 - radio style (mutually exclusive) */}
                    <div className="mb-5">
                        <SectionHeader
                            icon="fa-lock"
                            iconBg="rgba(170,103,255,0.12)"
                            iconColor="#aa67ff"
                            title="认证方式"
                        />
                        <div className="flex flex-wrap gap-2">
                            <AuthChip
                                label="公钥"
                                active={form.pubkeyAuth && !form.passwordAuth && !form.keyboardInteractiveAuth}
                                onClick={() => setForm((prev) => ({ ...prev, pubkeyAuth: true, passwordAuth: false, keyboardInteractiveAuth: false }))}
                            />
                            <AuthChip
                                label="密码"
                                active={form.passwordAuth && !form.pubkeyAuth && !form.keyboardInteractiveAuth}
                                onClick={() => setForm((prev) => ({ ...prev, passwordAuth: true, pubkeyAuth: false, keyboardInteractiveAuth: false }))}
                            />
                            <AuthChip
                                label="键盘交互"
                                active={form.keyboardInteractiveAuth && !form.pubkeyAuth && !form.passwordAuth}
                                onClick={() => setForm((prev) => ({ ...prev, keyboardInteractiveAuth: true, pubkeyAuth: false, passwordAuth: false }))}
                            />
                        </div>
                        {form.passwordAuth && (
                            <div className="mt-3 bg-white/3 border border-border rounded-md p-3">
                                <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">密码</div>
                                <div className="relative">
                                    <input
                                        type={passwordVisible ? "text" : "password"}
                                        className="w-full bg-background border border-border rounded px-2 py-1.5 pr-8 text-sm outline-none focus:border-accent-400 transition-colors font-mono"
                                        value={form.password}
                                        onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                                        placeholder={form.hasStoredPassword ? "已保存，留空则保持原密码" : "输入 SSH 密码"}
                                    />
                                    <button
                                        type="button"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary transition-colors"
                                        onClick={() => setPasswordVisible((prev) => !prev)}
                                        tabIndex={-1}
                                        aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                                    >
                                        <i className={`fa ${passwordVisible ? "fa-eye-slash" : "fa-eye"} text-xs`} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Section: 备注 */}
                    <div className="mb-4">
                        <SectionHeader
                            icon="fa-sticky-note"
                            iconBg="rgba(255,162,78,0.12)"
                            iconColor="#ffa24e"
                            title="备注"
                        />
                        <textarea
                            className="w-full bg-background border border-border rounded px-3 py-2 text-sm outline-none focus:border-accent-400 transition-colors min-h-[56px] resize-y"
                            value={form.remark}
                            onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))}
                            placeholder="主机用途、所有者、备注..."
                        />
                    </div>
                </div>

                {/* Right Footer */}
                <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-black/15">
                    <div className="flex items-center gap-4 text-[11px] text-zinc-500">
                        {selectedHost && selectedHost !== "__new__" && (
                            <>
                                <span className="flex items-center gap-1">
                                    <i className="fa fa-clock text-[9px]" />
                                    上次连接
                                </span>
                                {form.passwordAuth && (form.password || form.hasStoredPassword) && (
                                    <span className="flex items-center gap-1">
                                        <i className="fa fa-key text-[9px] text-accent-400" />
                                        密码已设置
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        {selectedHost && selectedHost !== "__new__" && (
                            <Button
                                className="red !h-7 !px-3 !text-xs"
                                onClick={() => void handleSoftDelete(selectedHost)}
                            >
                                <i className="fa fa-trash mr-1 text-[9px]" />
                                移除
                            </Button>
                        )}
                        {selectedHost && selectedHost !== "__new__" && (
                            <Button
                                className="!h-7 !px-3 !text-xs"
                                onClick={() => handleCopy(selectedHost)}
                            >
                                <i className="fa fa-copy mr-1 text-[9px]" />
                                复制
                            </Button>
                        )}
                        <Button
                            className="green !h-7 !px-4 !text-xs"
                            onClick={handleSave}
                            disabled={saving}
                        >
                            <i className="fa fa-check mr-1 text-[9px]" />
                            {saving ? "保存中..." : "保存"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { ConnectionsManagerViewModel };
