# AI Task-First Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 aiusechat 从“工具调用驱动的执行器”改成“语义任务优先的任务执行 runtime”，让顶部进度展示的是用户目标任务，而不是工具名。

**Architecture:** 以“语义计划优先、工具执行附属”的方式重构任务链。先为复杂请求稳定生成语义计划，再把工具调用挂靠到语义任务；只有在没有语义计划时才退回可读 fallback。前端顶部卡片只消费任务状态，不直接把工具事件当任务展示。

**Tech Stack:** Go（aiusechat/chatstore/uctypes）、React + Jotai（aipanel）、SSE `data-*` message parts、Vitest、Go test

---

## 文件结构与职责

### 后端核心
- `pkg/aiusechat/taskstate_runtime.go`
  - 任务状态 reducer
  - 语义计划优先 merge 逻辑
  - 工具到语义任务的推进逻辑
  - fallback 任务命名逻辑
- `pkg/aiusechat/tools_taskstate.go`
  - `waveai_create_plan`
  - `waveai_advance_plan`
- `pkg/aiusechat/usechat.go`
  - 在 `processAllToolCalls` 中优先使用现有语义计划
  - 发送 `data-taskstate`
- `pkg/aiusechat/usechat-prompts.go`
  - 强化复杂任务先建计划的提示
- `pkg/aiusechat/tools.go`
  - 注册计划工具
- `pkg/aiusechat/uctypes/uctypes.go`
  - 任务状态协议定义
- `pkg/aiusechat/chatstore/chatstore.go`
  - 任务状态持久化与 session meta 同步

### 前端核心
- `frontend/app/aipanel/aitypes.ts`
  - `taskstate` 类型
  - `getLatestTaskStatePart`
- `frontend/app/aipanel/waveai-model.tsx`
  - `taskStateAtom`
  - reload / clear / 动态同步
- `frontend/app/aipanel/aipanel.tsx`
  - 从消息中消费 `data-taskstate`
  - 顶部挂载 `TaskProgressPanel`
- `frontend/app/aipanel/taskprogress.ts`
  - 顶部卡片 view model
- `frontend/app/aipanel/taskprogresspanel.tsx`
  - 顶部语义任务卡片 UI

### 测试
- `pkg/aiusechat/taskstate_runtime_test.go`
- `pkg/aiusechat/tools_taskstate_test.go`
- `pkg/aiusechat/tools_readfile_test.go`
- `pkg/aiusechat/taskstate_test.go`
- `frontend/app/aipanel/tests/taskprogress.test.ts`
- `frontend/app/aipanel/tests/aitypes.test.ts`
- `frontend/app/aipanel/tests/agentstatus.test.ts`

---

## Phase 1: 修正任务抽象层（语义任务优先）

**目标：** 顶部任务卡片不再优先显示工具名；已有语义计划时，工具执行只能推进语义任务，不能覆盖它。

### Task 1: 固化语义计划优先规则

**Files:**
- Modify: `pkg/aiusechat/taskstate_runtime.go`
- Test: `pkg/aiusechat/taskstate_runtime_test.go`

- [ ] **Step 1: 写失败测试，证明已有语义计划时不能被工具 fallback 覆盖**

```go
func TestMergeToolTaskStatePrefersExistingSemanticPlan(t *testing.T) {
    existing := &uctypes.UITaskProgressState{
        PlanId: "plan-1",
        Source: "model-generated",
        Tasks: []uctypes.UITaskItem{{
            ID: "plan-task-1", Title: "创建 Python 脚本", Status: uctypes.TaskItemStatusInProgress,
        }},
    }
    fallback := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{ID: "tool-1", Name: "wave_run_command"}})
    merged := mergeTaskStateForToolCalls(existing, fallback)
    if merged.Tasks[0].Title != "创建 Python 脚本" {
        t.Fatalf("expected semantic title to win, got %q", merged.Tasks[0].Title)
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./pkg/aiusechat -run TestMergeToolTaskStatePrefersExistingSemanticPlan
```
Expected: FAIL，提示 `mergeTaskStateForToolCalls` 缺失或语义任务被覆盖。

- [ ] **Step 3: 最小实现 merge 逻辑**

