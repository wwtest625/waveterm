// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { sortConnectionHosts } from "@/app/view/connectionsmanager/connections-manager-util";

const WslPrefix = "wsl://";

function isRemoteConnectionName(connName?: string | null): boolean {
    if (!connName) {
        return false;
    }
    return connName !== "local" && !connName.startsWith("local:") && !connName.startsWith(WslPrefix);
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
    const connectionsMap: {[key: string]: ConnKeywords} = {};
    for (const conn of remoteConnections) {
        connectionsMap[conn] = fullConfig?.connections?.[conn] ?? {};
    }
    return sortConnectionHosts(connectionsMap);
}