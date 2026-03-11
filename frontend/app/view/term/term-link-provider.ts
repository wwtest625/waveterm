// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore, WOS } from "@/store/global";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { openPreviewInNewBlock } from "@/util/previewutil";
import { fireAndForget } from "@/util/util";
import type { IBufferRange, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

const FILE_PATH_REGEX =
    /(?:^|[\s('"`:])((\/[\w.+\-@/]*[\w.+\-@])|(~\/[\w.+\-@/]*[\w.+\-@])|(\.\/?[\w.+\-@/]*[\w.+\-@])|([\w.+\-@]+(?:\/[\w.+\-@]+)+)|([\w.+\-@]+))(?::(\d+)(?::(\d+))?)?/g;

const KNOWN_EXTENSIONS =
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|c|cpp|h|hpp|css|scss|less|html|json|yaml|yml|toml|md|txt|sh|bash|zsh|fish|lua|zig|swift|kt|scala|ex|exs|erl|hrl|vue|svelte|astro|sql|graphql|gql|proto|conf|cfg|ini|env|xml|csv|log)$/;

const KNOWN_FILENAMES = /(^|\/)(Makefile|Dockerfile|Rakefile|Gemfile|Justfile|Vagrantfile|Procfile|Brewfile)$/;

export type TerminalFileLinkMatch = {
    linkText: string;
    range: IBufferRange;
};

type FilePathLinkProviderOptions = {
    onHover?: (linkText: string, event: MouseEvent) => void;
    onLeave?: () => void;
};

function getLineText(terminal: Terminal, lineNumber: number): string {
    const line = terminal.buffer.active.getLine(lineNumber - 1);
    return line?.translateToString(true) ?? "";
}

function getBlockData(blockId: string): Block | undefined {
    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    return globalStore.get(blockAtom);
}

function getCwd(blockId: string): string | undefined {
    return getBlockData(blockId)?.meta?.["cmd:cwd"];
}

function getConnection(blockId: string): string {
    return getBlockData(blockId)?.meta?.connection ?? "";
}

function stripLineColSuffix(linkText: string): string {
    return linkText.replace(/:(\d+)(?::(\d+))?$/, "");
}

export function resolveTerminalFilePath(rawPath: string, cwd?: string): string {
    if (rawPath.startsWith("/") || rawPath.startsWith("~/")) {
        return rawPath;
    }
    if (!cwd) {
        return rawPath;
    }
    const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
    return rawPath.startsWith("./") ? `${base}${rawPath.slice(2)}` : `${base}${rawPath}`;
}

export function findTerminalFileLinks(lineText: string, bufferLineNumber: number): TerminalFileLinkMatch[] {
    const links: TerminalFileLinkMatch[] = [];
    let match: RegExpExecArray | null;
    FILE_PATH_REGEX.lastIndex = 0;

    while ((match = FILE_PATH_REGEX.exec(lineText)) !== null) {
        const fullMatch = match[0];
        const pathPart = match[1];

        const isBareRelativePath =
            !pathPart.startsWith("/") && !pathPart.startsWith("~/") && !pathPart.startsWith(".") && !pathPart.includes("/");
        const isSlashRelativePath =
            !pathPart.startsWith("/") && !pathPart.startsWith("~/") && !pathPart.startsWith(".") && pathPart.includes("/");

        if (
            (isBareRelativePath || isSlashRelativePath) &&
            !KNOWN_EXTENSIONS.test(pathPart) &&
            !KNOWN_FILENAMES.test(pathPart)
        ) {
            continue;
        }

        const matchStart = match.index;
        const pathStartInMatch = fullMatch.indexOf(pathPart);
        const startX = matchStart + pathStartInMatch + 1;

        const lineNum = match[7];
        const colNum = match[8];
        let linkText = pathPart;
        if (lineNum) {
            linkText += `:${lineNum}`;
            if (colNum) {
                linkText += `:${colNum}`;
            }
        }

        links.push({
            linkText,
            range: {
                start: { x: startX, y: bufferLineNumber },
                end: { x: startX + linkText.length - 1, y: bufferLineNumber },
            },
        });
    }

    return links;
}

function openFileInPreview(linkText: string, blockId: string): void {
    const resolvedPath = resolveTerminalFilePath(stripLineColSuffix(linkText), getCwd(blockId));
    fireAndForget(() => openPreviewInNewBlock(resolvedPath, getConnection(blockId), blockId));
}

export class FilePathLinkProvider implements ILinkProvider {
    constructor(
        private terminal: Terminal,
        private blockId: string,
        private options: FilePathLinkProviderOptions = {}
    ) {}

    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
        const lineText = getLineText(this.terminal, bufferLineNumber);
        if (!lineText) {
            callback(undefined);
            return;
        }

        const links = findTerminalFileLinks(lineText, bufferLineNumber).map(({ linkText, range }) => ({
            range,
            text: linkText,
            decorations: { pointerCursor: true, underline: true },
            hover: (event: MouseEvent, text: string) => {
                this.options.onHover?.(text, event);
            },
            leave: () => {
                this.options.onLeave?.();
            },
            activate: (event: MouseEvent, text: string) => {
                const isModifierHeld = PLATFORM === PlatformMacOS ? event.metaKey : event.ctrlKey;
                if (!isModifierHeld) {
                    return;
                }
                openFileInPreview(text, this.blockId);
            },
        }));

        callback(links.length > 0 ? links : undefined);
    }
}