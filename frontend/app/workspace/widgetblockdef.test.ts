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

test("buildWidgetBlockDef uses preview default dir for files widget when no terminal is focused", () => {
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
        previewDefaultDir: "/srv/projects",
    });

    assert.equal(result.meta?.file, "/srv/projects");
});

test("buildWidgetBlockDef keeps a custom preview file path when preview default dir is set", () => {
    const widget = {
        blockdef: {
            meta: {
                view: "preview",
                file: "/opt/custom",
            },
        },
    } as WidgetConfigType;

    const result = buildWidgetBlockDef(widget, {
        view: "web",
        previewDefaultDir: "/srv/projects",
    });

    assert.equal(result.meta?.file, "/opt/custom");
});

test("buildWidgetBlockDef uses preview default dir when focused terminal has no cwd", () => {
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
        cwd: "",
        previewDefaultDir: "/srv/projects",
    });

    assert.equal(result.meta?.connection, "ssh://devbox");
    assert.equal(result.meta?.file, "/srv/projects");
});

test("buildWidgetBlockDef uses preview default dir when focused terminal has no cwd even with custom meta.file", () => {
    const widget = {
        blockdef: {
            meta: {
                view: "preview",
                file: "/opt/custom",
            },
        },
    } as WidgetConfigType;

    const result = buildWidgetBlockDef(widget, {
        view: "term",
        connection: "ssh://devbox",
        cwd: "",
        previewDefaultDir: "/srv/projects",
    });

    assert.equal(result.meta?.connection, "ssh://devbox");
    assert.equal(result.meta?.file, "/srv/projects");
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

test("buildWidgetBlockDef inherits connection for network widget from focused terminal", () => {
    const widget = {
        blockdef: {
            meta: {
                view: "network",
            },
        },
    } as WidgetConfigType;

    const result = buildWidgetBlockDef(widget, {
        view: "term",
        connection: "root@192.2.53.33",
        cwd: "/srv/app",
    });

    assert.equal(result.meta?.view, "network");
    assert.equal(result.meta?.connection, "root@192.2.53.33");
});
