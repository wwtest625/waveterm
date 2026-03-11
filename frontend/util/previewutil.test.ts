import { describe, expect, it, vi } from "vitest";

describe("openPreviewInNewBlock", () => {
    it("splits to the right of the current block when a source block is provided", async () => {
        const createBlock = vi.fn();
        const createBlockSplitHorizontally = vi.fn().mockResolvedValue("block-2");

        vi.resetModules();
        vi.doMock("@/app/store/global", () => ({
            createBlock,
            createBlockSplitHorizontally,
            getApi: vi.fn(),
        }));
        vi.doMock("./platformutil", () => ({
            makeNativeLabel: vi.fn(),
        }));
        vi.doMock("./util", () => ({
            fireAndForget: (fn: () => unknown) => fn(),
            lazy: (fn: () => unknown) => fn(),
            stringToBase64: (value: string) => Buffer.from(value).toString("base64"),
        }));
        vi.doMock("./waveutil", () => ({
            formatRemoteUri: vi.fn(),
        }));
        vi.doMock("@/app/transfer/transfer-store", () => ({
            startDownloadTransfer: vi.fn(),
        }));

        const { openPreviewInNewBlock } = await import("./previewutil");
        await openPreviewInNewBlock("/srv/app/README.md", "ssh://devbox", "block-1");

        expect(createBlockSplitHorizontally).toHaveBeenCalledWith(
            {
                meta: {
                    view: "preview",
                    file: "/srv/app/README.md",
                    connection: "ssh://devbox",
                },
            },
            "block-1",
            "after"
        );
        expect(createBlock).not.toHaveBeenCalled();
    });

    it("creates a regular preview block when there is no source block", async () => {
        const createBlock = vi.fn().mockResolvedValue("block-2");
        const createBlockSplitHorizontally = vi.fn();

        vi.resetModules();
        vi.doMock("@/app/store/global", () => ({
            createBlock,
            createBlockSplitHorizontally,
            getApi: vi.fn(),
        }));
        vi.doMock("./platformutil", () => ({
            makeNativeLabel: vi.fn(),
        }));
        vi.doMock("./util", () => ({
            fireAndForget: (fn: () => unknown) => fn(),
            lazy: (fn: () => unknown) => fn(),
            stringToBase64: (value: string) => Buffer.from(value).toString("base64"),
        }));
        vi.doMock("./waveutil", () => ({
            formatRemoteUri: vi.fn(),
        }));
        vi.doMock("@/app/transfer/transfer-store", () => ({
            startDownloadTransfer: vi.fn(),
        }));

        const { openPreviewInNewBlock } = await import("./previewutil");
        await openPreviewInNewBlock("/srv/app/README.md", "");

        expect(createBlock).toHaveBeenCalledWith({
            meta: {
                view: "preview",
                file: "/srv/app/README.md",
                connection: "",
            },
        });
        expect(createBlockSplitHorizontally).not.toHaveBeenCalled();
    });

    it("creates a command block to the right when requested", async () => {
        const createBlock = vi.fn();
        const createBlockSplitHorizontally = vi.fn().mockResolvedValue("block-3");

        vi.resetModules();
        vi.doMock("@/app/store/global", () => ({
            createBlock,
            createBlockSplitHorizontally,
            getApi: vi.fn(),
        }));
        vi.doMock("./util", () => ({
            fireAndForget: (fn: () => unknown) => fn(),
            lazy: (fn: () => unknown) => fn(),
            stringToBase64: (value: string) => Buffer.from(value).toString("base64"),
        }));
        vi.doMock("./waveutil", () => ({
            formatRemoteUri: vi.fn(),
        }));
        vi.doMock("@/app/transfer/transfer-store", () => ({
            startDownloadTransfer: vi.fn(),
        }));

        const { openCommandInNewBlock } = await import("./previewutil");
        await openCommandInNewBlock("tar -xf /tmp/model.tar.gz -C model", "/tmp", "ssh://devbox", "block-1", "解压 model.tar.gz");

        expect(createBlockSplitHorizontally).toHaveBeenCalledWith(
            {
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd: "tar -xf /tmp/model.tar.gz -C model",
                    "cmd:cwd": "/tmp",
                    "cmd:closeonexit": false,
                    "cmd:runonce": true,
                    connection: "ssh://devbox",
                    "display:name": "解压 model.tar.gz",
                },
            },
            "block-1",
            "after"
        );
        expect(createBlock).not.toHaveBeenCalled();
    });

    it("sends cd to an existing shell terminal on the same connection", async () => {
        const createBlock = vi.fn();
        const createBlockSplitHorizontally = vi.fn();
        const refocusNode = vi.fn();
        const ControllerInputCommand = vi.fn().mockResolvedValue(undefined);
        const tabAtom = Symbol("tab-atom");

        vi.resetModules();
        vi.doMock("@/app/store/tab-model", () => ({
            getActiveTabModel: () => ({ tabAtom }),
        }));
        vi.doMock("@/app/store/global", () => ({
            createBlock,
            createBlockSplitHorizontally,
            getApi: vi.fn(),
            globalStore: {
                get: (atom: unknown) => {
                    if (atom === tabAtom) {
                        return { blockids: ["term-1"] };
                    }
                    if (atom === "block:term-1") {
                        return { meta: { view: "term", controller: "shell", connection: "root@192.2.53.33" } };
                    }
                    return null;
                },
            },
            refocusNode,
            WOS: {
                makeORef: (_type: string, id: string) => `block:${id}`,
                getWaveObjectAtom: (oref: string) => oref,
            },
        }));
        vi.doMock("@/app/store/wshclientapi", () => ({
            RpcApi: {
                ControllerInputCommand,
            },
        }));
        vi.doMock("@/app/store/wshrpcutil", () => ({
            TabRpcClient: "tab-rpc-client",
        }));
        vi.doMock("./util", () => ({
            fireAndForget: (fn: () => unknown) => fn(),
            lazy: (fn: () => unknown) => fn(),
            stringToBase64: (value: string) => Buffer.from(value).toString("base64"),
        }));
        vi.doMock("./waveutil", () => ({
            formatRemoteUri: vi.fn(),
        }));
        vi.doMock("@/app/transfer/transfer-store", () => ({
            startDownloadTransfer: vi.fn(),
        }));

        const { sendDirectoryToTerminal } = await import("./previewutil");
        await sendDirectoryToTerminal("/opt", "root@192.2.53.33", "block-1");

        expect(ControllerInputCommand).toHaveBeenCalledWith("tab-rpc-client", {
            blockid: "term-1",
            inputdata64: Buffer.from("cd /opt\n").toString("base64"),
        });
        expect(refocusNode).toHaveBeenCalledWith("term-1");
        expect(createBlock).not.toHaveBeenCalled();
        expect(createBlockSplitHorizontally).not.toHaveBeenCalled();
    });

    it("creates a shell terminal when no matching terminal exists", async () => {
        const createBlock = vi.fn();
        const createBlockSplitHorizontally = vi.fn().mockResolvedValue("term-2");
        const tabAtom = Symbol("tab-atom");

        vi.resetModules();
        vi.doMock("@/app/store/tab-model", () => ({
            getActiveTabModel: () => ({ tabAtom }),
        }));
        vi.doMock("@/app/store/global", () => ({
            createBlock,
            createBlockSplitHorizontally,
            getApi: vi.fn(),
            globalStore: {
                get: (atom: unknown) => {
                    if (atom === tabAtom) {
                        return { blockids: [] };
                    }
                    return null;
                },
            },
            refocusNode: vi.fn(),
            WOS: {
                makeORef: (_type: string, id: string) => `block:${id}`,
                getWaveObjectAtom: (oref: string) => oref,
            },
        }));
        vi.doMock("@/app/store/wshclientapi", () => ({
            RpcApi: {
                ControllerInputCommand: vi.fn(),
            },
        }));
        vi.doMock("@/app/store/wshrpcutil", () => ({
            TabRpcClient: "tab-rpc-client",
        }));
        vi.doMock("./util", () => ({
            fireAndForget: (fn: () => unknown) => fn(),
            lazy: (fn: () => unknown) => fn(),
            stringToBase64: (value: string) => Buffer.from(value).toString("base64"),
        }));
        vi.doMock("./waveutil", () => ({
            formatRemoteUri: vi.fn(),
        }));
        vi.doMock("@/app/transfer/transfer-store", () => ({
            startDownloadTransfer: vi.fn(),
        }));

        const { sendDirectoryToTerminal } = await import("./previewutil");
        await sendDirectoryToTerminal("/opt", "root@192.2.53.33", "block-1");

        expect(createBlockSplitHorizontally).toHaveBeenCalledWith(
            {
                meta: {
                    controller: "shell",
                    view: "term",
                    "cmd:cwd": "/opt",
                    connection: "root@192.2.53.33",
                },
            },
            "block-1",
            "after"
        );
        expect(createBlock).not.toHaveBeenCalled();
    });
});
