// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { NullErrorBoundary } from "@/app/element/errorboundary";
import { Search, useSearch } from "@/app/element/search";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { useTabModel } from "@/app/store/tab-model";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atoms, getOverrideConfigAtom, getSettingsPrefixAtom, globalStore, WOS } from "@/store/global";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import { ISearchOptions } from "@xterm/addon-search";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import { TermCardsView } from "./term-cards";
import { TermQuickInputBar } from "./term-quick-input-bar";
import { TermLinkTooltip } from "./term-tooltip";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { computeTheme, normalizeCursorStyle } from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

interface TerminalViewProps {
    blockId: string;
    model: TermViewModel;
}

const TermResyncHandler = React.memo(({ model }: TerminalViewProps) => {
    const connStatus = jotai.useAtomValue(model.connStatus);
    const [lastConnStatus, setLastConnStatus] = React.useState<ConnStatus>(connStatus);

    React.useEffect(() => {
        if (!model.termRef.current?.hasResized) {
            return;
        }
        const isConnected = connStatus?.status == "connected";
        const wasConnected = lastConnStatus?.status == "connected";
        const curConnName = connStatus?.connection;
        const lastConnName = lastConnStatus?.connection;
        if (isConnected == wasConnected && curConnName == lastConnName) {
            return;
        }
        model.termRef.current?.resyncController("resync handler");
        setLastConnStatus(connStatus);
    }, [connStatus]);

    return null;
});

