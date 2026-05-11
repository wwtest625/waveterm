// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    buildDockerExecCommand,
    buildDockerLogsCommand,
    buildDockerPullCommand,
    buildDockerRenameCommand,
    buildDockerSaveCommand,
    canRemoveDockerContainer,
    dockerContainerMatchesSearch,
    dockerStateBadgeClass,
    dockerStateLabel,
    getDockerErrorHeadline,
    getDockerStarStorageKey,
    isDockerContainerStarred,
    loadDockerStarredContainerIds,
    normalizeDockerState,
    saveDockerStarredContainerIds,
    sortDockerContainersForDisplay,
    toggleDockerStarredContainerId,
} from "./docker-util";

test("docker command builders quote identifiers safely", () => {
    assert.equal(buildDockerLogsCommand("web app"), "docker logs --tail 200 -f 'web app'");
    assert.equal(buildDockerExecCommand("web app"), "docker exec -it 'web app' /bin/bash");
    assert.equal(buildDockerPullCommand("ghcr.io/acme/web:latest"), "docker pull ghcr.io/acme/web\\:latest");
    assert.equal(buildDockerRenameCommand("web app", "new name"), "docker rename 'web app' 'new name'");
    assert.equal(buildDockerSaveCommand("nginx:latest"), "docker save nginx:latest -o nginx_latest.tar");
    assert.equal(buildDockerSaveCommand("ghcr.io/acme/web:v1"), "docker save ghcr.io/acme/web:v1 -o ghcr.io_acme_web_v1.tar");
});

test("canRemoveDockerContainer only allows stopped-like states", () => {
    assert.equal(canRemoveDockerContainer("running"), false);
    assert.equal(canRemoveDockerContainer("paused"), false);
    assert.equal(canRemoveDockerContainer("created"), true);
    assert.equal(canRemoveDockerContainer("exited"), true);
    assert.equal(canRemoveDockerContainer("dead"), true);
    assert.equal(canRemoveDockerContainer("restarting"), false);
    assert.equal(canRemoveDockerContainer("removing"), false);
    assert.equal(canRemoveDockerContainer(undefined), false);
    assert.equal(canRemoveDockerContainer(""), false);
});

test("normalizeDockerState trims and lowercases", () => {
    assert.equal(normalizeDockerState("  Running  "), "running");
    assert.equal(normalizeDockerState("PAUSED"), "paused");
    assert.equal(normalizeDockerState(""), "");
    assert.equal(normalizeDockerState(undefined), "");
    assert.equal(normalizeDockerState("  "), "");
});

test("dockerStateLabel maps all known states to Chinese labels", () => {
    assert.equal(dockerStateLabel("running"), "运行中");
    assert.equal(dockerStateLabel("paused"), "已暂停");
    assert.equal(dockerStateLabel("exited"), "已退出");
    assert.equal(dockerStateLabel("created"), "已创建");
    assert.equal(dockerStateLabel("dead"), "已停止");
    assert.equal(dockerStateLabel("restarting"), "重启中");
    assert.equal(dockerStateLabel("removing"), "移除中");
    assert.equal(dockerStateLabel("configured"), "已配置");
    assert.equal(dockerStateLabel(""), "未知");
    assert.equal(dockerStateLabel(undefined), "未知");
    assert.equal(dockerStateLabel("some_new_state"), "some_new_state");
});

test("dockerStateLabel is case-insensitive", () => {
    assert.equal(dockerStateLabel("Running"), "运行中");
    assert.equal(dockerStateLabel("RESTARTING"), "重启中");
    assert.equal(dockerStateLabel("  exited  "), "已退出");
});

test("dockerStateBadgeClass maps known states to the expected tone", () => {
    assert.match(dockerStateBadgeClass("running"), /emerald/);
    assert.match(dockerStateBadgeClass("paused"), /amber/);
    assert.match(dockerStateBadgeClass("exited"), /red/);
    assert.match(dockerStateBadgeClass("dead"), /red/);
    assert.match(dockerStateBadgeClass("created"), /zinc/);
    assert.match(dockerStateBadgeClass("restarting"), /blue/);
    assert.match(dockerStateBadgeClass("removing"), /blue/);
    assert.match(dockerStateBadgeClass("configured"), /zinc/);
    assert.match(dockerStateBadgeClass("unknown_state"), /zinc/);
});

