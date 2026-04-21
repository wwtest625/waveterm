// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type ConnectionFormState = {
    host: string;
    displayName: string;
    group: string;
    remark: string;
    user: string;
    hostname: string;
    port: string;
    password: string;
    passwordSecretName: string;
    hasStoredPassword: boolean;
    passwordAuth: boolean;
    pubkeyAuth: boolean;
    keyboardInteractiveAuth: boolean;
};

export type ParsedConnectionHost = {
    user: string;
    hostname: string;
};

export function sortConnectionHosts(connections: {[key: string]: ConnKeywords}): string[] {
    return Object.keys(connections ?? {}).sort((a, b) => {
        const aOrder = connections?.[a]?.["display:order"] ?? 0;
        const bOrder = connections?.[b]?.["display:order"] ?? 0;
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }
        return a.localeCompare(b);
    });
}

export function connectionMatchesQuery(host: string, meta: ConnKeywords | undefined, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return true;
    }
    const parsedHost = parseConnectionHost(host);
    const fields = [
        host,
        meta?.["display:name"],
        meta?.["ssh:user"] ?? parsedHost.user,
        meta?.["ssh:hostname"] ?? parsedHost.hostname,
        meta?.["ssh:port"],
    ];
    return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

export function parseConnectionHost(host: string): ParsedConnectionHost {
    const trimmedHost = host.trim();
    if (trimmedHost === "") {
        return { user: "root", hostname: "" };
    }
    const atIndex = trimmedHost.indexOf("@");
    if (atIndex <= 0 || atIndex === trimmedHost.length - 1) {
        return { user: "root", hostname: trimmedHost };
    }
    return {
        user: trimmedHost.slice(0, atIndex).trim() || "root",
        hostname: trimmedHost.slice(atIndex + 1).trim(),
    };
}

export function normalizeConnectionUser(user: string): string {
    const trimmedUser = user.trim();
    return trimmedUser === "" ? "root" : trimmedUser;
}

export function buildConnectionHost(user: string, hostname: string): string {
    const normalizedUser = normalizeConnectionUser(user);
    const trimmedHostname = hostname.trim();
    if (trimmedHostname === "") {
        return "";
    }
    return `${normalizedUser}@${trimmedHostname}`;
}

export function buildPasswordSecretName(host: string): string {
    const sanitized = host
        .trim()
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    return `SSH_PASSWORD_${sanitized || "CONNECTION"}`;
}

export function makeConnectionFormFromConfig(host: string, meta: ConnKeywords | undefined): ConnectionFormState {
    const metaAny = (meta ?? {}) as Record<string, any>;
    const parsedHost = parseConnectionHost(host ?? "");
    const passwordSecretName = meta?.["ssh:passwordsecretname"] ?? "";
    return {
        host: host ?? "",
        displayName: meta?.["display:name"] ?? "",
        group: (metaAny["display:group"] as string) ?? "",
        remark: (metaAny["display:description"] as string) ?? "",
        user: meta?.["ssh:user"] ?? parsedHost.user,
        hostname: meta?.["ssh:hostname"] ?? parsedHost.hostname,
        port: meta?.["ssh:port"] ?? "22",
        password: "",
        passwordSecretName: passwordSecretName,
        hasStoredPassword: passwordSecretName !== "",
        passwordAuth: meta?.["ssh:passwordauthentication"] ?? false,
        pubkeyAuth: meta?.["ssh:pubkeyauthentication"] ?? true,
        keyboardInteractiveAuth: meta?.["ssh:kbdinteractiveauthentication"] ?? false,
    };
}

export function buildConnMetaFromForm(form: ConnectionFormState): {[key: string]: any} {
    const trim = (v: string) => v.trim();
    const meta: {[key: string]: any} = {};
    const displayName = trim(form.displayName);
    const group = trim(form.group);
    const remark = trim(form.remark);
    const user = normalizeConnectionUser(form.user);
    const hostname = trim(form.hostname);
    const port = trim(form.port);
    const passwordSecretName = trim(form.passwordSecretName);

    if (displayName !== "") meta["display:name"] = displayName;
    if (group !== "") meta["display:group"] = group;
    if (remark !== "") meta["display:description"] = remark;
    if (user !== "") meta["ssh:user"] = user;
    if (hostname !== "") meta["ssh:hostname"] = hostname;
    if (port !== "") meta["ssh:port"] = port;
    if (passwordSecretName !== "") meta["ssh:passwordsecretname"] = passwordSecretName;
    meta["ssh:passwordauthentication"] = !!form.passwordAuth;
    meta["ssh:pubkeyauthentication"] = !!form.pubkeyAuth;
    meta["ssh:kbdinteractiveauthentication"] = !!form.keyboardInteractiveAuth;
    return meta;
}

export function shouldReinstallWsh(connStatus: ConnStatus | null | undefined): boolean {
    return connStatus?.status === "connected" && !connStatus?.wshenabled;
}

export function getEnsureWshButtonLabel(connStatus: ConnStatus | null | undefined): string {
    return shouldReinstallWsh(connStatus) ? "安装 WSH" : "确保 WSH";
}

export type WshBadgeInfo = {
    label: string;
    className: string;
    title: string;
};

export function getWshBadgeInfo(connStatus: ConnStatus | null | undefined): WshBadgeInfo {
    if (!connStatus || connStatus.status === "disconnected") {
        return {
            label: "-",
            className: "text-secondary border-border",
            title: "连接激活前 WSH 状态不可用",
        };
    }
    if (connStatus.status === "connecting") {
        return {
            label: "...",
            className: "text-yellow-300 border-yellow-600",
            title: "正在建立连接时检查 WSH",
        };
    }
    if (connStatus.wshenabled) {
        const versionText = connStatus.wshversion ? ` (${connStatus.wshversion})` : "";
        return {
            label: "就绪",
            className: "text-green-400 border-green-600",
            title: `WSH 可用${versionText}`,
        };
    }
    const detail = connStatus.wsherror || connStatus.nowshreason || "此连接上 WSH 不可用";
    const isDisabled = detail.includes("conn:wshenabled set to false");
    return {
        label: isDisabled ? "已禁用" : "缺失",
        className: isDisabled ? "text-yellow-300 border-yellow-600" : "text-red-400 border-red-600",
        title: detail,
    };
}

export type ConnStatusBadgeInfo = {
    label: string;
    className: string;
};

export function getConnStatusBadgeInfo(connStatus: ConnStatus | null | undefined): ConnStatusBadgeInfo {
    if (connStatus?.status === "connected") {
        return { label: "已连接", className: "text-green-400 border-green-600" };
    }
    if (connStatus?.status === "connecting") {
        return { label: "连接中", className: "text-yellow-300 border-yellow-600" };
    }
    if (connStatus?.status === "error") {
        return { label: "错误", className: "text-red-400 border-red-600" };
    }
    return { label: "未连接", className: "text-secondary border-border" };
}
