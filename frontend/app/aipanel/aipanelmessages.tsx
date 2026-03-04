// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import { getFirstExecutableCommandFromMessage } from "./autoexecute-util";
import { AIMessage } from "./aimessage";
import { AIModeDropdown } from "./aimode";
import { type WaveUIMessage } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

interface AIPanelMessagesProps {
    messages: WaveUIMessage[];
    status: string;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export const AIPanelMessages = memo(({ messages, status, onContextMenu }: AIPanelMessagesProps) => {
    const model = WaveAIModel.getInstance();
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const autoExecute = useAtomValue(model.autoExecuteAtom);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<string>(status);
    const seenAssistantMessageIdsRef = useRef<Set<string>>(new Set());
    const pendingAutoExecuteMessageIdRef = useRef<string | null>(null);
    const autoExecuteReadyRef = useRef(false);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

    const checkIfAtBottom = () => {
        const container = messagesContainerRef.current;
        if (!container) return true;

        const threshold = 50;
        const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return scrollBottom <= threshold;
    };

    const handleScroll = () => {
        const atBottom = checkIfAtBottom();
        setShouldAutoScroll(atBottom);
    };

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            container.scrollLeft = 0;
            setShouldAutoScroll(true);
        }
    };

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        container.addEventListener("scroll", handleScroll);
        return () => container.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
    }, [model]);

    useEffect(() => {
        if (shouldAutoScroll) {
            scrollToBottom();
        }
    }, [messages, shouldAutoScroll]);

    useEffect(() => {
        if (isPanelOpen) {
            scrollToBottom();
        }
    }, [isPanelOpen]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming) {
            requestAnimationFrame(() => {
                scrollToBottom();
            });
        }

        prevStatusRef.current = status;
    }, [status]);

    useEffect(() => {
        const assistantMessages = messages.filter((m) => m.role === "assistant");

        if (!autoExecuteReadyRef.current) {
            for (const message of assistantMessages) {
                seenAssistantMessageIdsRef.current.add(message.id);
            }
            autoExecuteReadyRef.current = true;
            return;
        }

        for (const message of assistantMessages) {
            if (!seenAssistantMessageIdsRef.current.has(message.id)) {
                seenAssistantMessageIdsRef.current.add(message.id);
                pendingAutoExecuteMessageIdRef.current = message.id;
            }
        }
    }, [messages]);

    useEffect(() => {
        if (status === "streaming") {
            return;
        }

        if (!autoExecute) {
            pendingAutoExecuteMessageIdRef.current = null;
            return;
        }

        const pendingMessageId = pendingAutoExecuteMessageIdRef.current;
        if (!pendingMessageId) {
            return;
        }

        const pendingMessage = messages.find((m) => m.id === pendingMessageId);
        pendingAutoExecuteMessageIdRef.current = null;
        if (!pendingMessage || pendingMessage.role !== "assistant") {
            return;
        }

        const command = getFirstExecutableCommandFromMessage(pendingMessage);
        if (!command) {
            return;
        }

        model.executeCommandInTerminal(command, { source: "auto" });
    }, [messages, status, autoExecute, model]);

    return (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 space-y-4" onContextMenu={onContextMenu}>
            <div className="mb-2">
                <AIModeDropdown compatibilityMode={true} />
            </div>
            {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isStreaming = status === "streaming" && isLastMessage && message.role === "assistant";
                return <AIMessage key={message.id} message={message} isStreaming={isStreaming} />;
            })}

            {status === "streaming" &&
                (messages.length === 0 || messages[messages.length - 1].role !== "assistant") && (
                    <AIMessage
                        key="last-message"
                        message={{ role: "assistant", parts: [], id: "last-message" } as any}
                        isStreaming={true}
                    />
                )}

            <div ref={messagesEndRef} />
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
