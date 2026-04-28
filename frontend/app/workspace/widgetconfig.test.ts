// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { parseWidgetsFile, setWidgetInFileContent, setWidgetWidthInFileContent } from "./widgetconfig";

test("parseWidgetsFile falls back to an empty object for invalid json", () => {
    assert.deepEqual(parseWidgetsFile("{"), {});
});

test("setWidgetWidthInFileContent preserves existing widget overrides", () => {
    const nextContent = setWidgetWidthInFileContent(
        JSON.stringify({
            "defwidget@files": {
                color: "#58c142",
            },
        }),
        "defwidget@files",
        33
    );

    assert.deepEqual(JSON.parse(nextContent), {
        "defwidget@files": {
            color: "#58c142",
            "display:width": 33,
        },
    });
});

test("setWidgetWidthInFileContent creates a widget override when needed", () => {
    const nextContent = setWidgetWidthInFileContent("{}", "defwidget@files", 40);

    assert.deepEqual(JSON.parse(nextContent), {
        "defwidget@files": {
            "display:width": 40,
        },
    });
});

test("setWidgetInFileContent preserves nested blockdef fields", () => {
    const nextContent = setWidgetInFileContent(
        JSON.stringify({
            "defwidget@files": {
                label: "files",
                blockdef: {
                    meta: {
                        view: "preview",
                        file: "~",
                    },
                },
            },
        }),
        "defwidget@files",
        (widget) => ({
            ...widget,
            blockdef: {
                ...(widget.blockdef ?? {}),
                meta: {
                    ...(widget.blockdef?.meta ?? {}),
                    file: "/srv/models",
                    connection: "root@192.0.2.82",
                },
            },
        })
    );

    assert.deepEqual(JSON.parse(nextContent), {
        "defwidget@files": {
            label: "files",
            blockdef: {
                meta: {
                    view: "preview",
                    file: "/srv/models",
                    connection: "root@192.0.2.82",
                },
            },
        },
    });
});
