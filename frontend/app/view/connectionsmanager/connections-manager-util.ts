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
    passwordAuth: boolean;
    pubkeyAuth: boolean;
    keyboardInteractiveAuth: boolean;
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
    const fields = [host, meta?.["display:name"], meta?.["ssh:user"], meta?.["ssh:hostname"], meta?.["ssh:port"]];
    return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

export function makeConnectionFormFromConfig(host: string, meta: ConnKeywords | undefined): ConnectionFormState {
    const metaAny = (meta ?? {}) as Record<string, any>;
    return {
        host: host ?? "",
        displayName: meta?.["display:name"] ?? "",
        group: (metaAny["display:group"] as string) ?? "",
        remark: (metaAny["display:description"] as string) ?? "",
        user: meta?.["ssh:user"] ?? "",
        hostname: meta?.["ssh:hostname"] ?? "",
        port: meta?.["ssh:port"] ?? "",
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
    const user = trim(form.user);
    const hostname = trim(form.hostname);
    const port = trim(form.port);

    if (displayName !== "") meta["display:name"] = displayName;
    if (group !== "") meta["display:group"] = group;
    if (remark !== "") meta["display:description"] = remark;
    if (user !== "") meta["ssh:user"] = user;
    if (hostname !== "") meta["ssh:hostname"] = hostname;
    if (port !== "") meta["ssh:port"] = port;
    meta["ssh:passwordauthentication"] = !!form.passwordAuth;
    meta["ssh:pubkeyauthentication"] = !!form.pubkeyAuth;
    meta["ssh:kbdinteractiveauthentication"] = !!form.keyboardInteractiveAuth;
    return meta;
}
