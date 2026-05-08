import type { WaveUIMessage } from "./aitypes";

export type ContextUsageStats = {
    usedTokens: number;
    totalTokens: number;
    usedPercent: number;
};

const MODEL_CONTEXT_TOKEN_LIMITS: Array<{ pattern: RegExp; limit: number }> = [
    { pattern: /gpt-5|gpt-4\.1|o1|o3|o4/i, limit: 256000 },
    { pattern: /claude-4|claude-sonnet|claude-opus|claude-haiku/i, limit: 200000 },
    { pattern: /gemini-2\.5|gemini-2\.0/i, limit: 1000000 },
    { pattern: /gemini-1\.5/i, limit: 1000000 },
    { pattern: /qwen|deepseek|llama|mixtral|mistral|yi|phi/i, limit: 128000 },
];

export function resolveModelContextLimit(modelName: string | undefined): number {
    const normalized = (modelName ?? "").trim();
    if (!normalized) {
        return 128000;
    }
    for (const item of MODEL_CONTEXT_TOKEN_LIMITS) {
        if (item.pattern.test(normalized)) {
            return item.limit;
        }
    }
    return 128000;
}

export function escapeMarkdown(text: string): string {
    return text
        .replace(/^# /gm, "\\# ")
        .replace(/^---$/gm, "\\-\\-\\-")
        .replace(/^```/gm, "\\`\\`\\`")
        .replace(/^>/gm, "\\>");
}

function estimateTokensFromText(text: string | undefined): number {
    const normalized = (text ?? "").trim();
    if (!normalized) {
        return 0;
    }
    let cjkCount = 0;
    let otherCount = 0;
    for (const ch of normalized) {
        const code = ch.codePointAt(0)!;
        if (
            (code >= 0x4e00 && code <= 0x9fff) ||
            (code >= 0x3040 && code <= 0x30ff) ||
            (code >= 0xac00 && code <= 0xd7af) ||
            (code >= 0x3400 && code <= 0x4dbf) ||
            (code >= 0xf900 && code <= 0xfaff)
        ) {
            cjkCount++;
        } else {
            otherCount++;
        }
    }
    return Math.ceil(cjkCount * 0.7 + otherCount / 4);
}

function estimateMessageTokens(message: WaveUIMessage): number {
    if (!message?.parts || message.parts.length === 0) {
        return 0;
    }
    let tokens = 0;
    for (const part of message.parts) {
        if (part.type === "text" || part.type === "reasoning") {
            tokens += estimateTokensFromText(part.text);
            continue;
        }
        if (part.type === "data-tooluse") {
            const toolData = part.data;
            tokens += estimateTokensFromText(toolData?.tooldesc);
            tokens += estimateTokensFromText(toolData?.outputtext);
            tokens += estimateTokensFromText(toolData?.errormessage);
            continue;
        }
        if (part.type === "data-toolprogress") {
            const progressData = part.data;
            const lines = Array.isArray(progressData?.statuslines) ? progressData.statuslines : [];
            for (const line of lines) {
                tokens += estimateTokensFromText(line);
            }
            continue;
        }
        if (part.type === "data-ask") {
            const askData = part.data;
            tokens += estimateTokensFromText(askData?.prompt);
            continue;
        }
    }
    return tokens;
}

const messageTokenEstimateCache = new WeakMap<WaveUIMessage, number>();

function estimateMessageTokensCached(message: WaveUIMessage): number {
    const cached = messageTokenEstimateCache.get(message);
    if (cached != null) {
        return cached;
    }
    const estimated = estimateMessageTokens(message);
    messageTokenEstimateCache.set(message, estimated);
    return estimated;
}

export function computeContextUsageStats(messages: WaveUIMessage[], modelName: string | undefined): ContextUsageStats {
    let usedTokens = 0;
    for (const message of messages) {
        usedTokens += estimateMessageTokensCached(message);
    }
    const totalTokens = resolveModelContextLimit(modelName);
    const usedPercent = totalTokens > 0 ? Math.min(100, Math.round((usedTokens / totalTokens) * 100)) : 0;
    return {
        usedTokens,
        totalTokens,
        usedPercent,
    };
}

export function formatTokensCompact(tokens: number): string {
    if (tokens >= 1000000) {
        return `${Math.round(tokens / 10000) / 100}M`;
    }
    if (tokens >= 1000) {
        return `${Math.round(tokens / 10) / 100}K`;
    }
    return `${tokens}`;
}
