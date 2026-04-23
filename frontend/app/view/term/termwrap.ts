// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    atoms,
    fetchWaveFile,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    isDev,
    openLink,
    setTabIndicator,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, fireAndForget } from "@/util/util";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";
import {
    handleOsc16162Command,
    handleOsc52Command,
    handleOsc7Command,
    type ShellIntegrationStatus,
} from "./osc-handlers";
import { resolveShellIntegrationRuntimeState } from "./term-shellintegration";
import { FilePathLinkProvider } from "./term-link-provider";
import { bufferLinesToText, createTempFileFromBlob, extractAllClipboardData, normalizeCursorStyle } from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
export const SupportsImageInput = true;
const IMEDedupWindowMs = 20;
const MaxRepaintTransactionMs = 2000;

// detect webgl support
function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("webgl");
        return !!ctx;
    } catch (e) {
        return false;
    }
}

const WebGLSupported = detectWebGLSupport();
let loggedWebGL = false;

type TermWrapOptions = {
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    sendDataHandler?: (data: string) => void;
    controllerOutputHandler?: (data: Uint8Array) => void;
    nodeModel?: BlockNodeModel;
};

export class TermWrap {
    tabId: string;
    blockId: string;
    ptyOffset: number;
    dataBytesProcessed: number;
    terminal: Terminal;
    connectElem: HTMLDivElement;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
    serializeAddon: SerializeAddon;
    mainFileSubject: SubjectWithRef<WSFileEventData>;
    loaded: boolean;
    heldData: Uint8Array[];
    handleResize_debounced: () => void;
    hasResized: boolean;
    multiInputCallback: (data: string) => void;
    sendDataHandler: (data: string) => void;
    onSearchResultsDidChange?: (result: { resultIndex: number; resultCount: number }) => void;
    private toDispose: TermTypes.IDisposable[] = [];
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
    shellIntegrationKnownAtom: jotai.PrimitiveAtom<boolean>;
    runtimeInfoReadyAtom: jotai.PrimitiveAtom<boolean>;
    lastCommandAtom: jotai.PrimitiveAtom<string | null>;
    lastCommandExitCodeAtom: jotai.PrimitiveAtom<number | null>;
    promptVersionAtom: jotai.PrimitiveAtom<number>;
    nodeModel: BlockNodeModel; // this can be null
    hoveredLinkUri: string | null = null;
    onLinkHover?: (uri: string | null, mouseX: number, mouseY: number) => void;
    controllerOutputHandler?: (data: Uint8Array) => void;

    // IME composition state tracking
    isComposing: boolean = false;
    composingData: string = "";
    lastCompositionEnd: number = 0;
    lastComposedText: string = "";
    firstDataAfterCompositionSent: boolean = false;

    // Paste deduplication
    // xterm.js paste() method triggers onData event, which can cause duplicate sends
    lastPasteData: string = "";
    lastPasteTime: number = 0;

    // for scrollToBottom support during a resize
    lastAtBottomTime: number = Date.now();
    lastScrollAtBottom: boolean = true;
    cachedAtBottomForResize: boolean | null = null;
    viewportScrollTop: number = 0;

    // dev only (for debugging)
    recentWrites: { idx: number; data: string; ts: number }[] = [];
    recentWritesCounter: number = 0;

    // for repaint transaction scrolling behavior
    lastClearScrollbackTs: number = 0;
    lastMode2026SetTs: number = 0;
    lastMode2026ResetTs: number = 0;
    inSyncTransaction: boolean = false;
    inRepaintTransaction: boolean = false;

    // batch write optimization
    private writeBuffer: Uint8Array[] = [];
    private writeBufferTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly BATCH_WRITE_INTERVAL_MS = 16; // ~60fps
    private readonly BATCH_WRITE_MAX_SIZE = 64 * 1024; // 64KB max buffer before forced flush
    private isScrolling: boolean = false;
    private scrollPauseTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly SCROLL_PAUSE_DELAY_MS = 150;

