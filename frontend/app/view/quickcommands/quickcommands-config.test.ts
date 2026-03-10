import { describe, expect, it } from "vitest";

import {
    collectQuickCommandGroupIds,
    filterQuickCommandItems,
    insertQuickCommandItem,
    moveQuickCommandItem,
    normalizeQuickCommandsConfig,
    reorderQuickCommandItems,
    removeQuickCommandItem,
    replaceQuickCommandItem,
    stringifyQuickCommandsConfig,
} from "./quickcommands-config";

describe("quickcommands-config", () => {
    it("normalizes malformed config items", () => {
        const config = normalizeQuickCommandsConfig({
            version: 99,
            items: [
                { type: "command", id: "cmd-1", name: "List", command: "ls -la" },
                { type: "command", id: "bad-cmd", name: "Broken", command: "" },
                {
                    type: "group",
                    id: "grp-1",
                    name: " Ops ",
                    items: [{ type: "command", id: "cmd-2", name: "Pwd", command: "pwd" }, { nope: true }],
                },
            ],
        });

        expect(config).toEqual({
            version: 1,
            items: [
                { type: "command", id: "cmd-1", name: "List", command: "ls -la", description: undefined },
                {
                    type: "group",
                    id: "grp-1",
                    name: "Ops",
                    items: [{ type: "command", id: "cmd-2", name: "Pwd", command: "pwd", description: undefined }],
                },
            ],
        });
    });

    it("inserts, replaces, and removes nested items", () => {
        const initial = normalizeQuickCommandsConfig({
            items: [{ type: "group", id: "grp-1", name: "Ops", items: [] }],
        });
        const inserted = insertQuickCommandItem(initial.items, "grp-1", {
            type: "command",
            id: "cmd-1",
            name: "List",
            command: "ls",
        });
        expect(inserted.inserted).toBe(true);
        const replaced = replaceQuickCommandItem(inserted.items, "cmd-1", {
            type: "command",
            id: "cmd-1",
            name: "List All",
            command: "ls -la",
            description: "full list",
        });
        expect(replaced.updated).toBe(true);
        const removed = removeQuickCommandItem(replaced.items, "cmd-1");
        expect(removed.removed).toBe(true);
        expect(removed.items).toEqual([{ type: "group", id: "grp-1", name: "Ops", items: [] }]);
    });

    it("collects group ids and stringifies normalized output", () => {
        const config = normalizeQuickCommandsConfig({
            items: [{ type: "group", id: "grp-1", name: "Ops", items: [{ type: "group", id: "grp-2", name: "Deploy", items: [] }] }],
        });
        expect(collectQuickCommandGroupIds(config.items)).toEqual(["grp-1", "grp-2"]);
        expect(stringifyQuickCommandsConfig(config)).toContain('"version": 1');
        expect(stringifyQuickCommandsConfig(config)).toContain('"name": "Deploy"');
    });

    it("filters commands by query while preserving matching groups", () => {
        const items = normalizeQuickCommandsConfig({
            items: [
                {
                    id: "g1",
                    type: "group",
                    name: "Deploy",
                    items: [
                        { id: "c1", type: "command", name: "Prod Release", command: "deploy prod", description: "publish app" },
                        { id: "c2", type: "command", name: "Staging", command: "deploy staging" },
                    ],
                },
                { id: "c3", type: "command", name: "Logs", command: "tail -f app.log" },
            ],
        }).items;

        expect(filterQuickCommandItems(items, "prod")).toEqual([
            {
                id: "g1",
                type: "group",
                name: "Deploy",
                items: [{ id: "c1", type: "command", name: "Prod Release", command: "deploy prod", description: "publish app" }],
            },
        ]);

        expect(filterQuickCommandItems(items, "deploy")).toEqual([
            {
                id: "g1",
                type: "group",
                name: "Deploy",
                items: [
                    { id: "c1", type: "command", name: "Prod Release", command: "deploy prod", description: "publish app" },
                    { id: "c2", type: "command", name: "Staging", command: "deploy staging", description: undefined },
                ],
            },
        ]);

        expect(filterQuickCommandItems(items, "tail -f")).toEqual([
            { id: "c3", type: "command", name: "Logs", command: "tail -f app.log", description: undefined },
        ]);
    });

    it("reorders root items and nested items within the same parent", () => {
        const items = normalizeQuickCommandsConfig({
            items: [
                { id: "c1", type: "command", name: "One", command: "echo 1" },
                {
                    id: "g1",
                    type: "group",
                    name: "Group",
                    items: [
                        { id: "c2", type: "command", name: "Two", command: "echo 2" },
                        { id: "c3", type: "command", name: "Three", command: "echo 3" },
                    ],
                },
                { id: "c4", type: "command", name: "Four", command: "echo 4" },
            ],
        }).items;

        const rootReordered = reorderQuickCommandItems(items, null, "c4", 0);
        expect(rootReordered.moved).toBe(true);
        expect(rootReordered.items.map((item) => item.id)).toEqual(["c4", "c1", "g1"]);

        const nestedReordered = reorderQuickCommandItems(rootReordered.items, "g1", "c3", 0);
        expect(nestedReordered.moved).toBe(true);
        expect((nestedReordered.items[2] as Extract<(typeof nestedReordered.items)[number], { type: "group" }>).items.map((item) => item.id)).toEqual([
            "c3",
            "c2",
        ]);
    });

    it("moves commands into another group and blocks invalid group nesting", () => {
        const items = normalizeQuickCommandsConfig({
            items: [
                { id: "c1", type: "command", name: "Root", command: "echo root" },
                {
                    id: "g1",
                    type: "group",
                    name: "Ops",
                    items: [{ id: "c2", type: "command", name: "Inside", command: "echo inside" }],
                },
                {
                    id: "g2",
                    type: "group",
                    name: "Deploy",
                    items: [{ id: "g3", type: "group", name: "Child", items: [] }],
                },
            ],
        }).items;

        const movedIntoGroup = moveQuickCommandItem(items, "c1", "g1");
        expect(movedIntoGroup.moved).toBe(true);
        expect(movedIntoGroup.items.map((item) => item.id)).toEqual(["g1", "g2"]);
        expect((movedIntoGroup.items[0] as Extract<(typeof movedIntoGroup.items)[number], { type: "group" }>).items.map((item) => item.id)).toEqual([
            "c2",
            "c1",
        ]);

        const invalidMove = moveQuickCommandItem(movedIntoGroup.items, "g2", "g3");
        expect(invalidMove.moved).toBe(false);
        expect(invalidMove.items).toEqual(movedIntoGroup.items);
    });
});