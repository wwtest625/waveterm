# Codex Engineering Reading Guide (Wave Context)

Date: **2026-03-12**

## Goal

Build a practical understanding of Codex app-server behavior and apply it to Wave's **pure wsh** local-agent runtime.

## Primary References

1. Codex app-server docs:
   - https://developers.openai.com/codex/app-server
2. OpenAI engineering post (Codex harness):
   - https://openai.com/zh-Hans-CN/index/unlocking-the-codex-harness/

## Key Concepts to Internalize

1. JSON-RPC lifecycle:
   - `initialize` -> `initialized` -> `thread/start|resume` -> `turn/start` -> streamed items -> `turn/completed`
2. App-server enums/version compatibility:
   - modern vs legacy enum spellings on `thread/start`
3. Host-side control points:
   - `settings.developer_instructions`
   - approval handling
   - runtime phase reporting
4. Failure classes:
   - protocol mismatch
   - runtime sandbox/process restrictions
   - host session lifecycle issues

## Wave-Specific Notes (Current)

- Legacy MCP bridge path has been removed.
- Terminal tasks are guided through developer instructions and real command execution.
- UI status now derives from `codex_*` and `term_*` progress signals.

## Suggested Reading Order

1. Official app-server protocol docs (handshake, thread/turn/item events).
2. Harness article for design intent and operational tradeoffs.
3. Wave implementation:
   - `pkg/aiusechat/localagent.go`
   - `pkg/aiusechat/codex_appserver.go`
   - `frontend/app/aipanel/agentstatus.tsx`

## Practical Review Checklist

1. Can we explain why enum fallback is needed for some app-server versions?
2. Do we always inject developer instructions for terminal-query turns?
3. Are runtime phases and user-visible status consistent with actual execution?
4. Are internal errors compressed for UX while preserving backend diagnosis detail?