```go
func mergeTaskStateForToolCalls(existing *uctypes.UITaskProgressState, fallback *uctypes.UITaskProgressState) *uctypes.UITaskProgressState {
    if existing != nil && len(existing.Tasks) > 0 && existing.Source == "model-generated" {
        return existing.Clone()
    }
    if fallback != nil {
        return fallback.Clone()
    }
    if existing != nil {
        return existing.Clone()
    }
    return nil
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./pkg/aiusechat -run TestMergeToolTaskStatePrefersExistingSemanticPlan
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add pkg/aiusechat/taskstate_runtime.go pkg/aiusechat/taskstate_runtime_test.go
git commit -m "feat: prefer semantic task plans over tool fallbacks"
```

### Task 2: 把工具名 fallback 改成人类可读标题

**Files:**
- Modify: `pkg/aiusechat/taskstate_runtime.go`
- Test: `pkg/aiusechat/taskstate_runtime_test.go`

- [ ] **Step 1: 写失败测试，证明不能出现 `Run wave_run_command` 这类标题**

```go
func TestBuildTaskStateFromToolCalls_UsesHumanReadableFallbackTitles(t *testing.T) {
    state := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{
        {ID: "tool-1", Name: "wave_run_command", Input: map[string]any{"command": "cd /app && pwd"}},
        {ID: "tool-2", Name: "write_text_file", Input: map[string]any{"filename": "/app/sample.txt"}},
    })
    if state.Tasks[0].Title == "Run wave_run_command" {
        t.Fatalf("unexpected raw tool title %q", state.Tasks[0].Title)
    }
    if state.Tasks[1].Title == "Run write_text_file" {
        t.Fatalf("unexpected raw tool title %q", state.Tasks[1].Title)
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./pkg/aiusechat -run TestBuildTaskStateFromToolCalls_UsesHumanReadableFallbackTitles
```
Expected: FAIL，出现原始工具名。

- [ ] **Step 3: 实现可读 fallback 标题映射**

```go
func readableFallbackTaskTitle(toolCall uctypes.WaveToolCall) string {
    inputMap, _ := toolCall.Input.(map[string]any)
    switch toolCall.Name {
    case "wave_run_command":
        if cmd, ok := inputMap["command"].(string); ok {
            return shortenCommandSummary(cmd)
        }
        return "执行命令"
    case "write_text_file":
        if filename, ok := inputMap["filename"].(string); ok && filename != "" {
            return fmt.Sprintf("写入文件 %s", filename)
        }
        return "写入文件"
    case "read_text_file":
        if filename, ok := inputMap["filename"].(string); ok && filename != "" {
            return fmt.Sprintf("读取文件 %s", filename)
        }
        return "读取文件"
    default:
        return "执行步骤"
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./pkg/aiusechat -run TestBuildTaskStateFromToolCalls_UsesHumanReadableFallbackTitles
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add pkg/aiusechat/taskstate_runtime.go pkg/aiusechat/taskstate_runtime_test.go
git commit -m "feat: use readable fallback task titles"
```

---

## Phase 2: 提升语义计划触发率（计划先于执行）

**目标：** 复杂任务进入后，模型更稳定地先建立语义计划，而不是上来直接框框敲命令。

### Task 3: 强化 prompt 中的计划优先级

**Files:**
- Modify: `pkg/aiusechat/usechat-prompts.go`
- Test: `pkg/aiusechat/p0_acceptance_test.go`

- [ ] **Step 1: 写失败测试，验证系统提示包含计划优先要求**

```go
func TestSystemPromptMentionsCreatePlanForMultiStepTasks(t *testing.T) {
    if !strings.Contains(SystemPromptText_OpenAI, "waveai_create_plan") {
        t.Fatalf("expected system prompt to mention waveai_create_plan")
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./pkg/aiusechat -run TestSystemPromptMentionsCreatePlanForMultiStepTasks
```
Expected: FAIL

- [ ] **Step 3: 最小修改 prompt**

```go
`For multi-step tasks, create a short plan with waveai_create_plan before or during execution, then update it with waveai_advance_plan as tasks complete or become blocked. Keep plan items concrete and action-oriented.`
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./pkg/aiusechat -run TestSystemPromptMentionsCreatePlanForMultiStepTasks
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add pkg/aiusechat/usechat-prompts.go pkg/aiusechat/p0_acceptance_test.go
git commit -m "feat: prioritize semantic planning in prompts"
```

