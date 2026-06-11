// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { Modal } from "@/app/modals/modal";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWidgetWidthMenuItems } from "@/app/workspace/widgetsettings";
import { WOS } from "@/store/global";
import { openCommandInNewBlock, sendCommandToTerminal } from "@/util/previewutil";
import { atom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
    buildDockerExecCommand,
    buildDockerLogsCommand,
    buildDockerPullCommand,
    buildDockerSaveCommand,
    canRemoveDockerContainer,
    dockerContainerMatchesSearch,
    dockerStateBadgeClass,
    dockerStateLabel,
    dockerStateNameClass,
    getDockerErrorHeadline,
    isDockerContainerStarred,
    loadDockerStarredContainerIds,
    saveDockerStarredContainerIds,
    shortenDockerId,
    sortDockerContainersForDisplay,
    toggleDockerStarredContainerId,
} from "./docker-util";

const searchInputClass =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent";

const panelClass = "rounded-xl border border-zinc-800 bg-zinc-950/70 p-4";
const DockerViewComponent = memo(DockerView);
type DockerTabKey = "containers" | "images";

function IconActionButton({
    icon,
    label,
    onClick,
    disabled,
    pending,
    variant = "default",
}: {
    icon: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    pending?: boolean;
    variant?: "default" | "danger" | "primary";
}) {
    const variantClass =
        variant === "danger"
            ? "text-red-400 border-zinc-700 hover:text-red-300 hover:border-red-500 hover:bg-red-500/10"
            : variant === "primary"
              ? "text-accent border-zinc-700 hover:border-accent hover:bg-accent/10"
              : "text-zinc-400 border-zinc-700 hover:text-zinc-100 hover:border-zinc-500";
    return (
        <button
            type="button"
            className={[
                "relative flex h-[30px] w-[30px] items-center justify-center rounded-md border bg-zinc-900 text-xs transition-all duration-200",
                variantClass,
                pending ? "opacity-70 cursor-wait docker-pending-spin" : "",
                disabled ? "opacity-40 cursor-not-allowed" : "",
            ].join(" ")}
            onClick={onClick}
            disabled={disabled || pending}
            title={label}
            aria-label={label}
        >
            <i className={`fa ${icon}`} />
        </button>
    );
}

function RowMoreButton({
    onClick,
    disabled,
}: {
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-400 text-xs transition-all hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClick}
            disabled={disabled}
            aria-label="更多操作"
            title="更多操作"
        >
            <i className="fa fa-ellipsis-h" />
        </button>
    );
}

function ErrorPanel({ error, onRefresh }: { error: DockerError; onRefresh: () => void }) {
    return (
        <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 text-center">
                <div className="text-lg font-semibold text-zinc-100">{getDockerErrorHeadline(error)}</div>
                {error?.detail ? <div className="mt-2 text-sm text-zinc-400">{error.detail}</div> : null}
                <div className="mt-4">
                    <Button onClick={onRefresh}>刷新</Button>
                </div>
            </div>
        </div>
    );
}

function EmptyList({ title }: { title: string }) {
    return (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-6 text-center text-sm text-zinc-500">
            {title}
        </div>
    );
}

function DockerTabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                active
                    ? "border-accent bg-accent text-black"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100",
            ].join(" ")}
        >
            {label}
        </button>
    );
}

function CopyableId({ value, label }: { value: string; label: string }) {
    if (!value) {
        return <span className="text-zinc-600">-</span>;
    }
    return (
        <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-zinc-400">{shortenDockerId(value)}</span>
            <CopyButton
                className="copy-button !h-[18px] !w-[18px] !min-w-[18px] !text-[9px]"
                onClick={() => {
                    void navigator.clipboard.writeText(value);
                }}
                title={`复制${label}`}
            />
        </div>
    );
}

