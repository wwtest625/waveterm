// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildRemoteFileError } from "./preview-error-util";

describe("buildRemoteFileError", () => {
    it("converts missing remote route failures into a wsh-specific message", () => {
        const connStatus = {
            status: "connected",
            connection: "root@example.com",
            connected: true,
            hasconnected: true,
            activeconnnum: 1,
            wshenabled: false,
            wsherror: "wsh installation failed",
        } as ConnStatus;

        const errorMsg = buildRemoteFileError(new Error('no route for "conn:root@example.com"'), connStatus, connStatus.connection);

        expect(errorMsg.status).toBe("Remote Files Unavailable");
        expect(errorMsg.text).toContain("requires wsh");
        expect(errorMsg.text).toContain("wsh installation failed");
    });

    it("keeps the original error for non-wsh failures", () => {
        const connStatus = {
            status: "connected",
            connection: "root@example.com",
            connected: true,
            hasconnected: true,
            activeconnnum: 1,
            wshenabled: true,
        } as ConnStatus;

        const errorMsg = buildRemoteFileError(new Error("permission denied"), connStatus, connStatus.connection, "Cannot Read Directory");

        expect(errorMsg).toEqual({
            status: "Cannot Read Directory",
            text: "Error: permission denied",
        });
    });

    it("falls back to nowshreason when wsherror is unavailable", () => {
        const connStatus = {
            status: "connected",
            connection: "root@example.com",
            connected: true,
            hasconnected: true,
            activeconnnum: 1,
            wshenabled: false,
            nowshreason: "user selected not to install wsh extensions",
        } as ConnStatus;

        const errorMsg = buildRemoteFileError(new Error('no route for "conn:root@example.com"'), connStatus, connStatus.connection);

        expect(errorMsg.status).toBe("Remote Files Unavailable");
        expect(errorMsg.text).toContain("user selected not to install wsh extensions");
    });
});
