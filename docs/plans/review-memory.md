# Review Memory

## 2026-03-12 - Codex Local Agent terminal-query failure (Windows)

- Issue pattern:
  - Terminal queries rely on real command execution in app-server turns.
  - On Windows this can fail via sandbox/process restrictions (`CreateProcessWithLogonW`) and end in timeout.
- Important anti-misdiagnosis:
  - Do not treat assistant refusal text as authoritative.
  - Trust runtime logs first (`item/started type=commandExecution`, progress phases, summarized runtime errors).
- Effective mitigations already in place:
  - enum fallback for `thread/start`
  - output integrity guard for missing terminal tool phase
  - extra diagnostic logging
- Next durable fix:
  - keep host-side terminal-query guardrails strict and continue reducing false refusals/noise output.
