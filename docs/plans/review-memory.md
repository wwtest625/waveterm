# Review Memory

## 2026-03-12 - Codex Local Agent terminal-query failure (Windows)

- Issue pattern:
  - Wave MCP is injected, but Codex can still pivot to `commandExecution` in app-server turns.
  - On Windows this can fail via sandbox/process restrictions (`CreateProcessWithLogonW`) and end in timeout.
- Important anti-misdiagnosis:
  - Do not treat "assistant says no wave tools" as authoritative.
  - Trust runtime logs first (`mcp_injected=true`, `item/started tool=wave_*`, `type=commandExecution`).
- Effective mitigations already in place:
  - enum fallback for `thread/start`
  - output integrity guard for missing terminal tool phase
  - extra diagnostic logging
- Next durable fix:
  - enforce host-side gating for terminal-query turns (allow `wave_*`, block `commandExecution` path).
