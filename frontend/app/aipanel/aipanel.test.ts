import { describe, expect, it, vi } from "vitest";
import { loadInitialChatForPanel } from "./aipanel";

describe("loadInitialChatForPanel", () => {
    it("marks the panel ready after a successful initial chat load", async () => {
        const uiLoadInitialChat = vi.fn().mockResolvedValue(undefined);
        const setError = vi.fn();
        const onReady = vi.fn();

        await loadInitialChatForPanel({ uiLoadInitialChat, setError }, onReady);

        expect(uiLoadInitialChat).toHaveBeenCalledTimes(1);
        expect(setError).not.toHaveBeenCalled();
        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("still marks the panel ready and records the error when initial chat load fails", async () => {
        const uiLoadInitialChat = vi.fn().mockRejectedValue(new Error("load failed"));
        const setError = vi.fn();
        const onReady = vi.fn();

        await loadInitialChatForPanel({ uiLoadInitialChat, setError }, onReady);

        expect(uiLoadInitialChat).toHaveBeenCalledTimes(1);
        expect(setError).toHaveBeenCalledWith("load failed");
        expect(onReady).toHaveBeenCalledTimes(1);
    });
});
