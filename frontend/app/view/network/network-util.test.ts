// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    deriveNetworkModel,
    getDisplayInterfaceName,
    getDiagnosticTone,
    getInterfaceActionErrorHeadline,
    getInterfaceRole,
    getNetworkErrorHeadline,
    getOverviewTone,
    networkStatusBadgeClass,
} from "./network-util";

test("deriveNetworkModel prioritizes the default route interface as primary", () => {
    const response = {
        interfaces: [
            { name: "docker0", type: "virtual", status: "up", ipv4: "172.17.0.1" },
            { name: "eth0", type: "wired", status: "up", ipv4: "192.168.1.50" },
            { name: "wlan0", type: "wireless", status: "down", ipv4: "" },
        ],
        defaultRouteInterface: "eth0",
        defaultGateway: "192.168.1.1",
        dnsServers: ["1.1.1.1"],
    } as NetworkListResponse;

    const model = deriveNetworkModel(response);

    assert.equal(model.primaryInterface?.name, "eth0");
    assert.equal(model.overviewStatus, "healthy");
    assert.equal(model.activeInterfaces.map((iface) => iface.name).join(","), "eth0");
    assert.equal(model.virtualInterfaces.map((iface) => iface.name).join(","), "docker0");
    assert.equal(model.diagnostics.length, 0);
});

test("deriveNetworkModel marks missing gateway as limited", () => {
    const response = {
        interfaces: [
            { name: "eth0", type: "wired", status: "up", ipv4: "10.0.0.20" },
            { name: "wlan0", type: "wireless", status: "up", ipv4: "" },
        ],
        defaultRouteInterface: "",
        defaultGateway: "",
        dnsServers: ["8.8.8.8"],
    } as NetworkListResponse;

    const model = deriveNetworkModel(response);

    assert.equal(model.overviewStatus, "limited");
    assert.match(model.overviewText, /默认网关/);
    assert.equal(getInterfaceRole(response.interfaces[0], model.primaryInterface?.name), "primary");
    assert.ok(model.diagnostics.some((item) => item.id === "missing-gateway"));
    assert.ok(model.diagnostics.some((item) => item.id === "missing-ip:wlan0"));
});

test("networkStatusBadgeClass maps tones and error headline stays friendly", () => {
    assert.match(networkStatusBadgeClass("up"), /emerald/);
    assert.match(networkStatusBadgeClass("down"), /amber/);
    assert.match(getDiagnosticTone("warning"), /amber/);
    assert.match(getOverviewTone("healthy"), /emerald/);
    assert.equal(getDisplayInterfaceName({ name: "eth0", displayName: "NVIDIA ConnectX" } as NetworkInterfaceSummary), "NVIDIA ConnectX");
    assert.equal(
        getInterfaceActionErrorHeadline({ code: "permission_denied", message: "nope" } as NetworkError),
        "当前连接没有修改网卡的权限。"
    );
    assert.equal(
        getNetworkErrorHeadline({ code: "missing_cli", message: "missing ip" } as NetworkError),
        "当前连接缺少网络命令，无法读取接口信息。"
    );
});
