// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { atoms, getConnStatusAtom, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import * as React from "react";

const AutoReconnectIntervalMs = 5000;
const ReconnectSuccessDisplayMs = 2500;
const ReconnectSuccessWindowMs = 15000;

const StalledOverlay = React.memo(
    ({
        connName,
        overlayRefCallback,
    }: {
        connName: string;
        overlayRefCallback: (el: HTMLDivElement | null) => void;
    }) => {
        const handleDisconnect = React.useCallback(() => {
            const prtn = RpcApi.ConnDisconnectCommand(TabRpcClient, connName, { timeout: 5000 });
            prtn.catch((e) => console.error("error disconnecting", connName, e));
        }, [connName]);

        return (
            <div
                className="@container absolute top-[calc(var(--header-height)+6px)] left-1.5 right-1.5 z-[var(--zindex-block-mask-inner)] overflow-hidden rounded-md bg-[var(--conn-status-overlay-bg-color)] backdrop-blur-[50px] shadow-lg opacity-90"
                ref={overlayRefCallback}
            >
                <div className="flex items-center gap-3 w-full pt-2.5 pb-2.5 pr-2 pl-3">
                    <i
                        className="fa-solid fa-triangle-exclamation text-warning text-base shrink-0"
                        title="连接停滞"
                    ></i>
                    <div className="text-[11px] font-semibold leading-4 tracking-[0.11px] text-white min-w-0 flex-1 break-words @max-xxs:hidden">
                        到 "{connName}" 的连接已停滞
                    </div>
                    <div className="flex-1 hidden @max-xxs:block"></div>
                    <Button
                        className="outlined grey text-[11px] py-[3px] px-[7px] @max-w350:text-[12px] @max-w350:py-[5px] @max-w350:px-[6px]"
                        onClick={handleDisconnect}
                        title="断开连接"
                    >
                        <span className="@max-w350:hidden!">断开连接</span>
                        <i className="fa-solid fa-link-slash hidden! @max-w350:inline!"></i>
                    </Button>
                </div>
            </div>
        );
    }
);
StalledOverlay.displayName = "StalledOverlay";

const ReconnectSuccessOverlay = React.memo(
    ({
        connName,
        overlayRefCallback,
    }: {
        connName: string;
        overlayRefCallback: (el: HTMLDivElement | null) => void;
    }) => {
        return (
            <div
                className="@container absolute top-[calc(var(--header-height)+6px)] left-1.5 right-1.5 z-[var(--zindex-block-mask-inner)] overflow-hidden rounded-md bg-[var(--conn-status-overlay-bg-color)] backdrop-blur-[50px] shadow-lg opacity-90"
                ref={overlayRefCallback}
            >
                <div className="flex items-center gap-3 w-full pt-2.5 pb-2.5 pr-2 pl-3">
                    <i className="fa-solid fa-circle-check text-green-400 text-base shrink-0" title="重连成功"></i>
                    <div className="text-[11px] font-semibold leading-4 tracking-[0.11px] text-white min-w-0 flex-1 break-words @max-xxs:hidden">
                        已重新连接到 "{connName}"
                    </div>
                    <div className="flex-1 hidden @max-xxs:block"></div>
                </div>
            </div>
        );
    }
);
ReconnectSuccessOverlay.displayName = "ReconnectSuccessOverlay";

