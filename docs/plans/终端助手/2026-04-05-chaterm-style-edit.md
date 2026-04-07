# Chaterm-Style Edit Borrowing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Wave's file editing feel more like Chaterm by nudging the model toward small search/replace edits and rereading the latest file before retrying.

**Architecture:** Keep the existing `edit_text_file` tool and backup flow. Add one short edit-workflow hint to the system prompt, tighten the tool description/schema language, and lock the new guidance in tests. Do not add a new edit tool or remove the current atomic behavior.

**Tech Stack:** Go, existing aiusechat prompt assembly, existing file edit tool definitions, Go unit tests.

---

### Task 1: Add edit workflow guidance

**Files:**
- Modify: `pkg/aiusechat/usechat-prompts.go`
- Modify: `pkg/aiusechat/usechat.go`

**Step 1: Write the failing test**

```go
// covered by existing prompt tests
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run TestP0AcceptanceCriteria_DocumentsCriteriaRatherThanClaimingCompletion -count=1`
Expected: FAIL until the new edit guidance exists.

**Step 3: Write minimal implementation**

Add a short edit-workflow add-on and append it when tools are available.

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/aiusechat -run TestP0AcceptanceCriteria_DocumentsCriteriaRatherThanClaimingCompletion -count=1`
Expected: PASS

### Task 2: Tighten file edit tool wording

**Files:**
- Modify: `pkg/aiusechat/tools_writefile.go`
- Modify: `pkg/aiusechat/tools_textops_test.go`

**Step 1: Write the failing test**

```go
// assert edit tool description mentions small search/replace batches
```

**Step 2: Run test to verify it fails**

Run: `go test ./pkg/aiusechat -run TestEditTextFileToolDefinitionMentionsSmallBatches -count=1`
Expected: FAIL until the wording is updated.

**Step 3: Write minimal implementation**

Update the description and input schema text to encourage small, latest-file edits.

**Step 4: Run test to verify it passes**

Run: `go test ./pkg/aiusechat -run TestEditTextFileToolDefinitionMentionsSmallBatches -count=1`
Expected: PASS

### Task 3: Verify the whole change set

**Files:**
- Test: `pkg/aiusechat/*`

**Step 1: Run the full package tests**

Run: `go test ./pkg/aiusechat ./pkg/wshrpc/wshserver -count=1`
Expected: PASS

**Step 2: Check formatting and diffs**

Run: `git diff --check`
Expected: no whitespace or patch-format issues
