// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import * as electron from "electron";
import { fireAndForget } from "../frontend/util/util";
import { isDev, unamePlatform } from "./emain-platform";
import { clearTabCache } from "./emain-tabview";
import { decreaseZoomLevel, increaseZoomLevel } from "./emain-util";
import {
    createNewWaveWindow,
    createWorkspace,
    focusedWaveWindow,
    getAllWaveWindows,
    getWaveWindowByWorkspaceId,
    relaunchBrowserWindows,
    WaveBrowserWindow,
} from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import { updater } from "./updater";

type AppMenuCallbacks = {
    createNewWaveWindow: () => Promise<void>;
    relaunchBrowserWindows: () => Promise<void>;
};

function getWindowWebContents(window: electron.BaseWindow): electron.WebContents {
    if (window == null) {
        return null;
    }
    if (window instanceof electron.BrowserWindow) {
        return window.webContents;
    }
    if (window instanceof WaveBrowserWindow) {
        if (window.activeTabView) {
            return window.activeTabView.webContents;
        }
        return null;
    }
    return null;
}

async function getWorkspaceMenu(ww?: WaveBrowserWindow): Promise<Electron.MenuItemConstructorOptions[]> {
    const workspaceList = await RpcApi.WorkspaceListCommand(ElectronWshClient);
    const workspaceMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "创建工作区",
            click: (_, window) => fireAndForget(() => createWorkspace((window as WaveBrowserWindow) ?? ww)),
        },
    ];
    function getWorkspaceSwitchAccelerator(i: number): string {
        if (i < 9) {
            return unamePlatform == "darwin" ? `Command+Control+${i + 1}` : `Alt+Control+${i + 1}`;
        }
    }
    if (workspaceList?.length) {
        workspaceMenu.push(
            { type: "separator" },
            ...workspaceList.map<Electron.MenuItemConstructorOptions>((workspace, i) => {
                return {
                    label: `${workspace.workspacedata.name}`,
                    click: (_, window) => {
                        ((window as WaveBrowserWindow) ?? ww)?.switchWorkspace(workspace.workspacedata.oid);
                    },
                    accelerator: getWorkspaceSwitchAccelerator(i),
                };
            })
        );
    }
    return workspaceMenu;
}

function makeEditMenu(fullConfig?: FullConfigType): Electron.MenuItemConstructorOptions[] {
    let pasteAccelerator: string;
    if (unamePlatform === "darwin") {
        pasteAccelerator = "Command+V";
    } else {
        const ctrlVPaste = fullConfig?.settings?.["app:ctrlvpaste"];
        if (ctrlVPaste == null) {
            pasteAccelerator = unamePlatform === "win32" ? "Control+V" : "";
        } else if (ctrlVPaste) {
            pasteAccelerator = "Control+V";
        } else {
            pasteAccelerator = "";
        }
    }
    return [
        {
            role: "undo",
            label: "撤销",
            accelerator: unamePlatform === "darwin" ? "Command+Z" : "",
        },
        {
            role: "redo",
            label: "重做",
            accelerator: unamePlatform === "darwin" ? "Command+Shift+Z" : "",
        },
        { type: "separator" },
        {
            role: "cut",
            label: "剪切",
            accelerator: unamePlatform === "darwin" ? "Command+X" : "",
        },
        {
            role: "copy",
            label: "复制",
            accelerator: unamePlatform === "darwin" ? "Command+C" : "",
        },
        {
            role: "paste",
            label: "粘贴",
            accelerator: pasteAccelerator,
        },
        {
            role: "pasteAndMatchStyle",
            label: "粘贴并匹配样式",
            accelerator: unamePlatform === "darwin" ? "Command+Shift+V" : "",
        },
        {
            role: "delete",
            label: "删除",
        },
        {
            role: "selectAll",
            label: "全选",
            accelerator: unamePlatform === "darwin" ? "Command+A" : "",
        },
    ];
}

function makeFileMenu(
    numWaveWindows: number,
    callbacks: AppMenuCallbacks,
    fullConfig: FullConfigType
): Electron.MenuItemConstructorOptions[] {
    const fileMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "新窗口",
            accelerator: "CommandOrControl+Shift+N",
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        },
        {
            role: "close",
            label: "关闭窗口",
            accelerator: "",
            click: () => {
                focusedWaveWindow?.close();
            },
        },
    ];
    if (numWaveWindows == 0) {
        fileMenu.push({
            label: "新窗口 (隐藏 -1)",
            accelerator: unamePlatform === "darwin" ? "Command+N" : "Alt+N",
            acceleratorWorksWhenHidden: true,
            visible: false,
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        });
        fileMenu.push({
            label: "新窗口 (隐藏 -2)",
            accelerator: unamePlatform === "darwin" ? "Command+T" : "Alt+T",
            acceleratorWorksWhenHidden: true,
            visible: false,
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        });
    }
    return fileMenu;
}

