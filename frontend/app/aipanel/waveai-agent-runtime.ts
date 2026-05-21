// Copyright 2025, Command Platform Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as jotai from "jotai";
import {
    type AgentRuntimeEvent,
    type AgentRuntimeSnapshot,
    type AgentRuntimeSnapshotPatch,
    type AgentTaskState,
    type AgentFocusChainState,
    type AskUserData,
    agentRuntimeSnapshotEquals,
    getDefaultAgentRuntimeSnapshot,
    mergeAgentRuntimeSnapshot,
    reduceAgentRuntimeSnapshot,
} from "./aitypes";
import { shouldThrottleExecutingRuntimeUpdate } from "./waveai-utils";

type AgentMode = "default" | "planning" | "auto-approve";
type DispatchFn = (action: import("./waveai-actions").WaveAIAction) => void;

export class AgentRuntimeModule {
    readonly agentRuntimeAtom: jotai.PrimitiveAtom<AgentRuntimeSnapshot>;
    readonly isAIStreaming: jotai.PrimitiveAtom<boolean>;
    readonly taskStateAtom: jotai.PrimitiveAtom<AgentTaskState | null>;
    readonly focusChainAtom: jotai.PrimitiveAtom<AgentFocusChainState | null>;
    readonly contextUsageAtom: jotai.PrimitiveAtom<number>;
    readonly securityBlockedAtom: jotai.PrimitiveAtom<boolean>;
    readonly askUserAtom: jotai.PrimitiveAtom<AskUserData | null>;
    readonly errorMessage: jotai.PrimitiveAtom<string>;
    readonly chatClearEpochAtom: jotai.PrimitiveAtom<number>;

    private lastExecutingRuntimeUpdateAt = 0;
    private readonly executingRuntimeThrottleMs = 250;
    private dispatch: DispatchFn;
    private orefContext: string;

    constructor(orefContext: string, dispatch: DispatchFn) {
        this.orefContext = orefContext;
        this.dispatch = dispatch;

        this.agentRuntimeAtom = jotai.atom(getDefaultAgentRuntimeSnapshot());
        this.isAIStreaming = jotai.atom(false);
        this.taskStateAtom = jotai.atom(null) as jotai.PrimitiveAtom<AgentTaskState | null>;
        this.focusChainAtom = jotai.atom(null) as jotai.PrimitiveAtom<AgentFocusChainState | null>;
        this.contextUsageAtom = jotai.atom(0);
        this.securityBlockedAtom = jotai.atom(false);
        this.askUserAtom = jotai.atom(null) as jotai.PrimitiveAtom<AskUserData | null>;
        this.errorMessage = jotai.atom(null) as jotai.PrimitiveAtom<string>;
        this.chatClearEpochAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
    }

    setError(message: string) {
        this.dispatch({ type: "SET_ERROR_MESSAGE", message });
    }

    clearError() {
        this.dispatch({ type: "SET_ERROR_MESSAGE", message: null });
    }

    setAgentRuntimeSnapshot(snapshot: AgentRuntimeSnapshot) {
        const current = globalStore.get(this.agentRuntimeAtom);
        if (agentRuntimeSnapshotEquals(current, snapshot)) {
            return;
        }
        if (snapshot.state === "executing") {
            this.lastExecutingRuntimeUpdateAt = Date.now();
        }
        this.dispatch({ type: "SET_AGENT_RUNTIME", snapshot });
    }

    mergeAgentRuntimeSnapshot(patch: AgentRuntimeSnapshotPatch) {
        const current = globalStore.get(this.agentRuntimeAtom);
        const next = mergeAgentRuntimeSnapshot(current, patch);
        if (shouldThrottleExecutingRuntimeUpdate(current, next, this.lastExecutingRuntimeUpdateAt, this.executingRuntimeThrottleMs)) {
            return;
        }
        if (agentRuntimeSnapshotEquals(current, next)) {
            return;
        }
        if (next.state === "executing") {
            this.lastExecutingRuntimeUpdateAt = Date.now();
        }
        this.dispatch({ type: "SET_AGENT_RUNTIME", snapshot: next });
    }

    dispatchAgentEvent(event: AgentRuntimeEvent) {
        const current = globalStore.get(this.agentRuntimeAtom);
        const next = reduceAgentRuntimeSnapshot(current, event);
        if (agentRuntimeSnapshotEquals(current, next)) {
            return;
        }
        if (next.state === "executing") {
            this.lastExecutingRuntimeUpdateAt = Date.now();
        }
        this.dispatch({ type: "SET_AGENT_RUNTIME", snapshot: next });
    }

    setModel(model: string) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:model": model },
        });
    }

    setWidgetAccess(enabled: boolean) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:widgetcontext": enabled },
        });
    }

    setAutoExecute(enabled: boolean) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:autoexecute": enabled } as MetaType,
        });
    }

    setAgentMode(mode: AgentMode) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "waveai:agentmode": mode },
        });
    }
}