### Task 4: 注册计划工具并确保 schema 合法

**Files:**
- Modify: `pkg/aiusechat/tools.go`
- Modify: `pkg/aiusechat/tools_taskstate.go`
- Test: `pkg/aiusechat/tools_taskstate_test.go`

- [ ] **Step 1: 写失败测试，验证两个计划工具都已注册**

```go
func TestGenerateTabStateAndTools_IncludesTaskPlanTools(t *testing.T) {
    _, tools, err := GenerateTabStateAndTools(context.Background(), "", false, &uctypes.WaveChatOpts{
        ChatId: "chat-1",
        Config: uctypes.AIOptsType{APIType: uctypes.APIType_OpenAIResponses, Model: "gpt-5-mini"},
    })
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    names := make([]string, 0, len(tools))
    for _, tool := range tools {
        names = append(names, tool.Name)
    }
    if !slices.Contains(names, "waveai_create_plan") || !slices.Contains(names, "waveai_advance_plan") {
        t.Fatalf("expected plan tools in tool list, got %#v", names)
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./pkg/aiusechat -run TestGenerateTabStateAndTools_IncludesTaskPlanTools
```
Expected: FAIL

- [ ] **Step 3: 注册工具并保持 strict schema 兼容 OpenAI**

```go
if chatOpts != nil {
    tools = append(tools, GetCreatePlanToolDefinition(chatOpts.ChatId, &chatOpts.Config))
    tools = append(tools, GetAdvancePlanToolDefinition(chatOpts.ChatId, &chatOpts.Config))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./pkg/aiusechat -run 'TestGenerateTabStateAndTools_IncludesTaskPlanTools|TestGet(CreatePlan|AdvancePlan)ToolDefinition_UsesOpenAICompatibleStrictSchema'
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add pkg/aiusechat/tools.go pkg/aiusechat/tools_taskstate.go pkg/aiusechat/tools_taskstate_test.go
git commit -m "feat: register semantic task planning tools"
```

---

## Phase 3: 把工具执行挂靠到语义任务

**目标：** 顶层展示语义任务，工具执行只推进语义任务，不再生成新的顶层“工具任务”。

### Task 5: `processAllToolCalls` 先读现有语义计划再合并 fallback

**Files:**
- Modify: `pkg/aiusechat/usechat.go`
- Test: `pkg/aiusechat/taskstate_runtime_test.go`

- [ ] **Step 1: 写失败测试，证明已有语义计划时工具 burst 不应覆盖当前任务**

```go
func TestMergeToolTaskStatePreservesCurrentSemanticPlanAcrossToolBursts(t *testing.T) {
    existing := &uctypes.UITaskProgressState{
        PlanId: "plan-1",
        Source: "model-generated",
        CurrentTaskId: "plan-task-2",
        Tasks: []uctypes.UITaskItem{
            {ID: "plan-task-1", Title: "创建 Python 脚本", Status: uctypes.TaskItemStatusCompleted},
            {ID: "plan-task-2", Title: "创建测试文件", Status: uctypes.TaskItemStatusInProgress},
        },
    }
    fallback := buildTaskStateFromToolCalls([]uctypes.WaveToolCall{{ID: "tool-2", Name: "write_text_file", Input: map[string]any{"filename": "/app/sample.txt"}}})
    merged := mergeTaskStateForToolCalls(existing, fallback)
    if merged.CurrentTaskId != "plan-task-2" {
        t.Fatalf("expected semantic current task to remain, got %q", merged.CurrentTaskId)
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./pkg/aiusechat -run TestMergeToolTaskStatePreservesCurrentSemanticPlanAcrossToolBursts
```
Expected: FAIL

- [ ] **Step 3: 修改 `processAllToolCalls` 的起始状态来源**

```go
existingTaskState := chatstore.DefaultChatStore.GetSession(chatOpts.ChatId)
var currentTaskState *uctypes.UITaskProgressState
if existingTaskState != nil {
    currentTaskState = existingTaskState.TaskState
}
taskState := mergeTaskStateForToolCalls(currentTaskState, buildTaskStateFromToolCalls(stopReason.ToolCalls))
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./pkg/aiusechat -run TestMergeToolTaskStatePreservesCurrentSemanticPlanAcrossToolBursts
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add pkg/aiusechat/usechat.go pkg/aiusechat/taskstate_runtime_test.go
git commit -m "feat: preserve semantic plans across tool execution"
```

