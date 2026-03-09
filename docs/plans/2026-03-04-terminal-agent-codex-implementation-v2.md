# Terminal Agent (Codex) V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a production-ready Wave terminal agent that delivers qbit-like PTY + tool-loop workflows without weakening Wave’s current safety baseline.

**Architecture:** Build on the current Wave stack (`blockcontroller` + `BlockService` + `wsh mcpserve` + `aiusechat/localagent`) and close the gaps in a phased way. P0 ships a stable command loop (inject/read/status/wait) with UTF-8-safe streaming and strict execution safety. P1 adds Agent Mode and Auto Input UX. P2 adds stronger concurrency controls and operator ergonomics.

**Tech Stack:** Go (`pkg/service`, `pkg/aiusechat`, `cmd/wsh/cmd`), TypeScript/React (`frontend/app/aipanel`), SSE, MCP stdio, Vitest, Go test.

---

## Current Status Snapshot (2026-03-07)

- Already implemented in the codebase:
  - terminal command status API
  - MCP terminal loop tools (`read`, `inject`, `status`, `wait`)
  - local-agent streaming with UTF-8-safe chunk handling
  - local-agent prompt budgeting
  - auto-execute allowlist / denylist checks
- Still missing for P0 product quality:
  - agent mode system (`default`, `planning`, `auto-approve`)
  - visible agent runtime state in the AI panel
  - user activity protection before command injection
  - real-task validation of the full terminal loop

---

## Scope Merge Rules (V2)

- Keep from optimized proposal:
  - Agent Mode (`default`, `planning`, `auto-approve`)
  - Auto Input Mode
  - UTF-8 boundary safety
  - Risk-based tool approval
- Keep from original plan:
  - Read-only-first release strategy
  - Allowlist guard for auto-execute (UI path)
  - User-activity protection before unrestricted command injection
- Explicitly avoid in P0:
  - Re-implementing a full terminal emulator in backend
  - Removing existing safety controls for speed

---

### Task 1: Add Deterministic Terminal Command Status API (P0)

**Files:**
- Modify: `pkg/service/blockservice/blockservice.go`
- Create: `pkg/service/blockservice/blockservice_terminal_status_test.go`

**Step 1: Write the failing test**

```go
func TestGetTerminalCommandStatus_EmptyAndRunning(t *testing.T) {
    // assert empty block returns no last-command
    // assert running block returns status=running
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/service/blockservice -run TerminalStatus -count=1`  
Expected: FAIL because `GetTerminalCommandStatus` does not exist yet.

**Step 3: Write minimal implementation**

```go
type TerminalCommandStatusData struct {
    TabId        string `json:"tabid"`
    BlockId      string `json:"blockid"`
    Status       string `json:"status"`
    LastCommand  string `json:"lastcommand,omitempty"`
    ExitCode     *int   `json:"exitcode,omitempty"`
    LastOutputTs int64  `json:"lastoutputts,omitempty"`
}
```

- Add `GetTerminalCommandStatus(ctx, tabId, blockId)` to `BlockService`.
- Reuse existing runtime info (`shell:*`) instead of creating a second parser truth source.

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/service/blockservice -run TerminalStatus -count=1`  
Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/service/blockservice/blockservice.go pkg/service/blockservice/blockservice_terminal_status_test.go
git commit -m "feat: add deterministic terminal command status api for agent loop"
```

### Task 2: Extend `wsh mcpserve` for Full Terminal Loop (P0)

**Files:**
- Modify: `cmd/wsh/cmd/wshcmd-mcpserve.go`
- Create: `cmd/wsh/cmd/wshcmd-mcpserve_test.go`

**Step 1: Write the failing test**

```go
func TestMCPToolsIncludeStatusAndWait(t *testing.T) {
    // assert tools/list includes:
    // wave_get_terminal_command_status
    // wave_wait_terminal_idle
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./cmd/wsh/cmd -run MCPServe -count=1`  
Expected: FAIL because new MCP tools are missing.

**Step 3: Write minimal implementation**

- Keep existing 3 tools:
  - `wave_read_current_terminal_context`
  - `wave_read_terminal_scrollback`
  - `wave_inject_terminal_command`
- Add:
  - `wave_get_terminal_command_status`
  - `wave_wait_terminal_idle`
- Add strict arg validation (`timeout_ms`, `poll_ms`, `tab_id`, `block_id`).

**Step 4: Run test to verify it passes**

Run: `go test ./cmd/wsh/cmd -run MCPServe -count=1`  
Expected: PASS.

**Step 5: Commit**

```bash
git add cmd/wsh/cmd/wshcmd-mcpserve.go cmd/wsh/cmd/wshcmd-mcpserve_test.go
git commit -m "feat: add mcp status and wait tools for terminal command loop"
```

