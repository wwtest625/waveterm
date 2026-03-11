// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, isBlank } from "@/util/util";
import { Column } from "@tanstack/react-table";
import dayjs from "dayjs";
import React from "react";
import { type PreviewModel } from "./preview-model";

export const recursiveError = "recursive flag must be set for directory operations";
export const overwriteError = "set overwrite flag to delete the existing file";
export const mergeError = "set overwrite flag to delete the existing contents or set merge flag to merge the contents";

export const displaySuffixes = {
    B: "b",
    kB: "k",
    MB: "m",
    GB: "g",
    TB: "t",
    KiB: "k",
    MiB: "m",
    GiB: "g",
    TiB: "t",
};

export function getBestUnit(bytes: number, si = false, sigfig = 3): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes === 0) return "0B";

    const units = si ? ["kB", "MB", "GB", "TB"] : ["KiB", "MiB", "GiB", "TiB"];
    const divisor = si ? 1000 : 1024;

    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(divisor)), units.length);
    const unit = idx === 0 ? "B" : units[idx - 1];
    const value = bytes / Math.pow(divisor, idx);

    return `${parseFloat(value.toPrecision(sigfig))}${displaySuffixes[unit] ?? unit}`;
}

export function getLastModifiedTime(unixMillis: number, column: Column<FileInfo, number>): string {
    const fileDatetime = dayjs(new Date(unixMillis));
    const nowDatetime = dayjs(new Date());

    let datePortion: string;
    if (nowDatetime.isSame(fileDatetime, "date")) {
        datePortion = "Today";
    } else if (nowDatetime.subtract(1, "day").isSame(fileDatetime, "date")) {
        datePortion = "Yesterday";
    } else {
        datePortion = dayjs(fileDatetime).format("M/D/YY");
    }

    if (column.getSize() > 120) {
        return `${datePortion}, ${dayjs(fileDatetime).format("h:mm A")}`;
    }
    return datePortion;
}

const iconRegex = /^[a-z0-9- ]+$/;

export function isIconValid(icon: string): boolean {
    if (isBlank(icon)) {
        return false;
    }
    return icon.match(iconRegex) != null;
}

export interface PreviewIconInfo {
    icon: string;
    expandedIcon?: string;
    color?: string;
}

const DefaultFolderIcon: PreviewIconInfo = {
    icon: "folder",
    expandedIcon: "folder-open",
    color: "#e3b341",
};

const DefaultFileIcon: PreviewIconInfo = {
    icon: "file",
    color: "#c9d1d9",
};

const directoryNameIcons: Record<string, PreviewIconInfo> = {
    ".git": { icon: "brands@git-alt", color: "#f05133" },
    ".github": { icon: "brands@github", color: "#8b949e" },
    ".gitlab": { icon: "brands@gitlab", color: "#fc6d26" },
    ".ssh": { icon: "key", color: "#fbbf24" },
    ".config": { icon: "gear", color: "#94a3b8" },
    ".cache": { icon: "database", color: "#94a3b8" },
    ".vscode": { icon: "code", color: "#3b82f6" },
    "bin": { icon: "terminal", color: "#fbbf24" },
    "sbin": { icon: "terminal", color: "#fbbf24" },
    "lib": { icon: "books", color: "#a78bfa" },
    "lib32": { icon: "books", color: "#a78bfa" },
    "lib64": { icon: "books", color: "#a78bfa" },
    "src": { icon: "code", color: "#22c55e" },
    "test": { icon: "flask-vial", color: "#ef4444" },
    "tests": { icon: "flask-vial", color: "#ef4444" },
    "__tests__": { icon: "flask-vial", color: "#ef4444" },
    "spec": { icon: "flask-vial", color: "#ef4444" },
    "specs": { icon: "flask-vial", color: "#ef4444" },
    "doc": { icon: "book", color: "#60a5fa" },
    "docs": { icon: "book", color: "#60a5fa" },
    "docker": { icon: "brands@docker", color: "#2496ed" },
    "cmake": { icon: "triangle", color: "#a855f7" },
    "build": { icon: "hammer", color: "#f59e0b" },
    "dist": { icon: "box-archive", color: "#f59e0b" },
    "out": { icon: "box-archive", color: "#f59e0b" },
    "target": { icon: "bullseye", color: "#f59e0b" },
};

