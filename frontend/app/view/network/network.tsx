// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWidgetWidthMenuItems } from "@/app/workspace/widgetsettings";
import { WOS } from "@/store/global";
import { atom } from "jotai";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
    deriveNetworkModel,
    getDisplayInterfaceName,
    getDiagnosticTone,
    getInterfaceActionErrorHeadline,
    getInterfaceRole,
    getInterfaceRoleLabel,
    getNetworkErrorHeadline,
    getOverviewTone,
    interfaceTypeIcon,
    interfaceTypeLabel,
    networkStatusBadgeClass,
    networkStatusLabel,
} from "./network-util";

const cardClass = "rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4";
const NetworkViewComponent = memo(NetworkView);
const networkResponseCache = new Map<string, NetworkListResponse>();

function ErrorPanel({ error, onRefresh }: { error: NetworkError; onRefresh: () => void }) {
    return (
        <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 text-center">
                <div className="text-lg font-semibold text-zinc-100">{getNetworkErrorHeadline(error)}</div>
                {error?.detail ? <div className="mt-2 text-sm text-zinc-400">{error.detail}</div> : null}
                <div className="mt-4">
                    <Button onClick={onRefresh}>刷新</Button>
                </div>
            </div>
        </div>
    );
}

function EmptyState({ title }: { title: string }) {
    return (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-6 text-center text-sm text-zinc-500">
            {title}
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
            <div className="mt-1 truncate text-sm font-medium text-zinc-100">{value || "未检测到"}</div>
        </div>
    );
}

function GroupSection({
    title,
    count,
    children,
    collapsible,
    collapsed,
    onToggle,
}: {
    title: string;
    count: number;
    children: ReactNode;
    collapsible?: boolean;
    collapsed?: boolean;
    onToggle?: () => void;
}) {
    return (
        <div className={cardClass}>
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <div className="text-sm font-semibold text-zinc-100">{title}</div>
                    <div className="text-xs text-zinc-500">{count} 个接口</div>
                </div>
                {collapsible ? (
                    <button
                        type="button"
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
                        onClick={onToggle}
                    >
                        {collapsed ? "展开" : "收起"}
                    </button>
                ) : null}
            </div>
            {!collapsed ? children : null}
        </div>
    );
}