const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [termWrapInst, setTermWrapInst] = React.useState<TermWrap | null>(null);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const termSettingsAtom = getSettingsPrefixAtom("term");
    const termSettings = jotai.useAtomValue(termSettingsAtom);
    const termMode = jotai.useAtomValue(model.termMode);
    const termModeRef = React.useRef(termMode);

    const tabModel = useTabModel();
    const termFontSize = jotai.useAtomValue(model.fontSizeAtom);
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const connFontFamily = fullConfig.connections?.[blockData?.meta?.connection]?.["term:fontfamily"];
    const isFocused = jotai.useAtomValue(model.nodeModel.isFocused);
    const isMI = jotai.useAtomValue(tabModel.isTermMultiInput);
    const isBasicTerm = blockData?.meta?.controller != "cmd"; // needs to match isBasicTerm
    const quickInputValue = jotai.useAtomValue(model.quickInputValueAtom);
    const quickInputNotifyEnabled = jotai.useAtomValue(model.quickInputNotifyEnabledAtom);
    const quickInputNotifyAvailable = jotai.useAtomValue(model.shellIntegrationAvailableAtom);

    // search
    const searchProps = useSearch({
        anchorRef: viewRef,
        viewModel: model,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
    });
    const searchIsOpen = jotai.useAtomValue<boolean>(searchProps.isOpen);
    const caseSensitive = useAtomValueSafe<boolean>(searchProps.caseSensitive);
    const wholeWord = useAtomValueSafe<boolean>(searchProps.wholeWord);
    const regex = useAtomValueSafe<boolean>(searchProps.regex);
    const searchVal = jotai.useAtomValue<string>(searchProps.searchValue);
    const cardsRuntimeReady = useAtomValueSafe<boolean>(termWrapInst?.runtimeInfoReadyAtom);
    const searchDecorations = React.useMemo(
        () => ({
            matchOverviewRuler: "#000000",
            activeMatchColorOverviewRuler: "#000000",
            activeMatchBorder: "#FF9632",
            matchBorder: "#FFFF00",
        }),
        []
    );
    const searchOpts = React.useMemo<ISearchOptions>(
        () => ({
            regex,
            wholeWord,
            caseSensitive,
            decorations: searchDecorations,
        }),
        [regex, wholeWord, caseSensitive]
    );
    const handleSearchError = React.useCallback((e: Error) => {
        console.warn("search error:", e);
    }, []);
    const executeSearch = React.useCallback(
        (searchText: string, direction: "next" | "previous") => {
            if (searchText === "") {
                model.termRef.current?.searchAddon.clearDecorations();
                return;
            }
            try {
                model.termRef.current?.searchAddon[direction === "next" ? "findNext" : "findPrevious"](
                    searchText,
                    searchOpts
                );
            } catch (e) {
                handleSearchError(e);
            }
        },
        [searchOpts, handleSearchError]
    );
    searchProps.onSearch = React.useCallback(
        (searchText: string) => executeSearch(searchText, "previous"),
        [executeSearch]
    );
    searchProps.onPrev = React.useCallback(() => executeSearch(searchVal, "previous"), [executeSearch, searchVal]);
    searchProps.onNext = React.useCallback(() => executeSearch(searchVal, "next"), [executeSearch, searchVal]);
    // Return input focus to the terminal when the search is closed
    React.useEffect(() => {
        if (!searchIsOpen) {
            model.giveFocus();
        }
    }, [searchIsOpen]);
    // rerun search when the searchOpts change
    React.useEffect(() => {
        model.termRef.current?.searchAddon.clearDecorations();
        searchProps.onSearch(searchVal);
    }, [searchOpts]);
    // end search

    React.useEffect(() => {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemeName = globalStore.get(model.termThemeNameAtom);
        const termTransparency = globalStore.get(model.termTransparencyAtom);
        const termMacOptionIsMetaAtom = getOverrideConfigAtom(blockId, "term:macoptionismeta");
        const [termTheme, _] = computeTheme(fullConfig, termThemeName, termTransparency);
        let termScrollback = 2000;
        if (termSettings?.["term:scrollback"]) {
            termScrollback = Math.floor(termSettings["term:scrollback"]);
        }
        if (blockData?.meta?.["term:scrollback"]) {
            termScrollback = Math.floor(blockData.meta["term:scrollback"]);
        }
        if (termScrollback < 0) {
            termScrollback = 0;
        }
        if (termScrollback > 50000) {
            termScrollback = 50000;
        }
        const termAllowBPM = globalStore.get(model.termBPMAtom) ?? true;
        const termMacOptionIsMeta = globalStore.get(termMacOptionIsMetaAtom) ?? false;
        const termCursorStyle = normalizeCursorStyle(globalStore.get(getOverrideConfigAtom(blockId, "term:cursor")));
        const termCursorBlink = globalStore.get(getOverrideConfigAtom(blockId, "term:cursorblink")) ?? false;
        const wasFocused = model.termRef.current != null && globalStore.get(model.nodeModel.isFocused);
        const termWrap = new TermWrap(
            tabModel.tabId,
            blockId,
            connectElemRef.current,
            {
                theme: termTheme,
                fontSize: termFontSize,
                fontFamily: termSettings?.["term:fontfamily"] ?? connFontFamily ?? "Hack",
                drawBoldTextInBrightColors: false,
                fontWeight: "normal",
                fontWeightBold: "bold",
                allowTransparency: true,
                scrollback: termScrollback,
                allowProposedApi: true, // Required by @xterm/addon-search to enable search functionality and decorations
                ignoreBracketedPasteMode: !termAllowBPM,
                macOptionIsMeta: termMacOptionIsMeta,
                cursorStyle: termCursorStyle,
                cursorBlink: termCursorBlink,
                overviewRuler: { width: 6 },
            },
            {
                keydownHandler: model.handleTerminalKeydown.bind(model),
                useWebGl: !termSettings?.["term:disablewebgl"],
                sendDataHandler: model.sendDataToController.bind(model),
                controllerOutputHandler: model.handleControllerOutputChunk.bind(model),
                nodeModel: model.nodeModel,
            }
        );
        (window as any).term = termWrap;
        model.termRef.current = termWrap;
        model.attachToTermWrap(termWrap);
        setTermWrapInst(termWrap);
        const rszObs = new ResizeObserver(() => {
            termWrap.handleResize_debounced();
        });
        rszObs.observe(connectElemRef.current);
        // New split panes can mount before the layout has fully settled, especially
        // in side-by-side splits. Kick a few follow-up resizes so xterm/controller
        // both converge on the final pane size.
        const resizeRecoveryTimers = [0, 120, 300].map((delay) =>
            window.setTimeout(() => {
                termWrap.handleResize();
            }, delay)
        );
        termWrap.onSearchResultsDidChange = (results) => {
            globalStore.set(searchProps.resultsIndex, results.resultIndex);
            globalStore.set(searchProps.resultsCount, results.resultCount);
        };
        fireAndForget(termWrap.initTerminal.bind(termWrap));
        if (wasFocused) {
            setTimeout(() => {
                model.giveFocus();
            }, 10);
        }
        return () => {
            model.attachToTermWrap(null);
            resizeRecoveryTimers.forEach((timerId) => window.clearTimeout(timerId));
            termWrap.dispose();
            rszObs.disconnect();
            setTermWrapInst(null);
        };
    }, [blockId, termSettings, termFontSize, connFontFamily]);

    React.useEffect(() => {
        termModeRef.current = termMode;
    }, [termMode]);

    React.useEffect(() => {
        if (!isBasicTerm || termMode !== "cards" || termWrapInst == null) {
            return;
        }
        model.prepareCardsMode(termWrapInst);
    }, [cardsRuntimeReady, isBasicTerm, model, termMode, termWrapInst]);

    React.useEffect(() => {
        if (isMI && isBasicTerm && isFocused && model.termRef.current != null) {
            model.termRef.current.multiInputCallback = (data: string) => {
                model.multiInputHandler(data);
            };
        } else {
            if (model.termRef.current != null) {
                model.termRef.current.multiInputCallback = null;
            }
        }
    }, [isMI, isBasicTerm, isFocused]);

    const stickerConfig = {
        charWidth: 8,
        charHeight: 16,
        rows: model.termRef.current?.terminal.rows ?? 24,
        cols: model.termRef.current?.terminal.cols ?? 80,
        blockId: blockId,
    };

    const termBg = computeBgStyleFromMeta(blockData?.meta);

    const handleContextMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const menuItems = model.getContextMenuItems();
            ContextMenuModel.getInstance().showContextMenu(menuItems, e);
        },
        [model]
    );

    return (
        <div className={clsx("view-term", "term-mode-" + termMode)} ref={viewRef} onContextMenu={handleContextMenu}>
            {termBg && <div key="term-bg" className="absolute inset-0 z-0 pointer-events-none" style={termBg} />}
            <TermResyncHandler blockId={blockId} model={model} />
            <TermThemeUpdater blockId={blockId} model={model} termRef={model.termRef} />
            <TermStickers config={stickerConfig} />
            <div key="connect-elem" className="term-connectelem" ref={connectElemRef} />
            {isBasicTerm && termMode === "cards" ? (
                <TermCardsView blockId={blockId} model={model} termWrap={termWrapInst} />
            ) : null}
            {isBasicTerm && termMode !== "cards" ? (
                <TermQuickInputBar
                    model={model}
                    value={quickInputValue}
                    onChange={(value) => model.setQuickInputValue(value)}
                    onSubmit={() => model.submitQuickInput()}
                    notifyEnabled={quickInputNotifyEnabled}
                    setNotifyEnabled={(enabled) => model.setQuickInputNotifyEnabled(enabled)}
                    notifyAvailable={quickInputNotifyAvailable}
                    placeholder="Enter a command. Ctrl+Enter sends it."
                    submitLabel="发送 (Ctrl+Enter)"
                    submitTitle="发送 (Ctrl+Enter)"
                />
            ) : null}
            <NullErrorBoundary debugName="TermLinkTooltip">
                <TermLinkTooltip termWrap={termWrapInst} />
            </NullErrorBoundary>
            <Search {...searchProps} />
        </div>
    );
};

export { TerminalView };
