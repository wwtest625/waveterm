// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type NetworkOverviewStatus = "healthy" | "limited" | "offline";
export type NetworkRole = "primary" | "active" | "virtual" | "idle";
export type NetworkDiagnosticSeverity = "warning" | "info";

export interface NetworkDiagnostic {
    id: string;
    severity: NetworkDiagnosticSeverity;
    message: string;
    interfaceName?: string;
}

export interface DerivedNetworkModel {
    primaryInterface: NetworkInterfaceSummary | null;
    overviewStatus: NetworkOverviewStatus;
    overviewText: string;
    dnsStatusText: string;
    diagnostics: NetworkDiagnostic[];
    activeInterfaces: NetworkInterfaceSummary[];
    otherInterfaces: NetworkInterfaceSummary[];
    virtualInterfaces: NetworkInterfaceSummary[];
}

export function getDisplayInterfaceName(iface?: NetworkInterfaceSummary | null): string {
    if (!iface) {
        return "";
    }
    return (iface.displayName ?? "").trim() || iface.name;
}

export function getNetworkErrorHeadline(error?: NetworkError | null): string {
    switch (error?.code) {
        case "missing_cli":
            return "当前连接缺少网络命令，无法读取接口信息。";
        case "connection_unavailable":
            return "当前连接不可用，暂时无法读取网络状态。";
        default:
            return error?.message ?? "加载网络数据失败。";
    }
}

export function networkStatusLabel(status?: string): string {
    switch ((status ?? "").trim().toLowerCase()) {
        case "up":
            return "已连接";
        case "down":
            return "未连接";
        case "disabled":
            return "已禁用";
        default:
            return "未知";
    }
}

export function networkStatusBadgeClass(status?: string): string {
    switch ((status ?? "").trim().toLowerCase()) {
        case "up":
            return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
        case "down":
            return "border-amber-500/40 bg-amber-500/10 text-amber-200";
        case "disabled":
            return "border-zinc-600 bg-zinc-800/80 text-zinc-300";
        default:
            return "border-zinc-600 bg-zinc-800/80 text-zinc-300";
    }
}

export function interfaceTypeLabel(type?: string): string {
    switch ((type ?? "").trim().toLowerCase()) {
        case "wired":
            return "有线";
        case "wireless":
            return "无线";
        case "virtual":
            return "虚拟";
        default:
            return "其他";
    }
}

export function getInterfaceActionErrorHeadline(error?: NetworkError | null): string {
    switch (error?.code) {
        case "permission_denied":
            return "当前连接没有修改网卡的权限。";
        case "not_found":
            return "没有找到对应网卡。";
        case "unsupported_dns":
            return "当前系统不支持直接改 DNS，这次只建议先改 IP 和网关。";
        default:
            return error?.message ?? "网卡操作失败。";
    }
}

export function interfaceTypeIcon(type?: string): string {
    switch ((type ?? "").trim().toLowerCase()) {
        case "wired":
            return "fa-network-wired";
        case "wireless":
            return "fa-wifi";
        case "virtual":
            return "fa-diagram-project";
        default:
            return "fa-ethernet";
    }
}

export function deriveNetworkModel(response: NetworkListResponse): DerivedNetworkModel {
    const interfaces = response.interfaces ?? [];
    const primaryInterface = findPrimaryInterface(interfaces, response.defaultRouteInterface);
    const dnsConfigured = (response.dnsServers ?? []).length > 0;
    const gatewayConfigured = (response.defaultGateway ?? "").trim() !== "";

    const activeInterfaces = interfaces.filter((iface) => isActiveInterface(iface, primaryInterface?.name));
    const otherInterfaces = interfaces.filter(
        (iface) => !isVirtualInterface(iface) && !isActiveInterface(iface, primaryInterface?.name)
    );
    const virtualInterfaces = interfaces.filter((iface) => isVirtualInterface(iface));

    let overviewStatus: NetworkOverviewStatus = "offline";
    let overviewText = "当前网络离线";
    if (primaryInterface && primaryInterface.ipv4) {
        if (gatewayConfigured && dnsConfigured) {
            overviewStatus = "healthy";
            overviewText = `当前网络正常，主连接为 ${primaryInterface.name}`;
        } else {
            overviewStatus = "limited";
            overviewText = gatewayConfigured ? "当前网络受限，DNS 未配置" : "当前网络受限，未检测到默认网关";
        }
    } else if (activeInterfaces.length > 0) {
        overviewStatus = "limited";
        overviewText = "接口在线，但尚未拿到完整网络配置";
    }

    const diagnostics = buildDiagnostics({
        interfaces,
        primaryInterface,
        activeInterfaces,
        gatewayConfigured,
        dnsConfigured,
    });

    return {
        primaryInterface,
        overviewStatus,
        overviewText,
        dnsStatusText: dnsConfigured ? "正常" : "未配置",
        diagnostics,
        activeInterfaces,
        otherInterfaces,
        virtualInterfaces,
    };
}

