import { describe, expect, it } from "vitest";
import { resolveShellIntegrationRuntimeState } from "./term-shellintegration";

describe("resolveShellIntegrationRuntimeState", () => {
    it("treats missing integration flag as known-but-unavailable", () => {
        const state = resolveShellIntegrationRuntimeState({});

        expect(state.integrationKnown).toBe(true);
        expect(state.integrationStatus).toBeNull();
    });

    it("marks integration as known and keeps ready status when integration is enabled", () => {
        const state = resolveShellIntegrationRuntimeState({
            "shell:integration": true,
            "shell:state": "ready",
        });

        expect(state.integrationKnown).toBe(true);
        expect(state.integrationStatus).toBe("ready");
    });

    it("treats empty runtime info as known-but-unavailable", () => {
        const state = resolveShellIntegrationRuntimeState(undefined);

        expect(state.integrationKnown).toBe(true);
        expect(state.integrationStatus).toBeNull();
    });
});
