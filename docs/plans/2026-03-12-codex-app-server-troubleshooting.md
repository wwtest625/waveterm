# Codex App-Server Troubleshooting (2026-03-12, Pure WSH)

## Scope

This note tracks the Windows quickdev issues seen on **March 11-12, 2026** while running Local Agent (Codex).
The codebase is now in **pure wsh mode** (legacy MCP bridge removed).

## Confirmed Root Causes

1. **`thread/start` enum mismatch with older app-server builds**
   - Symptom: `unknown variant unlessTrusted`
   - Cause: older server variants expect legacy enum names.
   - Fix in code: automatic fallback from modern enum set to legacy enum set.

2. **Windows sandbox/process execution failures**
   - Symptom: `context deadline exceeded`, `CreateProcessWithLogonW`, `windows sandbox`
   - Cause: command execution route blocked in some host/runtime combinations.
   - Mitigation in code: retry + concise failure summarization + stronger diagnostics.

3. **Single-instance lock during quickdev**
   - Symptom: `could not get single-instance-lock, shutting down`
   - Cause: another Wave dev instance was still alive.
   - Operational fix: close prior instance/process before relaunch.

## What Changed (Now True)

- Removed `wsh mcpserve` command path and related command/test files.
- Removed Codex/Claude MCP config injection branches (`--mcp-config`, `mcp_servers.wave.*`).
- Codex app-server turn now relies on `settings.developer_instructions` + direct command execution guidance.
- Runtime/UI status now tracks pure-wsh/codex phases (`codex_command_execution`, `term_*`, etc.).

## Runtime Signals to Check

1. Session bootstrap:
   - `local-agent: codex app-server session spec ...`
   - `codex app-server thread/start succeeded ...`
2. Turn execution:
   - `item/started ... type="commandExecution"`
   - `codex_command_execution` progress events in UI stream
3. Error classification:
   - sandbox timeout/process errors are compressed to user-facing short summaries
   - internal debug noise should not be dumped verbatim

## Remaining Risk

- Some Windows environments can still block command execution under sandboxed constraints.
- We now surface this clearly, but it remains environment-dependent and may require host/runtime tuning.

## Operator Checklist

1. Ensure no stale Wave dev instance is running before `task electron:winquickdev`.
2. Confirm Codex app-server starts and thread handshake succeeds.
3. Verify at least one real command-execution phase appears for terminal-query turns.
4. If blocked by sandbox/runtime, capture the summarized error and relevant logs for follow-up.
