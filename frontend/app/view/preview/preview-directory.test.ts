import { describe, expect, it } from "vitest";

import {
    getAncestorPaths,
    getArchiveExtractionPlan,
    getTreeRootPath,
    normalizeDirectoryEntries,
    shouldIncludeDirectoryEntry,
} from "./preview-directory";
import { getPreviewIconInfo } from "./preview-directory-utils";

describe("preview directory tree helpers", () => {
    it("detects slash and home roots", () => {
        expect(getTreeRootPath("/root/work")).toBe("/");
        expect(getTreeRootPath("~/project/src")).toBe("~");
        expect(getTreeRootPath("relative/path")).toBe("relative/path");
    });

    it("builds slash-root ancestor chains", () => {
        expect(getAncestorPaths("/", "/root/work/app")).toEqual(["/", "/root", "/root/work", "/root/work/app"]);
    });

    it("builds home-root ancestor chains", () => {
        expect(getAncestorPaths("~", "~/project/src")).toEqual(["~", "~/project", "~/project/src"]);
    });

    it("falls back to the provided root when target is outside the root", () => {
        expect(getAncestorPaths("/workspace", "/other/place")).toEqual(["/workspace"]);
    });

    it("filters hidden files without treating parent navigation as hidden", () => {
        expect(shouldIncludeDirectoryEntry({ name: ".ssh" }, false)).toBe(false);
        expect(shouldIncludeDirectoryEntry({ name: ".." }, false)).toBe(true);
        expect(shouldIncludeDirectoryEntry({ name: "README.md" }, false)).toBe(true);
        expect(shouldIncludeDirectoryEntry({ name: ".ssh" }, true)).toBe(true);
    });

    it("normalizes missing directory entries to an empty list", () => {
        expect(normalizeDirectoryEntries(undefined)).toEqual([]);
        expect(normalizeDirectoryEntries(null)).toEqual([]);
        expect(normalizeDirectoryEntries([{ name: "README.md", path: "/repo/README.md" } as FileInfo])).toEqual([
            { name: "README.md", path: "/repo/README.md" },
        ]);
    });

    it("assigns special icons for well-known folders and files", () => {
        const fullConfig = { mimetypes: {} } as FullConfigType;
        expect(getPreviewIconInfo({ path: "/repo/.git", name: ".git", isdir: true, mimetype: "directory" }, fullConfig)).toMatchObject({
            icon: "brands@git-alt",
            color: "#f05133",
        });
        expect(getPreviewIconInfo({ path: "/repo/.github", name: ".github", isdir: true, mimetype: "directory" }, fullConfig)).toMatchObject({
            icon: "brands@github",
            color: "#8b949e",
        });
        expect(getPreviewIconInfo({ path: "/repo/README.md", name: "README.md", isdir: false, mimetype: "text/markdown" }, fullConfig)).toMatchObject({
            icon: "book-open",
            color: "#f59e0b",
        });
        expect(getPreviewIconInfo({ path: "/repo/Dockerfile", name: "Dockerfile", isdir: false, mimetype: "text/plain" }, fullConfig)).toMatchObject({
            icon: "brands@docker",
            color: "#2496ed",
        });
    });

    it("prefers extension icons over generic mimetype icons", () => {
        const fullConfig = {
            mimetypes: {
                "text/markdown": { icon: "file", color: "#ffffff" },
                "text/plain": { icon: "file", color: "#ffffff" },
            },
        } as unknown as FullConfigType;

        expect(getPreviewIconInfo({ path: "/repo/Agent.md", name: "Agent.md", isdir: false, mimetype: "text/markdown" }, fullConfig)).toMatchObject({
            icon: "book-open",
            color: "#f59e0b",
        });
    });

    it("builds extraction plans for common archive types", () => {
        expect(getArchiveExtractionPlan({ path: "/tmp/model.tar.gz", name: "model.tar.gz", dir: "/tmp", mimetype: "application/gzip" })).toMatchObject({
            cwd: "/tmp",
            destinationLabel: "/tmp/model",
        });
        expect(getArchiveExtractionPlan({ path: "/tmp/model.zip", name: "model.zip", dir: "/tmp", mimetype: "application/zip" })?.command).toContain(
            "unzip -o"
        );
        expect(getArchiveExtractionPlan({ path: "/tmp/weights.7z", name: "weights.7z", dir: "/tmp", mimetype: "application/x-7z-compressed" })?.command).toContain(
            "7z x -y"
        );
    });
});