export function getInterfaceRole(iface: NetworkInterfaceSummary, primaryInterfaceName?: string): NetworkRole {
    if (iface.name === primaryInterfaceName) {
        return "primary";
    }
    if (isVirtualInterface(iface)) {
        return "virtual";
    }
    if ((iface.status ?? "").toLowerCase() === "up" && ((iface.ipv4 ?? "") !== "" || (iface.ipv6 ?? "") !== "")) {
        return "active";
    }
    return "idle";
}

export function getInterfaceRoleLabel(role: NetworkRole): string {
    switch (role) {
        case "primary":
            return "主连接";
        case "active":
            return "活动";
        case "virtual":
            return "虚拟";
        default:
            return "待机";
    }
}

export function getDiagnosticTone(severity: NetworkDiagnosticSeverity): string {
    if (severity === "warning") {
        return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    }
    return "border-sky-500/30 bg-sky-500/10 text-sky-100";
}

export function getOverviewTone(status: NetworkOverviewStatus): string {
    if (status === "healthy") {
        return "border-emerald-500/20";
    }
    if (status === "limited") {
        return "border-amber-500/20";
    }
    return "border-zinc-800";
}

type DiagnosticInput = {
    interfaces: NetworkInterfaceSummary[];
    primaryInterface: NetworkInterfaceSummary | null;
    activeInterfaces: NetworkInterfaceSummary[];
    gatewayConfigured: boolean;
    dnsConfigured: boolean;
};

function buildDiagnostics(input: DiagnosticInput): NetworkDiagnostic[] {
    const diagnostics: NetworkDiagnostic[] = [];
    const { interfaces, primaryInterface, activeInterfaces, gatewayConfigured, dnsConfigured } = input;

    if (primaryInterface && !gatewayConfigured) {
        diagnostics.push({
            id: "missing-gateway",
            severity: "warning",
            interfaceName: primaryInterface.name,
            message: "主连接已拿到地址，但没有默认网关。",
        });
    }

    if (primaryInterface && !dnsConfigured) {
        diagnostics.push({
            id: "missing-dns",
            severity: "warning",
            interfaceName: primaryInterface.name,
            message: "已检测到主连接，但系统没有配置 DNS。",
        });
    }

    for (const iface of interfaces) {
        const status = (iface.status ?? "").toLowerCase();
        const hasIp = ((iface.ipv4 ?? "").trim() !== "") || ((iface.ipv6 ?? "").trim() !== "");
        if (status === "up" && !hasIp && !isVirtualInterface(iface)) {
            diagnostics.push({
                id: `missing-ip:${iface.name}`,
                severity: "warning",
                interfaceName: iface.name,
                message: `${iface.name} 已连接，但没有分配地址。`,
            });
        }
    }

    if (activeInterfaces.length > 1) {
        diagnostics.push({
            id: "multiple-active",
            severity: "info",
            message: `当前存在 ${activeInterfaces.length} 个活动接口，请留意默认出口是否符合预期。`,
        });
    }

    const virtualCount = interfaces.filter((iface) => isVirtualInterface(iface)).length;
    if (virtualCount >= 5) {
        diagnostics.push({
            id: "virtual-noise",
            severity: "info",
            message: `当前存在 ${virtualCount} 个虚拟接口，真实出口已被单独置顶。`,
        });
    }

    if (!primaryInterface && interfaces.length > 0) {
        diagnostics.push({
            id: "no-primary",
            severity: "warning",
            message: "没有识别到可用主连接，请检查物理接口状态。",
        });
    }

    return diagnostics;
}

function findPrimaryInterface(
    interfaces: NetworkInterfaceSummary[],
    defaultRouteInterface?: string | null
): NetworkInterfaceSummary | null {
    const preferredName = (defaultRouteInterface ?? "").trim();
    if (preferredName !== "") {
        const matched = interfaces.find((iface) => iface.name === preferredName);
        if (matched) {
            return matched;
        }
    }
    return (
        interfaces.find(
            (iface) =>
                !isVirtualInterface(iface) &&
                (iface.status ?? "").toLowerCase() === "up" &&
                (((iface.ipv4 ?? "").trim() !== "") || ((iface.ipv6 ?? "").trim() !== ""))
        ) ?? null
    );
}

function isVirtualInterface(iface: NetworkInterfaceSummary): boolean {
    return (iface.type ?? "").toLowerCase() === "virtual";
}

function isActiveInterface(iface: NetworkInterfaceSummary, primaryInterfaceName?: string): boolean {
    if (iface.name === primaryInterfaceName) {
        return true;
    }
    if (isVirtualInterface(iface)) {
        return false;
    }
    return (iface.status ?? "").toLowerCase() === "up" && (((iface.ipv4 ?? "").trim() !== "") || ((iface.ipv6 ?? "").trim() !== ""));
}
