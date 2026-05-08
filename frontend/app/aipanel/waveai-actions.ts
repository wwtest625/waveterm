import {
    AgentFocusChainState,
    AgentRuntimeSnapshot,
    AgentTaskState,
    AskUserData,
    ChatBackgroundJobDetail,
    CommandInteractionState,
    WaveChatSessionMeta,
} from "@/app/aipanel/aitypes";
import type { DroppedFile, QueuedSubmission, TerminalTargetInfo } from "./waveai-model";

export type WaveAIAction =
    | { type: "SET_CHAT_ID"; chatId: string }
    | { type: "SET_SESSIONS"; sessions: WaveChatSessionMeta[] }
    | { type: "SET_HIDDEN_SESSION_IDS"; ids: string[] }
    | { type: "SET_IS_LOADING_CHAT"; value: boolean }
    | { type: "SET_IS_CHAT_EMPTY"; value: boolean }
    | { type: "SET_INPUT"; value: string }
    | { type: "SET_DROPPED_FILES"; files: DroppedFile[] }
    | { type: "SET_QUEUED_SUBMISSIONS"; submissions: QueuedSubmission[] }
    | { type: "SET_ERROR_MESSAGE"; message: string | null }
    | { type: "SET_IS_AI_STREAMING"; value: boolean }
    | { type: "SET_AGENT_RUNTIME"; snapshot: AgentRuntimeSnapshot }
    | { type: "SET_TASK_STATE"; taskState: AgentTaskState | null }
    | { type: "SET_FOCUS_CHAIN"; focusChain: AgentFocusChainState | null }
    | { type: "SET_CONTEXT_USAGE"; usage: number }
    | { type: "SET_SECURITY_BLOCKED"; blocked: boolean }
    | { type: "SET_ASK_USER"; data: AskUserData | null }
    | { type: "SET_COMMAND_INTERACTION"; interaction: CommandInteractionState | null }
    | { type: "SET_BACKGROUND_JOBS"; jobs: ChatBackgroundJobDetail[] }
    | { type: "SET_TERMINAL_TARGET"; info: TerminalTargetInfo | null }
    | { type: "SET_CURRENT_AI_MODE"; mode: string }
    | { type: "SET_CONTAINER_WIDTH"; width: number }
    | { type: "SET_RESTORE_BACKUP_MODAL"; toolCallId: string | null }
    | { type: "SET_RESTORE_BACKUP_STATUS"; status: "idle" | "processing" | "success" | "error" }
    | { type: "SET_RESTORE_BACKUP_ERROR"; error: string | null }
    | { type: "CLEAR_CHAT_STATE" };

let actionLogEnabled = false;

export function setActionLogEnabled(enabled: boolean): void {
    actionLogEnabled = enabled;
}

export function getActionLogEnabled(): boolean {
    return actionLogEnabled;
}
