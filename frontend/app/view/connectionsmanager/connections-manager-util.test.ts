// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    buildConnectionHost,
    buildPasswordSecretName,
    buildConnMetaFromForm,
    connectionMatchesQuery,
    getEnsureWshButtonLabel,
    getWshBadgeInfo,
    makeConnectionFormFromConfig,
    parseConnectionHost,
    shouldReinstallWsh,
    sortConnectionHosts,
} from "./connections-manager-util";

test("sortConnectionHosts sorts by display order then host name", () => {
    const connections: {[key: string]: ConnKeywords} = {
        "root@z-host": { "display:order": 10 },
        "root@a-host": { "display:order": 1 },
        "root@b-host": { "display:order": 1 },
    };

    const result = sortConnectionHosts(connections);
    assert.deepEqual(result, ["root@a-host", "root@b-host", "root@z-host"]);
});

test("connectionMatchesQuery checks host and key fields", () => {
    const meta: ConnKeywords = {
        "display:name": "Production API",
        "ssh:user": "root",
        "ssh:hostname": "192.168.1.10",
    };
    assert.equal(connectionMatchesQuery("root@prod", meta, "prod"), true);
    assert.equal(connectionMatchesQuery("root@prod", meta, "192.168"), true);
    assert.equal(connectionMatchesQuery("root@prod", meta, "staging"), false);
});

test("makeConnectionFormFromConfig maps existing config to form state", () => {
    const form = makeConnectionFormFromConfig("root@192.168.1.10", {
        "display:name": "Prod",
        "display:group": "Production",
        "display:description": "Main API host",
        "ssh:user": "root",
        "ssh:hostname": "192.168.1.10",
        "ssh:port": "22",
        "ssh:passwordauthentication": true,
        "ssh:pubkeyauthentication": false,
    });

    assert.equal(form.host, "root@192.168.1.10");
    assert.equal(form.displayName, "Prod");
    assert.equal(form.group, "Production");
    assert.equal(form.remark, "Main API host");
    assert.equal(form.user, "root");
    assert.equal(form.hostname, "192.168.1.10");
    assert.equal(form.port, "22");
    assert.equal(form.passwordSecretName, "");
    assert.equal(form.hasStoredPassword, false);
    assert.equal(form.passwordAuth, true);
    assert.equal(form.pubkeyAuth, false);
});

test("buildConnMetaFromForm trims strings and omits empty string fields", () => {
    const meta = buildConnMetaFromForm({
        host: "root@prod",
        displayName: "  Prod  ",
        group: "  Production  ",
        remark: "  Main host  ",
        user: " root ",
        hostname: " 192.168.1.10 ",
        port: " 22 ",
        password: "super-secret",
        passwordSecretName: " SSH_PASSWORD_ROOT_192_168_1_10 ",
        hasStoredPassword: true,
        passwordAuth: true,
        pubkeyAuth: false,
        keyboardInteractiveAuth: false,
    });

    assert.equal(meta["display:name"], "Prod");
    assert.equal(meta["display:group"], "Production");
    assert.equal(meta["display:description"], "Main host");
    assert.equal(meta["ssh:user"], "root");
    assert.equal(meta["ssh:hostname"], "192.168.1.10");
    assert.equal(meta["ssh:port"], "22");
    assert.equal(meta["ssh:passwordsecretname"], "SSH_PASSWORD_ROOT_192_168_1_10");
    assert.equal(meta["ssh:passwordauthentication"], true);
    assert.equal(meta["ssh:pubkeyauthentication"], false);
});

test("parseConnectionHost falls back to root and raw hostname", () => {
    assert.deepEqual(parseConnectionHost("root@192.168.1.10"), {
        user: "root",
        hostname: "192.168.1.10",
    });
    assert.deepEqual(parseConnectionHost("prod-alias"), {
        user: "root",
        hostname: "prod-alias",
    });
});

test("buildConnectionHost and buildPasswordSecretName normalize values", () => {
    assert.equal(buildConnectionHost("", " 192.168.1.10 "), "root@192.168.1.10");
    assert.equal(buildPasswordSecretName("root@192.168.1.10"), "SSH_PASSWORD_ROOT_192_168_1_10");
});

test("shouldReinstallWsh only returns true for connected nowsh connections", () => {
    assert.equal(shouldReinstallWsh({ status: "connected", wshenabled: false } as ConnStatus), true);
    assert.equal(shouldReinstallWsh({ status: "connected", wshenabled: true } as ConnStatus), false);
    assert.equal(shouldReinstallWsh({ status: "disconnected", wshenabled: false } as ConnStatus), false);
});

test("getEnsureWshButtonLabel matches connection state", () => {
    assert.equal(getEnsureWshButtonLabel({ status: "connected", wshenabled: false } as ConnStatus), "安装 WSH");
    assert.equal(getEnsureWshButtonLabel({ status: "connected", wshenabled: true } as ConnStatus), "确保 WSH");
    assert.equal(getEnsureWshButtonLabel(null), "确保 WSH");
});

test("getWshBadgeInfo reports ready state with version", () => {
    const badge = getWshBadgeInfo({
        status: "connected",
        wshenabled: true,
        wshversion: "wsh v0.14.1",
    } as ConnStatus);
    assert.equal(badge.label, "就绪");
    assert.match(badge.title, /0\.14\.1/);
});

test("getWshBadgeInfo reports disabled and missing states", () => {
    const disabled = getWshBadgeInfo({
        status: "connected",
        wshenabled: false,
        nowshreason: "conn:wshenabled set to false",
    } as ConnStatus);
    assert.equal(disabled.label, "已禁用");

    const missing = getWshBadgeInfo({
        status: "connected",
        wshenabled: false,
        wsherror: "error installing wsh/connserver",
    } as ConnStatus);
    assert.equal(missing.label, "缺失");
});