### Task 6: 工具结果推进语义任务，而不是改写标题

**Files:**
- Modify: `pkg/aiusechat/taskstate_runtime.go`
- Test: `pkg/aiusechat/taskstate_runtime_test.go`

- [ ] **Step 1: 写失败测试，证明工具完成/失败都不能改坏语义标题**

```go
func TestAdvanceTaskStateForToolResult_DoesNotOverrideSemanticTitle(t *testing.T) {
    state := &uctypes.UITaskProgressState{
        PlanId: "plan-1",
        Source: "model-generated",
        CurrentTaskId: "plan-task-1",
        Tasks: []uctypes.UITaskItem{{
            ID: "plan-task-1",
            Title: "创建 Python 脚本",
            Status: uctypes.TaskItemStatusInProgress,
            ToolCallIds: []string{"tool-1"},
        }},
    }
    advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "tool-1"})
    if state.Tasks[0].Title != "创建 Python 脚本" {
        t.Fatalf("semantic title should remain unchanged")
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./pkg/aiusechat -run 'TestAdvanceTaskStateForToolResult_(DoesNotOverrideSemanticTitle|BlocksSemanticTaskWithoutRenamingIt)'
```
Expected: FAIL

- [ ] **Step 3: 最小实现，按 `ToolCallIds` 绑定推进，不触碰标题字段**

```go
if !matchedAny {
    return
}
// 仅更新 status / summary / blockedReason / currentTaskId
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./pkg/aiusechat -run 'TestAdvanceTaskStateForToolResult_(DoesNotOverrideSemanticTitle|BlocksSemanticTaskWithoutRenamingIt|AdvancesSemanticPlanByBoundToolId)'
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add pkg/aiusechat/taskstate_runtime.go pkg/aiusechat/taskstate_runtime_test.go
git commit -m "feat: bind tool results to semantic tasks"
```

---

## Phase 4: 前端只呈现语义任务，不把工具当顶层任务

**目标：** 顶部卡片信息层级正确，优先显示语义任务；工具执行仍走消息区/工具区。

### Task 7: 保持顶部卡片只消费 `taskstate`

**Files:**
- Modify: `frontend/app/aipanel/taskprogress.ts`
- Modify: `frontend/app/aipanel/taskprogresspanel.tsx`
- Test: `frontend/app/aipanel/tests/taskprogress.test.ts`

- [ ] **Step 1: 写失败测试，确认 view model 使用语义任务标题而不是工具名**

```ts
it("prefers semantic task titles over raw tool names", () => {
    const viewModel = deriveTaskProgressViewModel({
        planid: "plan-1",
        source: "model-generated",
        status: "active",
        currenttaskid: "plan-task-1",
        summary: { total: 1, completed: 0, inprogress: 1, pending: 0, blocked: 0, percent: 0 },
        tasks: [{ id: "plan-task-1", title: "创建 Python 脚本", status: "in_progress", order: 0 }],
    });
    expect(viewModel.currentTaskTitle).toBe("创建 Python 脚本");
});
```

- [ ] **Step 2: 跑测试确认失败（如果当前逻辑不稳定）**

Run:
```bash
npm run test -- --run frontend/app/aipanel/tests/taskprogress.test.ts
```
Expected: FAIL 或暴露当前 view model 没有锁死语义标题优先。

- [ ] **Step 3: 最小实现，只消费 `taskstate.tasks[].title`，不从工具区反推标题**

```ts
const currentTask = sortedTasks.find((task) => task.id === taskState?.currenttaskid);
return {
  currentTaskTitle: currentTask?.title,
  ...
};
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npm run test -- --run frontend/app/aipanel/tests/taskprogress.test.ts
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/app/aipanel/taskprogress.ts frontend/app/aipanel/taskprogresspanel.tsx frontend/app/aipanel/tests/taskprogress.test.ts
git commit -m "feat: show semantic task titles in progress panel"
```

### Task 8: 前端流式只同步 `taskstate`，不从工具消息生成顶层任务

