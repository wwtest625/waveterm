// Copyright 2025, Command Platform Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    type AIBlockOutputStatus,
    type WaveUIMessage,
    isTextPart,
} from "./aitypes";

export type TaskTurn = {
    id: string;
    userMessage?: WaveUIMessage;
    assistantMessages: WaveUIMessage[];
    isStreaming: boolean;
    blockOutputStatus: AIBlockOutputStatus;
};

export function normalizeAssistantText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
        return "";
    }
    const lines = trimmed
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));
    return lines.join("\n").trim();
}

type AssistantDisplayContent = {
    answerText: string;
    thinkingText: string;
};

export function splitReasoningFromText(text: string): AssistantDisplayContent {
    let remaining = text;
    const reasoningSegments: string[] = [];
    const thinkTagPairs = ["think", "thinking"];

    for (const tagName of thinkTagPairs) {
        const pairRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "gi");
        remaining = remaining.replace(pairRegex, (_match, captured: string) => {
            const segment = captured.trim();
            if (segment) {
                reasoningSegments.push(segment);
            }
            return "\n";
        });
    }

    for (const tagName of thinkTagPairs) {
        const openingTag = `<${tagName}>`;
        const closingTag = `</${tagName}>`;
        const normalized = remaining.toLowerCase();
        const openingTagIndex = normalized.lastIndexOf(openingTag);
        const closingTagIndex = normalized.lastIndexOf(closingTag);
        if (openingTagIndex !== -1 && closingTagIndex < openingTagIndex) {
            const danglingReasoning = remaining.slice(openingTagIndex + openingTag.length).trim();
            if (danglingReasoning) {
                reasoningSegments.push(danglingReasoning);
            }
            remaining = remaining.slice(0, openingTagIndex);
        }
    }

    return {
        answerText: normalizeAssistantText(remaining),
        thinkingText: reasoningSegments.join("\n\n").trim(),
    };
}

export function getMessageText(message?: WaveUIMessage): string {
    if (!message?.parts?.length) {
        return "";
    }
    return normalizeAssistantText(
        message.parts
            .filter(isTextPart)
            .map((part) => part.text ?? "")
            .join("\n\n")
    );
}
