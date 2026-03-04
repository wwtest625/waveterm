# Files Widget Follow Focused Terminal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Files widget open preview on focused terminal's connection/cwd.

**Architecture:** Extract pure block-definition builder for widget click behavior, unit test it, then wire widgets click handler to pass focused terminal context.

**Tech Stack:** React + TypeScript + Vitest

---

### Task 1: Add failing tests for widget block definition behavior

**Files:**
- Create: `frontend/app/workspace/widgetblockdef.test.ts`
- Create/Modify: `frontend/app/workspace/widgetblockdef.ts`

**Step 1: Write failing test**
- Verify preview widget inherits focused terminal `connection` and `cmd:cwd`.
- Verify non-terminal context does not alter widget block definition.

**Step 2: Run test to verify failure**
- Run: `npx vitest run frontend/app/workspace/widgetblockdef.test.ts`

### Task 2: Implement minimal block definition builder

**Files:**
- Modify: `frontend/app/workspace/widgetblockdef.ts`

**Step 1: Implement pure function**
- Build a new block definition without mutating input.
- Apply focused terminal context only for preview view.

**Step 2: Run targeted tests**
- Run: `npx vitest run frontend/app/workspace/widgetblockdef.test.ts`

### Task 3: Wire widget click handler

**Files:**
- Modify: `frontend/app/workspace/widgets.tsx`

**Step 1: Pass focused terminal context**
- Read focused node and block metadata.
- Use pure helper to create block definition before `createBlock`.

**Step 2: Verify**
- Run: `npx vitest run frontend/app/workspace/widgetblockdef.test.ts frontend/app/workspace/widgetfilter.test.ts`