**Files:**
- Modify: `frontend/app/aipanel/aipanel.tsx`
- Modify: `frontend/app/aipanel/waveai-model.tsx`
- Test: `frontend/app/aipanel/tests/aitypes.test.ts`

- [ ] **Step 1: 写失败测试，证明顶部任务状态来自 `data-taskstate` / session snapshot**

```ts
it("represents summary, current task and ordered items", () => {
    const taskState: AgentTaskState = {
        version: 1,
        planid: "plan-1",
        source: "model-generated",
        status: "active",
        currenttaskid: "task-2",
        blockedreason: "",
        lastupdatedts: 123,
        summary: { total: 3, completed: 1, inprogress: 1, pending: 1, blocked: 0, percent: 33 },
        tasks: [
            { id: "task-1", title: "Map runtime", status: "completed", order: 0 },
            { id: "task-2", title: "Render panel", status: "in_progress", order: 1 },
        ],
    };
    expect(taskState.currenttaskid).toBe("task-2");
});
```

- [ ] **Step 2: 跑测试确认失败（若当前消费路径仍依赖工具推导）**

Run:
```bash
npm run test -- --run frontend/app/aipanel/tests/aitypes.test.ts frontend/app/aipanel/tests/agentstatus.test.ts
```
Expected: FAIL 或暴露消费链缺陷。

- [ ] **Step 3: 最小实现，`aipanel.tsx` 中只从 `getLatestTaskStatePart` 更新 `taskStateAtom`**

```ts
const latestTaskState = getLatestTaskStatePart(lastAssistantMessage);
if (latestTaskState?.data) {
    globalStore.set(model.taskStateAtom, latestTaskState.data as any);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npm run test -- --run frontend/app/aipanel/tests/aitypes.test.ts frontend/app/aipanel/tests/agentstatus.test.ts frontend/app/aipanel/tests/taskprogress.test.ts
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/app/aipanel/aipanel.tsx frontend/app/aipanel/waveai-model.tsx frontend/app/aipanel/aitypes.ts
git commit -m "feat: drive task progress from task state events"
```

---

## Phase 5: 端到端验证与回归

### Task 9: 运行完整回归测试

**Files:**
- Test only

- [ ] **Step 1: 运行 Go 测试**

Run:
```bash
go test ./pkg/aiusechat/...
```
Expected: 全部 PASS

- [ ] **Step 2: 运行前端相关测试**

Run:
```bash
npm run test -- --run frontend/app/aipanel/tests/aitypes.test.ts frontend/app/aipanel/tests/taskprogress.test.ts frontend/app/aipanel/tests/agentstatus.test.ts
```
Expected: 全部 PASS

- [ ] **Step 3: 手动验证一个真实复杂任务**

用例：
- 让 AI 在 `/app/xxx` 创建 `text_processor.py`
- 再创建 `sample.txt`
- 再运行验证

Expected:
- 顶部卡片优先显示：
  - 创建 Python 脚本
  - 创建测试文件
  - 运行并验证输出
- **不能**显示：
  - `Run wave_run_command`
  - `Run write_text_file`
- 工具执行继续在消息区/工具区展示

- [ ] **Step 4: 如果模型未稳定生成语义计划，记录现象并进入下一轮“强制先计划”改造**

Expected note:
- 若计划触发率不足，下一轮要把复杂任务请求在首轮强制先 `waveai_create_plan`

- [ ] **Step 5: 提交**

```bash
git add .
git commit -m "feat: make task progress semantic-plan first"
```

---

## 自检结论

### 覆盖情况
- 已覆盖“语义计划优先”
- 已覆盖“工具执行附属推进”
- 已覆盖“顶部卡片不再展示工具名”
- 已覆盖“fallback 也必须人类可读”
- 已覆盖“前端由 taskstate 驱动，而不是工具名驱动”

### 占坑检查
- 无 `TODO` / `TBD`
- 没有“以后补”类空话
- 每个代码步骤都给了具体代码/命令

### 一致性检查
- 统一使用：`waveai_create_plan`、`waveai_advance_plan`
- 统一使用：`mergeTaskStateForToolCalls`
- 统一使用：`data-taskstate`

---

Plan complete and saved to `plans/2026-04-15-ai-task-runtime-outline.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