function makeAppMenuItems(webContents: electron.WebContents): Electron.MenuItemConstructorOptions[] {
    const appMenuItems: Electron.MenuItemConstructorOptions[] = [
        {
            label: "关于 Wave Terminal",
            click: (_, window) => {
                (getWindowWebContents(window) ?? webContents)?.send("menu-item-about");
            },
        },
        {
            label: "检查更新",
            click: () => {
                fireAndForget(() => updater?.checkForUpdates(true));
            },
        },
        { type: "separator" },
    ];
    if (unamePlatform === "darwin") {
        appMenuItems.push(
            { role: "services", label: "服务" },
            { type: "separator" },
            { role: "hide", label: "隐藏" },
            { role: "hideOthers", label: "隐藏其他" },
            { type: "separator" }
        );
    }
    appMenuItems.push({ role: "quit", label: "退出" });
    return appMenuItems;
}

function makeViewMenu(
    webContents: electron.WebContents,
    callbacks: AppMenuCallbacks,
    fullscreenOnLaunch: boolean
): Electron.MenuItemConstructorOptions[] {
    const devToolsAccel = unamePlatform === "darwin" ? "Option+Command+I" : "Alt+Shift+I";
    return [
        {
            label: "重新加载标签页",
            accelerator: "Shift+CommandOrControl+R",
            click: (_, window) => {
                (getWindowWebContents(window) ?? webContents)?.reloadIgnoringCache();
            },
        },
        {
            label: "重新启动所有窗口",
            click: () => callbacks.relaunchBrowserWindows(),
        },
        {
            label: "清除标签页缓存",
            click: () => clearTabCache(),
        },
        {
            label: "切换开发者工具",
            accelerator: devToolsAccel,
            click: (_, window) => {
                let wc = getWindowWebContents(window) ?? webContents;
                wc?.toggleDevTools();
            },
        },
        { type: "separator" },
        {
            label: "重置缩放",
            accelerator: "CommandOrControl+0",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    wc.setZoomFactor(1);
                    wc.send("zoom-factor-change", 1);
                }
            },
        },
        {
            label: "放大",
            accelerator: "CommandOrControl+=",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    increaseZoomLevel(wc);
                }
            },
        },
        {
            label: "放大 (隐藏)",
            accelerator: "CommandOrControl+Shift+=",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    increaseZoomLevel(wc);
                }
            },
            visible: false,
            acceleratorWorksWhenHidden: true,
        },
        {
            label: "缩小",
            accelerator: "CommandOrControl+-",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    decreaseZoomLevel(wc);
                }
            },
        },
        {
            label: "缩小 (隐藏)",
            accelerator: "CommandOrControl+Shift+-",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    decreaseZoomLevel(wc);
                }
            },
            visible: false,
            acceleratorWorksWhenHidden: true,
        },
        {
            label: "启动时全屏",
            submenu: [
                {
                    label: "开启",
                    type: "radio",
                    checked: fullscreenOnLaunch,
                    click: () => {
                        RpcApi.SetConfigCommand(ElectronWshClient, { "window:fullscreenonlaunch": true });
                    },
                },
                {
                    label: "关闭",
                    type: "radio",
                    checked: !fullscreenOnLaunch,
                    click: () => {
                        RpcApi.SetConfigCommand(ElectronWshClient, { "window:fullscreenonlaunch": false });
                    },
                },
            ],
        },
        { type: "separator" },
        {
            role: "togglefullscreen",
            label: "切换全屏",
        },
    ];
}

