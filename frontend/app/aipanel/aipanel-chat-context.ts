import { type UseChatSendMessageType, type UseChatSetMessagesType } from "@/app/aipanel/aitypes";
import { createContext, useContext } from "react";
import type { ChatStatus } from "ai";

export interface AIPanelChatContextValue {
    sendMessage: UseChatSendMessageType;
    setMessages: UseChatSetMessagesType;
    status: ChatStatus;
    stop: () => void;
}

export const AIPanelChatContext = createContext<AIPanelChatContextValue | null>(null);

export function useAIPanelChat(): AIPanelChatContextValue {
    const ctx = useContext(AIPanelChatContext);
    if (!ctx) {
        throw new Error("useAIPanelChat must be used within AIPanelChatContext.Provider");
    }
    return ctx;
}
