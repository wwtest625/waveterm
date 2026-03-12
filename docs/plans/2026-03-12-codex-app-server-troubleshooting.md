# Codex App-Server Troubleshooting (2026-03-12)

## Scope

This document summarizes the unresolved local-agent failure seen in Windows quickdev runs while using **Local Agent (Codex)** for terminal queries.

## User-visible Symptom

- Local agent may fail with:
  - `Local Agent (codex) failed: context deadline exceeded`
  - stderr includes `exec error: windows sandbox: CreateProcessWithLogonW...`
- Assistant may return a generic failure summary after timeout.

## Evidence from Runtime Logs

From `%LOCALAPPDATA%\\waveterm-dev\\Data\\waveapp.log` on 2026-03-12:

- Wave MCP injection is present:
  - `local-agent: wave mcp invocation resolved ...`
  - `mcp_enabled=true mcp_injected=true`
- App-server starts with bypass enabled:
  - `bypass=true`
- Initialize handshake is healthy:
  - `initialize userAgent="waveterm/0.114.0 ... vscode/1.107.1 ..."`
- Thread start uses compatibility fallback:
  - modern `dangerFullAccess` rejected
  - legacy retry succeeds (`danger-full-access`)
- `wave_*` tools are visible at least in some turns:
  - `item/started ... tool="wave_read_current_terminal_context"`
- But model still sometimes switches to command execution:
  - `item/started ... type="commandExecution"`
  - then timeout/sandbox failures follow.

## Diagnosis

This is **not** a pure "tool not injected" problem anymore.

Current primary failure mode:

1. `wave_*` tools are injected and sometimes used.
2. Model behavior can still pivot to `commandExecution`.
3. On Windows, that path can hit sandbox/process restrictions.
4. Turn eventually times out (`context deadline exceeded`).

## What Is Already Implemented

- App-server migration foundation:
  - initialize/initialized
  - thread start/resume
  - item event translation to UI progress
- Enum compatibility:
  - modern -> legacy fallback for `thread/start`
- Bypass path in app-server thread config:
  - approval policy and sandbox bypass support
- Prompting + retry hardening for terminal flow:
  - require `wave_read_current_terminal_context -> inject -> wait -> result`
- Output integrity guard:
  - no fake-success response if no terminal tool phase observed
- Additional diagnostics:
  - MCP/session/handshake/item-started logs

## Why It Still Fails Sometimes

Because runtime enforcement is not yet strict enough for terminal-query turns:

- The host currently encourages `wave_*` flow but does not fully hard-block `commandExecution` for those turns.
- A single model pivot to `commandExecution` can still trigger Windows sandbox errors and timeout.

## Recommended Next Step (P0)

Implement host-side enforcement for terminal-query intent:

- If user request is terminal-query:
  - allow only `wave_*` tool route for that turn
  - reject/short-circuit `commandExecution` route
- Return a deterministic error when only disallowed path is attempted.

This turns the issue from probabilistic behavior into deterministic behavior.

## UX Follow-up (P1)

- Keep status chips explicit and always visible during local-agent run:
  - `Terminal Tools Connected`
  - `Terminal Context Ready`
- Ensure these are emitted/rendered even before first assistant text chunk.

## Repro Checklist

1. `task electron:winquickdev`
2. Provider = `Codex`, Mode = `Auto-Approve`
3. Ask for remote terminal CPU query
4. Check `waveapp.log` for:
   - `mcp_injected=true`
   - `tool="wave_read_current_terminal_context"`
   - any `type="commandExecution"` before failure

If all three appear in sequence, this known issue is reproduced.
