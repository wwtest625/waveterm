// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getRemoteConnectionNames } from "./conntypeahead-util";

describe("getRemoteConnectionNames", () => {
    it("returns configured connections ordered by display order then name", () => {
        const fullConfig = {
            connections: {
                "root@prod": { "display:order": 20 },
                "root@dev": { "display:order": 10 },
                "root@alpha": {},
            },
        } as FullConfigType;

        expect(getRemoteConnectionNames(fullConfig, [], null)).toEqual(["root@alpha", "root@dev", "root@prod"]);
    });

    it("keeps only active ad-hoc remote connections while excluding local and wsl entries", () => {
        const fullConfig = {
            connections: {
                "root@saved": { "display:order": 10 },
            },
        } as FullConfigType;
        const allConnStatus = [
            { connection: "root@adhoc", connected: true, activeconnnum: 1, status: "connected" },
            { connection: "root@stale", connected: false, activeconnnum: 0, status: "disconnected" },
            { connection: "wsl://Ubuntu" },
            { connection: "local:gitbash" },
            { connection: "" },
        ] as ConnStatus[];

        expect(getRemoteConnectionNames(fullConfig, allConnStatus, "root@current")).toEqual([
            "root@adhoc",
            "root@current",
            "root@saved",
        ]);
    });
});