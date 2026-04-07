import { describe, expect, it } from "vitest";
import { getDefaultAgentRuntimeSnapshot, reduceAgentRuntimeSnapshot } from "./aitypes";

describe("agent runtime reducer", () => {
    it("enters interacting state when command input is required", () => {
        const next = reduceAgentRuntimeSnapshot(getDefaultAgentRuntimeSnapshot(), {
            type: "INTERACTION_REQUIRED",
            reason: "Command is waiting for terminal input",
        });

        expect(next.state).toBe("interacting");
        expect(next.phaseLabel).toBe("Waiting Input");
        expect(next.blockedReason).toContain("terminal input");
    });

    it("uses completed as the terminal success state", () => {
        const next = reduceAgentRuntimeSnapshot(getDefaultAgentRuntimeSnapshot(), {
            type: "VERIFY_FINISHED",
            ok: true,
        });

        expect(next.state).toBe("completed");
        expect(next.phaseLabel).toBe("Completed");
    });
});
