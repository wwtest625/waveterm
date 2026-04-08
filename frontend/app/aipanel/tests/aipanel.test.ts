import { describe, expect, it, vi } from "vitest";
import { getHorizontalSessionTabs, loadInitialChatForPanel } from "../aipanel";

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

describe("getHorizontalSessionTabs", () => {
    it("keeps stable order when the active session is already in the first three", () => {
        const tabs = getHorizontalSessionTabs(
            [
                { chatid: "chat-1", title: "One" } as any,
                { chatid: "chat-2", title: "Two" } as any,
                { chatid: "chat-3", title: "Three" } as any,
                { chatid: "chat-4", title: "Four" } as any,
            ],
            [],
            "chat-3",
            3
        );

        expect(tabs.map((item) => item.chatid)).toEqual(["chat-1", "chat-2", "chat-3"]);
    });

    it("falls back to the most recent visible sessions when there is no active chat", () => {
        const tabs = getHorizontalSessionTabs(
            [
                { chatid: "chat-1", title: "One" } as any,
                { chatid: "chat-2", title: "Two" } as any,
                { chatid: "chat-3", title: "Three" } as any,
            ],
            [],
            null,
            3
        );

        expect(tabs.map((item) => item.chatid)).toEqual(["chat-1", "chat-2", "chat-3"]);
    });

    it("includes the active session when it is outside the first three without reordering the selected set", () => {
        const tabs = getHorizontalSessionTabs(
            [
                { chatid: "chat-1", title: "One" } as any,
                { chatid: "chat-2", title: "Two" } as any,
                { chatid: "chat-3", title: "Three" } as any,
                { chatid: "chat-4", title: "Four" } as any,
            ],
            [],
            "chat-4",
            3
        );

        expect(tabs.map((item) => item.chatid)).toEqual(["chat-1", "chat-2", "chat-4"]);
    });
});
