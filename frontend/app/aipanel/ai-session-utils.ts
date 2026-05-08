import type { WaveChatSessionMeta } from "./aitypes";
import { t } from "./aipanel-i18n";

export type SessionHistoryGroup = {
    label: string;
    sessions: WaveChatSessionMeta[];
};

export function normalizeSessionTs(ts: number | undefined): number {
    if (!ts || ts <= 0) {
        return 0;
    }
    return ts < 1_000_000_000_000 ? ts * 1000 : ts;
}

export function getSessionSortTs(session: WaveChatSessionMeta): number {
    return normalizeSessionTs(session.updatedts ?? session.createdts);
}

export function formatHistoryGroupLabel(dayStartTs: number, todayStartTs: number): string {
    if (dayStartTs === todayStartTs) {
        return t.aipanel.today;
    }
    if (dayStartTs === todayStartTs - 24 * 60 * 60 * 1000) {
        return t.aipanel.yesterday;
    }
    const date = new Date(dayStartTs);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}.${month}.${day}`;
}

export function getHorizontalSessionTabs(
    sessions: WaveChatSessionMeta[],
    hiddenSessionIds: string[],
    activeChatId: string | null | undefined,
    maxTabs = 3
): WaveChatSessionMeta[] {
    const visibleSessions = sessions.filter((session) => !hiddenSessionIds.includes(session.chatid));
    const normalizedMaxTabs = Math.max(1, maxTabs);
    const defaultTabs = visibleSessions.slice(0, normalizedMaxTabs);
    if (!activeChatId) {
        return defaultTabs;
    }
    if (defaultTabs.some((session) => session.chatid === activeChatId)) {
        return defaultTabs;
    }
    const activeSession = visibleSessions.find((session) => session.chatid === activeChatId);
    if (!activeSession) {
        return defaultTabs;
    }
    const tabsWithActive = [...defaultTabs.slice(0, normalizedMaxTabs - 1), activeSession];
    const visibleIndexByChatId = new Map(visibleSessions.map((session, index) => [session.chatid, index]));
    return tabsWithActive.sort((left, right) => {
        const leftIndex = visibleIndexByChatId.get(left.chatid) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = visibleIndexByChatId.get(right.chatid) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
    });
}