test("getDockerErrorHeadline provides friendly summaries", () => {
    assert.equal(
        getDockerErrorHeadline({ code: "missing_cli", message: "docker missing" } as DockerError),
        "当前连接未安装 Docker 命令。"
    );
    assert.equal(
        getDockerErrorHeadline({ code: "daemon_unreachable", message: "daemon down" } as DockerError),
        "当前连接上的 Docker 服务不可达。"
    );
    assert.equal(
        getDockerErrorHeadline({ code: "permission_denied", message: "no access" } as DockerError),
        "当前连接没有访问 Docker 的权限。"
    );
    assert.equal(
        getDockerErrorHeadline({ code: "not_found", message: "gone" } as DockerError),
        "没有找到对应的 Docker 资源。"
    );
    assert.equal(
        getDockerErrorHeadline({ code: "conflict", message: "in use" } as DockerError),
        "该资源仍在使用中，Docker 拒绝了这次操作。"
    );
    assert.equal(
        getDockerErrorHeadline({ code: "unknown", message: "Something failed" } as DockerError),
        "Something failed"
    );
    assert.equal(getDockerErrorHeadline(null), "加载 Docker 数据失败。");
    assert.equal(getDockerErrorHeadline(undefined), "加载 Docker 数据失败。");
});

test("docker star helpers persist and sort starred containers first", () => {
    const storageState: Record<string, string> = {};
    const storage = {
        getItem: (key: string) => storageState[key] ?? null,
        setItem: (key: string, value: string) => {
            storageState[key] = value;
        },
    };

    const key = getDockerStarStorageKey("root@192.0.2.82");
    assert.match(key, /root%40192\.0\.2\.82$/);

    saveDockerStarredContainerIds(storage, "root@192.0.2.82", ["beta", "alpha", "alpha", ""]);
    assert.deepEqual(JSON.parse(storageState[key]), ["beta", "alpha"]);
    assert.deepEqual(loadDockerStarredContainerIds(storage, "root@192.0.2.82"), ["beta", "alpha"]);
    assert.deepEqual(toggleDockerStarredContainerId(["beta", "alpha"], "alpha"), ["beta"]);

    const containers = [
        { id: "1", name: "zeta", image: "nginx:latest", imageId: "sha256:abc123", state: "running", statusText: "", portsText: "" },
        { id: "2", name: "alpha", image: "redis:latest", imageId: "sha256:def456", state: "exited", statusText: "", portsText: "" },
        { id: "3", name: "beta", image: "postgres:latest", imageId: "sha256:ghi789", state: "running", statusText: "", portsText: "" },
    ] as DockerContainerSummary[];

    const sorted = sortDockerContainersForDisplay(containers, ["3", "2"]);
    assert.deepEqual(
        sorted.map((container) => container.id),
        ["2", "3", "1"]
    );
});

test("loadDockerStarredContainerIds handles corrupt storage gracefully", () => {
    const storageState: Record<string, string> = {};
    const storage = {
        getItem: (key: string) => storageState[key] ?? null,
        setItem: (key: string, value: string) => {
            storageState[key] = value;
        },
    };

    const key = getDockerStarStorageKey("local");
    storageState[key] = "not-json";
    assert.deepEqual(loadDockerStarredContainerIds(storage, "local"), []);

    storageState[key] = JSON.stringify({ not: "an array" });
    assert.deepEqual(loadDockerStarredContainerIds(storage, "local"), []);

    storageState[key] = JSON.stringify([123, null, "valid", ""]);
    assert.deepEqual(loadDockerStarredContainerIds(storage, "local"), ["valid"]);

    storageState[key] = "";
    assert.deepEqual(loadDockerStarredContainerIds(storage, "local"), []);
});

test("isDockerContainerStarred works correctly", () => {
    assert.equal(isDockerContainerStarred(["a", "b", "c"], "a"), true);
    assert.equal(isDockerContainerStarred(["a", "b", "c"], "d"), false);
    assert.equal(isDockerContainerStarred([], "a"), false);
    assert.equal(isDockerContainerStarred(["a"], ""), false);
});

