# Connections Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add standalone Connections Manager page and top-left entry button.

**Architecture:** Add a new view model/component for connection CRUD on top of existing config/RPC APIs; add one launcher button in tab bar.

**Tech Stack:** React + TypeScript + Jotai + existing RPC client APIs

---

### Task 1: Add pure utility and tests (TDD)

**Files:**
- Create: `frontend/app/view/connectionsmanager/connections-manager-util.ts`
- Create: `frontend/app/view/connectionsmanager/connections-manager-util.test.ts`

**Steps:**
1. Write failing tests for:
   - list filtering/sorting
   - mapping existing connection to form state
   - building save payload from form
2. Run targeted tests, confirm fail.
3. Implement utility minimally.
4. Re-run targeted tests, confirm pass.

### Task 2: Implement Connections Manager view

**Files:**
- Create: `frontend/app/view/connectionsmanager/connections-manager.tsx`

**Steps:**
1. Build page UI (list + form).
2. Wire data from `atoms.fullConfigAtom`.
3. Wire save via `SetConnectionsConfigCommand`.
4. Wire test/connect via `ConnEnsureCommand`.

### Task 3: Register new view type

**Files:**
- Modify: `frontend/app/block/block.tsx`
- Modify: `frontend/app/block/blockutil.tsx`

**Steps:**
1. Register `connectionsmanager` in block registry.
2. Add icon and display name mapping.

### Task 4: Add top-left entry button

**Files:**
- Modify: `frontend/app/tab/tabbar.tsx`

**Steps:**
1. Add button component near Wave AI button.
2. Open `connectionsmanager` block on click.
3. Include button width in tab-width computation.

### Task 5: Verification

**Steps:**
1. Run targeted tests.
2. Run quick smoke test command:
   - `task electron:winquickdev`