function DockerView({ blockId }: ViewComponentProps<DockerViewModel>) {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const connection = (blockData?.meta?.connection as string) ?? "";
    const [activeTab, setActiveTab] = useState<DockerTabKey>("containers");
    const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
    const [images, setImages] = useState<DockerImageSummary[]>([]);
    const [containersSearch, setContainersSearch] = useState("");
    const [containerImageSearch, setContainerImageSearch] = useState("");
    const [imagesSearch, setImagesSearch] = useState("");
    const [pullImageRef, setPullImageRef] = useState("");
    const [starredContainerIds, setStarredContainerIds] = useState<string[]>([]);
    const [loadedStarStorageConnection, setLoadedStarStorageConnection] = useState<string | null>(null);
    const [renameContainer, setRenameContainer] = useState<DockerContainerSummary | null>(null);
    const [renameContainerName, setRenameContainerName] = useState("");
    const [renameContainerError, setRenameContainerError] = useState<string | null>(null);
    const [renameContainerSubmitting, setRenameContainerSubmitting] = useState(false);
    const renameContainerInputRef = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<DockerError | null>(null);
    const [actionError, setActionError] = useState<DockerError | null>(null);
    const [pendingActions, setPendingActions] = useState<Record<string, string>>({});

    const refreshData = useCallback(
        async (showLoading = false) => {
            if (showLoading) {
                setLoading(true);
            }
            try {
                const [containersResp, imagesResp] = await Promise.all([
                    RpcApi.DockerListContainersCommand(TabRpcClient, {
                        connection,
                        all: true,
                    }),
                    RpcApi.DockerListImagesCommand(TabRpcClient, {
                        connection,
                    }),
                ]);
                setContainers(containersResp?.containers ?? []);
                setImages(imagesResp?.images ?? []);
                setError(containersResp?.error ?? imagesResp?.error ?? null);
            } catch (err) {
                const message = err instanceof Error ? err.message : "加载 Docker 数据失败。";
                setError({ code: "unknown", message });
            } finally {
                setLoading(false);
            }
        },
        [connection]
    );

    useEffect(() => {
        setActionError(null);
        void refreshData(true);
        const intervalId = window.setInterval(() => {
            if (document.visibilityState === "visible") {
                void refreshData(false);
            }
        }, 5000);
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void refreshData(false);
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            window.clearInterval(intervalId);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [refreshData]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        setStarredContainerIds(loadDockerStarredContainerIds(window.localStorage, connection));
        setLoadedStarStorageConnection(connection);
    }, [connection]);

    useEffect(() => {
        if (typeof window === "undefined" || loadedStarStorageConnection !== connection) {
            return;
        }
        saveDockerStarredContainerIds(window.localStorage, connection, starredContainerIds);
    }, [connection, loadedStarStorageConnection, starredContainerIds]);

    const filteredContainers = useMemo(() => {
        return containers.filter((container) =>
            dockerContainerMatchesSearch(container, containersSearch, containerImageSearch)
        );
    }, [containerImageSearch, containers, containersSearch]);

    const sortedContainers = useMemo(
        () => sortDockerContainersForDisplay(filteredContainers, starredContainerIds),
        [filteredContainers, starredContainerIds]
    );

    const containerEmptyTitle =
        containers.length === 0 ? "当前连接没有容器。" : "没有匹配的容器，请试试别的关键词。";
    const imageEmptyTitle = images.length === 0 ? "当前连接没有镜像。" : "没有匹配的镜像，请试试别的关键词。";

    const filteredImages = useMemo(() => {
        const search = imagesSearch.trim().toLowerCase();
        const filtered = search === ""
            ? images
            : images.filter((image) =>
                [image.repository, image.tag, image.id, image.sizeText].join(" ").toLowerCase().includes(search)
            );
        return filtered
            .map((image, index) => ({ image, index }))
            .sort((left, right) => {
                if (right.image.containers !== left.image.containers) {
                    return right.image.containers - left.image.containers;
                }
                return left.index - right.index;
            })
            .map(({ image }) => image);
    }, [images, imagesSearch]);

    const runContainerAction = useCallback(
        async (containerId: string, action: "start" | "stop" | "kill" | "restart" | "remove") => {
            const actionKey = `${action}:${containerId}`;
            setPendingActions((prev) => ({ ...prev, [actionKey]: action }));
            setActionError(null);
            const isAsyncAction = action === "stop" || action === "restart";
            try {
                const resp = await RpcApi.DockerContainerActionCommand(TabRpcClient, {
                    connection,
                    containerId,
                    action,
                });
                if (resp?.error) {
                    if (isAsyncAction && (resp.error.detail?.includes("deadline") || resp.error.detail?.includes("timeout") || resp.error.detail?.includes("context"))) {
                        // 超时类错误：静默处理，靠轮询刷新
                    } else {
                        setActionError(resp.error);
                    }
                }
                await refreshData(false);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Docker 操作失败。";
                if (isAsyncAction && (message.includes("deadline") || message.includes("timeout") || message.includes("context"))) {
                    // 超时类错误：静默处理，靠轮询刷新
                    await refreshData(false);
                } else {
                    setActionError({ code: "unknown", message });
                }
            } finally {
                setPendingActions((prev) => {
                    const next = { ...prev };
                    delete next[actionKey];
                    return next;
                });
            }
        },
        [connection, refreshData]
    );

    const runImageRemove = useCallback(
        async (imageId: string) => {
            const actionKey = `remove-image:${imageId}`;
            setPendingActions((prev) => ({ ...prev, [actionKey]: "remove" }));
            setActionError(null);
            try {
                const resp = await RpcApi.DockerImageActionCommand(TabRpcClient, {
                    connection,
                    imageId,
                    action: "remove",
                });
                if (resp?.error) {
                    setActionError(resp.error);
                    return;
                }
                await refreshData(false);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Docker 操作失败。";
                setActionError({ code: "unknown", message });
            } finally {
                setPendingActions((prev) => {
                    const next = { ...prev };
                    delete next[actionKey];
                    return next;
                });
            }
        },
        [connection, refreshData]
    );

    const openLogs = useCallback(
        async (containerId: string, containerName: string) => {
            await openCommandInNewBlock(
                buildDockerLogsCommand(containerId),
                "",
                connection,
                blockId,
                `日志：${containerName || containerId}`
            );
        },
        [blockId, connection]
    );

    const execIntoContainer = useCallback(
        async (containerId: string) => {
            await sendCommandToTerminal(buildDockerExecCommand(containerId), connection, blockId);
        },
        [blockId, connection]
    );

    const runPullImage = useCallback(
        async (rawImageRef: string) => {
            const imageRef = rawImageRef.trim();
            if (imageRef === "") {
                return;
            }
            setActionError(null);
            await openCommandInNewBlock(buildDockerPullCommand(imageRef), "", connection, blockId, `更新：${imageRef}`);
        },
        [blockId, connection]
    );

    const pullImage = useCallback(async () => {
        await runPullImage(pullImageRef);
        setPullImageRef("");
    }, [pullImageRef, runPullImage]);

    const saveImage = useCallback(
        async (imageRef: string) => {
            if (!imageRef || imageRef === "<none>") {
                return;
            }
            setActionError(null);
            await openCommandInNewBlock(buildDockerSaveCommand(imageRef), "", connection, blockId, `导出：${imageRef}`);
        },
        [blockId, connection]
    );

    const openRenameContainer = useCallback((container: DockerContainerSummary) => {
        setRenameContainer(container);
        setRenameContainerName(container.name || "");
        setRenameContainerError(null);
        setActionError(null);
    }, []);

    const closeRenameContainer = useCallback(() => {
        if (renameContainerSubmitting) {
            return;
        }
        setRenameContainer(null);
        setRenameContainerName("");
        setRenameContainerError(null);
    }, [renameContainerSubmitting]);

    const submitRenameContainer = useCallback(async () => {
        if (renameContainer == null || renameContainerSubmitting) {
            return;
        }
        const nextName = renameContainerName.trim();
        if (nextName === "" || nextName === renameContainer.name) {
            return;
        }
        setRenameContainerSubmitting(true);
        setRenameContainerError(null);
        try {
            const resp = await RpcApi.DockerContainerActionCommand(TabRpcClient, {
                connection,
                containerId: renameContainer.id,
                action: "rename",
                newName: nextName,
            });
            if (resp?.error) {
                setRenameContainerError(resp.error.detail || resp.error.message);
                return;
            }
            setRenameContainer(null);
            setRenameContainerName("");
            await refreshData(false);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Docker 操作失败。";
            setRenameContainerError(message);
        } finally {
            setRenameContainerSubmitting(false);
        }
    }, [connection, refreshData, renameContainer, renameContainerName, renameContainerSubmitting]);

    const toggleContainerStar = useCallback((containerId: string) => {
        setStarredContainerIds((currentIds) => toggleDockerStarredContainerId(currentIds, containerId));
    }, []);

    useEffect(() => {
        if (renameContainer == null) {
            return;
        }
        window.setTimeout(() => {
            renameContainerInputRef.current?.focus({ preventScroll: true });
            renameContainerInputRef.current?.select();
        }, 0);
    }, [renameContainer]);

    if (loading) {
        return <div className="flex h-full items-center justify-center text-sm text-zinc-400">正在加载 Docker...</div>;
    }

    if (error != null) {
        return <ErrorPanel error={error} onRefresh={() => void refreshData(true)} />;
    }

    return (
        <div className="h-full w-full min-w-0 overflow-y-auto bg-zinc-900 p-4 text-zinc-100">
            <style>{`
                @keyframes docker-breathe {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
                @keyframes docker-glow-pulse {
                    0%, 100% { text-shadow: 0 0 4px currentColor; }
                    50% { text-shadow: 0 0 10px currentColor, 0 0 20px currentColor; }
                }
                @keyframes docker-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes docker-row-in {
                    from { opacity: 0; transform: translateY(6px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes docker-star-pop {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.3); }
                    100% { transform: scale(1); }
                }
                .docker-state-running {
                    animation: docker-breathe 3s ease-in-out infinite, docker-glow-pulse 3s ease-in-out infinite;
                }
                .docker-state-restarting {
                    animation: docker-breathe 1.5s ease-in-out infinite;
                }
                .docker-pending-spin i {
                    animation: docker-spin 1s linear infinite;
                }
                .docker-row-enter {
                    animation: docker-row-in 0.3s ease-out both;
                }
                .docker-star-animate {
                    animation: docker-star-pop 0.3s ease-out;
                }
            `}</style>
            <div className="flex w-full min-w-0 flex-col gap-4">
                {actionError ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        <div className="font-medium">{getDockerErrorHeadline(actionError)}</div>
                        {actionError.detail ? <div className="mt-1 opacity-80">{actionError.detail}</div> : null}
                    </div>
                ) : null}

                <div className={panelClass}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-lg font-semibold text-zinc-100">容器管理 ：{connection === "" ? "本机" : connection}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <DockerTabButton
                                active={activeTab === "containers"}
                                label="容器"
                                onClick={() => setActiveTab("containers")}
                            />
                            <DockerTabButton
                                active={activeTab === "images"}
                                label="镜像"
                                onClick={() => setActiveTab("images")}
                            />
                            <Button className="grey" onClick={() => void refreshData(true)}>
                                刷新
                            </Button>
                        </div>
                    </div>
                </div>
                {activeTab === "containers" ? (
                    <div key="docker-containers-panel" className={panelClass}>
                        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <div className="text-base font-semibold text-zinc-100">列表</div>
                            </div>
                            <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
                                <input
                                    className={`${searchInputClass} sm:flex-1`}
                                    placeholder="搜索容器名"
                                    value={containersSearch}
                                    onChange={(e) => setContainersSearch(e.target.value)}
                                />
                                <input
                                    className={`${searchInputClass} sm:flex-1`}
                                    placeholder="搜索镜像ID"
                                    value={containerImageSearch}
                                    onChange={(e) => setContainerImageSearch(e.target.value)}
                                />
                            </div>
                        </div>
                        {sortedContainers.length === 0 ? (
                            <EmptyList title={containerEmptyTitle} />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b border-zinc-800 bg-zinc-900/80">
                                            <th className="w-[40px] px-3 py-2 text-left text-xs font-medium text-zinc-500"></th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">容器名称</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">ID</th>
                                            <th className="w-[160px] px-3 py-2 text-right text-xs font-medium text-zinc-500">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedContainers.map((container) => {
                                            const containerKey = container.id;
                                            const stateLabel = dockerStateLabel(container.state);
                                            const disableRemove = !canRemoveDockerContainer(container.state);
                                            const isBusy = Object.keys(pendingActions).some((key) => key.endsWith(`:${containerKey}`));
                                            const isTogglePending =
                                                `start:${containerKey}` in pendingActions || `stop:${containerKey}` in pendingActions;
                                            const isRestartPending = `restart:${containerKey}` in pendingActions;
                                            const isRunningLike =
                                                container.state === "running" ||
                                                container.state === "paused" ||
                                                container.state === "restarting";
                                            const starred = isDockerContainerStarred(starredContainerIds, container.id);
                                            const openContainerMenu = (event: MouseEvent<HTMLButtonElement>) => {
                                                const menu: ContextMenuItem[] = [
                                                    {
                                                        label: "重命名",
                                                        click: () => {
                                                            openRenameContainer(container);
                                                        },
                                                    },
                                                    {
                                                        type: "separator",
                                                    },
                                                    {
                                                        label: starred ? "取消星标" : "添加星标",
                                                        click: () => {
                                                            toggleContainerStar(container.id);
                                                        },
                                                    },
                                                    {
                                                        type: "separator",
                                                    },
                                                    {
                                                        label: "强制停止",
                                                        enabled: isRunningLike && !isBusy,
                                                        click: () => {
                                                            void runContainerAction(container.id, "kill");
                                                        },
                                                    },
                                                    {
                                                        label: "日志",
                                                        click: () => {
                                                            void openLogs(container.id, container.name);
                                                        },
                                                    },
                                                    {
                                                        type: "separator",
                                                    },
                                                    {
                                                        label: "删除",
                                                        enabled: !disableRemove && !isBusy,
                                                        click: () => {
                                                            void runContainerAction(container.id, "remove");
                                                        },
                                                    },
                                                ];
                                                ContextMenuModel.getInstance().showContextMenu(menu, event);
                                            };
                                            return (
                                                <tr
                                                    key={containerKey}
                                                    className={[
                                                        "border-b border-zinc-800/60 transition-colors duration-300 last:border-b-0 docker-row-enter",
                                                        starred
                                                            ? "bg-emerald-950/15 hover:bg-emerald-950/25"
                                                            : "hover:bg-zinc-800/30",
                                                    ].join(" ")}
                                                >
                                                    <td className="px-3 py-2.5">
                                                        <button
                                                            type="button"
                                                            className={[
                                                                "flex h-[26px] w-[26px] items-center justify-center rounded-md border transition-all duration-200",
                                                                starred
                                                                    ? "border-amber-400/40 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25 docker-star-animate"
                                                                    : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-amber-400/40 hover:text-amber-300",
                                                            ].join(" ")}
                                                            onClick={() => toggleContainerStar(container.id)}
                                                            aria-label={starred ? "取消星标" : "添加星标"}
                                                            aria-pressed={starred}
                                                            title={starred ? "取消星标" : "添加星标"}
                                                        >
                                                            <i
                                                                className={[
                                                                    "fa text-[10px]",
                                                                    starred ? "fa-solid fa-star" : "fa-regular fa-star",
                                                                ].join(" ")}
                                                            />
                                                        </button>
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span
                                                                className={[
                                                                    "truncate text-sm font-semibold transition-colors duration-500",
                                                                    dockerStateNameClass(container.state),
                                                                    container.state === "running" ? "docker-state-running" : "",
                                                                    container.state === "restarting" ? "docker-state-restarting" : "",
                                                                    starred ? "font-bold" : "",
                                                                ].join(" ")}
                                                                title={`${container.name || container.id} · ${stateLabel}`}
                                                            >
                                                                {container.name || container.id}
                                                            </span>
                                                            <span className="flex-shrink-0 text-[11px] text-zinc-600">
                                                                {stateLabel}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="text-[10px] text-zinc-600">镜像</span>
                                                                <button
                                                                    type="button"
                                                                    className="cursor-pointer rounded border border-zinc-800 bg-zinc-900/80 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 transition-colors hover:border-accent hover:text-accent"
                                                                    onClick={() => {
                                                                        setActiveTab("images");
                                                                        setImagesSearch(shortenDockerId(container.imageId));
                                                                    }}
                                                                    title="点击查看镜像"
                                                                >
                                                                    {shortenDockerId(container.imageId)}
                                                                </button>
                                                                <CopyButton
                                                                    className="copy-button !h-[16px] !w-[16px] !min-w-[16px] !text-[8px]"
                                                                    onClick={() => {
                                                                        void navigator.clipboard.writeText(shortenDockerId(container.imageId));
                                                                    }}
                                                                    title="复制镜像ID"
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="text-[10px] text-zinc-600">容器</span>
                                                                <span className="font-mono text-[11px] text-zinc-400">{shortenDockerId(container.id)}</span>
                                                                <CopyButton
                                                                    className="copy-button !h-[16px] !w-[16px] !min-w-[16px] !text-[8px]"
                                                                    onClick={() => {
                                                                        void navigator.clipboard.writeText(container.id);
                                                                    }}
                                                                    title="复制容器ID"
                                                                />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <IconActionButton
                                                                icon={isRunningLike ? "fa-stop" : "fa-play"}
                                                                label={isRunningLike ? "停止" : "启动"}
                                                                onClick={() =>
                                                                    void runContainerAction(
                                                                        container.id,
                                                                        isRunningLike ? "stop" : "start"
                                                                    )
                                                                }
                                                                pending={isTogglePending}
                                                                variant={isRunningLike ? "danger" : "primary"}
                                                            />
                                                            {isRunningLike && (
                                                                <IconActionButton
                                                                    icon="fa-rotate-right"
                                                                    label="重启"
                                                                    onClick={() =>
                                                                        void runContainerAction(container.id, "restart")
                                                                    }
                                                                    pending={isRestartPending}
                                                                    variant="default"
                                                                />
                                                            )}
                                                            <IconActionButton
                                                                icon="fa-terminal"
                                                                label="进入"
                                                                onClick={() => void execIntoContainer(container.id)}
                                                                disabled={!isRunningLike}
                                                                variant="primary"
                                                            />
                                                            <RowMoreButton onClick={openContainerMenu} disabled={false} />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                ) : (
                    <div key="docker-images-panel" className={panelClass}>
                        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <div className="text-base font-semibold text-zinc-100">镜像列表</div>
                            </div>
                            <div className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row">
                                <input
                                    className={searchInputClass}
                                    placeholder="搜索镜像"
                                    value={imagesSearch}
                                    onChange={(e) => setImagesSearch(e.target.value)}
                                />
                                <input
                                    className={searchInputClass}
                                    placeholder="拉取镜像，例如 nginx:latest"
                                    value={pullImageRef}
                                    onChange={(e) => setPullImageRef(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            void pullImage();
                                        }
                                    }}
                                />
                                <Button onClick={() => void pullImage()}>拉取</Button>
                            </div>
                        </div>
                        {filteredImages.length === 0 ? (
                            <EmptyList title={imageEmptyTitle} />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b border-zinc-800 bg-zinc-900/80">
                                            <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">镜像</th>
                                            <th className="w-[100px] px-3 py-2 text-left text-xs font-medium text-zinc-500">大小</th>
                                            <th className="w-[120px] px-3 py-2 text-left text-xs font-medium text-zinc-500">使用情况</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">镜像 ID</th>
                                            <th className="w-[100px] px-3 py-2 text-right text-xs font-medium text-zinc-500">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredImages.map((image) => {
                                            const imageRef =
                                                image.tag && image.tag !== "<none>"
                                                    ? `${image.repository}:${image.tag}`
                                                    : image.repository !== "<none>"
                                                      ? image.repository
                                                      : image.id;
                                            const isBusy = `remove-image:${image.id}` in pendingActions;
                                            return (
                                                <tr
                                                    key={image.id}
                                                    className="border-b border-zinc-800/60 transition-colors duration-300 last:border-b-0 hover:bg-zinc-800/30 docker-row-enter"
                                                >
                                                    <td className="px-3 py-2.5">
                                                        <span className="truncate text-sm font-semibold text-zinc-100">
                                                            {imageRef}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <span className="text-xs text-zinc-400">{image.sizeText || "未知"}</span>
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        {image.containers > 0 ? (
                                                            <button
                                                                type="button"
                                                                className="cursor-pointer rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200 transition-colors hover:bg-amber-500/20"
                                                                onClick={() => {
                                                                    setActiveTab("containers");
                                                                    setContainerImageSearch(image.id);
                                                                    setContainersSearch("");
                                                                }}
                                                            >
                                                                {image.containers} 个容器
                                                            </button>
                                                        ) : (
                                                            <span className="text-xs text-zinc-500">未使用</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <CopyableId value={image.id} label="镜像ID" />
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <IconActionButton
                                                                icon="fa-download"
                                                                label="导出"
                                                                onClick={() => void saveImage(imageRef)}
                                                                variant="default"
                                                            />
                                                            <IconActionButton
                                                                icon="fa-trash"
                                                                label="删除"
                                                                onClick={() => void runImageRemove(image.id)}
                                                                disabled={isBusy}
                                                                pending={isBusy}
                                                                variant="danger"
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
            {renameContainer ? (
                <Modal
                    className="pt-6 pb-4 px-5"
                    onOk={() => void submitRenameContainer()}
                    onCancel={() => closeRenameContainer()}
                    onClose={() => closeRenameContainer()}
                    okLabel="重命名"
                    cancelLabel="取消"
                    okDisabled={renameContainerSubmitting || renameContainerName.trim() === "" || renameContainerName.trim() === (renameContainer.name || "")}
                >
                    <div className="mx-4 min-w-[420px] max-w-[560px] text-zinc-100">
                        <div className="text-lg font-semibold">重命名容器</div>
                        <div className="mt-1 text-sm text-zinc-400">
                            当前容器：{renameContainer.name || renameContainer.id}
                        </div>
                        <div className="mt-4 flex flex-col gap-2">
                            <label className="text-sm text-zinc-300">
                                新名称
                            </label>
                            <input
                                className={searchInputClass}
                                ref={renameContainerInputRef}
                                value={renameContainerName}
                                onChange={(e) => setRenameContainerName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        void submitRenameContainer();
                                    }
                                }}
                            />
                            {renameContainerError ? (
                                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                                    {renameContainerError}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}

export class DockerViewModel implements ViewModel {
    viewType = "docker";
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewIcon = atom("brands@docker");
    viewName = atom("容器");
    manageConnection = atom(true);
    filterOutNowsh = atom(true);
    noPadding = atom(true);

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const widthSubMenu = getWidgetWidthMenuItems({
            blockId: this.blockId,
            tabModel: this.tabModel,
        });
        if (widthSubMenu.length === 0) {
            return [];
        }
        return [{ label: "Width", submenu: widthSubMenu }];
    }

    get viewComponent(): ViewComponent {
        return DockerViewComponent;
    }
}