async function makeFullAppMenu(callbacks: AppMenuCallbacks, workspaceId?: string): Promise<Electron.Menu> {
    const numWaveWindows = getAllWaveWindows().length;
    const webContents = workspaceId && getWebContentsByWorkspaceId(workspaceId);
    const appMenuItems = makeAppMenuItems(webContents);

    let fullscreenOnLaunch = false;
    let fullConfig: FullConfigType = null;
    try {
        fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        fullscreenOnLaunch = fullConfig?.settings["window:fullscreenonlaunch"];
    } catch (e) {
        console.error("Error fetching config:", e);
    }
    const editMenu = makeEditMenu(fullConfig);
    const fileMenu = makeFileMenu(numWaveWindows, callbacks, fullConfig);
    const viewMenu = makeViewMenu(webContents, callbacks, fullscreenOnLaunch);
    let workspaceMenu: Electron.MenuItemConstructorOptions[] = null;
    try {
        workspaceMenu = await getWorkspaceMenu();
    } catch (e) {
        console.error("getWorkspaceMenu error:", e);
    }
    const windowMenu: Electron.MenuItemConstructorOptions[] = [
        { role: "minimize", label: "最小化", accelerator: "" },
        { role: "zoom", label: "缩放" },
        { type: "separator" },
        { role: "front", label: "前置" },
    ];
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        { role: "appMenu", submenu: appMenuItems },
        { role: "fileMenu", submenu: fileMenu },
        { role: "editMenu", submenu: editMenu },
        { role: "viewMenu", submenu: viewMenu },
    ];
    if (workspaceMenu != null) {
        menuTemplate.push({
            label: "工作区",
            id: "workspace-menu",
            submenu: workspaceMenu,
        });
    }
    menuTemplate.push({
        role: "windowMenu",
        submenu: windowMenu,
    });
    return electron.Menu.buildFromTemplate(menuTemplate);
}

export function instantiateAppMenu(workspaceId?: string): Promise<electron.Menu> {
    return makeFullAppMenu(
        {
            createNewWaveWindow,
            relaunchBrowserWindows,
        },
        workspaceId
    );
}

// does not a set a menu on windows
export function makeAndSetAppMenu() {
    if (unamePlatform === "win32") {
        return;
    }
    fireAndForget(async () => {
        const menu = await instantiateAppMenu();
        electron.Menu.setApplicationMenu(menu);
    });
}

function initMenuEventSubscriptions() {
    waveEventSubscribeSingle({
        eventType: "workspace:update",
        handler: makeAndSetAppMenu,
    });
}

function getWebContentsByWorkspaceId(workspaceId: string): electron.WebContents {
    const ww = getWaveWindowByWorkspaceId(workspaceId);
    if (ww) {
        return ww.activeTabView?.webContents;
    }
    return null;
}

function convertMenuDefArrToMenu(
    webContents: electron.WebContents,
    menuDefArr: ElectronContextMenuItem[],
    menuState: { hasClick: boolean }
): electron.Menu {
    const menuItems: electron.MenuItem[] = [];
    for (const menuDef of menuDefArr) {
        const menuItemTemplate: electron.MenuItemConstructorOptions = {
            role: menuDef.role as any,
            label: menuDef.label,
            type: menuDef.type,
            click: () => {
                menuState.hasClick = true;
                webContents.send("contextmenu-click", menuDef.id);
            },
            checked: menuDef.checked,
            enabled: menuDef.enabled,
        };
        if (menuDef.submenu != null) {
            menuItemTemplate.submenu = convertMenuDefArrToMenu(webContents, menuDef.submenu, menuState);
        }
        const menuItem = new electron.MenuItem(menuItemTemplate);
        menuItems.push(menuItem);
    }
    return electron.Menu.buildFromTemplate(menuItems);
}

electron.ipcMain.on(
    "contextmenu-show",
    (event, workspaceId: string, menuDefArr: ElectronContextMenuItem[]) => {
        const webContents = getWebContentsByWorkspaceId(workspaceId);
        if (!webContents) {
            console.error("invalid window for context menu:", workspaceId);
            event.returnValue = true;
            return;
        }
        if (menuDefArr.length === 0) {
            webContents.send("contextmenu-click", null);
            event.returnValue = true;
            return;
        }
        fireAndForget(async () => {
            const menuState = { hasClick: false };
            const menu = convertMenuDefArrToMenu(webContents, menuDefArr, menuState);
            menu.popup({
                callback: () => {
                    if (!menuState.hasClick) {
                        webContents.send("contextmenu-click", null);
                    }
                },
            });
        });
        event.returnValue = true;
    }
);

electron.ipcMain.on("workspace-appmenu-show", (event, workspaceId: string) => {
    fireAndForget(async () => {
        const webContents = getWebContentsByWorkspaceId(workspaceId);
        if (!webContents) {
            console.error("invalid window for workspace app menu:", workspaceId);
            return;
        }
        const menu = await instantiateAppMenu(workspaceId);
        menu.popup();
    });
    event.returnValue = true;
});

const dockMenu = electron.Menu.buildFromTemplate([
    {
        label: "新窗口",
        click() {
            fireAndForget(createNewWaveWindow);
        },
    },
]);

function makeDockTaskbar() {
    if (unamePlatform == "darwin") {
        electron.app.dock.setMenu(dockMenu);
    }
}

export { initMenuEventSubscriptions, makeDockTaskbar };
