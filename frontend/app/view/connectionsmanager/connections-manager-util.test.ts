// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    buildConnMetaFromForm,
    connectionMatchesQuery,
    makeConnectionFormFromConfig,
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
        "ssh:user": "root",
        "ssh:hostname": "192.168.1.10",
        "ssh:port": "22",
        "ssh:passwordauthentication": true,
        "ssh:pubkeyauthentication": false,
    });

    assert.equal(form.host, "root@192.168.1.10");
    assert.equal(form.displayName, "Prod");
    assert.equal(form.user, "root");
    assert.equal(form.hostname, "192.168.1.10");
    assert.equal(form.port, "22");
    assert.equal(form.passwordAuth, true);
    assert.equal(form.pubkeyAuth, false);
});

test("buildConnMetaFromForm trims strings and omits empty string fields", () => {
    const meta = buildConnMetaFromForm({
        host: "root@prod",
        displayName: "  Prod  ",
        user: " root ",
        hostname: " 192.168.1.10 ",
        port: " 22 ",
        passwordAuth: true,
        pubkeyAuth: false,
        keyboardInteractiveAuth: false,
    });

    assert.equal(meta["display:name"], "Prod");
    assert.equal(meta["ssh:user"], "root");
    assert.equal(meta["ssh:hostname"], "192.168.1.10");
    assert.equal(meta["ssh:port"], "22");
    assert.equal(meta["ssh:passwordauthentication"], true);
    assert.equal(meta["ssh:pubkeyauthentication"], false);
});
