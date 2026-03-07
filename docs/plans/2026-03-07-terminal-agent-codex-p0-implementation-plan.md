# Terminal Agent (Codex) P0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the biggest P0 gaps so Wave's local terminal agent feels controlled, transparent, and safe enough for real terminal workflows.

**Architecture:** Keep the existing Wave terminal-agent stack intact and improve the missing product layer around it. P0 work will add a first-class agent mode model, surface runtime state in the AI panel, prevent unsafe command injection while the user is active, and validate the full terminal loop with repeatable scenario tests instead of relying on individual backend primitives alone.

**Tech Stack:** Go (`pkg/aiusechat`, `pkg/service/blockservice`, `cmd/wsh/cmd`), TypeScript/React (`frontend/app/aipanel`, `frontend/app/view/term`), Jotai atoms, RPC metadata, Go test, Vitest.

---

### Task 1: Audit P0 Status Against the V2 Doc

**Files:**
- Modify: `docs/plans/2026-03-07-terminal-agent-codex-todo.md`
- Modify: `docs/plans/2026-03-04-terminal-agent-codex-implementation-v2.md`
- Create: `docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md`

**Step 1: Write the audit skeleton**

Create sections for:
- `Completed`
- `Partially completed`
- `Not started`
- `P0 blockers`

**Step 2: Verify current implementation status from the codebase**

Check:
- `pkg/service/blockservice/blockservice.go`
- `cmd/wsh/cmd/wshcmd-mcpserve.go`
- `pkg/aiusechat/localagent.go`
- `frontend/app/aipanel/autoexecute-util.ts`
- `frontend/app/aipanel/aipanelheader.tsx`

Expected: confirm which P0 items are already implemented and which are still missing at the product/interaction level.

**Step 3: Write the audit doc**

Document:
- exact completed capabilities
- exact missing P0 behaviors
- specific files that will change during P0

**Step 4: Update the checklist**

