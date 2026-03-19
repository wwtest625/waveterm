// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { buildWidgetBlockDef } from "./widgetblockdef";

test("buildWidgetBlockDef uses focused terminal remote connection and cwd for preview widget", () => {
    const widget = {
        blockdef: {
            meta: {
                view: "preview",
                file: "~",
            },
        },
    } as WidgetConfigType;

    const result = buildWidgetBlockDef(widget, {
        view: "term",
        connection: "ssh://devbox",
        cwd: "/srv/app",
    });

    assert.equal(result.meta?.view, "preview");
    assert.equal(result.meta?.connection, "ssh://devbox");
    assert.equal(result.meta?.file, "/srv/app");
});

test("buildWidgetBlockDef keeps preview widget unchanged when focused block is not terminal", () => {
    const widget = {
        blockdef: {
            meta: {
                view: "preview",
                file: "~",
            },
        },
    } as WidgetConfigType;

    const result = buildWidgetBlockDef(widget, {
        view: "web",
        connection: "ssh://devbox",
        cwd: "/srv/app",
    });

    assert.equal(result.meta?.connection, undefined);
    assert.equal(result.meta?.file, "~");
});

test("buildWidgetBlockDef does not mutate original widget blockdef", () => {
    const widget = {
        blockdef: {
            meta: {
                view: "preview",
                file: "~",
            },
        },
    } as WidgetConfigType;

    const _result = buildWidgetBlockDef(widget, {
        view: "term",
        connection: "ssh://devbox",
        cwd: "/srv/app",
    });

    assert.equal(widget.blockdef?.meta?.connection, undefined);
    assert.equal(widget.blockdef?.meta?.file, "~");
});

test("buildWidgetBlockDef inherits connection for docker widget from focused terminal", () => {
    const widget = {
        blockdef: {
            meta: {
                view: "docker",
            },
        },
    } as WidgetConfigType;

    const result = buildWidgetBlockDef(widget, {
        view: "term",
        connection: "root@192.2.53.33",
        cwd: "/srv/app",
    });

    assert.equal(result.meta?.view, "docker");
    assert.equal(result.meta?.connection, "root@192.2.53.33");
});

test("buildWidgetBlockDef inherits connection and cwd for tmux widget from focused terminal", () => {
    const widget = {
        blockdef: {
            meta: {
                view: "tmux",
            },
        },
    } as WidgetConfigType;

    const result = buildWidgetBlockDef(widget, {
        view: "term",
        connection: "root@192.2.53.33",
        cwd: "/srv/app",
    });

    assert.equal(result.meta?.view, "tmux");
    assert.equal(result.meta?.connection, "root@192.2.53.33");
    assert.equal(result.meta?.["cmd:cwd"], "/srv/app");
});
