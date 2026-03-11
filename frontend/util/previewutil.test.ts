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
});