const exactFileIcons: Record<string, PreviewIconInfo> = {
    ".gitignore": { icon: "brands@git-alt", color: "#f05133" },
    ".gitattributes": { icon: "brands@git-alt", color: "#f05133" },
    ".gitmodules": { icon: "brands@git-alt", color: "#f05133" },
    ".dockerignore": { icon: "brands@docker", color: "#2496ed" },
    ".env": { icon: "key", color: "#fbbf24" },
    ".env.local": { icon: "key", color: "#fbbf24" },
    "dockerfile": { icon: "brands@docker", color: "#2496ed" },
    "docker-compose.yml": { icon: "brands@docker", color: "#2496ed" },
    "docker-compose.yaml": { icon: "brands@docker", color: "#2496ed" },
    "compose.yml": { icon: "brands@docker", color: "#2496ed" },
    "compose.yaml": { icon: "brands@docker", color: "#2496ed" },
    "readme": { icon: "book-open", color: "#f59e0b" },
    "readme.md": { icon: "book-open", color: "#f59e0b" },
    "readme.txt": { icon: "book-open", color: "#f59e0b" },
    "readme.rst": { icon: "book-open", color: "#f59e0b" },
    "license": { icon: "scale-balanced", color: "#f59e0b" },
    "license.md": { icon: "scale-balanced", color: "#f59e0b" },
    "license.txt": { icon: "scale-balanced", color: "#f59e0b" },
    "copying": { icon: "scale-balanced", color: "#f59e0b" },
    "notice": { icon: "circle-info", color: "#60a5fa" },
    "notices.txt": { icon: "circle-info", color: "#60a5fa" },
    "makefile": { icon: "hammer", color: "#f59e0b" },
    "gnumakefile": { icon: "hammer", color: "#f59e0b" },
    "cmakelists.txt": { icon: "triangle", color: "#a855f7" },
    "package.json": { icon: "cube", color: "#68a063" },
    "package-lock.json": { icon: "cube", color: "#68a063" },
    "pnpm-lock.yaml": { icon: "cube", color: "#f59e0b" },
    "yarn.lock": { icon: "cube", color: "#2563eb" },
};

const extensionIcons: Record<string, PreviewIconInfo> = {
    "sh": { icon: "terminal", color: "#fbbf24" },
    "bash": { icon: "terminal", color: "#fbbf24" },
    "zsh": { icon: "terminal", color: "#fbbf24" },
    "fish": { icon: "terminal", color: "#fbbf24" },
    "ps1": { icon: "terminal", color: "#3b82f6" },
    "bat": { icon: "terminal", color: "#3b82f6" },
    "cmd": { icon: "terminal", color: "#3b82f6" },
    "ts": { icon: "file-code", color: "#3178c6" },
    "tsx": { icon: "file-code", color: "#3178c6" },
    "js": { icon: "file-code", color: "#f7df1e" },
    "jsx": { icon: "file-code", color: "#61dafb" },
    "mjs": { icon: "file-code", color: "#f7df1e" },
    "cjs": { icon: "file-code", color: "#f7df1e" },
    "go": { icon: "file-code", color: "#00add8" },
    "py": { icon: "file-code", color: "#3776ab" },
    "rs": { icon: "file-code", color: "#dea584" },
    "java": { icon: "file-code", color: "#f89820" },
    "c": { icon: "file-code", color: "#a8b9cc" },
    "cc": { icon: "file-code", color: "#a8b9cc" },
    "cpp": { icon: "file-code", color: "#00599c" },
    "h": { icon: "file-code", color: "#a8b9cc" },
    "hpp": { icon: "file-code", color: "#00599c" },
    "json": { icon: "file-code", color: "#f59e0b" },
    "jsonc": { icon: "file-code", color: "#f59e0b" },
    "yaml": { icon: "file-code", color: "#ef4444" },
    "yml": { icon: "file-code", color: "#ef4444" },
    "toml": { icon: "file-code", color: "#f59e0b" },
    "xml": { icon: "file-code", color: "#f59e0b" },
    "ini": { icon: "sliders", color: "#94a3b8" },
    "conf": { icon: "sliders", color: "#94a3b8" },
    "cfg": { icon: "sliders", color: "#94a3b8" },
    "md": { icon: "book-open", color: "#f59e0b" },
    "markdown": { icon: "book-open", color: "#f59e0b" },
    "rst": { icon: "book-open", color: "#f59e0b" },
    "txt": { icon: "file-lines", color: "#c9d1d9" },
    "log": { icon: "file-lines", color: "#c9d1d9" },
    "pdf": { icon: "file-pdf", color: "#ef4444" },
    "png": { icon: "image", color: "#22c55e" },
    "jpg": { icon: "image", color: "#22c55e" },
    "jpeg": { icon: "image", color: "#22c55e" },
    "gif": { icon: "image", color: "#22c55e" },
    "webp": { icon: "image", color: "#22c55e" },
    "svg": { icon: "image", color: "#22c55e" },
    "ico": { icon: "image", color: "#22c55e" },
    "zip": { icon: "file-zipper", color: "#f59e0b" },
    "tar": { icon: "file-zipper", color: "#f59e0b" },
    "gz": { icon: "file-zipper", color: "#f59e0b" },
    "tgz": { icon: "file-zipper", color: "#f59e0b" },
    "bz2": { icon: "file-zipper", color: "#f59e0b" },
    "xz": { icon: "file-zipper", color: "#f59e0b" },
    "7z": { icon: "file-zipper", color: "#f59e0b" },
    "rar": { icon: "file-zipper", color: "#f59e0b" },
    "cmake": { icon: "triangle", color: "#a855f7" },
};

