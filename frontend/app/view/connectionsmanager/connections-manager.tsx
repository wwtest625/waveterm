// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { modalsModel } from "@/app/store/modalmodel";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { TabModel } from "@/app/store/tab-model";
import { atoms, getConnStatusAtom } from "@/store/global";
import { RpcApi } from "@/store/wshclientapi";
import { useAtomValue } from "jotai";
import { atom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import {
    buildConnMetaFromForm,
    connectionMatchesQuery,
    ConnectionFormState,
    makeConnectionFormFromConfig,
    sortConnectionHosts,
} from "./connections-manager-util";

function makeBlankForm(): ConnectionFormState {
    return {
        host: "",
        displayName: "",
        group: "",
        remark: "",
        user: "",
        hostname: "",
        port: "22",
        passwordAuth: false,
        pubkeyAuth: true,
        keyboardInteractiveAuth: false,
    };
}

class ConnectionsManagerViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon = atom("server");
    viewName = atom("Connections");

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

function ConnectionStatusBadge({ host }: { host: string }) {
    const connStatus = useAtomValue(getConnStatusAtom(host));
    let label = "Disconnected";
    let className = "text-gray-300 border-gray-600";
    if (connStatus?.status === "connected") {
        label = "Connected";
        className = "text-green-400 border-green-600";
    } else if (connStatus?.status === "connecting") {
        label = "Connecting";
        className = "text-yellow-300 border-yellow-600";
    } else if (connStatus?.status === "error") {
        label = "Error";
        className = "text-red-400 border-red-600";
    }
    return <span className={`px-2 py-0.5 rounded border text-xs ${className}`}>{label}</span>;
}

function ConnectionsManagerView({ model }: ViewComponentProps<ConnectionsManagerViewModel>) {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [query, setQuery] = useState("");
    const [selectedHost, setSelectedHost] = useState<string>("");
    const [activeGroup, setActiveGroup] = useState<string>("All");
    const [form, setForm] = useState<ConnectionFormState>(makeBlankForm());
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [connectionsState, setConnectionsState] = useState<{[key: string]: ConnKeywords}>({});
    const [latencyMap, setLatencyMap] = useState<Record<string, number | null>>({});

    useEffect(() => {
        setConnectionsState(fullConfig?.connections ?? {});
    }, [fullConfig?.connections]);

    const groups = useMemo(() => {
        const set = new Set<string>();
        for (const host of Object.keys(connectionsState)) {
            const g = ((connectionsState[host] as any)?.["display:group"] as string) ?? "";
            if (g.trim() !== "") {
                set.add(g.trim());
            }
        }
        return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
    }, [connectionsState]);

    const filteredHosts = useMemo(() => {
        const sorted = sortConnectionHosts(connectionsState);
        return sorted.filter((host) => {
            const group = (((connectionsState[host] as any)?.["display:group"] as string) ?? "").trim();
            const groupMatch = activeGroup === "All" || group === activeGroup;
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

    useEffect(() => {
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

    async function handleSave() {
        const host = form.host.trim();
        if (host === "") {
            modalsModel.pushModal("MessageModal", { children: "Host is required (example: root@192.168.2.9)" });
            return;
        }
        const metaMap = buildConnMetaFromForm(form);
        setSaving(true);
        try {
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
        } catch (e) {
            modalsModel.pushModal("MessageModal", { children: `Save failed: ${String(e)}` });
        } finally {
            setSaving(false);
        }
    }

    async function handleTestConnection() {
        const host = form.host.trim();
        if (host === "") {
            modalsModel.pushModal("MessageModal", { children: "Host is required before testing connection." });
            return;
        }
        setTesting(true);
        try {
            await RpcApi.ConnEnsureCommand(
                TabRpcClient,
                {
                    connname: host,
                    logblockid: model.blockId,
                },
                { timeout: 60000 }
            );
        } catch (e) {
            modalsModel.pushModal("MessageModal", { children: `Connection test failed: ${String(e)}` });
        } finally {
            setTesting(false);
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

    return (
        <div className="h-full w-full flex overflow-hidden">
            <div className="w-[420px] border-r border-border flex flex-col shrink-0">
                <div className="p-3 border-b border-border flex items-center gap-2">
                    <input
                        className="flex-1 rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                        placeholder="Search host / name / user / address"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <select
                        className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                        value={activeGroup}
                        onChange={(e) => setActiveGroup(e.target.value)}
                    >
                        {groups.map((g) => (
                            <option key={g} value={g}>
                                {g}
                            </option>
                        ))}
                    </select>
                    <Button
                        className="!h-[30px] !px-2"
                        onClick={() => {
                            setSelectedHost("__new__");
                            setForm(makeBlankForm());
                        }}
                    >
                        <i className="fa fa-plus mr-1" />
                        New
                    </Button>
                </div>
                <div className="flex-1 overflow-auto p-2">
                    {filteredHosts.length === 0 ? (
                        <div className="text-secondary text-sm px-2 py-3">No connections</div>
                    ) : (
                        <div className="space-y-1">
                            <div className="grid grid-cols-[1.4fr_1.8fr_84px_88px_70px] text-[11px] text-secondary px-2 py-1">
                                <div>Name / Group</div>
                                <div>Address</div>
                                <div>Latency</div>
                                <div>Status</div>
                                <div>Probe</div>
                            </div>
                            {filteredHosts.map((host) => {
                                const meta = connectionsState[host];
                                const isSelected = selectedHost === host;
                                const group = (((meta as any)?.["display:group"] as string) ?? "").trim();
                                const latency = latencyMap[host];
                                const latencyText = latency == null ? "-" : `${latency} ms`;
                                return (
                                    <div
                                        key={host}
                                        className={`grid grid-cols-[1.4fr_1.8fr_84px_88px_70px] items-center rounded px-2 py-2 cursor-pointer border ${
                                            isSelected
                                                ? "bg-green-900/30 border-green-700"
                                                : "bg-panel border-transparent hover:border-border"
                                        }`}
                                        onClick={() => setSelectedHost(host)}
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate text-sm">{meta?.["display:name"] || host}</div>
                                            <div className="truncate text-[11px] text-secondary">
                                                {group === "" ? "Ungrouped" : group}
                                            </div>
                                        </div>
                                        <div className="truncate text-xs text-secondary">
                                            {(meta?.["ssh:user"] || "") + "@" + (meta?.["ssh:hostname"] || host)}
                                        </div>
                                        <div className="text-xs text-secondary">{latencyText}</div>
                                        <div>
                                            <ConnectionStatusBadge host={host} />
                                        </div>
                                        <div>
                                            <Button
                                                className="!h-[24px] !px-2 !text-xs"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void probeLatency(host);
                                                }}
                                            >
                                                Ping
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-auto">
                <div className="max-w-[760px] p-4">
                    <div className="text-lg font-semibold mb-3">Connections Manager</div>
                    <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-3 items-center">
                        <div className="text-secondary text-sm">Host Key</div>
                        <input
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                            value={form.host}
                            onChange={(e) => setForm((prev) => ({ ...prev, host: e.target.value }))}
                            placeholder="root@192.168.2.9"
                        />

                        <div className="text-secondary text-sm">Display Name</div>
                        <input
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                            value={form.displayName}
                            onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
                            placeholder="Production Host"
                        />

                        <div className="text-secondary text-sm">Group</div>
                        <input
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                            value={form.group}
                            onChange={(e) => setForm((prev) => ({ ...prev, group: e.target.value }))}
                            placeholder="Production / Staging / Lab"
                        />

                        <div className="text-secondary text-sm">Remark</div>
                        <textarea
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none min-h-[70px]"
                            value={form.remark}
                            onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))}
                            placeholder="Host purpose, ownership, notes..."
                        />

                        <div className="text-secondary text-sm">SSH User</div>
                        <input
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                            value={form.user}
                            onChange={(e) => setForm((prev) => ({ ...prev, user: e.target.value }))}
                            placeholder="root"
                        />

                        <div className="text-secondary text-sm">SSH Hostname</div>
                        <input
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                            value={form.hostname}
                            onChange={(e) => setForm((prev) => ({ ...prev, hostname: e.target.value }))}
                            placeholder="192.168.2.9"
                        />

                        <div className="text-secondary text-sm">SSH Port</div>
                        <input
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                            value={form.port}
                            onChange={(e) => setForm((prev) => ({ ...prev, port: e.target.value }))}
                            placeholder="22"
                        />

                        <div className="text-secondary text-sm">Auth</div>
                        <div className="flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={form.passwordAuth}
                                    onChange={(e) => setForm((prev) => ({ ...prev, passwordAuth: e.target.checked }))}
                                />
                                Password
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={form.pubkeyAuth}
                                    onChange={(e) => setForm((prev) => ({ ...prev, pubkeyAuth: e.target.checked }))}
                                />
                                Public Key
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={form.keyboardInteractiveAuth}
                                    onChange={(e) =>
                                        setForm((prev) => ({ ...prev, keyboardInteractiveAuth: e.target.checked }))
                                    }
                                />
                                Keyboard Interactive
                            </label>
                        </div>
                    </div>

                    <div className="mt-5 flex gap-2">
                        <Button className="!px-3" onClick={handleTestConnection} disabled={testing}>
                            {testing ? "Testing..." : "Test Connection"}
                        </Button>
                        <Button className="green !px-4" onClick={handleSave} disabled={saving}>
                            {saving ? "Saving..." : "Save"}
                        </Button>
                        <Button
                            className="!px-3"
                            onClick={() =>
                                modalsModel.pushModal("MessageModal", {
                                    children:
                                        "Tip: You can still use 'Edit Connections' in dropdown for raw JSON editing.",
                                })
                            }
                        >
                            Help
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { ConnectionsManagerViewModel };
