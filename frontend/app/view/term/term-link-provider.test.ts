// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

describe("term-link-provider", () => {
    it("finds supported terminal file paths", async () => {
        vi.resetModules();
        vi.doMock("@/util/platformutil", () => ({ PLATFORM: "linux", PlatformMacOS: "darwin" }));
        vi.doMock("@/util/previewutil", () => ({ openPreviewInNewBlock: vi.fn() }));
        vi.doMock("@/util/util", () => ({ fireAndForget: (fn: () => unknown) => fn() }));
        vi.doMock("@/store/global", () => ({ globalStore: { get: vi.fn() }, WOS: { getWaveObjectAtom: vi.fn() } }));
        const mod = await import("./term-link-provider");

        expect(mod.findTerminalFileLinks("See ./src/termwrap.ts:42:7 and foo/bar.txt", 3)).toEqual([
            {
                linkText: "./src/termwrap.ts:42:7",
                range: { start: { x: 5, y: 3 }, end: { x: 26, y: 3 } },
            },
            {
                linkText: "foo/bar.txt",
                range: { start: { x: 32, y: 3 }, end: { x: 42, y: 3 } },
            },
        ]);
        expect(mod.findTerminalFileLinks("skip foo/bar and keep foo/Makefile", 1)).toEqual([
            {
                linkText: "foo/Makefile",
                range: { start: { x: 23, y: 1 }, end: { x: 34, y: 1 } },
            },
        ]);

        expect(
            mod.findTerminalFileLinks("-rwxr-xr-x docker.sh init_env.sh sshd.sh total", 2).map((link) => link.linkText)
        ).toEqual(["docker.sh", "init_env.sh", "sshd.sh"]);

        expect(
            mod
                .findTerminalFileLinks("-rwxr-xr-x 1 root root 123 Jan 1 12:00 docker.sh* init_env.sh* sshd.sh", 4)
                .map((link) => link.linkText)
        ).toEqual(["docker.sh", "init_env.sh", "sshd.sh"]);
    });

    it("resolves relative paths against cwd", async () => {
        vi.resetModules();
        vi.doMock("@/util/platformutil", () => ({ PLATFORM: "linux", PlatformMacOS: "darwin" }));
        vi.doMock("@/util/previewutil", () => ({ openPreviewInNewBlock: vi.fn() }));
        vi.doMock("@/util/util", () => ({ fireAndForget: (fn: () => unknown) => fn() }));
        vi.doMock("@/store/global", () => ({ globalStore: { get: vi.fn() }, WOS: { getWaveObjectAtom: vi.fn() } }));
        const mod = await import("./term-link-provider");

        expect(mod.resolveTerminalFilePath("./src/app.ts", "/workspace/wave")).toBe("/workspace/wave/src/app.ts");
        expect(mod.resolveTerminalFilePath("src/app.ts", "/workspace/wave")).toBe("/workspace/wave/src/app.ts");
        expect(mod.resolveTerminalFilePath("~/src/app.ts", "/workspace/wave")).toBe("~/src/app.ts");
    });

    it("opens preview only on modifier click", async () => {
        const openPreviewInNewBlock = vi.fn().mockResolvedValue("block-2");

        vi.resetModules();
        vi.doMock("@/util/previewutil", () => ({
            openPreviewInNewBlock,
        }));
        vi.doMock("@/util/util", () => ({
            fireAndForget: (fn: () => unknown) => fn(),
        }));
        vi.doMock("@/util/platformutil", () => ({
            PLATFORM: "linux",
            PlatformMacOS: "darwin",
        }));
        vi.doMock("@/store/global", () => ({
            WOS: {
                makeORef: vi.fn((_otype: string, oid: string) => `block:${oid}`),
                getWaveObjectAtom: vi.fn(() => "block-atom"),
            },
            globalStore: {
                get: vi.fn(() => ({
                    meta: {
                        "cmd:cwd": "/workspace/waveterm",
                        connection: "ssh://devbox",
                    },
                })),
            },
        }));

        const { FilePathLinkProvider } = await import("./term-link-provider");
        const terminal = {
            buffer: {
                active: {
                    getLine: vi.fn(() => ({
                        translateToString: () => "./src/app.ts:12:3",
                    })),
                },
            },
        };

        const provider = new FilePathLinkProvider(terminal as any, "block-1");
        const callback = vi.fn();
        provider.provideLinks(1, callback);
        const links = callback.mock.calls[0][0];

        expect(links).toHaveLength(1);
        links[0].activate({ ctrlKey: false, metaKey: false } as MouseEvent, links[0].text);
        expect(openPreviewInNewBlock).not.toHaveBeenCalled();

        links[0].activate({ ctrlKey: true, metaKey: false } as MouseEvent, links[0].text);
        expect(openPreviewInNewBlock).toHaveBeenCalledWith(
            "/workspace/waveterm/src/app.ts",
            "ssh://devbox",
            "block-1"
        );
    });

    it("emits hover callbacks for file links", async () => {
        vi.resetModules();
        vi.doMock("@/util/platformutil", () => ({ PLATFORM: "linux", PlatformMacOS: "darwin" }));
        vi.doMock("@/util/previewutil", () => ({ openPreviewInNewBlock: vi.fn() }));
        vi.doMock("@/util/util", () => ({ fireAndForget: (fn: () => unknown) => fn() }));
        vi.doMock("@/store/global", () => ({ globalStore: { get: vi.fn() }, WOS: { getWaveObjectAtom: vi.fn() } }));
        const { FilePathLinkProvider } = await import("./term-link-provider");
        const onHover = vi.fn();
        const onLeave = vi.fn();
        const terminal = {
            buffer: {
                active: {
                    getLine: vi.fn(() => ({
                        translateToString: () => "docker.sh",
                    })),
                },
            },
        };

        const provider = new FilePathLinkProvider(terminal as any, "block-1", { onHover, onLeave });
        const callback = vi.fn();
        provider.provideLinks(1, callback);
        const links = callback.mock.calls[0][0];

        expect(links).toHaveLength(1);
        links[0].hover?.({ clientX: 10, clientY: 20 } as MouseEvent, links[0].text);
        expect(onHover).toHaveBeenCalledWith("docker.sh", expect.objectContaining({ clientX: 10, clientY: 20 }));

        links[0].leave?.({} as MouseEvent, links[0].text);
        expect(onLeave).toHaveBeenCalled();
    });
});