export const ConnStatusOverlay = React.memo(
    ({
        nodeModel,
        changeConnModalAtom,
    }: {
        nodeModel: NodeModel;
        changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
    }) => {
        const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
        const [connModalOpen] = jotai.useAtom(changeConnModalAtom);
        const connName = blockData?.meta?.connection ?? "";
        const connStatus = jotai.useAtomValue(getConnStatusAtom(connName));
        const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
        const [overlayRefCallback, _, domRect] = useDimensionsWithCallbackRef(30);
        const width = domRect?.width;
        const [showError, setShowError] = React.useState(false);
        const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);
        const [showWshError, setShowWshError] = React.useState(false);
        const [showReconnectSuccess, setShowReconnectSuccess] = React.useState(false);
        const wshStatusDetail = connStatus.wsherror || connStatus.nowshreason || "";
        const reconnectInFlightRef = React.useRef(false);
        const reconnectSuccessTimerRef = React.useRef<number | null>(null);
        const lastReconnectAttemptAtRef = React.useRef<number>(0);

        const clearReconnectSuccessTimer = React.useCallback(() => {
            if (reconnectSuccessTimerRef.current != null) {
                window.clearTimeout(reconnectSuccessTimerRef.current);
                reconnectSuccessTimerRef.current = null;
            }
        }, []);

        const showReconnectSuccessNotice = React.useCallback(() => {
            clearReconnectSuccessTimer();
            setShowReconnectSuccess(true);
            reconnectSuccessTimerRef.current = window.setTimeout(() => {
                reconnectSuccessTimerRef.current = null;
                setShowReconnectSuccess(false);
            }, ReconnectSuccessDisplayMs);
        }, [clearReconnectSuccessTimer]);

        React.useEffect(() => {
            if (width) {
                const hasError = !util.isBlank(connStatus.error);
                const showError = hasError && width >= 250 && connStatus.status == "error";
                setShowError(showError);
            }
        }, [width, connStatus, setShowError]);

        const attemptReconnect = React.useCallback(
            async (source: "auto" | "manual") => {
                if (connName === "" || connStatus.status == "connected" || connStatus.status == "connecting") {
                    return;
                }
                if (reconnectInFlightRef.current) {
                    return;
                }

                reconnectInFlightRef.current = true;
                lastReconnectAttemptAtRef.current = Date.now();
                try {
                    await RpcApi.ConnConnectCommand(
                        TabRpcClient,
                        { host: connName, logblockid: nodeModel.blockId },
                        { timeout: 60000 }
                    );
                } catch (e) {
                    console.error(`error reconnecting (${source})`, connName, e);
                } finally {
                    reconnectInFlightRef.current = false;
                }
            },
            [connName, connStatus.status, nodeModel.blockId]
        );

        React.useEffect(() => {
            if (connName === "") {
                reconnectInFlightRef.current = false;
                setShowReconnectSuccess(false);
                clearReconnectSuccessTimer();
                return;
            }

            if (connStatus.status == "connected") {
                if (Date.now() - lastReconnectAttemptAtRef.current <= ReconnectSuccessWindowMs) {
                    showReconnectSuccessNotice();
                }
                reconnectInFlightRef.current = false;
                return;
            }

            setShowReconnectSuccess(false);
            clearReconnectSuccessTimer();
        }, [clearReconnectSuccessTimer, connName, connStatus.status, showReconnectSuccessNotice]);

        React.useEffect(() => {
            if (connName === "") {
                return;
            }
            if (connStatus.status != "disconnected" && connStatus.status != "error") {
                return;
            }

            void attemptReconnect("auto");
            const intervalId = window.setInterval(() => {
                void attemptReconnect("auto");
            }, AutoReconnectIntervalMs);

            return () => window.clearInterval(intervalId);
        }, [attemptReconnect, connName, connStatus.status]);

        React.useEffect(() => {
            return () => {
                clearReconnectSuccessTimer();
            };
        }, [clearReconnectSuccessTimer]);

        const handleTryReconnect = React.useCallback(() => {
            void attemptReconnect("manual");
        }, [attemptReconnect]);

        const handleDisableWsh = React.useCallback(async () => {
            const metamaptype: unknown = {
                "conn:wshenabled": false,
            };
            const data: ConnConfigRequest = {
                host: connName,
                metamaptype: metamaptype,
            };
            try {
                await RpcApi.SetConnectionsConfigCommand(TabRpcClient, data);
            } catch (e) {
                console.error("problem setting connection config: ", e);
            }
        }, [connName]);

        const handleRemoveWshError = React.useCallback(async () => {
            try {
                await RpcApi.DismissWshFailCommand(TabRpcClient, connName);
            } catch (e) {
                console.error("unable to dismiss wsh error: ", e);
            }
        }, [connName]);

        let statusText = `已断开与 "${connName}" 的连接`;
        let showReconnect = true;
        if (connStatus.status == "connecting") {
            statusText = `正在连接 "${connName}"...`;
            showReconnect = false;
        } else if (connStatus.status == "disconnected" || connStatus.status == "error") {
            statusText = `已断开与 "${connName}" 的连接，正在自动重连`;
        }
        if (connStatus.status == "connected") {
            showReconnect = false;
        }

        let reconDisplay = null;
        let reconClassName = "outlined grey";
        if (width && width < 350) {
            reconDisplay = <i className="fa-sharp fa-solid fa-rotate-right fa-spin"></i>;
            reconClassName = clsx(reconClassName, "text-[12px] py-[5px] px-[6px]");
        } else {
            reconDisplay = "重新连接";
            reconClassName = clsx(reconClassName, "text-[11px] py-[3px] px-[7px]");
        }

        const showIcon = connStatus.status != "connecting";
        const showSpinnerIcon =
            connStatus.status == "connecting" || connStatus.status == "disconnected" || connStatus.status == "error";

        const wshConfigEnabled = fullConfig?.connections?.[connName]?.["conn:wshenabled"] ?? true;
        React.useEffect(() => {
            const showWshErrorTemp = connStatus.status == "connected" && wshStatusDetail != "" && wshConfigEnabled;

            setShowWshError(showWshErrorTemp);
        }, [connStatus.status, wshConfigEnabled, wshStatusDetail]);

        const handleCopy = React.useCallback(
            async (_e: React.MouseEvent) => {
                const errTexts = [];
                if (showError) {
                    errTexts.push(`error: ${connStatus.error}`);
                }
                if (showWshError) {
                    errTexts.push(`unable to use wsh: ${wshStatusDetail}`);
                }
                const textToCopy = errTexts.join("\n");
                await navigator.clipboard.writeText(textToCopy);
            },
            [showError, showWshError, connStatus.error, wshStatusDetail]
        );

        const showStalled = connStatus.status == "connected" && connStatus.connhealthstatus == "stalled";

        if (showReconnectSuccess && !showWshError) {
            return <ReconnectSuccessOverlay connName={connName} overlayRefCallback={overlayRefCallback} />;
        }

        if (!showWshError && !showStalled && (isLayoutMode || connStatus.status == "connected" || connModalOpen)) {
            return null;
        }

        if (showStalled && !showWshError) {
            return <StalledOverlay connName={connName} overlayRefCallback={overlayRefCallback} />;
        }

        return (
            <div className="connstatus-overlay" ref={overlayRefCallback}>
                <div className="connstatus-content">
                    <div className={clsx("connstatus-status-icon-wrapper", { "has-error": showError || showWshError })}>
                        {showSpinnerIcon ? (
                            <i className="fa-solid fa-spinner fa-spin"></i>
                        ) : (
                            showIcon && <i className="fa-solid fa-triangle-exclamation"></i>
                        )}
                        <div className="connstatus-status ellipsis">
                            <div className="connstatus-status-text">{statusText}</div>
                            {(showError || showWshError) && (
                                <OverlayScrollbarsComponent
                                    className="connstatus-error"
                                    options={{ scrollbars: { autoHide: "leave" } }}
                                >
                                    <CopyButton className="copy-button" onClick={handleCopy} title="Copy" />
                                    {showError ? <div>错误: {connStatus.error}</div> : null}
                                    {showWshError ? <div>无法使用 WSH: {wshStatusDetail}</div> : null}
                                </OverlayScrollbarsComponent>
                            )}
                            {showWshError && (
                                <Button className={reconClassName} onClick={handleDisableWsh}>
                                    始终禁用 WSH
                                </Button>
                            )}
                        </div>
                    </div>
                    {showReconnect ? (
                        <div className="connstatus-actions">
                            <Button className={reconClassName} onClick={handleTryReconnect}>
                                {reconDisplay}
                            </Button>
                        </div>
                    ) : null}
                    {showWshError ? (
                        <div className="connstatus-actions">
                            <Button className={`fa-xmark fa-solid ${reconClassName}`} onClick={handleRemoveWshError} />
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }
);
ConnStatusOverlay.displayName = "ConnStatusOverlay";
