// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { quote as shellQuote } from "shell-quote";

export function buildDockerLogsCommand(containerId: string): string {
    return `docker logs --tail 200 -f ${shellQuote([containerId])}`;
}

export function buildDockerExecCommand(containerId: string): string {
    return `docker exec -it ${shellQuote([containerId])} /bin/sh`;
}

export function buildDockerPullCommand(imageRef: string): string {
    return `docker pull ${shellQuote([imageRef])}`;
}

export function canRemoveDockerContainer(state?: string): boolean {
    const normalized = normalizeDockerState(state);
    return normalized === "exited" || normalized === "created" || normalized === "dead";
}

export function normalizeDockerState(state?: string): string {
    return (state ?? "").trim().toLowerCase();
}

export function dockerStateLabel(state?: string): string {
    const normalized = normalizeDockerState(state);
    if (normalized === "running") {
        return "运行中";
    }
    if (normalized === "paused") {
        return "已暂停";
    }
    if (normalized === "exited") {
        return "已退出";
    }
    if (normalized === "created") {
        return "已创建";
    }
    if (normalized === "dead") {
        return "已停止";
    }
    if (normalized === "restarting") {
        return "重启中";
    }
    if (normalized === "") {
        return "未知";
    }
    return normalized;
}

export function dockerStateBadgeClass(state?: string): string {
    const normalized = normalizeDockerState(state);
    if (normalized === "running") {
        return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    }
    if (normalized === "paused") {
        return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    }
    if (normalized === "exited" || normalized === "dead") {
        return "border-red-500/40 bg-red-500/10 text-red-300";
    }
    if (normalized === "created") {
        return "border-zinc-600 bg-zinc-800/80 text-zinc-300";
    }
    return "border-zinc-600 bg-zinc-800/80 text-zinc-300";
}

export function getDockerErrorHeadline(error?: DockerError | null): string {
    switch (error?.code) {
        case "missing_cli":
            return "当前连接未安装 Docker 命令。";
        case "daemon_unreachable":
            return "当前连接上的 Docker 服务不可达。";
        case "permission_denied":
            return "当前连接没有访问 Docker 的权限。";
        case "not_found":
            return "没有找到对应的 Docker 资源。";
        case "conflict":
            return "该资源仍在使用中，Docker 拒绝了这次操作。";
        default:
            return error?.message ?? "加载 Docker 数据失败。";
    }
}
