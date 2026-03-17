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

## 2026-03-17 - Files widget width bug investigation

- Confirmed the issue is not config precedence:
  - active user config `C:\Users\sys49169\.config\waveterm-dev\widgets.json` already stores `defwidget@files.display:width = 33`.
- Current strongest hypothesis:
  - widget creation/open flow reads the intended width, but a later layout step resets the split to an equal `50/50`.
- Investigation aids now in repo:
  - `[widget-width-debug]` console logs added around width persistence, sidebar widget open, split creation, and delayed width reapply.
- Follow-up location:
  - `docs/plans/bug_todo.md` tracks the active reproduction details and next debugging step.
