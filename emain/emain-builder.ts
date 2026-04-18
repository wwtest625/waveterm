import { BrowserWindow } from "electron";

export type BuilderWindowType = BrowserWindow & {
    builderId: string;
    builderAppId?: string;
};

const builderWindows: BuilderWindowType[] = [];
export let focusedBuilderWindow: BuilderWindowType = null;

export function getBuilderWindowById(builderId: string): BuilderWindowType {
    return builderWindows.find((win) => win.builderId === builderId);
}

export function getBuilderWindowByWebContentsId(webContentsId: number): BuilderWindowType {
    return builderWindows.find((win) => win.webContents.id === webContentsId);
}

export function getAllBuilderWindows(): BuilderWindowType[] {
    return builderWindows;
}

export async function createBuilderWindow(appId: string): Promise<BuilderWindowType> {
    throw new Error("Builder functionality has been removed");
}
