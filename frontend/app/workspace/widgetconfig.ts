// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type WidgetConfigDraft = Partial<WidgetConfigType> & { "display:width"?: number };
type WidgetsFile = Record<string, WidgetConfigDraft | null>;

function parseWidgetsFile(fileContent: string): WidgetsFile {
    try {
        const parsed = JSON.parse(fileContent || "{}");
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        return parsed as WidgetsFile;
    } catch {
        return {};
    }
}

function setWidgetWidthInFileContent(fileContent: string, widgetKey: string, width: number): string {
    const widgetsFile = parseWidgetsFile(fileContent);
    const existingWidget = widgetsFile[widgetKey];
    widgetsFile[widgetKey] = {
        ...(existingWidget != null && typeof existingWidget === "object" ? existingWidget : {}),
        "display:width": width,
    };
    return JSON.stringify(widgetsFile, null, 2);
}

export { parseWidgetsFile, setWidgetWidthInFileContent };
export type { WidgetConfigDraft, WidgetsFile };
