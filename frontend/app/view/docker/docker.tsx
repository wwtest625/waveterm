// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Button } from "@/app/element/button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/store/global";
import { openCommandInNewBlock, sendCommandToTerminal } from "@/util/previewutil";
import { atom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
    buildDockerExecCommand,
    buildDockerLogsCommand,
    buildDockerPullCommand,
    canRemoveDockerContainer,
    dockerStateBadgeClass,
    dockerStateLabel,
    getDockerErrorHeadline,
} from "./docker-util";

const searchInputClass =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent";

const panelClass = "rounded-xl border border-zinc-800 bg-zinc-950/70 p-4";
const DockerViewComponent = memo(DockerView);
type DockerTabKey = "containers" | "images";

function RowActionButton({
    label,
    onClick,
    disabled,
    variant = "default",
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: "default" | "danger";
}) {
    const className =
        variant === "danger"
            ? "!h-[28px] !px-2 !text-xs !bg-red-500/10 !border-red-500/30 !text-red-300 hover:!bg-red-500/20"
            : "!h-[28px] !px-2 !text-xs";
    return (
        <Button className={className} onClick={onClick} disabled={disabled}>
            {label}
        </Button>
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
            className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClick}
            disabled={disabled}
            aria-label="更多操作"
            title="更多操作"
        >
            <i className="fa fa-ellipsis-h text-[11px]" />
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

function DockerView({ blockId }: ViewComponentProps<DockerViewModel>) {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const connection = (blockData?.meta?.connection as string) ?? "";
    const [activeTab, setActiveTab] = useState<DockerTabKey>("containers");
    const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
    const [images, setImages] = useState<DockerImageSummary[]>([]);
    const [containersSearch, setContainersSearch] = useState("");
    const [imagesSearch, setImagesSearch] = useState("");
    const [pullImageRef, setPullImageRef] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<DockerError | null>(null);
    const [actionError, setActionError] = useState<DockerError | null>(null);
    const [pendingAction, setPendingAction] = useState<string | null>(null);

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
            void refreshData(false);
        }, 5000);
        return () => window.clearInterval(intervalId);
    }, [refreshData]);

    const filteredContainers = useMemo(() => {
        const search = containersSearch.trim().toLowerCase();
        if (search === "") {
            return containers;
        }
        return containers.filter((container) =>
            [container.name, container.image, container.id, container.statusText, container.portsText]
                .join(" ")
                .toLowerCase()
                .includes(search)
        );
    }, [containers, containersSearch]);

    const filteredImages = useMemo(() => {
        const search = imagesSearch.trim().toLowerCase();
        if (search === "") {
            return images;
        }
        return images.filter((image) =>
            [image.repository, image.tag, image.id, image.sizeText].join(" ").toLowerCase().includes(search)
        );
    }, [images, imagesSearch]);

    const runContainerAction = useCallback(
        async (containerId: string, action: "start" | "stop" | "restart" | "remove") => {
            setPendingAction(`${action}:${containerId}`);
            setActionError(null);
            try {
                const resp = await RpcApi.DockerContainerActionCommand(TabRpcClient, {
                    connection,
                    containerId,
                    action,
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
                setPendingAction(null);
            }
        },
        [connection, refreshData]
    );

    const runImageRemove = useCallback(
        async (imageId: string) => {
            setPendingAction(`remove-image:${imageId}`);
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
                setPendingAction(null);
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

    if (loading) {
        return <div className="flex h-full items-center justify-center text-sm text-zinc-400">正在加载 Docker...</div>;
    }

    if (error != null) {
        return <ErrorPanel error={error} onRefresh={() => void refreshData(true)} />;
    }

    return (
        <div className="h-full w-full min-w-0 overflow-y-auto bg-zinc-900 p-4 text-zinc-100">
            <div className="flex w-full min-w-0 flex-col gap-4">
                {actionError ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        <div className="font-medium">{getDockerErrorHeadline(actionError)}</div>
                        {actionError.detail ? <div className="mt-1 text-red-200/80">{actionError.detail}</div> : null}
                    </div>
                ) : null}

                <div className={panelClass}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-lg font-semibold text-zinc-100">容器管理</div>
                            <div className="text-sm text-zinc-400">
                                当前连接：{connection === "" ? "本机" : connection}
                            </div>
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
                                <div className="text-base font-semibold text-zinc-100">容器列表</div>
                                <div className="text-sm text-zinc-500">按名称或镜像搜索</div>
                            </div>
                            <input
                                className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-accent"
                                placeholder="搜索容器"
                                value={containersSearch}
                                onChange={(e) => setContainersSearch(e.target.value)}
                            />
                        </div>
                        {filteredContainers.length === 0 ? (
                            <EmptyList title="当前连接没有容器。" />
                        ) : (
                            <div className="space-y-2">
                                {filteredContainers.map((container) => {
                                    const containerKey = container.id;
                                    const stateLabel = dockerStateLabel(container.state);
                                    const disableRemove = !canRemoveDockerContainer(container.state);
                                    const isBusy = pendingAction != null && pendingAction.includes(containerKey);
                                    const isRunningLike =
                                        container.state === "running" ||
                                        container.state === "paused" ||
                                        container.state === "restarting";
                                    const openContainerMenu = (event: MouseEvent<HTMLButtonElement>) => {
                                        const menu: ContextMenuItem[] = [
                                            {
                                                label: "停止",
                                                enabled: isRunningLike && !isBusy,
                                                click: () => {
                                                    void runContainerAction(container.id, "stop");
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
                                        <div
                                            key={containerKey}
                                            className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5"
                                        >
                                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <div className="truncate text-sm font-semibold text-zinc-100">
                                                            {container.name || container.id}
                                                        </div>
                                                        <span
                                                            className={`rounded-full border px-2 py-0.5 text-[11px] tracking-wide ${dockerStateBadgeClass(container.state)}`}
                                                        >
                                                            {stateLabel}
                                                        </span>
                                                    </div>
                                                    <div className="mt-1 truncate text-sm text-zinc-400">
                                                        {container.image}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2 lg:justify-end">
                                                    {isRunningLike ? (
                                                        <RowActionButton
                                                            label="重启"
                                                            onClick={() =>
                                                                void runContainerAction(container.id, "restart")
                                                            }
                                                            disabled={isBusy}
                                                        />
                                                    ) : (
                                                        <RowActionButton
                                                            label="启动"
                                                            onClick={() =>
                                                                void runContainerAction(container.id, "start")
                                                            }
                                                            disabled={isBusy}
                                                        />
                                                    )}
                                                    <RowActionButton
                                                        label="进入"
                                                        onClick={() => void execIntoContainer(container.id)}
                                                        disabled={!isRunningLike}
                                                    />
                                                    <RowMoreButton onClick={openContainerMenu} disabled={false} />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <div key="docker-images-panel" className={panelClass}>
                        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <div className="text-base font-semibold text-zinc-100">镜像列表</div>
                                <div className="text-sm text-zinc-500">按名称或标签搜索</div>
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
                            <EmptyList title="当前连接没有镜像。" />
                        ) : (
                            <div className="space-y-2">
                                {filteredImages.map((image) => {
                                    const imageRef =
                                        image.tag && image.tag !== "<none>"
                                            ? `${image.repository}:${image.tag}`
                                            : image.repository;
                                    const isBusy = pendingAction === `remove-image:${image.id}`;
                                    return (
                                        <div
                                            key={image.id}
                                            className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-3"
                                        >
                                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-sm font-semibold text-zinc-100">
                                                        {imageRef}
                                                    </div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                                        <span>大小：{image.sizeText || "未知"}</span>
                                                        {image.inUse ? (
                                                            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-200">
                                                                使用中
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2 lg:justify-end">
                                                    <RowActionButton
                                                        label="更新"
                                                        onClick={() => void runPullImage(imageRef)}
                                                        disabled={!image.repository || image.repository === "<none>"}
                                                    />
                                                    <RowActionButton
                                                        label="删除"
                                                        onClick={() => void runImageRemove(image.id)}
                                                        disabled={isBusy}
                                                        variant="danger"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
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

    get viewComponent(): ViewComponent {
        return DockerViewComponent;
    }
}