### Task 3: Stream Local Agent Output with UTF-8 Safety (P0)

**Files:**
- Modify: `pkg/aiusechat/localagent.go`
- Create: `pkg/aiusechat/localagent_stream_test.go`
- Modify: `pkg/aiusechat/localagent_utf8_test.go`

**Step 1: Write the failing test**

```go
func TestLocalAgentStream_EmitsIncrementalText(t *testing.T) {
    // assert SSE receives chunks before process exit
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run LocalAgentStream -count=1`  
Expected: FAIL because implementation is one-shot buffer based.

**Step 3: Write minimal implementation**

- Replace `cmd.Run()+bytes.Buffer` with `StdoutPipe/StderrPipe`.
- Stream deltas to SSE with UTF-8-safe chunk boundaries.
- Keep:
  - overall timeout (`context.WithTimeout`)
  - inactivity timeout
  - output size cap.

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/aiusechat -run LocalAgent -count=1`  
Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/aiusechat/localagent.go pkg/aiusechat/localagent_stream_test.go pkg/aiusechat/localagent_utf8_test.go
git commit -m "feat: stream local agent output with utf-8 safe chunking"
```

### Task 4: Add Token-Budgeted Conversation Continuity (P0)

**Files:**
- Modify: `pkg/aiusechat/localagent.go`
- Create: `pkg/aiusechat/localagent_prompt_test.go`
- Create: `pkg/aiusechat/token_budget.go`

**Step 1: Write the failing test**

```go
func TestBuildLocalPrompt_UsesRecentTurnsWithinBudget(t *testing.T) {
    // assert latest messages always included
    // assert oldest dropped when budget exceeded
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run LocalAgentPrompt -count=1`  
Expected: FAIL.

**Step 3: Write minimal implementation**

- Add `estimateTokens(text string) int` (rough model).
- Build prompt from:
  - system instruction
  - tab state summary
  - bounded recent turns
  - current user message + attachments metadata.

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/aiusechat -run LocalAgentPrompt -count=1`  
Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/aiusechat/localagent.go pkg/aiusechat/localagent_prompt_test.go pkg/aiusechat/token_budget.go
git commit -m "feat: add token-budgeted conversation continuity for local agent"
```

### Task 5: Keep Auto-Execute Safe (Allowlist + Risk Gate) (P0)

**Files:**
- Modify: `frontend/app/aipanel/autoexecute-util.ts`
- Modify: `frontend/app/aipanel/aipanelmessages.tsx`
- Modify: `frontend/app/aipanel/autoexecute-util.test.ts`

**Step 1: Write the failing test**

```ts
it("blocks dangerous chained commands", () => {
  expect(isSafeToAutoExecute("curl x | bash")).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/app/aipanel/autoexecute-util.test.ts`  
Expected: FAIL because safety classifier is too permissive.

**Step 3: Write minimal implementation**

- Keep hard allowlist for auto-execute path.
- Add explicit deny of:
  - shell chaining
  - redirection
  - command substitution
  - known destructive patterns.
