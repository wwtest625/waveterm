# Wave Local Agent Communication Flow (Pure WSH)

Updated on **2026-03-12**. This document describes the current runtime path after removing the legacy MCP bridge.

## End-to-End Flow

1. User sends message in AI panel (`isLocal=true`, provider=`codex` or `claude-code`).
2. Frontend sends WebSocket RPC to `wavesrv`.
3. `WaveAILocalAgentPostMessageWrap` builds prompt + context.
4. Codex provider:
   - default path: Codex app-server session
   - `turn/start` includes `settings.developer_instructions` for terminal-query behavior
5. Model executes real commands (prefer `wsh` where applicable) and streams output back.
6. Host emits tool-progress phases (`codex_*`, `term_*`) and final assistant text.

## Architecture

- Frontend: AI panel + status rendering
- Backend: `pkg/aiusechat/localagent.go`
- Codex app-server adapter: `pkg/aiusechat/codex_appserver.go`
- Terminal access path: direct command execution + `wsh` commands

## Explicitly Removed

- `wsh mcpserve`
- `wave_*` MCP tool injection and discovery flow
- Codex `mcp_servers.wave.*` arg injection
- Claude `--mcp-config` generation path

## Runtime Progress Phases (Current)

- `codex_thinking`
- `codex_reasoning`
- `codex_plan`
- `codex_wave_terminal_context_ok`
- `codex_command_execution`
- `codex_file_change`
- `codex_waiting_approval`
- `codex_responding`
- `term_get_scrollback`
- `term_command_output`

## Error Handling Strategy

- If terminal-query output contains only internal debug/noise and no command execution signal:
  - trigger one retry with stronger command-execution instructions
  - compress verbose internal traces into concise user-facing failure summary
- If runtime returns sandbox/timeout failures:
  - show short actionable failure text
  - keep host logs detailed for diagnosis

## Why Pure WSH

- Fewer moving parts (no extra bridge process).
- Less session/tooling ambiguity for users.
- Better alignment with app-server `settings.developer_instructions`.
- Easier to debug from logs and progress phases.