function getFileName(path: string, fallbackName?: string): string {
    if (!isBlank(fallbackName)) {
        return fallbackName;
    }
    if (path === "/") {
        return "/";
    }
    const parts = path.split("/").filter(Boolean);
    return parts.at(-1) ?? path;
}

function getMimeTypeIconInfo(fullConfig: FullConfigType, mimeType: string): PreviewIconInfo | null {
    let currentMimeType = mimeType;
    while (currentMimeType.length > 0) {
        const config = fullConfig.mimetypes?.[currentMimeType];
        if (isIconValid(config?.icon)) {
            return {
                icon: config.icon,
                color: config.color ?? undefined,
            };
        }
        currentMimeType = currentMimeType.slice(0, -1);
    }
    return null;
}

function getIconByExtension(fileName: string): PreviewIconInfo | null {
    const lowerName = fileName.toLowerCase();
    const multiDotExtensions = [".tar.gz", ".tar.bz2", ".tar.xz"];
    const multiDotMatch = multiDotExtensions.find((suffix) => lowerName.endsWith(suffix));
    if (multiDotMatch) {
        return extensionIcons[multiDotMatch.slice(1)] ?? extensionIcons["gz"];
    }
    const ext = lowerName.includes(".") ? lowerName.split(".").pop() : "";
    if (isBlank(ext)) {
        return null;
    }
    return extensionIcons[ext] ?? null;
}

export function getPreviewIconInfo(
    entry: Pick<FileInfo, "path" | "name" | "isdir" | "mimetype">,
    fullConfig: FullConfigType
): PreviewIconInfo {
    const fileName = getFileName(entry.path, entry.name);
    const lowerName = fileName.toLowerCase();
    if (entry.isdir) {
        return directoryNameIcons[lowerName] ?? DefaultFolderIcon;
    }

    const exactIcon = exactFileIcons[lowerName];
    if (exactIcon) {
        return exactIcon;
    }

    const extensionIcon = getIconByExtension(fileName);
    if (extensionIcon) {
        return extensionIcon;
    }

    const mimeIcon = getMimeTypeIconInfo(fullConfig, entry.mimetype ?? "");
    if (mimeIcon) {
        return mimeIcon;
    }

    if ((entry.mimetype ?? "").startsWith("image/")) {
        return { icon: "image", color: "#22c55e" };
    }
    if (entry.mimetype === "application/pdf") {
        return { icon: "file-pdf", color: "#ef4444" };
    }

    return DefaultFileIcon;
}

export function getSortIcon(sortType: string | boolean): React.ReactNode {
    switch (sortType) {
        case "asc":
            return <i className="fa-solid fa-chevron-up dir-table-head-direction"></i>;
        case "desc":
            return <i className="fa-solid fa-chevron-down dir-table-head-direction"></i>;
        default:
            return null;
    }
}

export function cleanMimetype(input: string): string {
    const truncated = input.split(";")[0];
    return truncated.trim();
}

export function handleRename(
    model: PreviewModel,
    path: string,
    newPath: string,
    isDir: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        try {
            let srcuri = await model.formatRemoteUri(path, globalStore.get);
            if (isDir) {
                srcuri += "/";
            }
            await RpcApi.FileMoveCommand(TabRpcClient, {
                srcuri,
                desturi: await model.formatRemoteUri(newPath, globalStore.get),
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Rename failed: ${errorText}`);
            const errorMsg: ErrorMsg = {
                status: "Rename Failed",
                text: `${e}`,
            };
            setErrorMsg(errorMsg);
        }
        model.refreshCallback();
    });
}

export function handleFileDelete(
    model: PreviewModel,
    path: string,
    recursive: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        const formattedPath = await model.formatRemoteUri(path, globalStore.get);
        try {
            await RpcApi.FileDeleteCommand(TabRpcClient, {
                path: formattedPath,
                recursive,
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Delete failed: ${errorText}`);
            let errorMsg: ErrorMsg;
            if (errorText.includes(recursiveError) && !recursive) {
                errorMsg = {
                    status: "Confirm Delete Directory",
                    text: "Deleting a directory requires the recursive flag. Proceed?",
                    level: "warning",
                    buttons: [
                        {
                            text: "Delete Recursively",
                            onClick: () => handleFileDelete(model, path, true, setErrorMsg),
                        },
                    ],
                };
            } else {
                errorMsg = {
                    status: "Delete Failed",
                    text: `${e}`,
                };
            }
            setErrorMsg(errorMsg);
        }
        model.refreshCallback();
    });
}
