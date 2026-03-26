import { atom, createStore, type PrimitiveAtom } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

type LoadedModule = typeof import("./term-model");

type FakeTermWrap = {
    runtimeInfoReadyAtom: PrimitiveAtom<boolean>;
    shellIntegrationKnownAtom: PrimitiveAtom<boolean>;
    shellIntegrationStatusAtom: PrimitiveAtom<"ready" | "running-command" | null>;
    lastCommandAtom: PrimitiveAtom<string | null>;
    lastCommandExitCodeAtom: PrimitiveAtom<number | null>;
    contextLabelAtom: PrimitiveAtom<string>;
    terminal: { buffer: { active: { type: string } } };
    promptMarkers: any[];
};

async function loadTermModelModule() {
    vi.resetModules();

    const store = createStore();
    const pushModal = vi.fn();

    vi.doMock("@/app/aipanel/waveai-model", () => ({ WaveAIModel: class {} }));
    vi.doMock("@/app/store/keymodel", () => ({ appHandleKeyDown: vi.fn() }));
    vi.doMock("@/app/store/modalmodel", () => ({ modalsModel: { pushModal } }));
    vi.doMock("@/app/store/wps", () => ({ waveEventSubscribeSingle: vi.fn(() => () => {}) }));
    vi.doMock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
    vi.doMock("@/app/store/wshrouter", () => ({ makeFeBlockRouteId: vi.fn(() => "route-id") }));
    vi.doMock("@/app/store/wshrpcutil", () => ({
        DefaultRouter: { registerRoute: vi.fn(), unregisterRoute: vi.fn() },
        TabRpcClient: {},
    }));
    vi.doMock("@/app/view/term/term", () => ({ TerminalView: () => null }));
    vi.doMock("@/app/view/term/term-wsh", () => ({ TermWshClient: class {} }));
    vi.doMock("@/store/global", () => ({
        atoms: {
            staticTabId: atom("tab-1"),
            fullConfigAtom: atom({}),
        },
        createBlock: vi.fn(),
        createBlockSplitHorizontally: vi.fn(),
        createBlockSplitVertically: vi.fn(),
        getAllBlockComponentModels: vi.fn(() => []),
        getApi: vi.fn(),
        getBlockComponentModel: vi.fn(),
        getBlockMetaKeyAtom: vi.fn(),
        getBlockTermDurableAtom: vi.fn(),
        getConnStatusAtom: vi.fn(() => atom(null)),
        getOverrideConfigAtom: vi.fn(() => atom(null)),
        getSettingsKeyAtom: vi.fn(() => atom(null)),
        globalStore: store,
        readAtom: vi.fn(),
        recordTEvent: vi.fn(),
        useBlockAtom: vi.fn((_blockId: string, _key: string, factory: () => PrimitiveAtom<any>) => factory()),
        WOS: {
            getWaveObjectAtom: vi.fn(() => atom({ meta: {} })),
            makeORef: vi.fn((_otype: string, oid: string) => `block:${oid}`),
        },
    }));
    vi.doMock("@/store/services", () => ({}));
    vi.doMock("@/util/keyutil", () => ({}));
    vi.doMock("@/util/platformutil", () => ({ isMacOS: vi.fn(() => false), isWindows: vi.fn(() => false) }));
    vi.doMock("@/util/util", () => ({
        boundNumber: (value: number) => value,
        fireAndForget: (fn: () => unknown) => fn(),
        lazy: <T>(factory: () => T) => {
            let loaded = false;
            let value: T;
            return () => {
                if (!loaded) {
                    value = factory();
                    loaded = true;
                }
                return value;
            };
        },
        stringToBase64: (value: string) => value,
    }));
    vi.doMock("./shellblocking", () => ({ getBlockingCommand: vi.fn(() => null) }));
    vi.doMock("./term-cards-backfill", () => ({ buildBackfilledTermCard: vi.fn(() => null) }));
    vi.doMock("./term-quickinput", () => ({ normalizeQuickInputForSend: vi.fn((value: string) => value) }));
    vi.doMock("./termutil", () => ({ DefaultTermTheme: {}, computeTheme: vi.fn(() => ({})) }));
    vi.doMock("./termwrap", () => ({ TermWrap: class {} }));

    const mod = await import("./term-model");
    return { mod, store, pushModal };
}

