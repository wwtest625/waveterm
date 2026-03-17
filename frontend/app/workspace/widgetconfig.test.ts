// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { parseWidgetsFile, setWidgetWidthInFileContent } from "./widgetconfig";

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
