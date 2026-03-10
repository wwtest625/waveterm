// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const RemoteFilesUnavailableStatus = "Remote Files Unavailable";

function getWshDetail(connStatus: ConnStatus | null | undefined): string {
    return connStatus?.wsherror || connStatus?.nowshreason || "";
}

function isRemoteConnectionName(connName?: string | null): boolean {
    if (!connName) {
        return false;
    }
    return connName !== "local" && !connName.startsWith("local:") && !connName.startsWith("wsl://");
}

function hasMissingConnRoute(errorText: string, connName?: string | null): boolean {
    if (!connName) {
        return false;
    }
    return (
        errorText.includes(`no route for \"conn:${connName}\"`) ||
        errorText.includes(`no route for 'conn:${connName}'`) ||
        errorText.includes(`no route for conn:${connName}`)
    );
}

export function buildRemoteFileError(
    error: unknown,
    connStatus: ConnStatus | null | undefined,
    connName: string | null | undefined,
    fallbackStatus = "File Read Failed"
): ErrorMsg {
    const errorText = `${error}`;
    const missingConnRoute = hasMissingConnRoute(errorText, connName);
    const missingWsh = connStatus?.status === "connected" && (!connStatus?.wshenabled || missingConnRoute);
    if (isRemoteConnectionName(connName) && missingWsh) {
        const wshDetail = getWshDetail(connStatus);
        const detail = wshDetail ? ` ${wshDetail}` : "";
        return {
            status: RemoteFilesUnavailableStatus,
            text: `SSH is connected, but remote Files/Preview requires wsh on this connection.${detail}`,
        };
    }
    return {
        status: fallbackStatus,
        text: errorText,
    };
}