function makeTermWrap(store: ReturnType<typeof createStore>): FakeTermWrap {
    const runtimeInfoReadyAtom = atom(false);
    const shellIntegrationKnownAtom = atom(false);
    const shellIntegrationStatusAtom = atom<"ready" | "running-command" | null>(null);
    const lastCommandAtom = atom<string | null>(null);
    const lastCommandExitCodeAtom = atom<number | null>(null);
    const contextLabelAtom = atom("");

    store.set(runtimeInfoReadyAtom, false);
    store.set(shellIntegrationKnownAtom, false);
    store.set(shellIntegrationStatusAtom, null);
    store.set(lastCommandAtom, null);
    store.set(lastCommandExitCodeAtom, null);
    store.set(contextLabelAtom, "");

    return {
        runtimeInfoReadyAtom,
        shellIntegrationKnownAtom,
        shellIntegrationStatusAtom,
        lastCommandAtom,
        lastCommandExitCodeAtom,
        contextLabelAtom,
        terminal: { buffer: { active: { type: "normal" } } },
        promptMarkers: [],
    };
}

function makeModel(mod: LoadedModule, blockId: string) {
    const model = Object.create(mod.TermViewModel.prototype) as any;
    model.blockId = blockId;
    model.termRef = { current: null };
    model.quickInputNotificationQueueAtom = atom([]);
    model.quickInputPendingDispatchQueueAtom = atom([]);
    model.pendingCmdNotificationAtom = atom(null);
    model.cardsContextLabelAtom = atom("");
    model.shellIntegrationAvailableAtom = atom(false);
    model.autoTermModeAtom = atom<"term" | "cards">("term");
    model.termMode = atom("term");
    model.cardsAtom = atom([]);
    model.blockAtom = atom({ meta: {} });
    model.tabModel = { isTermMultiInput: atom(false) };
    model.sendDataToController = vi.fn();
    model.multiInputHandler = vi.fn();
    model.supportsQuickInput = vi.fn(() => false);
    model.finalizeActiveCard = vi.fn();
    model.beginCardFromShellIntegration = vi.fn();
    model.markLastPendingCardAsInteractive = vi.fn();
    model.setTermMode = vi.fn();
    model.sendCompletionNotification = vi.fn().mockResolvedValue(undefined);
    model.cardsUnsubFns = [];
    return model;
}