Mark the audit-related items in `docs/plans/2026-03-07-terminal-agent-codex-todo.md`.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-07-terminal-agent-codex-todo.md docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md docs/plans/2026-03-04-terminal-agent-codex-implementation-v2.md
git commit -m "docs: audit terminal agent p0 status against v2 plan"
```

### Task 2: Define P0 Acceptance Criteria in Code and Docs

**Files:**
- Modify: `docs/plans/2026-03-07-terminal-agent-codex-todo.md`
- Modify: `docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md`
- Create: `pkg/aiusechat/p0_acceptance_test.go`

**Step 1: Write the failing test**

```go
func TestP0AcceptanceCriteria_AgentModesAndPromptCapabilities(t *testing.T) {
    // assert planning mode is read-only
    // assert default mode allows normal tool use
    // assert local agent prompt advertises terminal capabilities truthfully
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run P0AcceptanceCriteria -count=1`
Expected: FAIL because P0 acceptance helpers and mode handling do not exist yet.

**Step 3: Add the acceptance criteria**

Define 5 P0 acceptance criteria in docs and align the tests with them:
- agent mode is visible and enforced
- panel shows agent runtime state
- agent will not inject while user is active
- local prompt truthfully describes capabilities
- terminal loop can complete a read/inject/wait/read cycle

**Step 4: Run test to verify it still fails only on unimplemented behavior**

Run: `go test ./pkg/aiusechat -run P0AcceptanceCriteria -count=1`
Expected: FAIL on specific missing implementation, not on malformed test setup.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-07-terminal-agent-codex-todo.md docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md pkg/aiusechat/p0_acceptance_test.go
git commit -m "test: codify terminal agent p0 acceptance criteria"
```

### Task 3: Add Agent Mode Domain Model and Enforcement

**Files:**
- Create: `pkg/aiusechat/agentmode.go`
- Create: `pkg/aiusechat/agentmode_test.go`
- Modify: `pkg/aiusechat/usechat.go`
- Modify: `pkg/aiusechat/usechat-prompts.go`
- Modify: `frontend/app/aipanel/waveai-model.tsx`
- Modify: `frontend/app/aipanel/aipanelheader.tsx`

**Step 1: Write the failing test**

```go
func TestAgentMode_PlanningBlocksWriteActions(t *testing.T) {
    // assert planning mode blocks terminal injection and write-like actions
}

func TestAgentMode_DefaultAndAutoApprovePolicies(t *testing.T) {
    // assert default and auto-approve resolve to different approval policies
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run AgentMode -count=1`
Expected: FAIL because the agent mode model and policy logic do not exist.

**Step 3: Write minimal implementation**

Add:
- `AgentMode` enum with `default`, `planning`, `auto-approve`
- metadata resolver for current tab/block mode
- policy helpers:
  - planning mode: read-only
  - default mode: current guarded behavior
  - auto-approve mode: skip approval only for allowed risk levels
- prompt suffix generation in `usechat-prompts.go`
- frontend header control to display and switch the current mode

Use metadata keys under the current AI oref, for example:
- `waveai:agentmode`

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/aiusechat -run AgentMode -count=1`
Expected: PASS.

**Step 5: Run focused frontend typecheck or tests**

Run: `npx vitest run frontend/app/aipanel/autoexecute-util.test.ts`
Expected: PASS with no regression in existing AI panel safety tests.

**Step 6: Commit**

```bash
git add pkg/aiusechat/agentmode.go pkg/aiusechat/agentmode_test.go pkg/aiusechat/usechat.go pkg/aiusechat/usechat-prompts.go frontend/app/aipanel/waveai-model.tsx frontend/app/aipanel/aipanelheader.tsx
git commit -m "feat: add terminal agent modes and mode-aware prompt policy"
```

### Task 4: Surface Agent Runtime State in the AI Panel

**Files:**
- Create: `frontend/app/aipanel/agentstatus.tsx`
- Modify: `frontend/app/aipanel/waveai-model.tsx`
- Modify: `frontend/app/aipanel/aipanel.tsx`
- Modify: `frontend/app/aipanel/aimessage.tsx`
- Modify: `pkg/aiusechat/localagent.go`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("agent runtime status mapping", () => {
  it("maps local agent progress into visible panel states", () => {
    // thinking -> reading terminal -> executing -> waiting -> complete -> error
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/app/aipanel/agentstatus.test.tsx`
Expected: FAIL because no panel status component or mapping exists yet.

**Step 3: Write minimal implementation**

Add a compact status strip that can show:
- provider
- current mode
- current phase
- last injected command
- blocked reason or timeout reason

Feed it from:
- `useChat` streaming state
- local-agent callbacks when available
- tool-use / approval state already rendered in messages

Keep it visually lightweight and always visible near the top of the panel.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/app/aipanel/agentstatus.test.tsx`
Expected: PASS.

**Step 5: Smoke test the panel**

Run: `npx vitest run frontend/app/aipanel/autoexecute-util.test.ts`
Expected: PASS with no regression.

**Step 6: Commit**

```bash
git add frontend/app/aipanel/agentstatus.tsx frontend/app/aipanel/waveai-model.tsx frontend/app/aipanel/aipanel.tsx frontend/app/aipanel/aimessage.tsx pkg/aiusechat/localagent.go frontend/app/aipanel/agentstatus.test.tsx
git commit -m "feat: surface terminal agent runtime state in ai panel"
```

### Task 5: Add User Activity Protection Before Command Injection

**Files:**
- Modify: `frontend/app/view/term/term-model.ts`
- Modify: `frontend/app/store/global.ts`
- Modify: `pkg/service/blockservice/blockservice.go`
- Create: `pkg/service/blockservice/blockservice_activity_test.go`
- Modify: `cmd/wsh/cmd/wshcmd-mcpserve.go`

**Step 1: Write the failing test**

```go
func TestInjectTerminalCommand_BlocksWhenUserRecentlyActive(t *testing.T) {
    // assert injection is rejected when user typed recently
}

func TestInjectTerminalCommand_AllowsForceOverride(t *testing.T) {
    // assert force=true bypasses activity protection
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/service/blockservice -run Activity -count=1`
Expected: FAIL because user activity tracking and forced override do not exist.

**Step 3: Write minimal implementation**

Add:
- a tracked `last user input` timestamp at the terminal/frontend edge
- metadata or runtime info propagation to backend
- a `GetUserActivityState` or equivalent helper in `BlockService`
- injection guard inside `InjectTerminalCommand`
- optional `force` parameter for MCP tool and backend request

Behavior:
- if user was active within the last 5 seconds, reject auto injection
- return a clear reason for the rejection
- allow explicit override only when requested

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/service/blockservice -run Activity -count=1`
Expected: PASS.

**Step 5: Run MCP tool tests**

Run: `go test ./cmd/wsh/cmd -run MCPServe -count=1`
Expected: PASS with updated tool args and injection behavior.

**Step 6: Commit**

```bash
git add frontend/app/view/term/term-model.ts frontend/app/store/global.ts pkg/service/blockservice/blockservice.go pkg/service/blockservice/blockservice_activity_test.go cmd/wsh/cmd/wshcmd-mcpserve.go
git commit -m "feat: block agent command injection during recent user activity"
```

### Task 6: Make Local-Agent Capability Prompts Truthful by Mode

**Files:**
- Modify: `pkg/aiusechat/usechat-prompts.go`
- Modify: `pkg/aiusechat/usechat.go`
- Create: `pkg/aiusechat/usechat_prompts_test.go`

**Step 1: Write the failing test**

```go
func TestPromptCapabilities_LocalAgentVsCloud(t *testing.T) {
    // cloud prompt says it cannot execute terminal commands
    // local terminal agent prompt says it can observe and drive the terminal within policy
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run PromptCapabilities -count=1`
Expected: FAIL because current prompt construction is not mode-aware enough.

**Step 3: Write minimal implementation**

Split prompt capability text by:
- cloud AI vs local agent
- planning vs default vs auto-approve mode

Preserve truthfulness:
- cloud mode must not overclaim terminal execution powers
- local agent must not claim unrestricted execution when mode forbids it

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/aiusechat -run PromptCapabilities -count=1`
Expected: PASS.

**Step 5: Commit**

```bash
git add pkg/aiusechat/usechat-prompts.go pkg/aiusechat/usechat.go pkg/aiusechat/usechat_prompts_test.go
git commit -m "feat: make local terminal agent prompts mode-aware and truthful"
```

### Task 7: Validate the Full P0 Terminal Agent Loop

**Files:**
- Create: `pkg/aiusechat/localagent_loop_test.go`
- Modify: `pkg/aiusechat/localagent.go`
- Modify: `docs/plans/2026-03-07-terminal-agent-codex-todo.md`
- Modify: `docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md`

**Step 1: Write the failing test**

```go
func TestLocalAgentLoop_ReadInjectWaitRead(t *testing.T) {
    // simulate or stub a terminal loop:
    // 1. read terminal context
    // 2. inject command
    // 3. wait until idle
    // 4. read terminal output
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run LocalAgentLoop -count=1`
Expected: FAIL because the loop behavior is not explicitly verified today.

**Step 3: Write minimal implementation**

Introduce the smallest seam needed to test the terminal loop:
- stub MCP tool invocations or wrap them behind a narrow interface
- record the loop phases for frontend visibility
- ensure failures produce actionable errors

Do not add a full new abstraction layer unless the test truly needs it.

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/aiusechat -run LocalAgentLoop -count=1`
Expected: PASS.

**Step 5: Run the relevant backend suite**

Run: `go test ./pkg/aiusechat ./pkg/service/blockservice ./cmd/wsh/cmd -count=1`
Expected: PASS.

**Step 6: Update the P0 checklist**

Mark completed P0 items in:
- `docs/plans/2026-03-07-terminal-agent-codex-todo.md`
- `docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md`

**Step 7: Commit**

```bash
git add pkg/aiusechat/localagent_loop_test.go pkg/aiusechat/localagent.go docs/plans/2026-03-07-terminal-agent-codex-todo.md docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md
git commit -m "test: validate terminal agent p0 loop end to end"
```

### Task 8: Final Verification for P0 Completion

**Files:**
- Modify: `docs/plans/2026-03-07-terminal-agent-codex-todo.md`
- Modify: `docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md`

**Step 1: Run Go verification**

Run: `go test ./pkg/aiusechat ./pkg/service/blockservice ./cmd/wsh/cmd -count=1`
Expected: PASS.

**Step 2: Run frontend verification**

Run: `npx vitest run frontend/app/aipanel/autoexecute-util.test.ts frontend/app/aipanel/agentstatus.test.tsx`
Expected: PASS.

**Step 3: Perform manual scenario verification**

Verify all 5 scenarios:
- read current terminal context and explain an error
- inject a safe command and wait for completion
- planning mode refuses execution
- dangerous auto-execute command is blocked
- recent user typing blocks auto injection

Expected: all scenarios succeed or fail with the intended user-facing behavior.

**Step 4: Mark P0 complete in docs**

Update:
- `docs/plans/2026-03-07-terminal-agent-codex-todo.md`
- `docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md`

**Step 5: Commit**

```bash
git add docs/plans/2026-03-07-terminal-agent-codex-todo.md docs/plans/2026-03-07-terminal-agent-codex-p0-audit.md
git commit -m "docs: mark terminal agent p0 complete"
```