    constructor(
        tabId: string,
        blockId: string,
        connectElem: HTMLDivElement,
        options: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions,
        waveOptions: TermWrapOptions
    ) {
        this.loaded = false;
        this.tabId = tabId;
        this.blockId = blockId;
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.controllerOutputHandler = waveOptions.controllerOutputHandler;
        this.nodeModel = waveOptions.nodeModel;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
        this.shellIntegrationKnownAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.runtimeInfoReadyAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.lastCommandAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.lastCommandExitCodeAtom = jotai.atom(null) as jotai.PrimitiveAtom<number | null>;
        this.promptVersionAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
        this.terminal = new Terminal(options);
        this.fitAddon = new FitAddon();
        this.serializeAddon = new SerializeAddon();
        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.serializeAddon);
        this.terminal.loadAddon(
            new WebLinksAddon(
                (e, uri) => {
                    e.preventDefault();
                    switch (PLATFORM) {
                        case PlatformMacOS:
                            if (e.metaKey) {
                                fireAndForget(() => openLink(uri));
                            }
                            break;
                        default:
                            if (e.ctrlKey) {
                                fireAndForget(() => openLink(uri));
                            }
                            break;
                    }
                },
                {
                    hover: (e, uri) => {
                        this.hoveredLinkUri = uri;
                        this.onLinkHover?.(uri, e.clientX, e.clientY);
                    },
                    leave: () => {
                        this.hoveredLinkUri = null;
                        this.onLinkHover?.(null, 0, 0);
                    },
                }
            )
        );
        if (WebGLSupported && waveOptions.useWebGl) {
            const webglAddon = new WebglAddon();
            this.toDispose.push(
                webglAddon.onContextLoss(() => {
                    webglAddon.dispose();
                })
            );
            this.terminal.loadAddon(webglAddon);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        }
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            return handleOsc7Command(data, this.blockId, this.loaded);
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            return handleOsc52Command(data, this.blockId, this.loaded, this);
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            return handleOsc16162Command(data, this.blockId, this.loaded, this);
        });
        this.toDispose.push(
            this.terminal.registerLinkProvider(
                new FilePathLinkProvider(this.terminal, this.blockId, {
                    onHover: (linkText, event) => {
                        this.hoveredLinkUri = linkText;
                        this.onLinkHover?.(linkText, event.clientX, event.clientY);
                    },
                    onLeave: () => {
                        this.hoveredLinkUri = null;
                        this.onLinkHover?.(null, 0, 0);
                    },
                })
            )
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ final: "J" }, (params) => {
                if (params[0] === 3) {
                    this.lastClearScrollbackTs = Date.now();
                    if (this.inSyncTransaction) {
                        console.log("[termwrap] repaint transaction starting");
                        this.inRepaintTransaction = true;
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
                if (params[0] === 2026) {
                    this.lastMode2026SetTs = Date.now();
                    this.inSyncTransaction = true;
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
                if (params[0] === 2026) {
                    this.lastMode2026ResetTs = Date.now();
                    this.inSyncTransaction = false;
                    const wasRepaint = this.inRepaintTransaction;
                    this.inRepaintTransaction = false;
                    if (wasRepaint && Date.now() - this.lastClearScrollbackTs <= MaxRepaintTransactionMs) {
                        setTimeout(() => {
                            console.log("[termwrap] repaint transaction complete, scrolling to bottom");
                            this.terminal.scrollToBottom();
                        }, 20);
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.onBell(() => {
                if (!this.loaded) {
                    return true;
                }
                console.log("BEL received in terminal", this.blockId);
                const bellSoundEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellsound")) ?? false;
                if (bellSoundEnabled) {
                    fireAndForget(() => RpcApi.ElectronSystemBellCommand(TabRpcClient, { route: "electron" }));
                }
                const bellIndicatorEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellindicator")) ?? false;
                if (bellIndicatorEnabled) {
                    const tabId = globalStore.get(atoms.staticTabId);
                    setTabIndicator(tabId, { icon: "bell", color: "#fbbf24", clearonfocus: true, priority: 1 });
                }
                return true;
            })
        );
        this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            if (e.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey) {
                return true;
            }
            if (!waveOptions.keydownHandler) {
                return true;
            }
            return waveOptions.keydownHandler(e);
        });
        this.connectElem = connectElem;
        this.mainFileSubject = null;
        this.heldData = [];
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
        this.terminal.open(this.connectElem);
        this.handleResize();
        const pasteHandler = this.pasteHandler.bind(this);
        this.connectElem.addEventListener("paste", pasteHandler, true);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
        const viewportElem = this.connectElem.querySelector(".xterm-viewport") as HTMLElement;
        if (viewportElem) {
            const scrollHandler = (e: any) => {
                this.handleViewportScroll(viewportElem);
            };
            viewportElem.addEventListener("scroll", scrollHandler);
            this.toDispose.push({
                dispose: () => {
                    viewportElem.removeEventListener("scroll", scrollHandler);
                },
            });
        }
    }

    getZoneId(): string {
        return this.blockId;
    }

    setCursorStyle(cursorStyle: string) {
        this.terminal.options.cursorStyle = normalizeCursorStyle(cursorStyle);
    }

    setCursorBlink(cursorBlink: boolean) {
        this.terminal.options.cursorBlink = cursorBlink ?? false;
    }

    resetCompositionState() {
        this.isComposing = false;
        this.composingData = "";
        this.lastComposedText = "";
        this.lastCompositionEnd = 0;
        this.firstDataAfterCompositionSent = false;
    }

    private handleCompositionStart = (e: CompositionEvent) => {
        dlog("compositionstart", e.data);
        this.isComposing = true;
        this.composingData = "";
    };

    private handleCompositionUpdate = (e: CompositionEvent) => {
        dlog("compositionupdate", e.data);
        this.composingData = e.data || "";
    };

    private handleCompositionEnd = (e: CompositionEvent) => {
        dlog("compositionend", e.data);
        this.isComposing = false;
        this.lastComposedText = e.data || "";
        this.lastCompositionEnd = Date.now();
        this.firstDataAfterCompositionSent = false;
    };

    async initTerminal() {
        globalStore.set(this.runtimeInfoReadyAtom, false);
        globalStore.set(this.shellIntegrationKnownAtom, false);
        const copyOnSelectAtom = getSettingsKeyAtom("term:copyonselect");
        this.toDispose.push(this.terminal.onData(this.handleTermData.bind(this)));
        this.toDispose.push(
            this.terminal.onSelectionChange(
                debounce(50, () => {
                    if (!globalStore.get(copyOnSelectAtom)) {
                        return;
                    }
                    // Don't copy-on-select when the search bar has focus — navigating
                    // search results changes the terminal selection programmatically.
                    const active = document.activeElement;
                    if (active != null && active.closest(".search-container") != null) {
                        return;
                    }
                    const selectedText = this.terminal.getSelection();
                    if (selectedText.length > 0) {
                        navigator.clipboard.writeText(selectedText);
                    }
                })
            )
        );
        if (this.onSearchResultsDidChange != null) {
            this.toDispose.push(this.searchAddon.onDidChangeResults(this.onSearchResultsDidChange.bind(this)));
        }

        // Register IME composition event listeners on the xterm.js textarea
        const textareaElem = this.connectElem.querySelector("textarea");
        if (textareaElem) {
            textareaElem.addEventListener("compositionstart", this.handleCompositionStart);
            textareaElem.addEventListener("compositionupdate", this.handleCompositionUpdate);
            textareaElem.addEventListener("compositionend", this.handleCompositionEnd);

            // Handle blur during composition - reset state to avoid stale data
            const blurHandler = () => {
                if (this.isComposing) {
                    dlog("Terminal lost focus during composition, resetting IME state");
                    this.resetCompositionState();
                }
            };
            textareaElem.addEventListener("blur", blurHandler);

            this.toDispose.push({
                dispose: () => {
                    textareaElem.removeEventListener("compositionstart", this.handleCompositionStart);
                    textareaElem.removeEventListener("compositionupdate", this.handleCompositionUpdate);
                    textareaElem.removeEventListener("compositionend", this.handleCompositionEnd);
                    textareaElem.removeEventListener("blur", blurHandler);
                },
            });
        }

        this.mainFileSubject = getFileSubject(this.getZoneId(), TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        try {
            try {
                const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                });

                const integrationRuntimeState = resolveShellIntegrationRuntimeState(rtInfo as Record<string, unknown> | null);
                globalStore.set(this.shellIntegrationKnownAtom, integrationRuntimeState.integrationKnown);
                globalStore.set(this.shellIntegrationStatusAtom, integrationRuntimeState.integrationStatus);

                const lastCmd = rtInfo ? rtInfo["shell:lastcmd"] : null;
                globalStore.set(this.lastCommandAtom, lastCmd || null);

                const lastExitCode = rtInfo ? (rtInfo["shell:lastcmdexitcode"] as number) : null;
                globalStore.set(this.lastCommandExitCodeAtom, lastExitCode ?? null);
            } catch (e) {
                console.log("Error loading runtime info:", e);
                const integrationRuntimeState = resolveShellIntegrationRuntimeState(null);
                globalStore.set(this.shellIntegrationKnownAtom, integrationRuntimeState.integrationKnown);
                globalStore.set(this.shellIntegrationStatusAtom, integrationRuntimeState.integrationStatus);
            }

            await this.loadInitialTerminalData();
        } finally {
            this.loaded = true;
            globalStore.set(this.runtimeInfoReadyAtom, true);
        }
        this.runProcessIdleTimeout();
    }

    dispose() {
        if (this.writeBufferTimer) {
            clearTimeout(this.writeBufferTimer);
            this.writeBufferTimer = null;
        }
        if (this.scrollPauseTimer) {
            clearTimeout(this.scrollPauseTimer);
            this.scrollPauseTimer = null;
        }
        this.flushWriteBuffer();
        this.promptMarkers.forEach((marker) => {
            try {
                marker.dispose();
            } catch (_) {}
        });
        this.promptMarkers = [];
        this.terminal.dispose();
        this.toDispose.forEach((d) => {
            try {
                d.dispose();
            } catch (_) {}
        });
        this.mainFileSubject.release();
    }

    handleTermData(data: string) {
        if (!this.loaded) {
            return;
        }

        // IME fix: suppress isComposing=true events unless they immediately follow
        // a compositionend (within 20ms). This handles CapsLock input method switching
        // where the composition buffer gets flushed as a spurious isComposing=true event
        if (this.isComposing) {
            const timeSinceCompositionEnd = Date.now() - this.lastCompositionEnd;
            if (timeSinceCompositionEnd > IMEDedupWindowMs) {
                dlog("Suppressed IME data (composing, not near compositionend):", data);
                return;
            }
        }

        this.sendDataHandler?.(data);
        this.multiInputCallback?.(data);
    }

    addFocusListener(focusFn: () => void) {
        this.terminal.textarea.addEventListener("focus", focusFn);
    }

    handleNewFileSubjectData(msg: WSFileEventData) {
        if (msg.fileop == "truncate") {
            this.flushWriteBuffer();
            this.terminal.clear();
            this.heldData = [];
        } else if (msg.fileop == "append") {
            const decodedData = base64ToArray(msg.data64);
            if (this.loaded) {
                this.batchWrite(decodedData);
            } else {
                this.heldData.push(decodedData);
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    private getBufferSize(): number {
        return this.writeBuffer.reduce((acc, arr) => acc + arr.length, 0);
    }

    private batchWrite(data: Uint8Array): void {
        if (this.isScrolling) {
            this.writeBuffer.push(data);
            return;
        }
        this.writeBuffer.push(data);
        const bufferSize = this.getBufferSize();
        if (bufferSize >= this.BATCH_WRITE_MAX_SIZE) {
            this.flushWriteBuffer();
        } else if (!this.writeBufferTimer) {
            this.writeBufferTimer = setTimeout(() => {
                this.writeBufferTimer = null;
                this.flushWriteBuffer();
            }, this.BATCH_WRITE_INTERVAL_MS);
        }
    }

    private flushWriteBuffer(): void {
        if (this.writeBuffer.length === 0) {
            return;
        }
        const totalSize = this.getBufferSize();
        const merged = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of this.writeBuffer) {
            merged.set(chunk, offset);
            offset += chunk.length;
        }
        this.writeBuffer = [];
        this.ptyOffset += totalSize;
        this.dataBytesProcessed += totalSize;
        this.lastUpdated = Date.now();
        // Capture the raw stream before xterm parser side effects (OSC prompt ready,
        // exit code updates, etc.) flip cards state to "done". Otherwise fast commands
        // can finalize before the callback runs and their output gets dropped.
        this.controllerOutputHandler?.(merged);
        this.terminal.write(merged);
    }

    doTerminalWrite(data: string | Uint8Array, setPtyOffset?: number): Promise<void> {
        if (isDev() && this.loaded) {
            const dataStr = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
            this.recentWrites.push({ idx: this.recentWritesCounter++, ts: Date.now(), data: dataStr });
            if (this.recentWrites.length > 50) {
                this.recentWrites.shift();
            }
        }
        let resolve: () => void = null;
        let prtn = new Promise<void>((presolve, _) => {
            resolve = presolve;
        });
        const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
        // Keep cards capture in front of terminal parser state transitions for the same
        // reason as flushWriteBuffer(): we want the output chunk while the card is still
        // active, not after prompt-ready events finalize it.
        this.controllerOutputHandler?.(encoded);
        this.terminal.write(data, () => {
            if (setPtyOffset != null) {
                this.ptyOffset = setPtyOffset;
            } else {
                this.ptyOffset += data.length;
                this.dataBytesProcessed += data.length;
            }
            this.lastUpdated = Date.now();
            resolve();
        });
        return prtn;
    }

    async loadInitialTerminalData(): Promise<void> {
        const startTs = Date.now();
        const zoneId = this.getZoneId();
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(zoneId, TermCacheFileName);
        let ptyOffset = 0;
        if (cacheFile != null) {
            ptyOffset = cacheFile.meta["ptyoffset"] ?? 0;
            if (cacheData.byteLength > 0) {
                const curTermSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
                const fileTermSize: TermSize = cacheFile.meta["termsize"];
                let didResize = false;
                if (
                    fileTermSize != null &&
                    (fileTermSize.rows != curTermSize.rows || fileTermSize.cols != curTermSize.cols)
                ) {
                    console.log("terminal restore size mismatch, temp resize", fileTermSize, curTermSize);
                    this.terminal.resize(fileTermSize.cols, fileTermSize.rows);
                    didResize = true;
                }
                this.doTerminalWrite(cacheData, ptyOffset);
                if (didResize) {
                    this.terminal.resize(curTermSize.cols, curTermSize.rows);
                }
            }
        }
        const { data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, ptyOffset);
        console.log(
            `terminal loaded cachefile:${cacheData?.byteLength ?? 0} main:${mainData?.byteLength ?? 0} bytes, ${Date.now() - startTs}ms`
        );
        if (mainFile != null) {
            await this.doTerminalWrite(mainData, null);
        }
    }

    async resyncController(reason: string) {
        dlog("resync controller", this.blockId, reason);
        const rtOpts: RuntimeOpts = { termsize: { rows: this.terminal.rows, cols: this.terminal.cols } };
        try {
            await RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: this.tabId,
                blockid: this.blockId,
                rtopts: rtOpts,
            });
        } catch (e) {
            console.log(`error controller resync (${reason})`, this.blockId, e);
        }
    }

    setAtBottom(atBottom: boolean) {
        if (this.lastScrollAtBottom && !atBottom) {
            this.lastAtBottomTime = Date.now();
        }
        this.lastScrollAtBottom = atBottom;
        if (atBottom) {
            this.lastAtBottomTime = Date.now();
        }
    }

    wasRecentlyAtBottom(): boolean {
        if (this.lastScrollAtBottom) {
            return true;
        }
        return Date.now() - this.lastAtBottomTime <= 1000;
    }

    handleViewportScroll(viewportElem: HTMLElement) {
        const { scrollTop, scrollHeight, clientHeight } = viewportElem;
        const atBottom = scrollTop + clientHeight >= scrollHeight - clientHeight * 0.5;
        this.setAtBottom(atBottom);
        const delta = this.viewportScrollTop - scrollTop;
        if (delta >= 100 || delta <= -100) {
            this.isScrolling = true;
            if (this.scrollPauseTimer) {
                clearTimeout(this.scrollPauseTimer);
            }
            this.scrollPauseTimer = setTimeout(() => {
                this.isScrolling = false;
                this.scrollPauseTimer = null;
                this.flushWriteBuffer();
            }, this.SCROLL_PAUSE_DELAY_MS);
        }
        if (isDev() && delta >= 500) {
            console.log(
                `[termwrap] large-scroll blockId=${this.blockId} delta=${Math.round(delta)}px scrollTop=${scrollTop} wasNearBottom=${atBottom}`
            );
        }
        this.viewportScrollTop = scrollTop;
    }

    handleResize() {
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        const atBottom = this.cachedAtBottomForResize ?? this.wasRecentlyAtBottom();
        if (!atBottom) {
            this.cachedAtBottomForResize = null;
        }
        this.fitAddon.fit();
        if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            console.log(
                "[termwrap] resize",
                `${oldRows}x${oldCols}`,
                "->",
                `${this.terminal.rows}x${this.terminal.cols}`,
                "atBottom:",
                atBottom
            );
            fireAndForget(async () => {
                try {
                    await RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize });
                } catch (e) {
                    // During startup/reconnect, controller may not exist yet; resync path will recover.
                    dlog("controller input skipped during resize", this.blockId, e);
                }
            });
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
        if (atBottom) {
            setTimeout(() => {
                console.log("[termwrap] resize scroll-to-bottom");
                this.cachedAtBottomForResize = null;
                this.terminal.scrollToBottom();
                this.setAtBottom(true);
            }, 20);
        }
    }

    processAndCacheData() {
        if (this.dataBytesProcessed < MinDataProcessedForCache) {
            return;
        }
        const serializedOutput = this.serializeAddon.serialize();
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        console.log("idle timeout term", this.dataBytesProcessed, serializedOutput.length, termSize);
        fireAndForget(() =>
            services.BlockService.SaveTerminalState(this.blockId, serializedOutput, "full", this.ptyOffset, termSize)
        );
        this.dataBytesProcessed = 0;
    }

    runProcessIdleTimeout() {
        setTimeout(() => {
            window.requestIdleCallback(() => {
                this.processAndCacheData();
                this.runProcessIdleTimeout();
            });
        }, 5000);
    }

    async pasteHandler(e?: ClipboardEvent): Promise<void> {
        this.pasteActive = true;
        e?.preventDefault();
        e?.stopPropagation();

        try {
            const clipboardData = await extractAllClipboardData(e);
            let firstImage = true;
            for (const data of clipboardData) {
                if (data.image && SupportsImageInput) {
                    if (!firstImage) {
                        await new Promise((r) => setTimeout(r, 150));
                    }
                    const tempPath = await createTempFileFromBlob(data.image);
                    this.terminal.paste(tempPath + " ");
                    firstImage = false;
                }
                if (data.text) {
                    this.terminal.paste(data.text);
                }
            }
        } catch (err) {
            console.error("Paste error:", err);
        } finally {
            setTimeout(() => {
                this.pasteActive = false;
            }, 30);
        }
    }

    getScrollbackContent(): string {
        if (!this.terminal) {
            return "";
        }
        const buffer = this.terminal.buffer.active;
        const lines = bufferLinesToText(buffer, 0, buffer.length);
        return lines.join("\n");
    }
}