describe("term-model quick input notifications", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-25T10:00:00Z"));
    });

    it("queues notify-enabled quick input until runtime is ready, then arms in FIFO order", async () => {
        const { mod, store } = await loadTermModelModule();
        const model = makeModel(mod, "block-a");
        const termWrap = makeTermWrap(store);
        model.termRef.current = termWrap;

        model.attachToTermWrap(termWrap);
        model.dispatchQuickInputSubmission({
            data: "echo first\n",
            notifyOnCompletion: true,
            thresholdMs: 30_000,
            commandText: "echo first",
        });

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(1);
        expect(store.get(model.quickInputNotificationQueueAtom)).toHaveLength(0);
        expect(model.sendDataToController).not.toHaveBeenCalled();

        store.set(termWrap.runtimeInfoReadyAtom, true);
        store.set(termWrap.shellIntegrationStatusAtom, "ready");
        store.set(termWrap.shellIntegrationKnownAtom, true);

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(0);
        expect(store.get(model.quickInputNotificationQueueAtom)).toEqual([
            { startTs: null, thresholdMs: 30_000, commandText: "echo first" },
        ]);
        expect(model.sendDataToController).toHaveBeenCalledTimes(1);
        expect(model.sendDataToController).toHaveBeenCalledWith("echo first\n");
    });

    it("sends the command without arming a notification when shell integration is unavailable", async () => {
        const { mod, store, pushModal } = await loadTermModelModule();
        const model = makeModel(mod, "block-b");
        const termWrap = makeTermWrap(store);
        model.termRef.current = termWrap;

        store.set(termWrap.runtimeInfoReadyAtom, true);
        store.set(termWrap.shellIntegrationKnownAtom, true);
        model.attachToTermWrap(termWrap);
        model.dispatchQuickInputSubmission({
            data: "echo no-notify\n",
            notifyOnCompletion: true,
            thresholdMs: 30_000,
            commandText: "echo no-notify",
        });

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(0);
        expect(store.get(model.quickInputNotificationQueueAtom)).toHaveLength(0);
        expect(model.sendDataToController).toHaveBeenCalledTimes(1);
        expect(pushModal).toHaveBeenCalledTimes(1);
    });

    it("ignores flush attempts from a stale term wrap after the block attaches a new one", async () => {
        const { mod, store } = await loadTermModelModule();
        const model = makeModel(mod, "block-c");
        const oldTermWrap = makeTermWrap(store);
        const newTermWrap = makeTermWrap(store);

        model.termRef.current = oldTermWrap;
        model.attachToTermWrap(oldTermWrap);
        model.dispatchQuickInputSubmission({
            data: "echo stale\n",
            notifyOnCompletion: true,
            thresholdMs: 30_000,
            commandText: "echo stale",
        });

        model.termRef.current = newTermWrap;
        model.attachToTermWrap(newTermWrap);

        store.set(oldTermWrap.runtimeInfoReadyAtom, true);
        store.set(oldTermWrap.shellIntegrationStatusAtom, "ready");
        store.set(oldTermWrap.shellIntegrationKnownAtom, true);
        model.tryFlushQueuedQuickInputDispatches("stale-termwrap", oldTermWrap);

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(1);
        expect(store.get(model.quickInputNotificationQueueAtom)).toHaveLength(0);
        expect(model.sendDataToController).not.toHaveBeenCalled();

        store.set(newTermWrap.runtimeInfoReadyAtom, true);
        store.set(newTermWrap.shellIntegrationStatusAtom, "ready");
        store.set(newTermWrap.shellIntegrationKnownAtom, true);

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(0);
        expect(store.get(model.quickInputNotificationQueueAtom)).toHaveLength(1);
        expect(model.sendDataToController).toHaveBeenCalledTimes(1);
    });

    it("keeps notifications isolated per block when multiple terminals run concurrently", async () => {
        const { mod, store } = await loadTermModelModule();
        const modelA = makeModel(mod, "block-a");
        const modelB = makeModel(mod, "block-b");
        const termWrapA = makeTermWrap(store);
        const termWrapB = makeTermWrap(store);

        modelA.termRef.current = termWrapA;
        modelB.termRef.current = termWrapB;
        store.set(termWrapA.runtimeInfoReadyAtom, true);
        store.set(termWrapB.runtimeInfoReadyAtom, true);
        store.set(termWrapA.shellIntegrationKnownAtom, true);
        store.set(termWrapB.shellIntegrationKnownAtom, true);
        store.set(termWrapA.shellIntegrationStatusAtom, "ready");
        store.set(termWrapB.shellIntegrationStatusAtom, "ready");
        modelA.attachToTermWrap(termWrapA);
        modelB.attachToTermWrap(termWrapB);

        modelA.dispatchQuickInputSubmission({
            data: "echo alpha\n",
            notifyOnCompletion: true,
            thresholdMs: 0,
            commandText: "echo alpha",
        });
        modelB.dispatchQuickInputSubmission({
            data: "echo beta\n",
            notifyOnCompletion: true,
            thresholdMs: 0,
            commandText: "echo beta",
        });

        store.set(termWrapA.lastCommandAtom, "echo alpha");
        store.set(termWrapA.lastCommandExitCodeAtom, 11);
        store.set(termWrapB.lastCommandAtom, "echo beta");
        store.set(termWrapB.lastCommandExitCodeAtom, 22);

        modelA.handleQuickInputStatusChange("running-command", termWrapA);
        vi.advanceTimersByTime(25);
        modelB.handleQuickInputStatusChange("running-command", termWrapB);
        vi.advanceTimersByTime(25);
        modelA.handleQuickInputStatusChange("ready", termWrapA);
        modelB.handleQuickInputStatusChange("ready", termWrapB);

        expect(modelA.sendCompletionNotification).toHaveBeenCalledWith("echo alpha", 11, 50);
        expect(modelB.sendCompletionNotification).toHaveBeenCalledWith("echo beta", 22, 25);
        expect(store.get(modelA.quickInputNotificationQueueAtom)).toHaveLength(0);
        expect(store.get(modelB.quickInputNotificationQueueAtom)).toHaveLength(0);
    });

    it("keeps notify-enabled quick input queued while integration capability is still unknown", async () => {
        const { mod, store, pushModal } = await loadTermModelModule();
        const model = makeModel(mod, "block-d");
        const termWrap = makeTermWrap(store);
        model.termRef.current = termWrap;

        model.attachToTermWrap(termWrap);
        store.set(termWrap.runtimeInfoReadyAtom, true);
        model.dispatchQuickInputSubmission({
            data: "echo wait-for-handshake\n",
            notifyOnCompletion: true,
            thresholdMs: 30_000,
            commandText: "echo wait-for-handshake",
        });

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(1);
        expect(store.get(model.quickInputNotificationQueueAtom)).toHaveLength(0);
        expect(model.sendDataToController).not.toHaveBeenCalled();
        expect(pushModal).not.toHaveBeenCalled();

        store.set(termWrap.shellIntegrationStatusAtom, "ready");
        store.set(termWrap.shellIntegrationKnownAtom, true);

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(0);
        expect(store.get(model.quickInputNotificationQueueAtom)).toEqual([
            {
                startTs: null,
                thresholdMs: 30_000,
                commandText: "echo wait-for-handshake",
            },
        ]);
        expect(model.sendDataToController).toHaveBeenCalledWith("echo wait-for-handshake\n");
    }, 10_000);

    it("queues the command until the current running command finishes", async () => {
        const { mod, store } = await loadTermModelModule();
        const model = makeModel(mod, "block-e");
        const termWrap = makeTermWrap(store);
        model.termRef.current = termWrap;

        store.set(termWrap.runtimeInfoReadyAtom, true);
        store.set(termWrap.shellIntegrationKnownAtom, true);
        store.set(termWrap.shellIntegrationStatusAtom, "running-command");
        model.attachToTermWrap(termWrap);

        model.dispatchQuickInputSubmission({
            data: "echo late-arm\n",
            notifyOnCompletion: true,
            thresholdMs: 30_000,
            commandText: "echo late-arm",
        });

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(1);
        expect(store.get(model.quickInputNotificationQueueAtom)).toHaveLength(0);
        expect(model.sendDataToController).not.toHaveBeenCalled();

        store.set(termWrap.shellIntegrationStatusAtom, "ready");
        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(0);
        expect(store.get(model.quickInputNotificationQueueAtom)).toEqual([
            { startTs: null, thresholdMs: 30_000, commandText: "echo late-arm" },
        ]);
        expect(model.sendDataToController).toHaveBeenCalledWith("echo late-arm\n");

        store.set(termWrap.shellIntegrationStatusAtom, "running-command");
        const started = store.get(model.quickInputNotificationQueueAtom)[0];
        expect(started.startTs).toBeTypeOf("number");

        vi.advanceTimersByTime(30_500);
        store.set(termWrap.lastCommandAtom, "echo late-arm");
        store.set(termWrap.lastCommandExitCodeAtom, 0);
        store.set(termWrap.shellIntegrationStatusAtom, "ready");

        expect(model.sendCompletionNotification).toHaveBeenCalledWith("echo late-arm", 0, 30_500);
        expect(store.get(model.quickInputNotificationQueueAtom)).toHaveLength(0);
    });

    it("falls back to exit code when ready status never returns", async () => {
        const { mod, store } = await loadTermModelModule();
        const model = makeModel(mod, "block-f");
        const termWrap = makeTermWrap(store);
        model.termRef.current = termWrap;

        store.set(termWrap.runtimeInfoReadyAtom, true);
        store.set(termWrap.shellIntegrationKnownAtom, true);
        store.set(termWrap.shellIntegrationStatusAtom, "running-command");
        model.attachToTermWrap(termWrap);

        model.dispatchQuickInputSubmission({
            data: "echo exit-fallback\n",
            notifyOnCompletion: true,
            thresholdMs: 30_000,
            commandText: "echo exit-fallback",
        });

        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(1);
        expect(model.sendDataToController).not.toHaveBeenCalled();

        store.set(termWrap.shellIntegrationStatusAtom, "ready");
        expect(store.get(model.quickInputPendingDispatchQueueAtom)).toHaveLength(0);
        expect(model.sendDataToController).toHaveBeenCalledWith("echo exit-fallback\n");
        store.set(termWrap.shellIntegrationStatusAtom, "running-command");
        vi.advanceTimersByTime(30_500);
        store.set(termWrap.lastCommandAtom, "echo exit-fallback");
        store.set(termWrap.lastCommandExitCodeAtom, 7);
        vi.advanceTimersByTime(200);

        expect(model.sendCompletionNotification).toHaveBeenCalledWith("echo exit-fallback", 7, 30_650);
        expect(store.get(model.quickInputNotificationQueueAtom)).toHaveLength(0);
    });
});
