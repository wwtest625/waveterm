// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { quote as shellQuote } from "shell-quote";

const dockerStarStoragePrefix = "waveterm:docker-starred-containers:";

export function buildDockerLogsCommand(containerId: string): string {
    return `docker logs --tail 200 -f ${shellQuote([containerId])}`;
}

export function buildDockerExecCommand(containerId: string): string {
    return `docker exec -it ${shellQuote([containerId])} /bin/bash`;
}

export function buildDockerPullCommand(imageRef: string): string {
    return `docker pull ${shellQuote([imageRef])}`;
}

export function buildDockerRenameCommand(containerId: string, newName: string): string {
    return `docker rename ${shellQuote([containerId])} ${shellQuote([newName])}`;
}

export function getDockerStarStorageKey(connection: string): string {
    return `${dockerStarStoragePrefix}${encodeURIComponent(connection)}`;
}

export function loadDockerStarredContainerIds(storage: Pick<Storage, "getItem">, connection: string): string[] {
    const raw = storage.getItem(getDockerStarStorageKey(connection));
    if (raw == null || raw.trim() === "") {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    } catch {
        return [];
    }
}

export function saveDockerStarredContainerIds(
    storage: Pick<Storage, "setItem">,
    connection: string,
    containerIds: Iterable<string>
): void {
    const uniqueIds = Array.from(new Set(Array.from(containerIds).filter((id) => id.trim() !== "")));
    storage.setItem(getDockerStarStorageKey(connection), JSON.stringify(uniqueIds));
}

export function toggleDockerStarredContainerId(containerIds: string[], containerId: string): string[] {
    const normalizedId = containerId.trim();
    if (normalizedId === "") {
        return containerIds;
    }
    const nextIds = new Set(containerIds);
    if (nextIds.has(normalizedId)) {
        nextIds.delete(normalizedId);
    } else {
        nextIds.add(normalizedId);
    }
    return Array.from(nextIds);
}

export function isDockerContainerStarred(containerIds: Iterable<string>, containerId: string): boolean {
    const normalizedId = containerId.trim();
    if (normalizedId === "") {
        return false;
    }
    return new Set(containerIds).has(normalizedId);
}

export function dockerContainerMatchesSearch(
    container: DockerContainerSummary,
    containerSearch: string,
    imageSearch: string
): boolean {
    const normalizedContainerSearch = containerSearch.trim().toLowerCase();
    const normalizedImageSearch = imageSearch.trim().toLowerCase();
    const matchesContainerSearch =
        normalizedContainerSearch === "" ||
        [container.name, container.id, container.statusText, container.portsText]
            .join(" ")
            .toLowerCase()
            .includes(normalizedContainerSearch);
    const matchesImageSearch =
        normalizedImageSearch === "" || container.image.toLowerCase().includes(normalizedImageSearch);
    return matchesContainerSearch && matchesImageSearch;
}

export function sortDockerContainersForDisplay(
    containers: DockerContainerSummary[],
    starredContainerIds: Iterable<string>
): DockerContainerSummary[] {
    const starredIds = new Set(Array.from(starredContainerIds).map((id) => id.trim()).filter((id) => id !== ""));
    return containers
        .map((container, index) => ({ container, index }))
        .sort((left, right) => {
            const leftStarred = starredIds.has(left.container.id);
            const rightStarred = starredIds.has(right.container.id);
            if (leftStarred !== rightStarred) {
                return leftStarred ? -1 : 1;
            }
            return left.index - right.index;
        })
        .map(({ container }) => container);
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