function InterfaceRow({
    iface,
    primaryInterfaceName,
    selected,
    onSelect,
    children,
}: {
    iface: NetworkInterfaceSummary;
    primaryInterfaceName?: string;
    selected?: boolean;
    onSelect?: (iface: NetworkInterfaceSummary) => void;
    children?: ReactNode;
}) {
    const role = getInterfaceRole(iface, primaryInterfaceName);

    return (
        <div
            className={[
                "w-full rounded-xl border text-left transition-colors",
                selected
                    ? "border-accent/40 bg-accent/10"
                    : "border-zinc-800/80 bg-zinc-900/45 hover:border-zinc-700 hover:bg-zinc-900/60",
            ].join(" ")}
        >
            <button type="button" onClick={() => onSelect?.(iface)} className="w-full px-4 py-3 text-left">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-300">
                                <i className={`fa-solid ${interfaceTypeIcon(iface.type)}`} />
                            </span>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-zinc-100">{iface.name}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                    <span>{interfaceTypeLabel(iface.type)}</span>
                                    <span>•</span>
                                    <span>{iface.ipv4 || iface.ipv6 || "未分配地址"}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                        <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] tracking-wide ${networkStatusBadgeClass(iface.status)}`}
                        >
                            {networkStatusLabel(iface.status)}
                        </span>
                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
                            {getInterfaceRoleLabel(role)}
                        </span>
                    </div>
                </div>
            </button>
            {selected && children ? <div className="border-t border-zinc-800/80 px-4 py-4">{children}</div> : null}
        </div>
    );
}

function NetworkView({ blockId }: ViewComponentProps<NetworkViewModel>) {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const connection = (blockData?.meta?.connection as string) ?? "";
    const [response, setResponse] = useState<NetworkListResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<NetworkError | null>(null);
    const [actionError, setActionError] = useState<NetworkError | null>(null);
    const [pendingAction, setPendingAction] = useState<string>("");
    const [virtualCollapsed, setVirtualCollapsed] = useState(true);
    const [selectedInterfaceName, setSelectedInterfaceName] = useState<string>("");
    const [mtuDraft, setMtuDraft] = useState<string>("");
    const [editIpv4CidrDraft, setEditIpv4CidrDraft] = useState<string>("");
    const [editGatewayDraft, setEditGatewayDraft] = useState<string>("");
    const [editDnsDraft, setEditDnsDraft] = useState<string>("");

    const refreshData = useCallback(
        async (showLoading = false, forceReload = false) => {
            const cacheKey = connection || "__local__";
            if (!forceReload) {
                const cached = networkResponseCache.get(cacheKey);
                if (cached) {
                    setResponse(cached);
                    setError(cached?.error ?? null);
                    setLoading(false);
                    return;
                }
            }
            if (showLoading) {
                setLoading(true);
            }
            try {
                const resp = await RpcApi.NetworkListCommand(TabRpcClient, { connection });
                networkResponseCache.set(cacheKey, resp);
                setResponse(resp);
                setError(resp?.error ?? null);
                if (resp?.interfaces?.length && mtuDraft === "" && selectedInterfaceName === "") {
                    const firstIface = resp.interfaces[0];
                    if (firstIface?.mtu) {
                        setMtuDraft(String(firstIface.mtu));
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : "加载网络数据失败。";
                setError({ code: "unknown", message });
            } finally {
                setLoading(false);
            }
        },
        [connection]
    );

    useEffect(() => {
        void refreshData(true, false);
        return undefined;
    }, [refreshData]);

    const model = useMemo(
        () =>
            deriveNetworkModel(
                response ?? {
                    interfaces: [],
                    defaultRouteInterface: "",
                    defaultGateway: "",
                    dnsServers: [],
                }
            ),
        [response]
    );

    const selectedInterface = useMemo(() => {
        const interfaces = response?.interfaces ?? [];
        if (selectedInterfaceName === "") {
            return null;
        }
        return interfaces.find((iface) => iface.name === selectedInterfaceName) ?? null;
    }, [model.primaryInterface, response?.interfaces, selectedInterfaceName]);

    useEffect(() => {
        if (selectedInterface?.mtu) {
            setMtuDraft(String(selectedInterface.mtu));
        } else if (selectedInterface) {
            setMtuDraft("");
        }
    }, [selectedInterface?.name, selectedInterface?.mtu]);

    useEffect(() => {
        if (!selectedInterface) {
            setEditIpv4CidrDraft("");
            setEditGatewayDraft("");
            setEditDnsDraft("");
            return;
        }
        setEditIpv4CidrDraft(selectedInterface.ipv4Cidr || selectedInterface.ipv4 || "");
        setEditGatewayDraft(
            selectedInterface.defaultGateway ||
                (selectedInterface.name === model.primaryInterface?.name ? response?.defaultGateway || "" : "")
        );
        setEditDnsDraft((response?.dnsServers ?? []).join(", "));
    }, [selectedInterface?.name, selectedInterface?.ipv4Cidr, selectedInterface?.ipv4, selectedInterface?.defaultGateway, response?.defaultGateway, response?.dnsServers]);

    const runInterfaceAction = useCallback(
        async (action: "restart" | "up" | "down" | "set_mtu") => {
            if (!selectedInterface) {
                return;
            }
            const displayName = getDisplayInterfaceName(selectedInterface);
            if ((action === "restart" || action === "down") && !window.confirm(`确认对 ${displayName} 执行${action === "restart" ? "重启" : "禁用"}？`)) {
                return;
            }
            setPendingAction(action);
            setActionError(null);
            try {
                const resp = await RpcApi.NetworkActionCommand(TabRpcClient, {
                    connection,
                    name: selectedInterface.name,
                    action,
                    mtu: action === "set_mtu" ? Number(mtuDraft) : undefined,
                });
                if (resp?.error) {
                    setActionError(resp.error);
                    return;
                }
                await refreshData(false, true);
            } catch (err) {
                const message = err instanceof Error ? err.message : "网卡操作失败。";
                setActionError({ code: "unknown", message });
            } finally {
                setPendingAction("");
            }
        },
        [connection, mtuDraft, refreshData, selectedInterface]
    );

    const saveTemporaryConfig = useCallback(async () => {
        if (!selectedInterface) {
            return;
        }
        if (!window.confirm(`确认修改 ${getDisplayInterfaceName(selectedInterface)} 的临时网络配置？这可能导致当前连接短暂中断。`)) {
            return;
        }
        setPendingAction("configure");
        setActionError(null);
        try {
            const dnsServers = editDnsDraft
                .split(/[,\n]/)
                .map((item) => item.trim())
                .filter(Boolean);
            const resp = await RpcApi.NetworkConfigureCommand(TabRpcClient, {
                connection,
                name: selectedInterface.name,
                ipv4Cidr: editIpv4CidrDraft.trim(),
                gateway: editGatewayDraft.trim(),
                dnsServers,
            });
            if (resp?.error) {
                setActionError(resp.error);
                return;
            }
            await refreshData(false, true);
        } catch (err) {
            const message = err instanceof Error ? err.message : "网络配置保存失败。";
            setActionError({ code: "unknown", message });
        } finally {
            setPendingAction("");
        }
    }, [connection, editDnsDraft, editGatewayDraft, editIpv4CidrDraft, refreshData, selectedInterface]);

    if (error && !response) {
        return <ErrorPanel error={error} onRefresh={() => void refreshData(true, true)} />;
    }

    const renderExpandedDetail = (iface: NetworkInterfaceSummary) => (
        <div className="space-y-3">
            {iface.kindDescription ? (
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                    {iface.kindDescription}
                </div>
            ) : null}
            {iface.nameExplanation ? (
                <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
                    {iface.nameExplanation}
                </div>
            ) : null}
            {iface.vendor === "NVIDIA" ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                    这张卡已经按英伟达 Mellanox 设备处理。
                </div>
            ) : null}
            {actionError && iface.name === selectedInterface?.name ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    {getInterfaceActionErrorHeadline(actionError)}
                </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Metric label="IPv4" value={iface.ipv4 || "未分配"} />
                <Metric label="IPv4/CIDR" value={iface.ipv4Cidr || iface.ipv4 || "未分配"} />
                <Metric label="别名" value={iface.altNames?.join(", ") || "未检测到"} />
                <Metric label="MTU" value={iface.mtu ? String(iface.mtu) : "未检测到"} />
                <Metric label="驱动" value={iface.driver || "未检测到"} />
                <Metric label="固件" value={iface.firmwareVersion || "未检测到"} />
                <Metric label="厂商" value={iface.vendor || "未检测到"} />
                <Metric label="设备" value={iface.product || "未检测到"} />
            </div>
            <div className="flex flex-wrap gap-2">
                <Button onClick={() => void runInterfaceAction("restart")} disabled={!iface.canRestart || pendingAction !== ""}>
                    重启网卡
                </Button>
                <Button className="grey" onClick={() => void runInterfaceAction("up")} disabled={pendingAction !== ""}>
                    启用
                </Button>
                <Button className="grey" onClick={() => void runInterfaceAction("down")} disabled={pendingAction !== ""}>
                    禁用
                </Button>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3">
                <div className="mb-2 text-sm font-medium text-zinc-100">编辑 MTU</div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent"
                        value={mtuDraft}
                        onChange={(e) => setMtuDraft(e.target.value)}
                        placeholder="例如 1500"
                    />
                    <Button
                        onClick={() => void runInterfaceAction("set_mtu")}
                        disabled={!iface.canEditMtu || pendingAction !== "" || mtuDraft.trim() === ""}
                    >
                        保存 MTU
                    </Button>
                </div>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3">
                <div className="mb-2 text-sm font-medium text-zinc-100">编辑临时网络配置</div>
                <div className="space-y-3">
                    <input
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent"
                        value={editIpv4CidrDraft}
                        onChange={(e) => setEditIpv4CidrDraft(e.target.value)}
                        placeholder="IPv4/CIDR 例如 192.168.1.20/24"
                    />
                    <input
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent"
                        value={editGatewayDraft}
                        onChange={(e) => setEditGatewayDraft(e.target.value)}
                        placeholder="默认网关 例如 192.168.1.1"
                    />
                    <input
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent"
                        value={editDnsDraft}
                        onChange={(e) => setEditDnsDraft(e.target.value)}
                        placeholder="DNS，用逗号分隔 例如 1.1.1.1, 8.8.8.8"
                    />
                    <Button onClick={() => void saveTemporaryConfig()} disabled={pendingAction !== ""}>
                        保存临时配置
                    </Button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex h-full w-full min-w-0 flex-col gap-4 overflow-y-auto px-4 py-4">
            <div className="flex items-center justify-between px-1">
                <div>
                    <div className="text-lg font-semibold text-zinc-100">网络</div>
                    <div className="text-sm text-zinc-500">{connection || "本地连接"}</div>
                </div>
                <Button onClick={() => void refreshData(true, true)} disabled={loading}>
                    刷新
                </Button>
            </div>

            {error ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    {getNetworkErrorHeadline(error)}
                </div>
            ) : null}

            <div
                className={[cardClass, getOverviewTone(model.overviewStatus)].join(" ")}
            >
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">网络总览</div>
                <div className="mt-2 text-xl font-semibold text-zinc-100">{model.overviewText}</div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Metric label="主连接" value={model.primaryInterface?.name || "未检测到"} />
                    <Metric label="IP 地址" value={model.primaryInterface?.ipv4 || model.primaryInterface?.ipv6 || "未检测到"} />
                    <Metric label="默认网关" value={response?.defaultGateway || "未检测到"} />
                    <Metric label="DNS" value={model.dnsStatusText} />
                </div>
            </div>

            {model.diagnostics.length > 0 ? (
                <div className="space-y-3">
                    {model.diagnostics.map((diagnostic) => (
                        <div
                            key={diagnostic.id}
                            className={`rounded-xl border px-4 py-3 text-sm ${getDiagnosticTone(diagnostic.severity)}`}
                        >
                            {diagnostic.message}
                        </div>
                    ))}
                </div>
            ) : null}

            <GroupSection title="活动接口" count={model.activeInterfaces.length}>
                {model.activeInterfaces.length === 0 ? (
                    <EmptyState title="当前没有活动接口。" />
                ) : (
                    <div className="space-y-3">
                        {model.activeInterfaces.map((iface) => (
                            <InterfaceRow
                                key={iface.name}
                                iface={iface}
                                primaryInterfaceName={model.primaryInterface?.name}
                                selected={iface.name === selectedInterface?.name}
                                onSelect={(nextIface) =>
                                    setSelectedInterfaceName((current) => (current === nextIface.name ? "" : nextIface.name))
                                }
                            >
                                {renderExpandedDetail(iface)}
                            </InterfaceRow>
                        ))}
                    </div>
                )}
            </GroupSection>

            <GroupSection title="其他接口" count={model.otherInterfaces.length}>
                {model.otherInterfaces.length === 0 ? (
                    <EmptyState title="没有其他物理接口。" />
                ) : (
                    <div className="space-y-3">
                        {model.otherInterfaces.map((iface) => (
                            <InterfaceRow
                                key={iface.name}
                                iface={iface}
                                primaryInterfaceName={model.primaryInterface?.name}
                                selected={iface.name === selectedInterface?.name}
                                onSelect={(nextIface) =>
                                    setSelectedInterfaceName((current) => (current === nextIface.name ? "" : nextIface.name))
                                }
                            >
                                {renderExpandedDetail(iface)}
                            </InterfaceRow>
                        ))}
                    </div>
                )}
            </GroupSection>

            <GroupSection
                title="虚拟网络"
                count={model.virtualInterfaces.length}
                collapsible={true}
                collapsed={virtualCollapsed}
                onToggle={() => setVirtualCollapsed((value) => !value)}
            >
                {model.virtualInterfaces.length === 0 ? (
                    <EmptyState title="当前没有虚拟网络接口。" />
                ) : (
                    <div className="space-y-3">
                        {model.virtualInterfaces.map((iface) => (
                            <InterfaceRow
                                key={iface.name}
                                iface={iface}
                                primaryInterfaceName={model.primaryInterface?.name}
                                selected={iface.name === selectedInterface?.name}
                                onSelect={(nextIface) =>
                                    setSelectedInterfaceName((current) => (current === nextIface.name ? "" : nextIface.name))
                                }
                            >
                                {renderExpandedDetail(iface)}
                            </InterfaceRow>
                        ))}
                    </div>
                )}
            </GroupSection>
        </div>
    );
}

export class NetworkViewModel implements ViewModel {
    viewType = "network";
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon = atom("network-wired");
    viewName = atom("网络");
    manageConnection = atom(true);
    filterOutNowsh = atom(true);
    noPadding = atom(true);

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const widthSubMenu = getWidgetWidthMenuItems({
            blockId: this.blockId,
            tabModel: this.tabModel,
        });
        if (widthSubMenu.length === 0) {
            return [];
        }
        return [{ label: "Width", submenu: widthSubMenu }];
    }

    get viewComponent(): ViewComponent {
        return NetworkViewComponent;
    }
}
