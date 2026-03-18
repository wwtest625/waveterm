// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    buildDockerExecCommand,
    buildDockerLogsCommand,
    buildDockerPullCommand,
    canRemoveDockerContainer,
    dockerStateBadgeClass,
    getDockerErrorHeadline,
} from "./docker-util";

test("docker command builders quote identifiers safely", () => {
    assert.equal(buildDockerLogsCommand("web app"), "docker logs --tail 200 -f 'web app'");
    assert.equal(buildDockerExecCommand("web app"), "docker exec -it 'web app' /bin/sh");
    assert.equal(buildDockerPullCommand("ghcr.io/acme/web:latest"), "docker pull ghcr.io/acme/web\\:latest");
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
