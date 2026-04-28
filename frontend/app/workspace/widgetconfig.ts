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

function setWidgetInFileContent(
    fileContent: string,
    widgetKey: string,
    updater: (widget: WidgetConfigDraft) => WidgetConfigDraft
): string {
    const widgetsFile = parseWidgetsFile(fileContent);
    const existingWidget = widgetsFile[widgetKey];
    const existingWidgetConfig = existingWidget != null && typeof existingWidget === "object" ? existingWidget : {};
    widgetsFile[widgetKey] = updater({
        ...existingWidgetConfig,
    });
    return JSON.stringify(widgetsFile, null, 2);
}

function setWidgetWidthInFileContent(fileContent: string, widgetKey: string, width: number): string {
    return setWidgetInFileContent(fileContent, widgetKey, (widget) => ({
        ...widget,
        "display:width": width,
    }));
}

export { parseWidgetsFile, setWidgetInFileContent, setWidgetWidthInFileContent };
export type { WidgetConfigDraft, WidgetsFile };
