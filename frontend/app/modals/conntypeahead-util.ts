// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const WslPrefix = "wsl://";

function isRemoteConnectionName(connName?: string | null): boolean {
    if (!connName) {
        return false;
    }
    return connName !== "local" && !connName.startsWith("local:") && !connName.startsWith(WslPrefix);
}

function sortRemoteConnectionNames(a: string, b: string, fullConfig?: FullConfigType | null): number {
    const connectionsConfig = fullConfig?.connections;
    const aOrder = connectionsConfig?.[a]?.["display:order"] ?? 0;
    const bOrder = connectionsConfig?.[b]?.["display:order"] ?? 0;
    if (aOrder !== bOrder) {
        return aOrder - bOrder;
    }
    return a.localeCompare(b);
}

function shouldIncludeAdhocConnection(connStatus?: ConnStatus | null): boolean {
    if (!isRemoteConnectionName(connStatus?.connection)) {
        return false;
    }
    return connStatus?.connected || connStatus?.activeconnnum > 0 || connStatus?.status === "connecting";
}

export function getRemoteConnectionNames(
    fullConfig: FullConfigType | null | undefined,
    allConnStatus: ConnStatus[] | null | undefined,
    currentConnection?: string | null
): string[] {
    const remoteConnections = new Set(Object.keys(fullConfig?.connections ?? {}));
    if (isRemoteConnectionName(currentConnection)) {
        remoteConnections.add(currentConnection);
    }
    for (const connStatus of allConnStatus ?? []) {
        if (shouldIncludeAdhocConnection(connStatus)) {
            remoteConnections.add(connStatus.connection);
        }
    }
    return Array.from(remoteConnections).sort((a, b) => sortRemoteConnectionNames(a, b, fullConfig));
}