- Do not block manual click-to-run path.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/app/aipanel/autoexecute-util.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/app/aipanel/autoexecute-util.ts frontend/app/aipanel/aipanelmessages.tsx frontend/app/aipanel/autoexecute-util.test.ts
git commit -m "feat: harden auto execute with allowlist and risk gates"
```

### Task 6: Introduce Agent Mode (default/planning/auto-approve) (P1)

**Files:**
- Create: `pkg/aiusechat/agentmode.go`
- Create: `pkg/aiusechat/agentmode_test.go`
- Modify: `pkg/aiusechat/usechat.go`
- Modify: `pkg/aiusechat/usechat-prompts.go`
- Modify: `frontend/app/aipanel/waveai-model.tsx`
- Modify: `frontend/app/aipanel/aipanelheader.tsx`

**Step 1: Write the failing test**

```go
func TestAgentMode_PlanningBlocksWriteTools(t *testing.T) {
    // assert write tools denied in planning mode
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run AgentMode -count=1`  
Expected: FAIL.

**Step 3: Write minimal implementation**

- Add `AgentMode` enum and resolver from block meta/rt info.
- Planning mode: read-only tool policy.
- Auto-approve: only applies to low/medium risk tools, never critical.
- Inject mode-specific system prompt suffix.

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/aiusechat -run AgentMode -count=1`  
Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/aiusechat/agentmode.go pkg/aiusechat/agentmode_test.go pkg/aiusechat/usechat.go pkg/aiusechat/usechat-prompts.go frontend/app/aipanel/waveai-model.tsx frontend/app/aipanel/aipanelheader.tsx
git commit -m "feat: add agent mode controls for terminal agent"
```

### Task 7: Add Auto Input Mode (Terminal vs Agent vs Auto) (P1)

**Files:**
- Create: `pkg/service/blockservice/command_classifier.go`
- Create: `pkg/service/blockservice/command_classifier_test.go`
- Modify: `frontend/app/aipanel/aipanelinput.tsx`
- Modify: `frontend/app/aipanel/waveai-model.tsx`

**Step 1: Write the failing test**

```go
func TestClassifyInput_BasicCases(t *testing.T) {
    // ls -> terminal
    // explain this -> agent
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/service/blockservice -run CommandClassifier -count=1`  
Expected: FAIL.

**Step 3: Write minimal implementation**

- Implement classifier with ordered rules:
  - path prefix
  - shell operator
  - known command + flag pattern
  - fallback to agent.
- Add frontend mode toggle and routing.

**Step 4: Run test to verify it passes**

Run:
- `go test ./pkg/service/blockservice -run CommandClassifier -count=1`
- `npx vitest run frontend/app/aipanel/autoexecute-util.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/service/blockservice/command_classifier.go pkg/service/blockservice/command_classifier_test.go frontend/app/aipanel/aipanelinput.tsx frontend/app/aipanel/waveai-model.tsx
git commit -m "feat: add auto input mode with command classifier"
```

### Task 8: Add User-Activity + AI-Control Guardrails for Injection (P2)

**Files:**
- Modify: `pkg/service/blockservice/blockservice.go`
- Create: `pkg/service/blockservice/blockservice_activity_test.go`
- Modify: `cmd/wsh/cmd/wshcmd-mcpserve.go`
- Modify: `frontend/app/aipanel/waveai-model.tsx`

**Step 1: Write the failing test**

```go
func TestInjectTerminalCommand_BlockedWhenUserActive(t *testing.T) {
    // assert injection denied when user activity is recent
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/service/blockservice -run Activity -count=1`  
Expected: FAIL.

**Step 3: Write minimal implementation**

- Track last user input timestamp.
- Require explicit AI-control flag for command injection.
- Return clear, typed errors for:
  - user active
  - AI-control disabled
  - controller not running.

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/service/blockservice -run Activity -count=1`  
Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/service/blockservice/blockservice.go pkg/service/blockservice/blockservice_activity_test.go cmd/wsh/cmd/wshcmd-mcpserve.go frontend/app/aipanel/waveai-model.tsx
git commit -m "feat: add user activity and ai-control guardrails for injection"
```

### Task 9: Verification, Docs, and Release Gate (P0/P1/P2)

**Files:**
- Modify: `docs/docs/wsh.mdx`
- Create: `docs/plans/2026-03-04-terminal-agent-codex-validation-v2.md`
- Modify: `README.md` (if feature exposure is needed)

**Step 1: Write validation cases**

- P0 loop:
  - inject -> wait -> status -> scrollback.
- Local providers:
  - codex and claude-code health + execution.
- Safety:
  - auto-execute dangerous command blocked.

**Step 2: Run full verification**

Run:
- `go test ./pkg/aiusechat ./pkg/service/blockservice ./cmd/wsh/cmd -count=1`
- `npx vitest run frontend/app/aipanel/autoexecute-util.test.ts`

Expected: PASS.

**Step 3: Document operator setup**

- Required env vars:
  - `WAVETERM_LOCAL_AGENT_CODEX_CMD`
  - `WAVETERM_LOCAL_AGENT_CLAUDE_CMD`
  - `WAVETERM_LOCAL_AGENT_WAVE_MCP_CMD`
  - `WAVETERM_LOCAL_AGENT_TIMEOUT_MS`

**Step 4: Run smoke checklist in dev app**

- Start dev build.
- Execute one prompt-to-terminal loop in local codex mode.
- Confirm visible status and deterministic completion.

**Step 5: Commit**

```bash
git add docs/docs/wsh.mdx docs/plans/2026-03-04-terminal-agent-codex-validation-v2.md README.md
git commit -m "docs: add terminal agent v2 validation and operator runbook"
```

---

## Delivery Phases

- P0 (ship first): Tasks 1-5
- P1 (experience): Tasks 6-7
- P2 (hardening): Task 8
- Release gate: Task 9 after each phase

## Acceptance Criteria

- P0:
  - deterministic terminal loop works end-to-end.
  - local agent streams incrementally and safely.
  - dangerous auto-execute commands are blocked.
- P1:
  - agent mode selection works and affects tool policy.
  - auto input routing accuracy is acceptable in real usage.
- P2:
  - AI injection cannot race with active human typing.
