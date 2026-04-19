// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { Modal } from "@/app/modals/modal";
import {
    clearTransferHistory,
    formatTransferBytes,
    removeTransferTask,
    transferTasksAtom,
    type TransferTask,
    uploadFileWithTransfer,
} from "@/app/transfer/transfer-store";
import { TreeNodeData, TreeView } from "@/app/treeview/treeview";
import { atoms, getApi, globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { addOpenMenuItems, openCommandInNewBlock, openPreviewInNewBlock } from "@/util/previewutil";
import { fireAndForget, makeIconClass } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import {
    Header,
    Row,
    RowData,
    Table,
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import clsx from "clsx";
import { PrimitiveAtom, atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { quote as shellQuote } from "shell-quote";
import { debounce } from "throttle-debounce";
import "./directorypreview.scss";
import { Input } from "@/app/element/input";
import { EntryManagerOverlay, EntryManagerOverlayProps, EntryManagerType } from "./entry-manager";
import {
    cleanMimetype,
    getBestUnit,
    getLastModifiedTime,
    getPreviewIconInfo,
    getSortIcon,
    handleFileDelete,
    handleRename,
    mergeError,
    overwriteError,
} from "./preview-directory-utils";
import { buildRemoteFileError } from "./preview-error-util";
import { type PreviewModel } from "./preview-model";

const PageJumpSize = 20;
const TreeMaxWidth = 100000;
const ArchiveSuffixes = [".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".tbz2", ".txz", ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar"];

function getDisplayName(path: string, fallback?: string): string {
    if (fallback) {
        return fallback;
    }
    if (path === "/") {
        return "/";
    }
    const chunks = path.split("/").filter(Boolean);
    return chunks[chunks.length - 1] ?? path;
}

export function shouldIncludeDirectoryEntry(
    entry: Pick<FileInfo, "name"> | null | undefined,
    showHiddenFiles: boolean
): boolean {
    const name = entry?.name;
    if (!name) {
        return false;
    }
    if (!showHiddenFiles && name.startsWith(".") && name !== "..") {
        return false;
    }
    return true;
}

export function normalizeDirectoryEntries(entries: FileInfo[] | null | undefined): FileInfo[] {
    return entries ?? [];
}

type ArchiveExtractionPlan = {
    command: string;
    cwd: string;
    destinationLabel: string;
    title: string;
};

type UploadConfirmState = {
    files: UploadCandidate[];
    targetDir: string;
};

type UploadCandidate = {
    name: string;
    size: number;
    displayPath: string;
    localPath?: string;
    file?: File;
    lastModified?: number;
};

function getLocalFileDisplayPath(file: File): string {
    const fileWithPath = file as File & { path?: string; webkitRelativePath?: string };
    return fileWithPath.path || fileWithPath.webkitRelativePath || file.name;
}

function getPathBaseName(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const chunks = normalizedPath.split("/").filter(Boolean);
    return chunks[chunks.length - 1] ?? filePath;
}

function fileToUploadCandidate(file: File): UploadCandidate {
    const fileWithPath = file as File & { path?: string };
    return {
        name: file.name || getPathBaseName(fileWithPath.path ?? ""),
        size: file.size,
        displayPath: getLocalFileDisplayPath(file),
        localPath: fileWithPath.path,
        file,
        lastModified: file.lastModified,
    };
}

function localPathToUploadCandidate(filePath: string): UploadCandidate {
    return {
        name: getPathBaseName(filePath),
        size: 0,
        displayPath: filePath,
        localPath: filePath,
    };
}

function getParentDirectory(fileInfo: Pick<FileInfo, "path" | "dir">): string {
    if (fileInfo.dir) {
        return fileInfo.dir;
    }
    const path = fileInfo.path;
    if (!path || path === "/") {
        return "/";
    }
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash <= 0) {
        return lastSlash === 0 ? "/" : ".";
    }
    return path.slice(0, lastSlash);
}

function stripArchiveSuffix(fileName: string): string {
    const lowerName = fileName.toLowerCase();
    const matchedSuffix = ArchiveSuffixes.find((suffix) => lowerName.endsWith(suffix));
    if (!matchedSuffix) {
        return fileName;
    }
    const stripped = fileName.slice(0, -matchedSuffix.length);
    return stripped || `${fileName}-extracted`;
}

export function getArchiveExtractionPlan(
    fileInfo: Pick<FileInfo, "path" | "name" | "dir" | "mimetype">
): ArchiveExtractionPlan | null {
    const fileName = getDisplayName(fileInfo.path, fileInfo.name);
    const lowerName = fileName.toLowerCase();
    const cwd = getParentDirectory(fileInfo);
    const outputName = stripArchiveSuffix(fileName);
    const quotedFilePath = shellQuote([fileInfo.path]);
    const quotedOutputName = shellQuote([outputName]);

    if (lowerName.endsWith(".zip")) {
        return {
            command: `mkdir -p ${quotedOutputName} && unzip -o ${quotedFilePath} -d ${quotedOutputName}`,
            cwd,
            destinationLabel: `${cwd}/${outputName}`.replace("//", "/"),
            title: `解压 ${fileName}`,
        };
    }
    if (
        lowerName.endsWith(".tar") ||
        lowerName.endsWith(".tar.gz") ||
        lowerName.endsWith(".tgz") ||
        lowerName.endsWith(".tar.bz2") ||
        lowerName.endsWith(".tbz2") ||
        lowerName.endsWith(".tar.xz") ||
        lowerName.endsWith(".txz")
    ) {
        return {
            command: `mkdir -p ${quotedOutputName} && tar -xf ${quotedFilePath} -C ${quotedOutputName}`,
            cwd,
            destinationLabel: `${cwd}/${outputName}`.replace("//", "/"),
            title: `解压 ${fileName}`,
        };
    }
    if (lowerName.endsWith(".7z")) {
        return {
            command: `mkdir -p ${quotedOutputName} && cd ${quotedOutputName} && 7z x -y ${quotedFilePath}`,
            cwd,
            destinationLabel: `${cwd}/${outputName}`.replace("//", "/"),
            title: `解压 ${fileName}`,
        };
    }
    if (lowerName.endsWith(".rar")) {
        return {
            command: `mkdir -p ${quotedOutputName} && cd ${quotedOutputName} && unrar x -o+ ${quotedFilePath}`,
            cwd,
            destinationLabel: `${cwd}/${outputName}`.replace("//", "/"),
            title: `解压 ${fileName}`,
        };
    }
    if (lowerName.endsWith(".gz")) {
        return {
            command: `gunzip -c ${quotedFilePath} > ${quotedOutputName}`,
            cwd,
            destinationLabel: `${cwd}/${outputName}`.replace("//", "/"),
            title: `解压 ${fileName}`,
        };
    }
    if (lowerName.endsWith(".bz2")) {
        return {
            command: `bunzip2 -c ${quotedFilePath} > ${quotedOutputName}`,
            cwd,
            destinationLabel: `${cwd}/${outputName}`.replace("//", "/"),
            title: `解压 ${fileName}`,
        };
    }
    if (lowerName.endsWith(".xz")) {
        return {
            command: `xz -dc ${quotedFilePath} > ${quotedOutputName}`,
            cwd,
            destinationLabel: `${cwd}/${outputName}`.replace("//", "/"),
            title: `解压 ${fileName}`,
        };
    }
    return null;
}

function canExtractArchive(fileInfo: Pick<FileInfo, "path" | "name" | "dir" | "mimetype" | "isdir">): boolean {
    if (fileInfo.isdir) {
        return false;
    }
    return getArchiveExtractionPlan(fileInfo) != null;
}

function handleFileActivation(
    fileInfo: FileInfo,
    model: PreviewModel,
    conn: string,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    if (fileInfo.isdir) {
        fireAndForget(() => model.goHistory(fileInfo.path));
        return;
    }
    const extractionPlan = getArchiveExtractionPlan(fileInfo);
    if (extractionPlan) {
        const fileName = getDisplayName(fileInfo.path, fileInfo.name);
        setErrorMsg({
            status: "\u89e3\u538b\u786e\u8ba4",
            text: `\u662f\u5426\u5c06 "${fileName}" \u89e3\u538b\u5230 "${extractionPlan.destinationLabel}"\uff1f`,
            level: "warning",
            buttons: [
                {
                    text: "\u786e\u5b9a",
                    onClick: () =>
                        fireAndForget(() =>
                            openCommandInNewBlock(
                                extractionPlan.command,
                                extractionPlan.cwd,
                                conn,
                                model.blockId,
                                extractionPlan.title
                            )
                        ),
                },
            ],
        });
        return;
    }
    fireAndForget(() => openPreviewInNewBlock(fileInfo.path, conn, model.blockId));
}

export function getTreeRootPath(path: string): string {
    if (!path) {
        return "/";
    }
    if (path === "~" || path.startsWith("~/")) {
        return "~";
    }
    if (path.startsWith("/")) {
        return "/";
    }
    return path;
}

export function getAncestorPaths(rootPath: string, targetPath: string): string[] {
    if (!rootPath || !targetPath) {
        return [];
    }
    if (rootPath === "~") {
        if (!(targetPath === "~" || targetPath.startsWith("~/"))) {
            return ["~"];
        }
        const segments = targetPath.slice(2).split("/").filter(Boolean);
        const result = ["~"];
        let current = "~";
        for (const segment of segments) {
            current = `${current}/${segment}`;
            result.push(current);
        }
        return result;
    }
    if (rootPath === "/") {
        const segments = targetPath.split("/").filter(Boolean);
        const result = ["/"];
        let current = "";
        for (const segment of segments) {
            current += `/${segment}`;
            result.push(current);
        }
        return result;
    }
    if (targetPath === rootPath) {
        return [rootPath];
    }
    if (!targetPath.startsWith(`${rootPath}/`)) {
        return [rootPath];
    }
    const suffix = targetPath.slice(rootPath.length + 1);
    const segments = suffix.split("/").filter(Boolean);
    const result = [rootPath];
    let current = rootPath;
    for (const segment of segments) {
        current = `${current}/${segment}`;
        result.push(current);
    }
    return result;
}

function fileInfoToTreeNode(fileInfo: FileInfo, fullConfig: FullConfigType, parentId?: string): TreeNodeData {
    const iconInfo = getPreviewIconInfo(fileInfo, fullConfig);
    return {
        id: fileInfo.path,
        parentId,
        path: fileInfo.path,
        label: getDisplayName(fileInfo.path, fileInfo.name),
        isDirectory: !!fileInfo.isdir,
        mimeType: fileInfo.mimetype,
        icon: iconInfo.icon,
        expandedIcon: iconInfo.expandedIcon,
        iconColor: iconInfo.color,
        isReadonly: fileInfo.readonly,
        notfound: fileInfo.notfound,
        staterror: fileInfo.staterror,
        childrenStatus: fileInfo.isdir ? "unloaded" : "loaded",
    };
}

function treeNodeToFileInfo(node: TreeNodeData): FileInfo {
    const path = node.path ?? node.id;
    return {
        path,
        dir: node.parentId,
        name: node.label,
        staterror: node.staterror,
        notfound: node.notfound,
        isdir: node.isDirectory,
        mimetype: node.mimeType,
        readonly: node.isReadonly,
    };
}

interface DirectoryTableHeaderCellProps {
    header: Header<FileInfo, unknown>;
}

function DirectoryTableHeaderCell({ header }: DirectoryTableHeaderCellProps) {
    return (
        <div
            className="dir-table-head-cell"
            key={header.id}
            style={{ width: `calc(var(--header-${header.id}-size) * 1px)` }}
        >
            <div className="dir-table-head-cell-content" onClick={() => header.column.toggleSorting()}>
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                {getSortIcon(header.column.getIsSorted())}
            </div>
            <div className="dir-table-head-resize-box">
                <div
                    className="dir-table-head-resize"
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                />
            </div>
        </div>
    );
}

declare module "@tanstack/react-table" {
    interface TableMeta<TData extends RowData> {
        updateName: (path: string, isDir: boolean) => void;
        newFile: () => void;
        newDirectory: () => void;
    }
}

interface DirectoryTableProps {
    model: PreviewModel;
    data: FileInfo[];
    dirPath: string;
    rootPath: string;
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
    entryManagerOverlayPropsAtom: PrimitiveAtom<EntryManagerOverlayProps>;
    newFile: (basePath?: string) => void;
    newDirectory: (basePath?: string) => void;
    openUploadFilePicker: (targetDir: string) => void;
}

const columnHelper = createColumnHelper<FileInfo>();

function openRenameEntryManager(
    setEntryManagerProps: (props?: EntryManagerOverlayProps) => void,
    model: PreviewModel,
    path: string,
    isDir: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    const fileName = path.split("/").at(-1);
    setEntryManagerProps({
        entryManagerType: EntryManagerType.EditName,
        startingValue: fileName,
        onSave: (newName: string) => {
            if (newName !== fileName) {
                const newPath = path.slice(0, path.length - fileName.length) + newName;
                handleRename(model, path, newPath, isDir, setErrorMsg);
            }
            setEntryManagerProps(undefined);
        },
    });
}

function DirectoryTable({
    model,
    data,
    dirPath,
    rootPath,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setSelectedPath,
    setRefreshVersion,
    entryManagerOverlayPropsAtom,
    newFile,
    newDirectory,
    openUploadFilePicker,
}: DirectoryTableProps) {
    const searchActive = useAtomValue(model.directorySearchActive);
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const columns = useMemo(
        () => [
            columnHelper.accessor("mimetype", {
                cell: (info) => {
                    const iconInfo = getPreviewIconInfo(info.row.original, fullConfig);
                    return <i className={makeIconClass(iconInfo.icon, true, { defaultIcon: "file" })} style={{ color: iconInfo.color }} />;
                },
                header: () => <span></span>,
                id: "logo",
                size: 25,
                enableSorting: false,
            }),
            columnHelper.accessor("name", {
                cell: (info) => <span className="dir-table-name ellipsis">{info.getValue()}</span>,
                header: () => <span className="dir-table-head-name">Name</span>,
                sortingFn: "alphanumeric",
                size: 200,
                minSize: 90,
            }),
            columnHelper.accessor("modestr", {
                cell: (info) => <span className="dir-table-modestr">{info.getValue()}</span>,
                header: () => <span>Perm</span>,
                size: 91,
                minSize: 90,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("modtime", {
                cell: (info) => (
                    <span className="dir-table-lastmod">{getLastModifiedTime(info.getValue(), info.column)}</span>
                ),
                header: () => <span>Last Modified</span>,
                size: 91,
                minSize: 65,
                sortingFn: "datetime",
            }),
            columnHelper.accessor("size", {
                cell: (info) => <span className="dir-table-size">{getBestUnit(info.getValue())}</span>,
                header: () => <span className="dir-table-head-size">Size</span>,
                size: 55,
                minSize: 50,
                sortingFn: "auto",
            }),
            columnHelper.accessor("mimetype", {
                cell: (info) => <span className="dir-table-type ellipsis">{cleanMimetype(info.getValue() ?? "")}</span>,
                header: () => <span className="dir-table-head-type">Type</span>,
                size: 97,
                minSize: 97,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("path", {}),
        ],
        [fullConfig]
    );

    const setEntryManagerProps = useSetAtom(entryManagerOverlayPropsAtom);

    const updateName = useCallback(
        (path: string, isDir: boolean) => {
            openRenameEntryManager(setEntryManagerProps, model, path, isDir, setErrorMsg);
        },
        [model, setErrorMsg, setEntryManagerProps]
    );

    const table = useReactTable({
        data,
        columns,
        columnResizeMode: "onChange",
        getSortedRowModel: getSortedRowModel(),
        getCoreRowModel: getCoreRowModel(),

        initialState: {
            sorting: [
                {
                    id: "name",
                    desc: false,
                },
            ],
            columnVisibility: {
                path: false,
            },
        },
        enableMultiSort: false,
        enableSortingRemoval: false,
        meta: {
            updateName,
            newFile,
            newDirectory,
        },
    });
    const sortingState = table.getState().sorting;
    useEffect(() => {
        const allRows = table.getRowModel()?.flatRows || [];
        setSelectedPath((allRows[focusIndex]?.getValue("path") as string) ?? null);
    }, [focusIndex, data, setSelectedPath, sortingState]);

    const columnSizeVars = useMemo(() => {
        const headers = table.getFlatHeaders();
        const colSizes: { [key: string]: number } = {};
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i]!;
            colSizes[`--header-${header.id}-size`] = header.getSize();
            colSizes[`--col-${header.column.id}-size`] = header.column.getSize();
        }
        return colSizes;
    }, [table.getState().columnSizingInfo]);

    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [scrollHeight, setScrollHeight] = useState(0);

    const onScroll = useCallback(
        debounce(2, () => {
            if (osRef.current) {
                setScrollHeight(osRef.current.osInstance().elements().viewport.scrollTop);
            }
        }),
        []
    );

    const TableComponent = table.getState().columnSizingInfo.isResizingColumn ? MemoizedTableBody : TableBody;

    return (
        <OverlayScrollbarsComponent
            options={{ scrollbars: { autoHide: "leave" } }}
            events={{ scroll: onScroll }}
            className="dir-table"
            style={{ ...columnSizeVars }}
            ref={osRef}
            data-scroll-height={scrollHeight}
        >
            <div className="dir-table-head">
                {table.getHeaderGroups().map((headerGroup) => (
                    <div className="dir-table-head-row" key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                            <DirectoryTableHeaderCell key={header.id} header={header} />
                        ))}
                    </div>
                ))}
            </div>
            <TableComponent
                bodyRef={bodyRef}
                model={model}
                data={data}
                dirPath={dirPath}
                rootPath={rootPath}
                table={table}
                search={search}
                focusIndex={focusIndex}
                setFocusIndex={setFocusIndex}
                setSearch={setSearch}
                setSelectedPath={setSelectedPath}
                setRefreshVersion={setRefreshVersion}
                osRef={osRef.current}
                newFile={newFile}
                newDirectory={newDirectory}
                openUploadFilePicker={openUploadFilePicker}
            />
        </OverlayScrollbarsComponent>
    );
}

interface TableBodyProps {
    bodyRef: React.RefObject<HTMLDivElement>;
    model: PreviewModel;
    data: Array<FileInfo>;
    dirPath: string;
    rootPath: string;
    table: Table<FileInfo>;
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
    osRef: OverlayScrollbarsComponentRef;
    newFile: (basePath?: string) => void;
    newDirectory: (basePath?: string) => void;
    openUploadFilePicker: (targetDir: string) => void;
}

function TableBody({
    bodyRef,
    model,
    dirPath,
    rootPath,
    table,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setRefreshVersion,
    osRef,
    newFile,
    newDirectory,
    openUploadFilePicker,
}: TableBodyProps) {
    const searchActive = useAtomValue(model.directorySearchActive);
    const dummyLineRef = useRef<HTMLDivElement>(null);
    const warningBoxRef = useRef<HTMLDivElement>(null);
    const conn = useAtomValue(model.connection);
    const finfo = useAtomValue(model.statFile);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const rows = table.getRowModel().rows;
    const dotdotRow = rows.find((row) => row.original.name === "..");
    const otherRows = rows.filter((row) => row !== dotdotRow);

    useEffect(() => {
        if (focusIndex === null || !bodyRef.current || !osRef) {
            return;
        }

        const osInstance = osRef.osInstance();
        if (!osInstance) {
            return;
        }

        const rowElement = bodyRef.current.querySelector(`[data-rowindex="${focusIndex}"]`) as HTMLDivElement;
        if (!rowElement) {
            return;
        }

        const viewport = osInstance.elements().viewport;
        const viewportHeight = viewport.offsetHeight;
        const rowRect = rowElement.getBoundingClientRect();
        const parentRect = viewport.getBoundingClientRect();
        const viewportScrollTop = viewport.scrollTop;
        const rowTopRelativeToViewport = rowRect.top - parentRect.top + viewport.scrollTop;
        const rowBottomRelativeToViewport = rowRect.bottom - parentRect.top + viewport.scrollTop;

        if (rowTopRelativeToViewport - 30 < viewportScrollTop) {
            // Row is above the visible area
            let topVal = rowTopRelativeToViewport - 30;
            if (topVal < 0) {
                topVal = 0;
            }
            viewport.scrollTo({ top: topVal });
        } else if (rowBottomRelativeToViewport + 5 > viewportScrollTop + viewportHeight) {
            // Row is below the visible area
            const topVal = rowBottomRelativeToViewport - viewportHeight + 5;
            viewport.scrollTo({ top: topVal });
        }
    }, [focusIndex]);

    const handleFileContextMenu = useCallback(
        (e: any, targetFile?: FileInfo) => {
            e.preventDefault();
            e.stopPropagation();
            const menuFile = targetFile ?? finfo;
            const menu: ContextMenuItem[] = [
                {
                    label: "\u65b0\u5efa\u6587\u4ef6",
                    click: () => {
                        newFile();
                    },
                },
                {
                    label: "\u65b0\u5efa\u6587\u4ef6\u5939",
                    click: () => {
                        newDirectory();
                    },
                },
                {
                    label: "\u4e0a\u4f20\u5230\u5f53\u524d\u76ee\u5f55",
                    click: () => {
                        openUploadFilePicker(dirPath ?? rootPath);
                    },
                },
                {
                    type: "separator",
                },
            ];
            if (menuFile) {
                addOpenMenuItems(menu, conn, menuFile, model.blockId);
                if (menuFile.path && menuFile.path !== rootPath) {
                    menu.push(
                        {
                            type: "separator",
                        },
                        {
                            label: "\u5220\u9664\uff08\u4e0d\u53ef\u6062\u590d\uff09",
                            sublabel: "\u5371\u9669\u64cd\u4f5c",
                            click: () => handleFileDelete(model, menuFile.path, false, setErrorMsg),
                        }
                    );
                }
            }

            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [conn, model, newDirectory, newFile, openUploadFilePicker, rootPath, setErrorMsg]
    );

    return (
        <div className="dir-table-body" ref={bodyRef}>
            {(searchActive || search !== "") && (
                <div className="flex rounded-[3px] py-1 px-2 bg-warning text-black" ref={warningBoxRef}>
                    <span>{search === "" ? "Type to search (Esc to cancel)" : `Searching for "${search}"`}</span>
                    <div
                        className="ml-auto bg-transparent flex justify-center items-center flex-col p-0.5 rounded-md hover:bg-hoverbg focus:bg-hoverbg focus-within:bg-hoverbg cursor-pointer"
                        onClick={() => {
                            setSearch("");
                            globalStore.set(model.directorySearchActive, false);
                        }}
                    >
                        <i className="fa-solid fa-xmark" />
                        <input
                            type="text"
                            value={search}
                            onChange={() => {}}
                            className="w-0 h-0 opacity-0 p-0 border-none pointer-events-none"
                        />
                    </div>
                </div>
            )}
            <div className="dir-table-body-scroll-box">
                <div className="dummy dir-table-body-row" ref={dummyLineRef}>
                    <div className="dir-table-body-cell">dummy-data</div>
                </div>
                {dotdotRow && (
                    <TableRow
                        model={model}
                        row={dotdotRow}
                        focusIndex={focusIndex}
                        setFocusIndex={setFocusIndex}
                        setSearch={setSearch}
                        idx={0}
                        handleFileContextMenu={handleFileContextMenu}
                        key="dotdot"
                    />
                )}
                {otherRows.map((row, idx) => (
                    <TableRow
                        model={model}
                        row={row}
                        focusIndex={focusIndex}
                        setFocusIndex={setFocusIndex}
                        setSearch={setSearch}
                        idx={dotdotRow ? idx + 1 : idx}
                        handleFileContextMenu={handleFileContextMenu}
                        key={row.original.path}
                    />
                ))}
            </div>
        </div>
    );
}

type TableRowProps = {
    model: PreviewModel;
    row: Row<FileInfo>;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    idx: number;
    handleFileContextMenu: (e: any, finfo: FileInfo) => void;
};

function TableRow({
    model,
    row,
    focusIndex,
    setFocusIndex,
    setSearch,
    idx,
    handleFileContextMenu,
}: TableRowProps) {
    const dirPath = useAtomValue(model.statFilePath);
    const connection = useAtomValue(model.connection);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);

    const dragItem: DraggedFile = {
        relName: row.getValue("name") as string,
        absParent: dirPath,
        uri: formatRemoteUri(row.getValue("path") as string, connection),
        isDir: row.original.isdir,
    };
    const [_, drag] = useDrag(
        () => ({
            type: "FILE_ITEM",
            canDrag: true,
            item: () => dragItem,
        }),
        [dragItem]
    );

    const dragRef = useCallback(
        (node: HTMLDivElement | null) => {
            drag(node);
        },
        [drag]
    );

    return (
        <div
            className={clsx("dir-table-body-row", { focused: focusIndex === idx }, idx % 2 === 0 ? "row-even" : "row-odd")}
            data-rowindex={idx}
            onDoubleClick={() => {
                handleFileActivation(row.original, model, connection, setErrorMsg);
                setSearch("");
                globalStore.set(model.directorySearchActive, false);
            }}
            onClick={() => setFocusIndex(idx)}
            onContextMenu={(e) => handleFileContextMenu(e, row.original)}
            ref={dragRef}
        >
            {row.getVisibleCells().map((cell) => (
                <div
                    className={clsx("dir-table-body-cell", "col-" + cell.column.id)}
                    key={cell.id}
                    style={{ width: `calc(var(--col-${cell.column.id}-size) * 1px)` }}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    );
}

const MemoizedTableBody = React.memo(
    TableBody,
    (prev, next) => prev.table.options.data == next.table.options.data
) as typeof TableBody;

interface DirectoryTreeProps {
    model: PreviewModel;
    rootPath: string;
    dirPath: string;
    conn: string;
    connStatus: ConnStatus;
    fullConfig: FullConfigType;
    showHiddenFiles: boolean;
    selectedPath: string;
    setSelectedPath: (_: string) => void;
    setErrorMsg: (msg: ErrorMsg) => void;
    setEntryManagerProps: (props?: EntryManagerOverlayProps) => void;
    newFile: (basePath?: string) => void;
    newDirectory: (basePath?: string) => void;
    openUploadFilePicker: (targetDir: string) => void;
}

function DirectoryTree({
    model,
    rootPath,
    dirPath,
    conn,
    connStatus,
    fullConfig,
    showHiddenFiles,
    selectedPath,
    setSelectedPath,
    setErrorMsg,
    setEntryManagerProps,
    newFile,
    newDirectory,
    openUploadFilePicker,
}: DirectoryTreeProps) {
    const ensuredExpandedIds = useMemo(() => {
        const targetPath = selectedPath || dirPath || rootPath;
        return getAncestorPaths(rootPath, targetPath);
    }, [dirPath, rootPath, selectedPath]);

    const initialNodes = useMemo(
        () => ({
            [rootPath]: fileInfoToTreeNode(
                {
                    path: rootPath,
                    dir: rootPath,
                    name: rootPath === "/" ? "/" : rootPath,
                    isdir: true,
                    mimetype: "directory",
                },
                fullConfig,
                undefined
            ),
        }),
        [fullConfig, rootPath]
    );

    const showNodeContextMenu = useCallback(
        (finfo: FileInfo, event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const fileName = finfo.path.split("/").pop() ?? finfo.path;
            const isRootNode = finfo.path === rootPath;
            const uploadTargetDir = finfo.isdir ? finfo.path : (finfo.dir ?? rootPath);
            const menu: ContextMenuItem[] = [
                {
                    label: "\u65b0\u5efa\u6587\u4ef6",
                    click: () => newFile(finfo.isdir ? finfo.path : finfo.dir),
                },
                {
                    label: "\u65b0\u5efa\u6587\u4ef6\u5939",
                    click: () => newDirectory(finfo.isdir ? finfo.path : finfo.dir),
                },
                {
                    label: "\u4e0a\u4f20\u5230\u6b64\u5904",
                    click: () => openUploadFilePicker(uploadTargetDir),
                },
            ];
            if (!isRootNode) {
                menu.push(
                    {
                        label: "\u91cd\u547d\u540d",
                        click: () => openRenameEntryManager(setEntryManagerProps, model, finfo.path, !!finfo.isdir, setErrorMsg),
                    },
                    {
                        type: "separator",
                    },
                    {
                        label: "\u590d\u5236\u6587\u4ef6\u540d",
                        click: () => fireAndForget(() => navigator.clipboard.writeText(fileName)),
                    },
                    {
                        label: "\u590d\u5236\u5b8c\u6574\u6587\u4ef6\u540d",
                        click: () => fireAndForget(() => navigator.clipboard.writeText(finfo.path)),
                    },
                    {
                        label: "\u590d\u5236\u6587\u4ef6\u540d\uff08Shell \u5f15\u53f7\uff09",
                        click: () => fireAndForget(() => navigator.clipboard.writeText(shellQuote([fileName]))),
                    },
                    {
                        label: "\u590d\u5236\u5b8c\u6574\u6587\u4ef6\u540d\uff08Shell \u5f15\u53f7\uff09",
                        click: () => fireAndForget(() => navigator.clipboard.writeText(shellQuote([finfo.path]))),
                    }
                );
            }
            if (canExtractArchive(finfo)) {
                menu.push(
                    {
                        type: "separator",
                    },
                    {
                        label: "\u89e3\u538b\u5230\u5f53\u524d\u76ee\u5f55",
                        click: () => handleFileActivation(finfo, model, conn, setErrorMsg),
                    }
                );
            }
            menu.push({ type: "separator" });
            addOpenMenuItems(menu, conn, finfo, model.blockId);
            if (!isRootNode) {
                menu.push(
                    {
                        type: "separator",
                    },
                    {
                        label: "\u5220\u9664\uff08\u4e0d\u53ef\u6062\u590d\uff09",
                        sublabel: "\u5371\u9669\u64cd\u4f5c",
                        click: () => handleFileDelete(model, finfo.path, false, setErrorMsg),
                    }
                );
            }
            ContextMenuModel.getInstance().showContextMenu(menu, event);
        },
        [conn, model, newDirectory, newFile, openUploadFilePicker, rootPath, setEntryManagerProps, setErrorMsg]
    );

    const fetchDir = useCallback(
        async (id: string, limit: number) => {
            try {
                const entries = normalizeDirectoryEntries(
                    await RpcApi.FileListCommand(
                    TabRpcClient,
                    {
                        path: await model.formatRemoteUri(id, globalStore.get),
                        opts: {
                            limit,
                        },
                    },
                    null
                    )
                );
                return {
                    nodes: entries
                        .filter((entry) => entry.name !== "..")
                        .filter((entry) => shouldIncludeDirectoryEntry(entry, showHiddenFiles))
                        .map((entry) => fileInfoToTreeNode(entry, fullConfig, id)),
                };
            } catch (e) {
                const remoteError = buildRemoteFileError(e, connStatus, conn, "Cannot Read Directory");
                throw new Error(remoteError?.text ?? `${e}`);
            }
        },
        [conn, connStatus, fullConfig, model, showHiddenFiles]
    );

    return (
        <TreeView
            ref={model.directoryTreeRef}
            rootIds={[rootPath]}
            initialNodes={initialNodes}
            fetchDir={fetchDir}
            selectedId={selectedPath || dirPath || rootPath}
            defaultExpandedIds={[rootPath]}
            ensureExpandedIds={ensuredExpandedIds}
            width="100%"
            height="100%"
            minWidth={0}
            maxWidth={TreeMaxWidth}
            className="directory-tree-view border-0 rounded-none bg-transparent"
            disableDirectoryDoubleClick={true}
            onSelectionChange={(_id, node) => {
                setSelectedPath(node.path ?? node.id);
            }}
            onOpenFile={(_id, node) => {
                handleFileActivation(treeNodeToFileInfo(node), model, conn, setErrorMsg);
            }}
            onContextMenu={(_id, node, event) => {
                showNodeContextMenu(treeNodeToFileInfo(node), event);
            }}
        />
    );
}

interface DirectoryPreviewProps {
    model: PreviewModel;
}

function DirectoryPreview({ model }: DirectoryPreviewProps) {
    const [searchText, setSearchText] = useState("");
    const [focusIndex, setFocusIndex] = useState(0);
    const [unfilteredData, setUnfilteredData] = useState<FileInfo[]>([]);
    const [isNativeFileDragOver, setIsNativeFileDragOver] = useState(false);
    const [uploadConfirmState, setUploadConfirmState] = useState<UploadConfirmState | null>(null);
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const directoryViewMode = useAtomValue(model.directoryViewMode);
    const showHiddenFiles = useAtomValue(model.showHiddenFiles);
    const [showTransferPanel, setShowTransferPanel] = useAtom(model.showTransferPanel);
    const [selectedPath, setSelectedPath] = useState("");
    const [refreshVersion, setRefreshVersion] = useAtom(model.refreshVersion);
    const conn = useAtomValue(model.connection);
    const connStatus = useAtomValue(model.connStatus);
    const blockData = useAtomValue(model.blockAtom);
    const finfo = useAtomValue(model.statFile);
    const dirPath = finfo?.path;
    const rootPath = useMemo(() => getTreeRootPath(dirPath), [dirPath]);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const fileUploadInputRef = useRef<HTMLInputElement>(null);
    const pendingUploadTargetDirRef = useRef<string>("");

    useEffect(() => {
        model.refreshCallback = () => {
            setRefreshVersion((refreshVersion) => refreshVersion + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, [setRefreshVersion]);

    useEffect(
        () =>
            fireAndForget(async () => {
                if (directoryViewMode !== "list") {
                    setUnfilteredData([]);
                    return;
                }
                let entries: FileInfo[] = [];
                try {
                    const file = await RpcApi.FileReadCommand(
                        TabRpcClient,
                        {
                            info: {
                                path: await model.formatRemoteUri(dirPath, globalStore.get),
                            },
                        },
                        null
                    );
                    entries = normalizeDirectoryEntries(file.entries);
                    if (file?.info && file.info.dir && file.info?.path !== file.info?.dir) {
                        entries.unshift({
                            name: "..",
                            path: file?.info?.dir,
                            isdir: true,
                            modtime: new Date().getTime(),
                            mimetype: "directory",
                        });
                    }
                } catch (e) {
                    setErrorMsg(buildRemoteFileError(e, connStatus, conn, "Cannot Read Directory"));
                }
                setUnfilteredData(entries);
            }),
        [conn, connStatus, dirPath, directoryViewMode, refreshVersion]
    );

    const filteredData = useMemo(
        () =>
            unfilteredData?.filter((fileInfo) => {
                if (!shouldIncludeDirectoryEntry(fileInfo, showHiddenFiles)) {
                    return false;
                }
                return fileInfo.name.toLowerCase().includes(searchText);
            }) ?? [],
        [unfilteredData, showHiddenFiles, searchText]
    );
    const selectedFileInfo = filteredData.find((fileInfo) => fileInfo.path === selectedPath) ?? null;

    useEffect(() => {
        if (dirPath) {
            setSelectedPath(dirPath);
        }
    }, [dirPath]);

    useEffect(() => {
        if (directoryViewMode === "tree") {
            setSearchText("");
            globalStore.set(model.directorySearchActive, false);
        }
    }, [directoryViewMode, model]);

    useEffect(() => {
        model.directoryKeyDownHandler = (waveEvent: WaveKeyboardEvent): boolean => {
            if (directoryViewMode === "tree") {
                return false;
            }
            if (checkKeyPressed(waveEvent, "Cmd:f")) {
                globalStore.set(model.directorySearchActive, true);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Escape")) {
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowUp")) {
                setFocusIndex((idx) => Math.max(idx - 1, 0));
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowDown")) {
                setFocusIndex((idx) => Math.min(idx + 1, filteredData.length - 1));
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageUp")) {
                setFocusIndex((idx) => Math.max(idx - PageJumpSize, 0));
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageDown")) {
                setFocusIndex((idx) => Math.min(idx + PageJumpSize, filteredData.length - 1));
                return true;
            }
            if (checkKeyPressed(waveEvent, "Enter")) {
                if (selectedFileInfo == null) {
                    return;
                }
                handleFileActivation(selectedFileInfo, model, conn, setErrorMsg);
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Backspace")) {
                if (searchText.length == 0) {
                    return true;
                }
                setSearchText((current) => current.slice(0, -1));
                return true;
            }
            if (
                checkKeyPressed(waveEvent, "Space") &&
                searchText == "" &&
                PLATFORM == PlatformMacOS &&
                !blockData?.meta?.connection
            ) {
                getApi().onQuicklook(selectedPath);
                return true;
            }
            if (isCharacterKeyEvent(waveEvent)) {
                setSearchText((current) => current + waveEvent.key);
                return true;
            }
            return false;
        };
        return () => {
            model.directoryKeyDownHandler = null;
        };
    }, [conn, directoryViewMode, selectedFileInfo, selectedPath, searchText]);

    useEffect(() => {
        if (filteredData.length != 0 && focusIndex > filteredData.length - 1) {
            setFocusIndex(filteredData.length - 1);
        }
    }, [filteredData]);

    const entryManagerPropsAtom = useState(
        atom<EntryManagerOverlayProps>(null) as PrimitiveAtom<EntryManagerOverlayProps>
    )[0];
    const [entryManagerProps, setEntryManagerProps] = useAtom(entryManagerPropsAtom);

    const { refs, floatingStyles, context } = useFloating({
        open: !!entryManagerProps,
        onOpenChange: () => setEntryManagerProps(undefined),
        middleware: [offset(({ rects }) => -rects.reference.height / 2 - rects.floating.height / 2)],
    });

    const handleDropCopy = useCallback(
        async (data: CommandFileCopyData, isDir: boolean) => {
            try {
                await RpcApi.FileCopyCommand(TabRpcClient, data, { timeout: data.opts.timeout });
            } catch (e) {
                console.warn("Copy failed:", e);
                const copyError = `${e}`;
                const allowRetry = copyError.includes(overwriteError) || copyError.includes(mergeError);
                let errorMsg: ErrorMsg;
                if (allowRetry) {
                    errorMsg = {
                        status: "Confirm Overwrite File(s)",
                        text: "This copy operation will overwrite an existing file. Would you like to continue?",
                        level: "warning",
                        buttons: [
                            {
                                text: "Delete Then Copy",
                                onClick: async () => {
                                    data.opts.overwrite = true;
                                    await handleDropCopy(data, isDir);
                                },
                            },
                            {
                                text: "Sync",
                                onClick: async () => {
                                    data.opts.merge = true;
                                    await handleDropCopy(data, isDir);
                                },
                            },
                        ],
                    };
                } else {
                    errorMsg = {
                        status: "Copy Failed",
                        text: copyError,
                        level: "error",
                    };
                }
                setErrorMsg(errorMsg);
            }
            model.refreshCallback?.();
        },
        [model, setErrorMsg]
    );

    const uploadLocalFiles = useCallback(
        async (targetDir: string, inputFiles: UploadCandidate[], overwrite = false) => {
            const files = inputFiles.filter((file) => file != null);
            if (files.length === 0) {
                return;
            }

            try {
                if (!overwrite) {
                    const existingFiles: string[] = [];
                    for (const file of files) {
                        const targetPath = `${targetDir}/${file.name}`;
                        const remotePath = await model.formatRemoteUri(targetPath, globalStore.get);
                        const fileInfo = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: remotePath } }, null);
                        if (fileInfo && !fileInfo.notfound) {
                            existingFiles.push(file.name);
                        }
                    }
                    if (existingFiles.length > 0) {
                        setErrorMsg({
                            status: "\u786e\u8ba4\u8986\u76d6",
                            text: `\u76ee\u6807\u6587\u4ef6\u5939 "${targetDir}" \u4e2d\u5df2\u5b58\u5728\uff1a${existingFiles.join("\u3001")}\u3002\u662f\u5426\u7ee7\u7eed\u8986\u76d6\uff1f`,
                            level: "warning",
                            buttons: [
                                {
                                    text: "\u8986\u76d6",
                                    onClick: () => {
                                        void uploadLocalFiles(targetDir, files, true);
                                    },
                                },
                            ],
                        });
                        return;
                    }
                }

                for (const file of files) {
                    const targetPath = `${targetDir}/${file.name}`;
                    await uploadFileWithTransfer({
                        file: file.file,
                        localPath: file.localPath,
                        name: file.name,
                        size: file.size,
                        connection: conn,
                        targetPath,
                        resolveRemotePath: (nextTargetPath) => model.formatRemoteUri(nextTargetPath, globalStore.get),
                        onCompleted: () => model.refreshCallback?.(),
                    });
                    model.refreshCallback?.();
                }
                model.refreshCallback();
            } catch (e) {
                setErrorMsg({
                    status: "\u4e0a\u4f20\u5931\u8d25",
                    text: `${e}`,
                    level: "error",
                });
            }
        },
        [conn, model, setErrorMsg]
    );

    const beginUploadFlow = useCallback((targetDir: string, files: UploadCandidate[]) => {
        const filteredFiles = files.filter((file) => file != null);
        if (filteredFiles.length === 0) {
            return;
        }
        setUploadConfirmState({
            files: filteredFiles,
            targetDir,
        });
    }, []);

    const openUploadFilePicker = useCallback((targetDir: string) => {
        pendingUploadTargetDirRef.current = targetDir;
        const api = getApi();
        if (api?.pickUploadFiles) {
            fireAndForget(async () => {
                const filePaths = await api.pickUploadFiles();
                beginUploadFlow(
                    targetDir,
                    (filePaths ?? []).filter((filePath) => filePath != null && filePath !== "").map((filePath) => localPathToUploadCandidate(filePath))
                );
            });
            return;
        }
        if (fileUploadInputRef.current) {
            fileUploadInputRef.current.value = "";
            fileUploadInputRef.current.click();
        }
    }, [beginUploadFlow]);

    const hasNativeFilesDragged = useCallback((dataTransfer: DataTransfer) => dataTransfer?.types?.includes("Files") ?? false, []);

    const handleNativeFileDragOver = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            if (!hasNativeFilesDragged(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            setIsNativeFileDragOver(true);
        },
        [hasNativeFilesDragged]
    );

    const handleNativeFileDragLeave = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            if (!hasNativeFilesDragged(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const { clientX, clientY } = e;
            if (clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom) {
                setIsNativeFileDragOver(false);
            }
        },
        [hasNativeFilesDragged]
    );

    const handleNativeFileDrop = useCallback(
        async (e: React.DragEvent<HTMLDivElement>) => {
            if (!e.dataTransfer.files?.length) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            setIsNativeFileDragOver(false);
            beginUploadFlow(
                dirPath ?? rootPath,
                Array.from(e.dataTransfer.files).map((file) => fileToUploadCandidate(file))
            );
        },
        [beginUploadFlow, dirPath, rootPath]
    );

    const [, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM", //a name of file drop type
            canDrop: (_, monitor) => {
                const dragItem = monitor.getItem<DraggedFile>();
                // drop if not current dir is the parent directory of the dragged item
                // requires absolute path
                if (monitor.isOver({ shallow: false }) && dragItem.absParent !== dirPath) {
                    return true;
                }
                return false;
            },
            drop: async (draggedFile: DraggedFile, monitor) => {
                if (!monitor.didDrop()) {
                    const timeoutYear = 31536000000; // one year
                    const opts: FileCopyOpts = {
                        timeout: timeoutYear,
                    };
                    const desturi = await model.formatRemoteUri(dirPath, globalStore.get);
                    const data: CommandFileCopyData = {
                        srcuri: draggedFile.uri,
                        desturi,
                        opts,
                    };
                    await handleDropCopy(data, draggedFile.isDir);
                }
            },
            // TODO: mabe add a hover option?
        }),
        [dirPath, model.formatRemoteUri, model.refreshCallback]
    );

    useEffect(() => {
        drop(refs.reference);
    }, [refs.reference]);

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const newFile = useCallback((basePath?: string) => {
        const targetDir = basePath ?? dirPath;
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewFile,
            onSave: (newName: string) => {
                fireAndForget(async () => {
                    await RpcApi.FileCreateCommand(
                        TabRpcClient,
                        {
                            info: {
                                path: await model.formatRemoteUri(`${targetDir}/${newName}`, globalStore.get),
                            },
                        },
                        null
                    );
                    model.refreshCallback();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath, model, setEntryManagerProps]);
    const newDirectory = useCallback((basePath?: string) => {
        const targetDir = basePath ?? dirPath;
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewDirectory,
            onSave: (newName: string) => {
                fireAndForget(async () => {
                    await RpcApi.FileMkdirCommand(TabRpcClient, {
                        info: {
                            path: await model.formatRemoteUri(`${targetDir}/${newName}`, globalStore.get),
                        },
                    });
                    model.refreshCallback();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath, model, setEntryManagerProps]);

    const handleFileContextMenu = useCallback(
        (e: any) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: "新建文件",
                    click: () => {
                        newFile();
                    },
                },
                {
                    label: "新建文件夹",
                    click: () => {
                        newDirectory();
                    },
                },
                {
                    label: "上传到当前目录",
                    click: () => {
                        openUploadFilePicker(dirPath ?? rootPath);
                    },
                },
                {
                    type: "separator",
                },
            ];
            addOpenMenuItems(menu, conn, finfo, model.blockId);

            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [conn, dirPath, finfo, model.blockId, newDirectory, newFile, openUploadFilePicker, rootPath]
    );

    return (
        <Fragment>
            <div
                ref={refs.setReference}
                className={clsx("dir-table-container", isNativeFileDragOver && "native-file-drag-over")}
                onChangeCapture={(e) => {
                    const event = e as React.ChangeEvent<HTMLInputElement>;
                    if (!entryManagerProps && event.target.type !== "file") {
                        setSearchText(event.target.value.toLowerCase());
                    }
                }}
                {...getReferenceProps()}
                onContextMenu={(e) => handleFileContextMenu(e)}
                onClick={() => setEntryManagerProps(undefined)}
                onDragEnter={handleNativeFileDragOver}
                onDragOver={handleNativeFileDragOver}
                onDragLeave={handleNativeFileDragLeave}
                onDrop={handleNativeFileDrop}
            >
                <input
                    ref={fileUploadInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={(e) => {
                        const targetDir = pendingUploadTargetDirRef.current || dirPath || rootPath;
                        const files = Array.from(e.target.files ?? []);
                        beginUploadFlow(
                            targetDir,
                            files.map((file) => fileToUploadCandidate(file))
                        );
                    }}
                />
                {isNativeFileDragOver && (
                    <div className="native-file-upload-overlay">{"\u4e0a\u4f20\u5230\uff1a"} {dirPath ?? rootPath}</div>
                )}
                {directoryViewMode === "tree" && dirPath && finfo ? (
                    <DirectoryTree
                        key={`${rootPath}:${refreshVersion}`}
                        model={model}
                        rootPath={rootPath}
                        dirPath={dirPath}
                        conn={conn}
                        connStatus={connStatus}
                        fullConfig={fullConfig}
                        showHiddenFiles={showHiddenFiles}
                        selectedPath={selectedPath}
                        setSelectedPath={setSelectedPath}
                        setErrorMsg={setErrorMsg}
                        setEntryManagerProps={setEntryManagerProps}
                        newFile={newFile}
                        newDirectory={newDirectory}
                        openUploadFilePicker={openUploadFilePicker}
                    />
                ) : (
                    <DirectoryTable
                        model={model}
                        data={filteredData}
                        dirPath={dirPath}
                        rootPath={rootPath}
                        search={searchText}
                        focusIndex={focusIndex}
                        setFocusIndex={setFocusIndex}
                        setSearch={setSearchText}
                        setSelectedPath={setSelectedPath}
                        setRefreshVersion={setRefreshVersion}
                        entryManagerOverlayPropsAtom={entryManagerPropsAtom}
                        newFile={newFile}
                        newDirectory={newDirectory}
                        openUploadFilePicker={openUploadFilePicker}
                    />
                )}
                {showTransferPanel && (
                    <TransferMiniPanel onClose={() => setShowTransferPanel(false)} />
                )}
            </div>
            {entryManagerProps && (
                <EntryManagerOverlay
                    {...entryManagerProps}
                    forwardRef={refs.setFloating}
                    style={floatingStyles}
                    getReferenceProps={getFloatingProps}
                    onCancel={() => setEntryManagerProps(undefined)}
                />
            )}
            {uploadConfirmState && (
                <Modal
                    className="upload-confirm-modal"
                    onCancel={() => setUploadConfirmState(null)}
                    onClose={() => setUploadConfirmState(null)}
                    onClickBackdrop={() => setUploadConfirmState(null)}
                    onOk={() => {
                        void uploadLocalFiles(uploadConfirmState.targetDir, uploadConfirmState.files);
                        setUploadConfirmState(null);
                    }}
                    cancelLabel="取消"
                    okLabel="确定"
                    okDisabled={uploadConfirmState.targetDir.trim() === ""}
                >
                    <div className="upload-confirm-content">
                        <div className="upload-confirm-title">{"\u5c06\u4e0b\u5217\u6587\u4ef6\u4e0a\u4f20\u5230\u6307\u5b9a\u6587\u4ef6\u5939"}</div>
                        <div className="upload-confirm-file-list">
                            {uploadConfirmState.files.map((file) => (
                                <div key={`${file.name}-${file.displayPath}-${file.lastModified ?? "local"}`} className="upload-confirm-file-item">
                                    {file.displayPath}
                                </div>
                            ))}
                        </div>
                        <div className="upload-confirm-label">{"\u76ee\u6807\u6587\u4ef6\u5939:"}</div>
                        <Input
                            value={uploadConfirmState.targetDir}
                            onChange={(value) =>
                                setUploadConfirmState((current) => (current == null ? current : { ...current, targetDir: value }))
                            }
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && event.ctrlKey && uploadConfirmState.targetDir.trim() !== "") {
                                    event.preventDefault();
                                    void uploadLocalFiles(uploadConfirmState.targetDir, uploadConfirmState.files);
                                    setUploadConfirmState(null);
                                }
                            }}
                            autoFocus={true}
                            className="upload-confirm-target-input"
                        />
                    </div>
                </Modal>
            )}
            {showTransferPanel && (
                <TransferMiniPanel onClose={() => setShowTransferPanel(false)} />
            )}
        </Fragment>
    );
}

function getMiniTaskIcon(task: TransferTask): string {
    if (task.status === "completed") return "circle-check";
    if (task.status === "error") return "circle-xmark";
    if (task.status === "cancelled") return "ban";
    return task.direction === "upload" ? "arrow-up-from-bracket" : "arrow-down-to-bracket";
}

function getMiniTaskStatusText(task: TransferTask): string {
    if (task.status === "pending") return "等待中";
    if (task.status === "running") return `${Math.round(task.progress)}% · ${formatTransferBytes(task.speedBytesPerSecond)}/s`;
    if (task.status === "completed") return "已完成";
    if (task.status === "cancelled") return "已取消";
    return "失败";
}

function getMiniTaskStatusClass(task: TransferTask): string {
    if (task.status === "completed") return "completed";
    if (task.status === "error") return "error";
    if (task.status === "cancelled") return "cancelled";
    if (task.status === "running") return "running";
    return "pending";
}

function TransferMiniPanel({ onClose }: { onClose: () => void }) {
    const tasks = useAtomValue(transferTasksAtom);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                const target = e.target as HTMLElement;
                if (target.closest(".wave-iconbutton")) return;
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onClose]);

    const runningTasks = tasks.filter((t) => t.status === "pending" || t.status === "running");
    const finishedTasks = tasks.filter((t) => t.status === "completed" || t.status === "error" || t.status === "cancelled");
    const displayFinished = finishedTasks.slice(0, 5);
    const hasMore = finishedTasks.length > 5;
    const canClear = finishedTasks.length > 0;

    return (
        <div ref={panelRef} className="transfer-mini-panel">
            <div className="transfer-mini-header">
                <span className="transfer-mini-title">传输</span>
                {runningTasks.length > 0 && (
                    <span className="transfer-mini-running-count">{runningTasks.length} 个进行中</span>
                )}
                {canClear && (
                    <button type="button" className="transfer-mini-clear" onClick={() => clearTransferHistory()}>
                        清空
                    </button>
                )}
            </div>
            {tasks.length === 0 ? (
                <div className="transfer-mini-empty">暂无传输任务</div>
            ) : (
                <div className="transfer-mini-list">
                    {runningTasks.map((task) => (
                        <div key={task.id} className="transfer-mini-item running">
                            <i className={makeIconClass(getMiniTaskIcon(task), true)} />
                            <div className="transfer-mini-item-info">
                                <div className="transfer-mini-item-name">{task.name}</div>
                                <div className="transfer-mini-item-status">
                                    <span className={getMiniTaskStatusClass(task)}>{getMiniTaskStatusText(task)}</span>
                                </div>
                            </div>
                            <div className="transfer-mini-progress">
                                <div className="transfer-mini-progress-fill" style={{ width: `${task.progress}%` }} />
                            </div>
                        </div>
                    ))}
                    {displayFinished.map((task) => (
                        <div key={task.id} className="transfer-mini-item finished">
                            <i className={makeIconClass(getMiniTaskIcon(task), true)} />
                            <div className="transfer-mini-item-info">
                                <div className="transfer-mini-item-name">{task.name}</div>
                                <div className="transfer-mini-item-status">
                                    <span className={getMiniTaskStatusClass(task)}>{getMiniTaskStatusText(task)}</span>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="transfer-mini-remove"
                                title="移除"
                                onClick={() => removeTransferTask(task.id)}
                            >
                                <i className={makeIconClass("xmark", false)} />
                            </button>
                        </div>
                    ))}
                    {hasMore && <div className="transfer-mini-more">还有 {finishedTasks.length - 5} 个已结束任务</div>}
                </div>
            )}
        </div>
    );
}

export { DirectoryPreview, TransferMiniPanel };
