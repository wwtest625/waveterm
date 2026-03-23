// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, getConnStatusAtom } from "@/store/global";
import { RpcApi } from "@/store/wshclientapi";
import { atom, useAtomValue } from "jotai";
import { type MouseEvent, useEffect, useMemo, useState } from "react";
import {
    buildConnectionHost,
    buildConnMetaFromForm,
    buildPasswordSecretName,
    ConnectionFormState,
    connectionMatchesQuery,
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

function AuthToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`rounded px-3 py-1.5 text-sm border transition-colors ${
                active
                    ? "bg-zinc-700 text-white border-zinc-600"
                    : "bg-panel text-secondary border-border hover:text-primary"
            }`}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

function ListActionButton({
    label,
    onClick,
    disabled,
    variant = "default",
}: {
    label: string;
    onClick: (e: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    variant?: "default" | "danger";
}) {
    const className =
        variant === "danger"
            ? "!h-[24px] !px-2 !text-xs !bg-red-500/10 !border-red-500/30 !text-red-300 hover:!bg-red-500/20"
            : "!h-[24px] !px-2 !text-xs";
    return (
        <Button className={className} onClick={onClick} disabled={disabled}>
            {label}
        </Button>
    );
}

function ConnectionListRow({
    host,
    meta,
    isSelected,
    latencyText,
    onSelect,
    onConnect,
    onMore,
}: {
    host: string;
    meta: ConnKeywords | undefined;
    isSelected: boolean;
    latencyText: string;
    onSelect: () => void;
    onConnect: (host: string) => void;
    onMore: (e: MouseEvent<HTMLButtonElement>, host: string) => void;
}) {
    const connStatus = useAtomValue(getConnStatusAtom(host));
    const group = (((meta as any)?.["display:group"] as string) ?? "").trim();
    const parsedHost = parseConnectionHost(host);
    const addressUser = meta?.["ssh:user"] ?? parsedHost.user;
    const addressHost = meta?.["ssh:hostname"] ?? parsedHost.hostname;
    const addressLabel = addressHost ? `${addressUser}@${addressHost}` : host;
    const isConnecting = connStatus?.status === "connecting";
    const displayLabel = meta?.["display:name"] || host;

    return (
        <div
            className={`flex items-center gap-2 rounded px-2 py-2 cursor-pointer border ${
                isSelected ? "bg-green-900/30 border-green-700" : "bg-panel border-transparent hover:border-border"
            }`}
            onClick={onSelect}
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="truncate text-sm">{displayLabel}</div>
                    <div className="shrink-0 text-[11px] text-secondary">{latencyText}</div>
                </div>
                <div className="truncate text-xs text-secondary">{addressLabel}</div>
                <div className="truncate text-[11px] text-secondary">{group === "" ? "Ungrouped" : group}</div>
            </div>
            <div className="w-[96px] shrink-0 flex justify-center">
                <ConnectionStatusBadge host={host} />
            </div>
            <div className="w-[88px] shrink-0 flex justify-center">
                <WshStatusBadge host={host} />
            </div>
            <div className="shrink-0 flex items-center gap-1">
                <ListActionButton
                    label={isConnecting ? "Connecting" : "Connect"}
                    disabled={isConnecting}
                    onClick={(e) => {
                        e.stopPropagation();
                        onConnect(host);
                    }}
                />
                <button
                    type="button"
                    className="h-[24px] w-[24px] shrink-0 rounded border border-border bg-panel text-secondary hover:text-primary hover:border-zinc-500"
                    onClick={(e) => onMore(e, host)}
                    aria-label="More actions"
                >
                    <i className="fa fa-ellipsis-h text-[11px]" />
                </button>
            </div>
        </div>
    );
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

function WshStatusBadge({ host }: { host: string }) {
    const connStatus = useAtomValue(getConnStatusAtom(host));
    const badge = getWshBadgeInfo(connStatus);
    return (
        <span className={`px-2 py-0.5 rounded border text-xs ${badge.className}`} title={badge.title}>
            {badge.label}
        </span>
    );
}

function getConnectionFailureGuidance(errorText: string): {
    summary: string;
    hints: string[];
    isHostKeyChanged: boolean;
} {
    const lowerError = errorText.toLowerCase();
    if (lowerError.includes("hostkey-changed") || lowerError.includes("remote host identification has changed")) {
        return {
            summary:
                "The server's SSH host key has changed. This could indicate a legitimate change (server reinstallation) or a security issue.",
            hints: [
                "If you recently reinstalled the server, click 'Update Key' to trust the new key.",
                "If you did not expect this change, it could be a security issue - do NOT update the key.",
                "The new key will be automatically trusted after updating.",
            ],
            isHostKeyChanged: true,
        };
    }
    if (lowerError.includes("unable to authenticate") || lowerError.includes("no supported methods remain")) {
        return {
            summary: "The server rejected the authentication methods offered by this connection.",
            hints: [
                "Verify SSH User and credentials.",
                "If password auth is disabled on the server, use Public Key or Keyboard Interactive.",
                "If using root, confirm server policy allows root SSH login.",
            ],
            isHostKeyChanged: false,
        };
    }
    if (lowerError.includes("connection refused")) {
        return {
            summary: "The server host was reached, but the SSH port refused the connection.",
            hints: ["Confirm SSH is running on the target host.", "Check the SSH port in this connection profile."],
            isHostKeyChanged: false,
        };
    }
    if (lowerError.includes("timed out") || lowerError.includes("timeout")) {
        return {
            summary: "The SSH test timed out before the server completed the handshake.",
            hints: [
                "Verify the host IP and port are correct.",
                "Check firewall, security group, and network ACL rules.",
            ],
            isHostKeyChanged: false,
        };
    }
    if (lowerError.includes("no route to host") || lowerError.includes("network is unreachable")) {
        return {
            summary: "WaveTerm could not reach the target network endpoint.",
            hints: ["Check routing/VPN settings and whether the host is reachable from this machine."],
            isHostKeyChanged: false,
        };
    }
    return {
        summary: "WaveTerm could not complete the requested operation for this connection.",
        hints: ["Review the technical details below for the exact server response."],
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
    const rawError = String(error ?? "Unknown error");
    const guidance = getConnectionFailureGuidance(rawError);
    const [updatingKey, setUpdatingKey] = useState(false);

    async function handleUpdateKey() {
        if (!attemptedHost) return;
        setUpdatingKey(true);
        try {
            await RpcApi.UpdateKnownHostKeyCommand(TabRpcClient, { host: attemptedHost });
            // Close the modal and retry connection
            modalsModel.popModal();
            if (onRetry) {
                onRetry();
            }
        } catch (e) {
            // Show error but keep modal open
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
                            <span className="uppercase tracking-wide text-[10px] text-secondary">Target</span>
                            <span className="truncate font-mono text-primary">{attemptedHost}</span>
                        </div>
                    )}
                </div>
                <div className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-secondary">Suggested checks</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-secondary">
                        {guidance.hints.map((hint) => (
                            <li key={hint}>{hint}</li>
                        ))}
                    </ul>
                </div>
                {guidance.isHostKeyChanged && attemptedHost && (
                    <div className="px-4 pb-3">
                        <Button className="!px-3" onClick={handleUpdateKey} disabled={updatingKey}>
                            {updatingKey ? "Updating..." : "Update Key"}
                        </Button>
                        <div className="mt-2 text-xs text-secondary">
                            This will remove the old host key and trust the new one.
                        </div>
                    </div>
                )}
                <div className="px-4 pb-4">
                    <div className="rounded-lg border border-border bg-black/30 p-3">
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-secondary">Technical details</div>
                        <pre className="m-0 whitespace-pre-wrap break-words text-xs leading-5 text-primary">
                            {rawError}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ConnectionsManagerView({ model }: ViewComponentProps<ConnectionsManagerViewModel>) {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [query, setQuery] = useState("");
    const [selectedHost, setSelectedHost] = useState<string>("");
    const [activeGroup, setActiveGroup] = useState<string>("All");
    const [form, setForm] = useState<ConnectionFormState>(makeBlankForm());
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [ensuringWsh, setEnsuringWsh] = useState(false);
    const [connectionsState, setConnectionsState] = useState<{ [key: string]: ConnKeywords }>({});
    const [latencyMap, setLatencyMap] = useState<Record<string, number | null>>({});
    const selectedConnStatus = useAtomValue(getConnStatusAtom(selectedHost));

    function showConnectionFailureModal(title: string, error: unknown, attemptedHost?: string | null) {
        modalsModel.pushModal("MessageModal", {
            children: <ConnectionFailureModalContent title={title} error={error} attemptedHost={attemptedHost} />,
        });
    }

    useEffect(() => {
        setConnectionsState(fullConfig?.connections ?? {});
    }, [fullConfig?.connections]);

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
        return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
    }, [connectionsState]);

    const filteredHosts = useMemo(() => {
        const sorted = sortConnectionHosts(connectionsState);
        return sorted.filter((host) => {
            const isHidden = !!connectionsState[host]?.["display:hidden"];
            if (isHidden) {
                return false;
            }
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

    async function persistForm(): Promise<string | null> {
        const isNewConnection = selectedHost === "__new__";
        const normalizedUser = normalizeConnectionUser(form.user);
        const derivedHost = buildConnectionHost(normalizedUser, form.hostname);
        const currentHost = selectedHost !== "__new__" ? selectedHost : form.host.trim();
        const host = isNewConnection ? derivedHost : currentHost || derivedHost;

        if (host === "") {
            modalsModel.pushModal("MessageModal", { children: "SSH Hostname is required before saving." });
            return null;
        }
        if (isNewConnection && connectionsState[host] && !connectionsState[host]?.["display:hidden"]) {
            modalsModel.pushModal("MessageModal", {
                children: `Connection "${host}" already exists. Change SSH Hostname before saving the copy.`,
            });
            return null;
        }

        let passwordSecretName = form.passwordSecretName.trim();
        const password = form.password;
        if (form.passwordAuth && password.trim() !== "") {
            passwordSecretName = passwordSecretName || buildPasswordSecretName(host);
            await RpcApi.SetSecretsCommand(TabRpcClient, {
                [passwordSecretName]: password,
            });
        }

        const nextForm: ConnectionFormState = {
            ...form,
            host,
            user: normalizedUser,
            password: "",
            passwordSecretName,
            hasStoredPassword: passwordSecretName !== "",
        };
        const metaMap = buildConnMetaFromForm(nextForm);
        metaMap["display:hidden"] = false;
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
        } catch (e) {
            showConnectionFailureModal("Connect failed", e, host);
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
            children: "Connection copied to a new draft. Modify SSH Hostname if needed, then click Save.",
        });
    }

    async function handleSoftDelete(host: string) {
        if (!window.confirm(`Hide connection "${host}" from the list?`)) {
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
            showConnectionFailureModal("Delete failed", e, host);
        }
    }

    function handleMoreActions(e: MouseEvent<HTMLButtonElement>, host: string) {
        ContextMenuModel.getInstance().showContextMenu(
            [
                {
                    label: "Copy",
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
                    label: "Delete",
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
        } catch (e) {
            showConnectionFailureModal("Save failed", e);
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
        } catch (e) {
            showConnectionFailureModal("Connection test failed", e, attemptedHost);
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
        } catch (e) {
            showConnectionFailureModal("WSH setup failed", e, attemptedHost);
        } finally {
            setEnsuringWsh(false);
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
                            <div className="flex items-center gap-2 text-[11px] text-secondary px-2 py-1">
                                <div className="flex-1 min-w-0">Name / Address / Group</div>
                                <div className="w-[96px] shrink-0 text-center">Status</div>
                                <div className="w-[88px] shrink-0 text-center">WSH</div>
                                <div className="shrink-0 w-[96px] text-left">Actions</div>
                            </div>
                            {filteredHosts.map((host) => {
                                const meta = connectionsState[host];
                                const isSelected = selectedHost === host;
                                const latency = latencyMap[host];
                                const latencyText = latency == null ? "-" : `${latency} ms`;
                                return (
                                    <ConnectionListRow
                                        key={host}
                                        host={host}
                                        meta={meta}
                                        isSelected={isSelected}
                                        latencyText={latencyText}
                                        onSelect={() => setSelectedHost(host)}
                                        onConnect={(nextHost) => void handleConnect(nextHost)}
                                        onMore={handleMoreActions}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-auto">
                <div className="max-w-[820px] p-4">
                    <div className="text-lg font-semibold mb-3">Connections Manager</div>
                    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-3 items-start">
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

                        <div className="text-secondary text-sm">SSH User</div>
                        <input
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                            value={form.user}
                            onChange={(e) => setForm((prev) => ({ ...prev, user: e.target.value }))}
                            placeholder="root"
                        />

                        <div className="text-secondary text-sm">SSH Hostname / Port</div>
                        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                            <input
                                className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                                value={form.hostname}
                                onChange={(e) => setForm((prev) => ({ ...prev, hostname: e.target.value }))}
                                placeholder="192.168.2.9"
                            />
                            <input
                                className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                                value={form.port}
                                onChange={(e) => setForm((prev) => ({ ...prev, port: e.target.value }))}
                                placeholder="22"
                            />
                        </div>

                        <div className="text-secondary text-sm">Auth</div>
                        <div className="flex flex-wrap gap-2">
                            <AuthToggle
                                label="Password"
                                active={form.passwordAuth}
                                onClick={() => setForm((prev) => ({ ...prev, passwordAuth: !prev.passwordAuth }))}
                            />
                            <AuthToggle
                                label="Public Key"
                                active={form.pubkeyAuth}
                                onClick={() => setForm((prev) => ({ ...prev, pubkeyAuth: !prev.pubkeyAuth }))}
                            />
                            <AuthToggle
                                label="Keyboard Interactive"
                                active={form.keyboardInteractiveAuth}
                                onClick={() =>
                                    setForm((prev) => ({
                                        ...prev,
                                        keyboardInteractiveAuth: !prev.keyboardInteractiveAuth,
                                    }))
                                }
                            />
                        </div>

                        {form.passwordAuth && (
                            <>
                                <div className="text-secondary text-sm pt-2">Password</div>
                                <div>
                                    <input
                                        type="password"
                                        className="w-full rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none"
                                        value={form.password}
                                        onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                                        placeholder={
                                            form.hasStoredPassword
                                                ? "Leave blank to keep the saved password"
                                                : "Stored securely in Wave's secret store"
                                        }
                                    />
                                    {form.hasStoredPassword && form.password === "" && (
                                        <div className="mt-1 text-[11px] text-secondary">
                                            A password is already stored for this connection.
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        <div className="text-secondary text-sm pt-2">Remark</div>
                        <textarea
                            className="rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none min-h-[88px]"
                            value={form.remark}
                            onChange={(e) => setForm((prev) => ({ ...prev, remark: e.target.value }))}
                            placeholder="Host purpose, ownership, notes..."
                        />
                    </div>

                    <div className="mt-5 flex gap-2">
                        <Button className="!px-3" onClick={handleTestConnection} disabled={testing}>
                            {testing ? "Testing..." : "Test Connection"}
                        </Button>
                        <Button className="green !px-4" onClick={handleSave} disabled={saving}>
                            {saving ? "Saving..." : "Save"}
                        </Button>
                        <Button className="!px-3" onClick={handleEnsureWsh} disabled={ensuringWsh}>
                            {ensuringWsh ? "Setting up WSH..." : getEnsureWshButtonLabel(selectedConnStatus)}
                        </Button>
                        <Button
                            className="!px-3"
                            onClick={() =>
                                modalsModel.pushModal("MessageModal", {
                                    children:
                                        "Tip: Passwords are saved to Wave's secret store. You can still use 'Edit Connections' for raw JSON editing.",
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