test("toggleDockerStarredContainerId adds and removes correctly", () => {
    assert.deepEqual(toggleDockerStarredContainerId(["a", "b"], "c"), ["a", "b", "c"]);
    assert.deepEqual(toggleDockerStarredContainerId(["a", "b", "c"], "b"), ["a", "c"]);
    assert.deepEqual(toggleDockerStarredContainerId([], "a"), ["a"]);
    assert.deepEqual(toggleDockerStarredContainerId(["a"], ""), ["a"]);
});

test("docker container search supports separate name and image ID filters", () => {
    const container = {
        id: "1",
        name: "web-api",
        image: "ghcr.io/acme/web:latest",
        imageId: "sha256:abc123def",
        state: "running",
        statusText: "Up",
        portsText: "8080/tcp",
    } as DockerContainerSummary;

    assert.equal(dockerContainerMatchesSearch(container, "web", ""), true);
    assert.equal(dockerContainerMatchesSearch(container, "", "sha256:abc123def"), true);
    assert.equal(dockerContainerMatchesSearch(container, "web", "sha256:xyz"), false);
    assert.equal(dockerContainerMatchesSearch(container, "nonexistent", ""), false);
    assert.equal(dockerContainerMatchesSearch(container, "", ""), true);
    assert.equal(dockerContainerMatchesSearch(container, "  WEB  ", ""), true);
    assert.equal(dockerContainerMatchesSearch(container, "", "  ABC123  "), true);
});

test("docker container search matches against ports and status", () => {
    const container = {
        id: "1",
        name: "web",
        image: "nginx",
        imageId: "sha256:abc",
        state: "running",
        statusText: "Up 2 hours",
        portsText: "0.0.0.0:8080->80/tcp",
    } as DockerContainerSummary;

    assert.equal(dockerContainerMatchesSearch(container, "8080", ""), true);
    assert.equal(dockerContainerMatchesSearch(container, "Up 2 hours", ""), true);
});

test("sortDockerContainersForDisplay preserves original order for non-starred", () => {
    const containers = [
        { id: "1", name: "c", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
        { id: "2", name: "a", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
        { id: "3", name: "b", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
    ] as DockerContainerSummary[];

    const sorted = sortDockerContainersForDisplay(containers, []);
    assert.deepEqual(
        sorted.map((c) => c.id),
        ["1", "2", "3"]
    );
});

test("sortDockerContainersForDisplay puts starred containers first maintaining order", () => {
    const containers = [
        { id: "1", name: "c", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
        { id: "2", name: "a", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
        { id: "3", name: "b", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
        { id: "4", name: "d", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
    ] as DockerContainerSummary[];

    const sorted = sortDockerContainersForDisplay(containers, ["3", "1"]);
    assert.deepEqual(
        sorted.map((c) => c.id),
        ["1", "3", "2", "4"]
    );
});

test("sortDockerContainersForDisplay puts running containers before stopped", () => {
    const containers = [
        { id: "1", name: "stopped", image: "img", imageId: "", state: "exited", statusText: "", portsText: "" },
        { id: "2", name: "running", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
        { id: "3", name: "stopped2", image: "img", imageId: "", state: "dead", statusText: "", portsText: "" },
        { id: "4", name: "paused", image: "img", imageId: "", state: "paused", statusText: "", portsText: "" },
    ] as DockerContainerSummary[];

    const sorted = sortDockerContainersForDisplay(containers, []);
    assert.deepEqual(
        sorted.map((c) => c.id),
        ["2", "4", "1", "3"]
    );
});

test("sortDockerContainersForDisplay starred takes priority over running state", () => {
    const containers = [
        { id: "1", name: "stopped-starred", image: "img", imageId: "", state: "exited", statusText: "", portsText: "" },
        { id: "2", name: "running", image: "img", imageId: "", state: "running", statusText: "", portsText: "" },
        { id: "3", name: "stopped", image: "img", imageId: "", state: "exited", statusText: "", portsText: "" },
    ] as DockerContainerSummary[];

    const sorted = sortDockerContainersForDisplay(containers, ["1"]);
    assert.deepEqual(
        sorted.map((c) => c.id),
        ["1", "2", "3"]
    );
});
