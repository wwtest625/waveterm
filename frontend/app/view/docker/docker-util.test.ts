// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    buildDockerExecCommand,
    buildDockerLogsCommand,
    buildDockerPullCommand,
    buildDockerRenameCommand,
    canRemoveDockerContainer,
    dockerContainerMatchesSearch,
    dockerStateBadgeClass,
    getDockerErrorHeadline,
    getDockerStarStorageKey,
    loadDockerStarredContainerIds,
    saveDockerStarredContainerIds,
    sortDockerContainersForDisplay,
    toggleDockerStarredContainerId,
} from "./docker-util";

test("docker command builders quote identifiers safely", () => {
    assert.equal(buildDockerLogsCommand("web app"), "docker logs --tail 200 -f 'web app'");
    assert.equal(buildDockerExecCommand("web app"), "docker exec -it 'web app' /bin/bash");
    assert.equal(buildDockerPullCommand("ghcr.io/acme/web:latest"), "docker pull ghcr.io/acme/web\\:latest");
    assert.equal(buildDockerRenameCommand("web app", "new name"), "docker rename 'web app' 'new name'");
});

test("canRemoveDockerContainer only allows stopped-like states", () => {
    assert.equal(canRemoveDockerContainer("running"), false);
    assert.equal(canRemoveDockerContainer("paused"), false);
    assert.equal(canRemoveDockerContainer("created"), true);
    assert.equal(canRemoveDockerContainer("exited"), true);
    assert.equal(canRemoveDockerContainer("dead"), true);
});

test("dockerStateBadgeClass maps known states to the expected tone", () => {
    assert.match(dockerStateBadgeClass("running"), /emerald/);
    assert.match(dockerStateBadgeClass("paused"), /amber/);
    assert.match(dockerStateBadgeClass("exited"), /red/);
    assert.match(dockerStateBadgeClass("created"), /zinc/);
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
        getDockerErrorHeadline({ code: "unknown", message: "Something failed" } as DockerError),
        "Something failed"
    );
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
        { id: "1", name: "zeta", image: "nginx:latest", state: "running", statusText: "", portsText: "" },
        { id: "2", name: "alpha", image: "redis:latest", state: "exited", statusText: "", portsText: "" },
        { id: "3", name: "beta", image: "postgres:latest", state: "running", statusText: "", portsText: "" },
    ] as DockerContainerSummary[];

    const sorted = sortDockerContainersForDisplay(containers, ["3", "2"]);
    assert.deepEqual(
        sorted.map((container) => container.id),
        ["2", "3", "1"]
    );
});

test("docker container search supports separate name and image filters", () => {
    const container = {
        id: "1",
        name: "web-api",
        image: "ghcr.io/acme/web:latest",
        state: "running",
        statusText: "Up",
        portsText: "8080/tcp",
    } as DockerContainerSummary;

    assert.equal(dockerContainerMatchesSearch(container, "web", ""), true);
    assert.equal(dockerContainerMatchesSearch(container, "", "ghcr.io/acme/web"), true);
    assert.equal(dockerContainerMatchesSearch(container, "web", "redis"), false);
});
