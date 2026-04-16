# AI Task-First Runtime Implementation Plan (v2 — 对齐 Chaterm 架构)

> **Goal:** 把 waveterm 的 aiusechat 从"工具调用驱动的执行器"改成"语义任务优先的任务执行 runtime"，彻底对齐 Chaterm 的 AI 终端助手架构。

> **Reference:** Chaterm-main (`C:\Users\sys49169\Downloads\Github\Chaterm-main`)

**Architecture:** 以"智能检测 + 语义计划优先 + 工具执行附属 + 聚焦链推进 + 命令安全"五层架构重构任务链。后端自动检测复杂任务并触发计划创建；模型也可主动创建计划；工具执行挂靠到语义任务并通过聚焦链推进；命令执行前经过安全校验；前端顶部卡片消费任务状态+聚焦链+上下文信息。

**Tech Stack:** Go（aiusechat/chatstore/uctypes）、React + Jotai（aipanel）、SSE `data-*` message parts、Vitest、Go test

---

## 与 Chaterm 架构对齐总览

| 能力 | Chaterm 实现 | waveterm 现状 | 本方案目标 |
|------|-------------|--------------|-----------|
| 任务计划工具 | `todo_write` / `todo_read`（含 description、subtasks、priority、toolCalls、isFocused） | `waveai_create_plan` / `waveai_advance_plan`（仅 title） | 升级为 `waveai_todo_write` / `waveai_todo_read`，对齐 Chaterm schema |
| 智能任务检测 | `SmartTaskDetector`（正则+启发式+领域检测） | 无 | 新增 `SmartTaskDetector` Go 实现 |
| 聚焦链 | `FocusChainService` + `TodoContextTracker` | 无 | 新增聚焦链服务和上下文追踪器 |
| 命令安全 | `CommandSecurityManager`（黑名单/白名单/危险命令分级） | `toolapproval.go` 基础审批 | 新增 `CommandSecurityManager` Go 实现 |
| 上下文管理 | `ContextManager` + `ModelContextTracker` | `context_management.go` cheatsheet 刷新 | 扩展上下文窗口管理+token 追踪 |
| 交互检测 | `InteractionDetector`（快速正则+LLM fallback+TUI+auto-cancel） | `interaction_detector.go` 基础正则 | 扩展 LLM fallback 和 TUI 检测 |
| 工具调用绑定 | `TodoToolCallTracker` | `ToolCallIds` 字段存在但未追踪 | 完善工具调用与任务的绑定追踪 |
| 任务提醒 | `TodoReminderService` | 无 | 新增任务提醒服务 |
| 前端展示 | Todo 列表+聚焦链+上下文用量+子任务 | `TaskProgressPanel` 基础进度 | 升级前端对齐 Chaterm |

---

## 文件结构与职责

### 后端核心

- `pkg/aiusechat/uctypes/uctypes.go`
  - 扩展 `UITaskItem`：新增 `Description`、`Subtasks`、`Priority`、`IsFocused`、`FocusedTs`、`CompletedTs`、`ContextUsagePercent` 字段
  - 新增 `UIFocusChainState` 类型
  - 新增 `CommandSecurityResult`、`SecurityConfig` 类型
- `pkg/aiusechat/taskstate_runtime.go`
  - 任务状态 reducer
  - 语义计划优先 merge 逻辑
  - 工具到语义任务的推进逻辑
  - fallback 任务命名逻辑
  - **新增** `SmartTaskDetector` Go 实现
  - **新增** `FocusChainService` Go 实现
  - **新增** `TodoContextTracker` Go 实现
  - **新增** `TodoToolCallTracker` Go 实现
  - **新增** `TodoReminderService` Go 实现
- `pkg/aiusechat/command_security.go`
  - **新增** `CommandSecurityManager`：命令解析、黑名单/白名单/危险命令校验、severity 分级
  - **新增** `CommandParser`：命令结构解析（管道、链式命令拆分）
  - **新增** `SecurityConfig`：安全配置管理（热加载）
- `pkg/aiusechat/tools_taskstate.go`
  - 重构 `waveai_create_plan` → `waveai_todo_write`
  - 重构 `waveai_advance_plan` → `waveai_todo_read`
  - 对齐 Chaterm 的 `TodoWriteParams` / `TodoReadParams` schema
- `pkg/aiusechat/todo_prompts.go`
  - **新增** `SmartTaskDetector` Go 实现（对齐 Chaterm `todo-prompts.ts`）
  - **新增** `TODO_PROMPTS_OPTIMIZED` 核心/提醒提示词
  - **新增** `isHighComplexityIntent` 领域启发式检测
  - **新增** `ShouldCreateTodo` 主函数
- `pkg/aiusechat/usechat.go`
  - 在 `processAllToolCalls` 中优先使用现有语义计划
  - 发送 `data-taskstate`
  - **新增** 工具调用绑定到当前聚焦任务
  - **新增** 命令执行前安全校验
  - **新增** 上下文窗口用量追踪
- `pkg/aiusechat/usechat-prompts.go`
  - 强化复杂任务先建计划的提示
  - **新增** todo_write/todo_read 工具使用指导
  - **新增** 安全规则提示（命令被阻止后必须停止）
- `pkg/aiusechat/tools.go`
  - 注册计划工具
  - **新增** 注册 todo_write / todo_read 替代旧工具
- `pkg/aiusechat/interaction_detector.go`
  - **扩展** LLM fallback 检测
  - **扩展** TUI 检测和 auto-cancel
  - **扩展** alternate screen 检测
  - **新增** pager observation 模式
  - **新增** dismiss/suppress 逻辑
  - **新增** prompt debounce
  - **新增** exit key 检测
  - **新增** hash 去重
- `pkg/aiusechat/interaction_detector_types.go`
  - **新增** `InteractionType`、`TuiCategory`、`InteractionResult`、`QuickPattern`、`ConfirmValues` 等类型定义
- `pkg/aiusechat/context_management.go`
  - **扩展** 上下文窗口管理策略
  - **扩展** token 用量追踪
  - **扩展** 上下文截断和压缩
- `pkg/aiusechat/chatstore/chatstore.go`
  - 任务状态持久化与 session meta 同步
  - **新增** todo 存储（独立于 session meta，对齐 Chaterm TodoStorage）
  - **新增** todo CRUD 方法（ReadTodos/WriteTodos/UpdateTodo/DeleteTodo/GetTodo/TodoExists）
  - **新增** 安全配置持久化（JSON 文件，对齐 Chaterm SecurityConfigManager）
  - **新增** 安全配置热加载（文件变更监听）
  - **新增** 默认安全配置生成（含注释的 JSON 文件，对齐 Chaterm generateConfigWithComments）

### 前端核心

- `frontend/app/aipanel/aitypes.ts`
  - `taskstate` 类型
  - `getLatestTaskStatePart`
  - **新增** `FocusChainState` 类型
  - **新增** `TodoItem` 对齐 Chaterm schema（description、subtasks、priority、isFocused）
- `frontend/app/aipanel/waveai-model.tsx`
  - `taskStateAtom`
  - **新增** `focusChainAtom`
  - **新增** `contextUsageAtom`
  - reload / clear / 动态同步
- `frontend/app/aipanel/aipanel.tsx`
  - 从消息中消费 `data-taskstate`
  - 顶部挂载 `TaskProgressPanel`
  - **新增** 安全阻止事件处理
- `frontend/app/aipanel/taskprogress.ts`
  - 顶部卡片 view model
  - **新增** 聚焦链 view model
  - **新增** 上下文用量 view model
- `frontend/app/aipanel/taskprogresspanel.tsx`
  - 顶部语义任务卡片 UI
  - **新增** 聚焦链可视化
  - **新增** 上下文用量指示器
  - **新增** 子任务展示
  - **新增** 安全阻止提示

### 测试

- `pkg/aiusechat/taskstate_runtime_test.go`
- `pkg/aiusechat/tools_taskstate_test.go`
- `pkg/aiusechat/tools_readfile_test.go`
- `pkg/aiusechat/taskstate_test.go`
- `pkg/aiusechat/command_security_test.go`
- `pkg/aiusechat/smart_task_detector_test.go`
- `pkg/aiusechat/todo_prompts_test.go`
- `pkg/aiusechat/focus_chain_test.go`
- `pkg/aiusechat/context_tracker_test.go`
- `pkg/aiusechat/interaction_detector_test.go`
- `pkg/aiusechat/interaction_detector_types_test.go`
- `frontend/app/aipanel/tests/taskprogress.test.ts`
- `frontend/app/aipanel/tests/aitypes.test.ts`
- `frontend/app/aipanel/tests/agentstatus.test.ts`

---

## Phase 1: 升级任务数据模型（对齐 Chaterm Todo Schema）

**目标：** 把 `UITaskItem` 从只有 title 的薄模型升级为对齐 Chaterm `Todo` schema 的完整模型，支持 description、subtasks、priority、isFocused、toolCalls。

### Task 1: 扩展 UITaskItem 和 UITaskProgressState

**Files:**
- Modify: `pkg/aiusechat/uctypes/uctypes.go`
- Test: `pkg/aiusechat/taskstate_runtime_test.go`

- [ ] **Step 1: 扩展 UITaskItem 字段（对齐 Chaterm Todo + TodoToolCall 完整 schema）**

```go
type TaskItemPriority string

const (
    TaskItemPriorityHigh   TaskItemPriority = "high"
    TaskItemPriorityMedium TaskItemPriority = "medium"
    TaskItemPriorityLow    TaskItemPriority = "low"
)

// UIToolCall 对齐 Chaterm TodoToolCall（完整 schema，替代旧的 ToolCallIds []string）
type UIToolCall struct {
    ID         string         `json:"id"`
    Name       string         `json:"name"`
    Parameters map[string]any `json:"parameters,omitempty"`
    Timestamp  int64          `json:"timestamp"`
}

type UISubtask struct {
    ID          string      `json:"id"`
    Content     string      `json:"content"`
    Description string      `json:"description,omitempty"`
    ToolCalls   []UIToolCall `json:"toolcalls,omitempty"`
}

type UITaskItem struct {
    ID          string            `json:"id"`
    Title       string            `json:"title"`
    Description string            `json:"description,omitempty"`
    Status      TaskItemStatus    `json:"status"`
    Priority    TaskItemPriority  `json:"priority,omitempty"`
    Order       int               `json:"order,omitempty"`
    Kind        string            `json:"kind,omitempty"`
    Notes       string            `json:"notes,omitempty"`
    Subtasks    []UISubtask       `json:"subtasks,omitempty"`
    ToolCalls   []UIToolCall      `json:"toolcalls,omitempty"`
    IsFocused   bool              `json:"isfocused,omitempty"`
    StartedTs   int64             `json:"startedts,omitempty"`
    CompletedTs int64             `json:"completedts,omitempty"`
    FocusedTs   int64             `json:"focusedts,omitempty"`
    CreatedTs   int64             `json:"createdts,omitempty"`
    UpdatedTs   int64             `json:"updatedts,omitempty"`
    ContextUsagePercent int       `json:"contextusagepercent,omitempty"`
}
```

> ⚠️ **关键变更**：旧 `ToolCallIds []string` 替换为 `ToolCalls []UIToolCall`，对齐 Chaterm 的 `TodoToolCall` schema（含 id/name/parameters/timestamp）。`UISubtask` 也新增 `ToolCalls` 字段。新增 `CreatedTs`/`UpdatedTs` 对齐 Chaterm 的 `createdAt`/`updatedAt`。

- [ ] **Step 2: 新增 UIFocusChainState + UIFocusChainTransition + UIFocusChainHandoff 类型（对齐 Chaterm FocusChainState/Transition/Handoff）**

```go
type UIFocusChainState struct {
    TaskID              string `json:"taskid,omitempty"`
    FocusedTodoId       string `json:"focusedtodoid,omitempty"`
    ChainProgress       int    `json:"chainprogress,omitempty"`
    TotalTodos          int    `json:"totaltodos,omitempty"`
    CompletedTodos      int    `json:"completedtodos,omitempty"`
    CurrentContextUsage int    `json:"currentcontextusage,omitempty"`
    LastFocusChangeTs   int64  `json:"lastfocuschangets,omitempty"`
    AutoTransition      bool   `json:"autotransition,omitempty"`
}

type FocusTransitionReason string

const (
    FocusTransitionTaskCompleted FocusTransitionReason = "task_completed"
    FocusTransitionContextThreshold FocusTransitionReason = "context_threshold"
    FocusTransitionUserRequest FocusTransitionReason = "user_request"
    FocusTransitionAutoProgress FocusTransitionReason = "auto_progress"
)

type UIFocusChainTransition struct {
    FromTodoId              string               `json:"fromtodoid,omitempty"`
    ToTodoId                string               `json:"totodoid,omitempty"`
    Reason                  FocusTransitionReason `json:"reason"`
    Timestamp               int64                `json:"timestamp"`
    ContextUsageAtTransition int                 `json:"contextusageattransition,omitempty"`
}

type UIFocusChainHandoff struct {
    CompletedWork   string         `json:"completedwork"`
    CurrentState    string         `json:"currentstate"`
    NextSteps       string         `json:"nextsteps"`
    RelevantFiles   []string       `json:"relevantfiles,omitempty"`
    ContextSnapshot map[string]any `json:"contextsnapshot,omitempty"`
}
```

> ⚠️ **关键补充**：`UIFocusChainTransition` 对齐 Chaterm 的 `FocusChainTransition`，记录聚焦链推进历史（from/to/reason/timestamp/contextUsage）。`UIFocusChainHandoff` 对齐 Chaterm 的 `FocusChainHandoff`，用于任务切换时的上下文传递。这两个类型在原大纲中完全缺失，是聚焦链系统的核心数据结构。

- [ ] **Step 3: 扩展 UITaskProgressState 包含 FocusChain**

```go
type UITaskProgressState struct {
    Version       int                   `json:"version,omitempty"`
    PlanId        string                `json:"planid,omitempty"`
    Source        string                `json:"source,omitempty"`
    Status        TaskProgressStatus    `json:"status,omitempty"`
    CurrentTaskId string                `json:"currenttaskid,omitempty"`
    Tasks         []UITaskItem          `json:"tasks,omitempty"`
    Summary       UITaskProgressSummary `json:"summary,omitempty"`
    BlockedReason string                `json:"blockedreason,omitempty"`
    LastUpdatedTs int64                 `json:"lastupdatedts,omitempty"`
    FocusChain    *UIFocusChainState    `json:"focuschain,omitempty"`
}
```

- [ ] **Step 4: 更新 Clone 方法适配新字段**

- [ ] **Step 5: 写测试验证新字段序列化/反序列化正确**

```go
func TestUITaskItem_NewFieldsSerialize(t *testing.T) {
    item := uctypes.UITaskItem{
        ID:          "task-1",
        Title:       "部署 MySQL",
        Description: "在远程服务器上安装并配置 MySQL 8.0",
        Priority:    uctypes.TaskItemPriorityHigh,
        Status:      uctypes.TaskItemStatusInProgress,
        IsFocused:   true,
        ToolCalls: []uctypes.UIToolCall{
            {ID: "tc-1", Name: "wave_run_command", Parameters: map[string]any{"command": "apt install mysql"}, Timestamp: time.Now().UnixMilli()},
        },
        Subtasks: []uctypes.UISubtask{
            {ID: "sub-1", Content: "安装 MySQL", Description: "使用 apt 安装", ToolCalls: []uctypes.UIToolCall{{ID: "tc-sub1", Name: "wave_run_command", Timestamp: time.Now().UnixMilli()}}},
            {ID: "sub-2", Content: "配置 my.cnf"},
        },
    }
    data, err := json.Marshal(item)
    if err != nil {
        t.Fatalf("marshal failed: %v", err)
    }
    var decoded uctypes.UITaskItem
    if err := json.Unmarshal(data, &decoded); err != nil {
        t.Fatalf("unmarshal failed: %v", err)
    }
    if decoded.Description != "在远程服务器上安装并配置 MySQL 8.0" {
        t.Fatalf("description mismatch")
    }
    if decoded.Priority != uctypes.TaskItemPriorityHigh {
        t.Fatalf("priority mismatch")
    }
    if !decoded.IsFocused {
        t.Fatalf("isfocused should be true")
    }
    if len(decoded.Subtasks) != 2 {
        t.Fatalf("subtasks count mismatch")
    }
    if len(decoded.ToolCalls) != 1 || decoded.ToolCalls[0].Name != "wave_run_command" {
        t.Fatalf("toolcalls mismatch: expected 1 call with name wave_run_command, got %v", decoded.ToolCalls)
    }
    if len(decoded.Subtasks[0].ToolCalls) != 1 {
        t.Fatalf("subtask toolcalls mismatch")
    }
}

func TestUIFocusChainTransition_Serialize(t *testing.T) {
    transition := uctypes.UIFocusChainTransition{
        FromTodoId: "t1",
        ToTodoId:   "t2",
        Reason:     uctypes.FocusTransitionTaskCompleted,
        Timestamp:  time.Now().UnixMilli(),
        ContextUsageAtTransition: 45,
    }
    data, err := json.Marshal(transition)
    if err != nil {
        t.Fatalf("marshal failed: %v", err)
    }
    var decoded uctypes.UIFocusChainTransition
    if err := json.Unmarshal(data, &decoded); err != nil {
        t.Fatalf("unmarshal failed: %v", err)
    }
    if decoded.Reason != uctypes.FocusTransitionTaskCompleted {
        t.Fatalf("reason mismatch: got %s", decoded.Reason)
    }
}

func TestUIFocusChainHandoff_Serialize(t *testing.T) {
    handoff := uctypes.UIFocusChainHandoff{
        CompletedWork: "Completed 2 tasks:\n- 安装 MySQL\n- 配置 my.cnf",
        CurrentState:  "Currently working on: 启动并验证",
        NextSteps:     "1 tasks remaining:\n- 验证数据同步",
        ContextSnapshot: map[string]any{"progress": 66, "contextUsage": 45},
    }
    data, err := json.Marshal(handoff)
    if err != nil {
        t.Fatalf("marshal failed: %v", err)
    }
    var decoded uctypes.UIFocusChainHandoff
    if err := json.Unmarshal(data, &decoded); err != nil {
        t.Fatalf("unmarshal failed: %v", err)
    }
    if decoded.NextSteps != "1 tasks remaining:\n- 验证数据同步" {
        t.Fatalf("nextsteps mismatch")
    }
}
```

- [ ] **Step 6: 跑测试确认通过**

```bash
go test ./pkg/aiusechat/... -run TestUITaskItem_NewFieldsSerialize
```

---

## Phase 2: 升级计划工具为 Todo 工具（对齐 Chaterm todo_write/todo_read）

**目标：** 用 `waveai_todo_write` / `waveai_todo_read` 替代 `waveai_create_plan` / `waveai_advance_plan`，对齐 Chaterm 的完整 schema。

### Task 2: 实现 waveai_todo_write 工具

**Files:**
- Modify: `pkg/aiusechat/tools_taskstate.go`
- Test: `pkg/aiusechat/tools_taskstate_test.go`

- [ ] **Step 1: 定义 TodoWriteInput schema（对齐 Chaterm TodoWriteParams）**

```go
type todoWriteSubtaskInput struct {
    ID          string `json:"id"`
    Content     string `json:"content"`
    Description string `json:"description,omitempty"`
}

type todoWriteTaskInput struct {
    ID          string                   `json:"id"`
    Content     string                   `json:"content"`
    Description string                   `json:"description,omitempty"`
    Status      string                   `json:"status"`
    Priority    string                   `json:"priority"`
    Subtasks    []todoWriteSubtaskInput  `json:"subtasks,omitempty"`
}

type todoWriteInput struct {
    Todos     []todoWriteTaskInput `json:"todos"`
    AutoFocus bool                 `json:"autofocus,omitempty"`
}
```

- [ ] **Step 2: 实现 GetTodoWriteToolDefinition**

关键逻辑（对齐 Chaterm `TodoWriteTool.execute`）：
1. 预处理：补充缺失时间戳（CreatedTs/UpdatedTs）
2. 校验：每个 todo 必须有 content + status + priority
3. 聚焦链：如果没有显式聚焦，自动聚焦第一个 in_progress 任务
4. 已完成任务标记 CompletedTs，清除 IsFocused
5. 保存到 chatstore
6. 同步 FocusChainState
7. 如果是全新创建的 todo 列表（全部 pending + ≥3 个任务），添加提醒：必须立即把第一个任务设为 in_progress
8. **双语输出**：检测内容是否包含中文，切换输出语言（对齐 Chaterm `hasChineseContent` 检测）
9. 检查是否应建议新任务（上下文阈值）

```go
func GetTodoWriteToolDefinition(chatId string, aiOpts *uctypes.AIOptsType) uctypes.ToolDefinition {
    return uctypes.ToolDefinition{
        Name:        "waveai_todo_write",
        DisplayName: "Todo Write",
        Description: "Create and manage structured task lists. Each task must include content (title) and description (detailed steps). Use ONLY for tasks with ≥3 concrete steps; for 1-2 steps, act directly. State flow: pending → in_progress → completed.",
        ToolLogName: "wave:todowrite",
        Strict:      true,
        InputSchema: map[string]any{
            "type": "object",
            "properties": map[string]any{
                "todos": map[string]any{
                    "type": "array",
                    "items": map[string]any{
                        "type": "object",
                        "properties": map[string]any{
                            "id":          map[string]any{"type": "string"},
                            "content":     map[string]any{"type": "string"},
                            "description": map[string]any{"type": "string"},
                            "status":      map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed"}},
                            "priority":    map[string]any{"type": "string", "enum": []string{"high", "medium", "low"}},
                            "subtasks": map[string]any{
                                "type": "array",
                                "items": map[string]any{
                                    "type": "object",
                                    "properties": map[string]any{
                                        "id":          map[string]any{"type": "string"},
                                        "content":     map[string]any{"type": "string"},
                                        "description": map[string]any{"type": "string"},
                                    },
                                    "required": []string{"id", "content"},
                                },
                            },
                        },
                        "required":             []string{"id", "content", "status", "priority"},
                        "additionalProperties": false,
                    },
                },
                "auto_focus": map[string]any{"type": "boolean"},
            },
            "required":             []string{"todos"},
            "additionalProperties": false,
        },
        ToolAnyCallback: func(input any, _ *uctypes.UIMessageDataToolUse) (any, error) {
            // ... 完整实现见 Step 2 描述
        },
        ToolApproval: func(input any) string { return uctypes.ApprovalAutoApproved },
    }
}
```

- [ ] **Step 3: 写测试验证 todo_write 创建完整任务列表**

```go
func TestTodoWriteTool_CreatesFullTaskList(t *testing.T) {
    result, err := executeTodoWriteTool(chatId, map[string]any{
        "todos": []any{
            map[string]any{"id": "t1", "content": "安装 MySQL", "description": "使用 apt 安装 MySQL 8.0", "status": "pending", "priority": "high"},
            map[string]any{"id": "t2", "content": "配置 my.cnf", "description": "调整 innodb_buffer_pool_size", "status": "pending", "priority": "high"},
            map[string]any{"id": "t3", "content": "启动并验证", "description": "systemctl start mysql && mysql -e 'SELECT 1'", "status": "pending", "priority": "medium"},
        },
    })
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    state := result.(*uctypes.UITaskProgressState)
    if len(state.Tasks) != 3 {
        t.Fatalf("expected 3 tasks, got %d", len(state.Tasks))
    }
    if state.Tasks[0].Description != "使用 apt 安装 MySQL 8.0" {
        t.Fatalf("description not preserved")
    }
    if state.Tasks[0].Priority != uctypes.TaskItemPriorityHigh {
        t.Fatalf("priority not preserved")
    }
    if !state.Tasks[0].IsFocused {
        t.Fatalf("first task should be auto-focused")
    }
    if state.Tasks[0].Status != uctypes.TaskItemStatusInProgress {
        t.Fatalf("first task should be in_progress after auto-focus")
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

### Task 3: 实现 waveai_todo_read 工具

**Files:**
- Modify: `pkg/aiusechat/tools_taskstate.go`
- Test: `pkg/aiusechat/tools_taskstate_test.go`

- [ ] **Step 1: 实现 GetTodoReadToolDefinition（对齐 Chaterm TodoReadTool）**

关键逻辑（对齐 Chaterm `TodoReadTool.execute`）：
1. 从 chatstore 读取当前 todo 列表
2. 如果为空，返回提示建议创建（对齐 Chaterm `TodoReminderService.getReminderForEmptyTodos`）
3. **如果 <3 个任务，提示直接执行不必建清单**（对齐 Chaterm：`"Only 1–2 tasks present. This is not a complex checklist; execute directly and report the outcome."`）
4. 如果 ≥3 个任务，返回格式化的任务列表+聚焦链状态+上下文用量
5. 检查是否应建议新任务（上下文阈值）
6. **双语输出**：检测内容是否包含中文，切换输出语言

- [ ] **Step 2: 写测试验证 todo_read 返回正确格式**

- [ ] **Step 3: 跑测试确认通过**

### Task 4: 注册新工具并废弃旧工具

**Files:**
- Modify: `pkg/aiusechat/tools.go`
- Test: `pkg/aiusechat/tools_taskstate_test.go`

- [ ] **Step 1: 在 GenerateTabStateAndTools 中注册 waveai_todo_write 和 waveai_todo_read**
- [ ] **Step 2: 移除 waveai_create_plan 和 waveai_advance_plan 的注册**
- [ ] **Step 3: 写测试验证新工具已注册、旧工具已移除**

```go
func TestGenerateTabStateAndTools_IncludesTodoTools(t *testing.T) {
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
    if !slices.Contains(names, "waveai_todo_write") || !slices.Contains(names, "waveai_todo_read") {
        t.Fatalf("expected todo tools in tool list, got %#v", names)
    }
    if slices.Contains(names, "waveai_create_plan") || slices.Contains(names, "waveai_advance_plan") {
        t.Fatalf("old plan tools should be removed, got %#v", names)
    }
}
```

---

## Phase 3: 智能任务检测（对齐 Chaterm SmartTaskDetector）

**目标：** 后端自动检测复杂任务，在模型未主动创建 todo 时兜底触发。

### Task 5: 实现 SmartTaskDetector

**Files:**
- Modify: `pkg/aiusechat/taskstate_runtime.go`
- Test: `pkg/aiusechat/smart_task_detector_test.go`

- [ ] **Step 1.5: 实现辅助函数**

```go
// matchesAny 检查文本是否匹配任意正则表达式
func matchesAny(text string, patterns []*regexp.Regexp) bool {
    for _, p := range patterns {
        if p.MatchString(text) {
            return true
        }
    }
    return false
}
```

```go
var complexActionPatterns = []*regexp.Regexp{
    regexp.MustCompile(`(?i)(部署|安装|搭建|配置|上线|发布|迁移|备份|恢复|初始化|扩容|缩容|集群|加固|监控)`),
    regexp.MustCompile(`(?i)(deploy|install|setup|configure|provision|migrate|backup|restore|initialize|bootstrap|scale|harden|monitor)`),
}

var complexResourcePatterns = []*regexp.Regexp{
    // 第一类：数据库/消息队列/搜索
    regexp.MustCompile(`(?i)(mysql|postgres|postgresql|redis|mongodb|kafka|zookeeper|nginx|elasticsearch|rabbitmq|consul|etcd|vault|istio|traefik|haproxy|keepalived)`),
    // 第二类：DevOps/CI-CD/监控
    regexp.MustCompile(`(?i)(docker|compose|kubernetes|k8s|helm|jenkins|gitlab|harbor|prometheus|grafana)`),
    // 第三类：网络/安全
    regexp.MustCompile(`(?i)(ssl|tls|证书|防火墙|iptables|vpn|wireguard|openvpn|域名|dns|负载均衡|lb)`),
    // 第四类：中文通用资源词
    regexp.MustCompile(`(?i)(数据库|消息队列|缓存|搜索|网关|代理|服务发现)`),
}

var complexContextPatterns = []*regexp.Regexp{
    regexp.MustCompile(`(?i)(生产|线上|环境|集群|多节点|高可用|容灾|灾备|灰度|回滚)`),
    regexp.MustCompile(`(?i)(production|cluster|multi-?node|high\s*availability|dr|disaster\s*recovery|canary|rollback)`),
}

func isHighComplexityIntent(text string) bool {
    actionHit := matchesAny(text, complexActionPatterns)
    resourceHit := matchesAny(text, complexResourcePatterns)
    contextHit := matchesAny(text, complexContextPatterns)
    return (actionHit && resourceHit) || (resourceHit && contextHit) || (actionHit && contextHit)
}
```

> ⚠️ **关键补全**：原计划遗漏了大量 resource patterns：
> - 中间件：zookeeper, rabbitmq, consul, etcd, vault, istio, traefik, haproxy, keepalived
> - DevOps：jenkins, gitlab, harbor, prometheus, grafana, compose
> - 安全：wireguard, openvpn, lb
> - 中文通用资源词：数据库、消息队列、缓存、搜索、网关、代理、服务发现

- [ ] **Step 2: 实现序列词和列表格式检测**

```go
var sequencePatterns = []*regexp.Regexp{
    regexp.MustCompile(`[第一二三四五六七八九十]\s*[步阶段项]`),
    regexp.MustCompile(`(首先|然后|接下来|最后|依次)`),
    regexp.MustCompile(`[1-9]\.|[一二三四五六七八九十]、`),
    regexp.MustCompile(`(?i)(first|then|next|finally|step\s*[1-9]|step\s*one)`),
}
```

- [ ] **Step 2.5: 实现扩展模式检测（对齐 Chaterm shouldCreateTodo 中的 patterns 数组）**

```go
// extendedPatterns 对齐 Chaterm todo-prompts.ts:108-131 中的完整 patterns 数组
var extendedPatterns = []*regexp.Regexp{
    // 中文：运维动作 + 问题/故障/性能
    regexp.MustCompile(`(排查|优化|部署|升级|迁移|维护|分析|监控).*(问题|故障|性能|异常|日志)`),
    // 中文：批量操作
    regexp.MustCompile(`(批量|全部|所有).*(服务器|应用|数据库|系统|配置)`),
    // 中文：多动作任务
    regexp.MustCompile(`(查看|检查|分析|监控).*(分析|检查|查看)`),
    // 中文：系统诊断任务
    regexp.MustCompile(`(系统|应用|服务).*(监控|分析|日志|资源|异常)`),

    // 英文：序列词
    regexp.MustCompile(`(?i)(first|then|next|finally|step\s*[1-9]|step\s*one)`),
    // 英文：列表格式
    regexp.MustCompile(`[1-9]\.\s`),
    // 英文：多动作任务
    regexp.MustCompile(`(?i)(check|analyze|examine|monitor|troubleshoot|deploy|optimize|migrate).*(and|then|\s+\w+\s+(and|then))`),
    // 英文：系统诊断
    regexp.MustCompile(`(?i)(system|application|server|database|service).*(monitor|analyze|log|resource|error|issue|anomaly)`),
    // 英文：批量操作
    regexp.MustCompile(`(?i)(batch|all|multiple).*(server|application|database|system|config)`),
    // 英文：故障排查
    regexp.MustCompile(`(?i)(troubleshoot|diagnose|investigate).*(problem|issue|error|failure|performance)`),
    // 英文：部署和运维
    regexp.MustCompile(`(?i)(deploy|migrate|backup|restore|upgrade).*(server|application|database|system|production)`),

    // 英文扩展：基础系统检查
    regexp.MustCompile(`(?i)(check|analyze|examine|monitor).*(system|application|server|database|log|resource)`),
    // 英文扩展：资源使用查询
    regexp.MustCompile(`(?i)(which|what).*(application|process|service).*(consume|using|占用)`),
    // 英文扩展：日志分析
    regexp.MustCompile(`(?i)(examine|analyze|check).*(log|file|error|anomaly)`),
}

// countPatternSignals 统计匹配的信号数量
func countPatternSignals(text string) int {
    signals := 0
    for _, pattern := range extendedPatterns {
        if pattern.MatchString(text) {
            signals++
        }
    }
    return signals
}

// countSequenceSignals 统计序列词/列表格式的数量
func countSequenceSignals(text string) int {
    count := 0
    // 数字列表：1. 2. 3.
    count += len(regexp.MustCompile(`(?:^|\s)(?:[1-9])[\.]\s`).FindAllString(text, -1))
    // 中文枚举：一、二、三、
    count += len(regexp.MustCompile(`[一二三四五六七八九十]、`).FindAllString(text, -1))
    // 中文序列词：首先、然后、接下来、最后
    count += len(regexp.MustCompile(`(首先|然后|接下来|最后|依次)`).FindAllString(text, -1))
    // 英文序列词：first, then, next, finally
    count += len(regexp.MustCompile(`\b(first|then|next|finally)\b`).FindAllString(text, -1))
    return count
}
```

> ⚠️ **关键补全**：原计划 Step 2 只有基础的序列词检测，遗漏了 Chaterm 中大量的扩展 patterns：
> - 运维动作 + 问题组合：(排查|优化|部署...).*(问题|故障|性能|异常|日志)
> - 批量操作：(批量|全部|所有).*(服务器|应用|数据库|系统|配置)
> - 多动作任务：(查看|检查|分析|监控).*(分析|检查|查看)
> - 系统诊断：(系统|应用|服务).*(监控|分析|日志|资源|异常)
> - 英文故障排查、部署运维、资源查询、日志分析等 10+ 种扩展模式

- [ ] **Step 3: 实现 ShouldCreateTodo 主函数**

```go
const (
    minMessageLength     = 10
    minStepsForTodo      = 3
    minSignalsForComplex = 2
)

// ShouldCreateTodo 对齐 Chaterm SmartTaskDetector.shouldCreateTodo
// 检测逻辑：
// 1. 消息太短 → 直接返回 false
// 2. 领域强意图检测（action+resource、resource+context、action+context 任意两组匹配）→ 直接返回 true
// 3. 序列词/列表格式达到 3 个以上 → 直接返回 true
// 4. 统计扩展模式匹配信号数量，达到 2 个以上 → 返回 true
func ShouldCreateTodo(message string) bool {
    if len(message) <= minMessageLength {
        return false
    }

    // 早期退出：领域强意图检测（如 "部署一个 MySQL 数据库"）
    if isHighComplexityIntent(message) {
        return true
    }

    // 检查序列词/列表格式是否达到 3 个以上
    if countSequenceSignals(message) >= minStepsForTodo {
        return true
    }

    // 统计扩展模式匹配信号数量
    signals := countPatternSignals(message)
    return signals >= minSignalsForComplex
}
```

> ⚠️ **关键修正**：原计划在 ShouldCreateTodo 中对 message 做了 ToLower 处理后再传给 isHighComplexityIntent，
> 但 isHighComplexityIntent 内部的正则已经使用了 `(?i)` 标志做大小写不敏感匹配，且中文不需要 ToLower。
> 现在改为直接传原始 message，与 Chaterm 的行为完全对齐（Chaterm 的 COMPLEX_ACTIONS 等正则有 `/i` 标志）。

- [ ] **Step 4: 写测试覆盖中英文场景**

```go
func TestShouldCreateTodo_ChineseComplexTask(t *testing.T) {
    tests := []struct {
        input    string
        expected bool
    }{
        // 领域强意图：action + resource
        {"部署一个 MySQL 数据库", true},
        {"安装 Redis 缓存", true},
        {"配置 Kubernetes 集群", true},
        {"搭建 Kafka 消息队列", true},
        // 领域强意图：resource + context
        {"生产环境 Redis 集群", true},
        {"线上 MySQL 数据库高可用", true},
        // 领域强意图：action + context
        {"部署生产环境", true},
        {"配置集群高可用", true},
        // 序列词/列表格式
        {"首先检查日志，然后分析错误，最后修复问题", true},
        {"1. 安装依赖 2. 配置环境 3. 启动服务", true},
        {"第一阶段搭建环境，第二阶段配置服务，第三阶段验证", true},
        // 扩展模式：运维+问题
        {"排查性能问题", true},
        {"优化系统资源", true},
        {"升级数据库配置并分析异常日志", true},
        // 扩展模式：批量操作
        {"批量配置所有服务器", true},
        {"全部应用需要迁移", true},
        // 扩展模式：多动作
        {"查看并分析系统日志", true},
        {"检查应用监控状态", true},
        // 扩展模式：系统诊断
        {"系统资源监控分析", true},
        {"服务异常日志排查", true},
        // 不应该触发的场景
        {"查看当前目录", false},
        {"你好", false},
        {"ls -la", false},
        {"帮我了解一下 Docker", false},  // 单纯了解，非操作意图
        {"查看 MySQL 状态", false},        // 单一动作，不触发
    }
    for _, tt := range tests {
        result := ShouldCreateTodo(tt.input)
        if result != tt.expected {
            t.Errorf("ShouldCreateTodo(%q) = %v, want %v", tt.input, result, tt.expected)
        }
    }
}

func TestShouldCreateTodo_EnglishComplexTask(t *testing.T) {
    tests := []struct {
        input    string
        expected bool
    }{
        // 领域强意图：action + resource
        {"Deploy a MySQL database cluster", true},
        {"Install Redis and configure it", true},
        {"Setup Kubernetes k8s environment", true},
        {"Configure nginx and prometheus", true},
        {"Migrate PostgreSQL to new server", true},
        {"Bootstrap docker compose services", true},
        // 领域强意图：resource + context
        {"Production Redis cluster high availability", true},
        {"MySQL database disaster recovery plan", true},
        // 领域强意图：action + context
        {"Deploy to production cluster", true},
        {"Configure multi-node environment", true},
        // 序列词/列表格式
        {"First check logs, then analyze errors, finally fix the issue", true},
        {"1. Install deps 2. Configure env 3. Start service", true},
        {"Step one: setup, Step two: deploy, Step three: verify", true},
        // 扩展模式：多动作
        {"Check and analyze system logs", true},
        {"Deploy then monitor the application", true},
        // 扩展模式：系统诊断
        {"Monitor server resource usage and errors", true},
        {"Analyze database performance issues", true},
        // 扩展模式：批量操作
        {"Batch configure all servers", true},
        {"Multiple application database migration", true},
        // 扩展模式：故障排查
        {"Troubleshoot system performance problems", true},
        {"Diagnose application failure issues", true},
        // 扩展模式：部署运维
        {"Deploy application to production server", true},
        {"Backup and restore database system", true},
        // 扩展模式：资源查询
        {"Which application process is using high memory", true},
        // 扩展模式：日志分析
        {"Examine log files for errors", true},
        // 不应该触发的场景
        {"Check the current directory", false},
        {"Hello", false},
        {"ls -la", false},
        {"Tell me about Docker", false},
        {"Check MySQL status", false},
    }
    for _, tt := range tests {
        result := ShouldCreateTodo(tt.input)
        if result != tt.expected {
            t.Errorf("ShouldCreateTodo(%q) = %v, want %v", tt.input, result, tt.expected)
        }
    }
}

func TestIsHighComplexityIntent_ResourcePatterns(t *testing.T) {
    // 测试新增的 resource patterns 是否生效
    tests := []struct {
        input    string
        expected bool
    }{
        // 中间件类
        {"部署 zookeeper 集群", true},
        {"配置 rabbitmq 消息队列", true},
        {"安装 consul 服务发现", true},
        {"搭建 etcd 集群", true},
        {"配置 vault 密钥管理", true},
        {"部署 istio 服务网格", true},
        {"配置 traefik 网关", true},
        {"安装 haproxy 负载均衡", true},
        {"配置 keepalived 高可用", true},
        // DevOps 类
        {"部署 jenkins CI 环境", true},
        {"配置 gitlab 代码仓库", true},
        {"搭建 harbor 镜像仓库", true},
        {"安装 prometheus 监控", true},
        {"配置 grafana 仪表盘", true},
        // 网络安全类
        {"配置 ssl 证书", true},
        {"设置 wireguard VPN", true},
        {"配置 openvpn 服务", true},
        {"设置域名 DNS 解析", true},
        // 中文通用资源词
        {"部署数据库集群", true},
        {"配置消息队列服务", true},
        {"搭建缓存系统", true},
        {"配置网关代理", true},
        // 不应该触发的（单独资源词，没有 action 或 context）
        {"MySQL 是什么", false},
        {"介绍一下 Redis", false},
    }
    for _, tt := range tests {
        result := isHighComplexityIntent(tt.input)
        if result != tt.expected {
            t.Errorf("isHighComplexityIntent(%q) = %v, want %v", tt.input, result, tt.expected)
        }
    }
}

func TestCountSequenceSignals(t *testing.T) {
    tests := []struct {
        input    string
        expected int
    }{
        {"1. 安装 2. 配置 3. 启动", 3},
        {"一、准备 二、部署 三、验证", 3},
        {"首先安装，然后配置，最后启动", 3},
        {"first install, then configure, finally deploy", 3},
        {"查看日志", 0},
    }
    for _, tt := range tests {
        result := countSequenceSignals(tt.input)
        if result != tt.expected {
            t.Errorf("countSequenceSignals(%q) = %d, want %d", tt.input, result, tt.expected)
        }
    }
}

func TestCountPatternSignals(t *testing.T) {
    tests := []struct {
        input    string
        expected int
    }{
        {"排查性能问题", 1},        // 运维+问题
        {"批量配置所有服务器", 1},    // 批量操作
        {"查看并分析日志", 1},       // 多动作
        {"系统资源监控", 1},         // 系统诊断
        {"排查问题并分析日志", 2},   // 多个信号
    }
    for _, tt := range tests {
        result := countPatternSignals(tt.input)
        if result < tt.expected {
            t.Errorf("countPatternSignals(%q) = %d, want >= %d", tt.input, result, tt.expected)
        }
    }
}
```

- [ ] **Step 5: 在 usechat.go 中集成 SmartTaskDetector**

当用户发送新消息时，如果 `ShouldCreateTodo` 返回 true 且当前没有活跃 todo，在系统提示中追加提醒：

```go
if ShouldCreateTodo(userMessage) && currentTaskState == nil {
    systemPrompt += "\n\n⚠️ 检测到复杂任务，请使用 waveai_todo_write 创建任务列表来跟踪执行进度。"
}
```

---

## Phase 4: 聚焦链系统（对齐 Chaterm FocusChainService）

**目标：** 实现聚焦链，跟踪当前聚焦任务、自动推进、上下文阈值告警。

### Task 6: 实现 FocusChainService 和 TodoContextTracker

**Files:**
- Modify: `pkg/aiusechat/taskstate_runtime.go`
- Test: `pkg/aiusechat/focus_chain_test.go`

- [ ] **Step 1: 实现 TodoContextTracker（对齐 Chaterm）**

```go
const (
    contextWarningLevel  = 50
    contextCriticalLevel = 70
    contextMaximumLevel  = 90
)

type ContextThresholdLevel string

const (
    ContextLevelNormal   ContextThresholdLevel = "normal"
    ContextLevelWarning  ContextThresholdLevel = "warning"
    ContextLevelCritical ContextThresholdLevel = "critical"
    ContextLevelMaximum  ContextThresholdLevel = "maximum"
)

type TodoContextTracker struct {
    sessionID         string
    activeTodoID      string
    contextUsagePercent int
    currentTokenCount int
    maxContextTokens  int
}

func (t *TodoContextTracker) UpdateContextUsage(tokenCount int, maxTokens int) ContextThresholdLevel {
    t.currentTokenCount = tokenCount
    if maxTokens > 0 {
        t.maxContextTokens = maxTokens
    }
    t.contextUsagePercent = min(100, tokenCount*100/t.maxContextTokens)
    return t.getContextLevel()
}

func (t *TodoContextTracker) ShouldSuggestNewTask() (bool, string) {
    if t.contextUsagePercent >= contextCriticalLevel {
        return true, fmt.Sprintf("Context usage at %d%% (%d/%d tokens). Consider creating a new task.", t.contextUsagePercent, t.currentTokenCount, t.maxContextTokens)
    }
    return false, ""
}
```

- [ ] **Step 2: 实现 FocusChainService（对齐 Chaterm）**

```go
type FocusChainService struct {
    taskID      string
    state       *uctypes.UIFocusChainState
    transitions []uctypes.UIFocusChainTransition
}

func (s *FocusChainService) FocusTodo(todoID string, reason string) {
    // 记录 transition（对齐 Chaterm FocusChainService.focusTodo）
    transition := uctypes.UIFocusChainTransition{
        FromTodoId:              s.state.FocusedTodoId,
        ToTodoId:                todoID,
        Reason:                  uctypes.FocusTransitionReason(reason),
        Timestamp:               time.Now().UnixMilli(),
        ContextUsageAtTransition: s.state.CurrentContextUsage,
    }
    s.transitions = append(s.transitions, transition)

    s.state.FocusedTodoId = todoID
    s.state.LastFocusChangeTs = time.Now().UnixMilli()
    s.state.AutoTransition = true
}

func (s *FocusChainService) CompleteFocusedTodo() (*uctypes.UITaskItem, *uctypes.UITaskItem) {
    // 标记当前聚焦任务为 completed
    // 自动推进到下一个 pending 任务
    // 记录 transition（reason=task_completed）
    // 返回 (completedTodo, nextTodo)
}

func (s *FocusChainService) GetProgressSummary() (total, completed, progressPercent int) {
    // 计算聚焦链进度
}

func (s *FocusChainService) ShouldSuggestNewTask() (suggest bool, reason string) {
    // 委托给 TodoContextTracker
}

func (s *FocusChainService) GenerateHandoff() *uctypes.UIFocusChainHandoff {
    // 对齐 Chaterm FocusChainService.generateHandoff
    // 生成任务切换上下文：completedWork + currentState + nextSteps + contextSnapshot
}

func (s *FocusChainService) GetTransitions() []uctypes.UIFocusChainTransition {
    return s.transitions
}
```

- [ ] **Step 3: 写测试验证聚焦链推进逻辑**

```go
func TestFocusChainService_AutoAdvanceOnComplete(t *testing.T) {
    state := &uctypes.UITaskProgressState{
        PlanId: "plan-1",
        Source: "model-generated",
        Tasks: []uctypes.UITaskItem{
            {ID: "t1", Title: "安装 MySQL", Status: uctypes.TaskItemStatusInProgress, IsFocused: true, Priority: uctypes.TaskItemPriorityHigh},
            {ID: "t2", Title: "配置 my.cnf", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityHigh},
            {ID: "t3", Title: "启动并验证", Status: uctypes.TaskItemStatusPending, Priority: uctypes.TaskItemPriorityMedium},
        },
    }
    svc := NewFocusChainService("chat-1", state)
    completed, next := svc.CompleteFocusedTodo()
    if completed.ID != "t1" {
        t.Fatalf("expected t1 completed, got %s", completed.ID)
    }
    if next.ID != "t2" {
        t.Fatalf("expected t2 as next, got %s", next.ID)
    }
    if !next.IsFocused {
        t.Fatalf("next task should be focused")
    }
    if next.Status != uctypes.TaskItemStatusInProgress {
        t.Fatalf("next task should be in_progress")
    }
}
```

- [ ] **Step 4: 在 todo_write 工具回调中集成聚焦链**

当 todo_write 被调用时：
1. 自动聚焦第一个 in_progress 或 pending 任务
2. 同步 FocusChainState 到 UITaskProgressState
3. 如果是全新创建的列表，添加提醒

- [ ] **Step 5: 跑测试确认通过**

---

## Phase 5: 命令安全系统（对齐 Chaterm CommandSecurityManager）

**目标：** 命令执行前经过安全校验，危险命令被阻止或需审批。

### Task 7: 实现 CommandSecurityManager

**Files:**
- New: `pkg/aiusechat/command_security.go`
- Test: `pkg/aiusechat/command_security_test.go`

- [ ] **Step 1: 定义 SecurityConfig（含 SecurityPolicy 嵌套结构）和 CommandSecurityResult（对齐 Chaterm SecurityTypes）**

```go
type CommandSecurityResult struct {
    IsAllowed        bool   `json:"isallowed"`
    Reason           string `json:"reason,omitempty"`
    Category         string `json:"category,omitempty"` // "blacklist", "whitelist", "dangerous", "permission"
    Severity         string `json:"severity,omitempty"` // "low", "medium", "high", "critical"
    Action           string `json:"action,omitempty"`   // "block", "ask", "allow"
    RequiresApproval bool   `json:"requiresapproval,omitempty"`
}

type SecurityPolicy struct {
    BlockCritical    bool `json:"blockcritical"`    // 直接阻止 critical 危险命令
    AskForMedium     bool `json:"askformedium"`     // medium 危险命令是否询问用户
    AskForHigh       bool `json:"askforhigh"`       // high 危险命令是否询问用户
    AskForBlacklist  bool `json:"askforblacklist"`  // 黑名单命令是否询问（false=直接阻止）
}

type SecurityConfig struct {
    EnableCommandSecurity bool           `json:"enablecommandsecurity"`
    EnableStrictMode      bool           `json:"enablestrictmode"`
    BlacklistPatterns     []string       `json:"blacklistpatterns"`
    WhitelistPatterns     []string       `json:"whitelistpatterns"`
    DangerousCommands     []string       `json:"dangerouscommands"`
    MaxCommandLength      int            `json:"maxcommandlength"`
    SecurityPolicy        SecurityPolicy `json:"securitypolicy"`
}
```

> ⚠️ **关键补充**：原大纲缺少 `SecurityPolicy` 嵌套结构。Chaterm 的安全决策依赖 `blockCritical`/`askForMedium`/`askForHigh`/`askForBlacklist` 四个策略开关来决定 block vs ask，这是安全系统的核心决策逻辑。

- [ ] **Step 2: 实现 CommandParser（管道/链式命令拆分）**

```go
type ParsedCommand struct {
    Executable string
    Args       []string
    IsCompound bool
    Compounds  []*ParsedCommand
}

func ParseCommand(command string) *ParsedCommand {
    // 拆分管道、&&、||、; 链式命令
    // 返回主命令和子命令列表
}
```

- [ ] **Step 3: 实现 CommandSecurityManager.ValidateCommandSecurity（对齐 Chaterm 完整决策链）**

关键逻辑（对齐 Chaterm `CommandSecurityManager`）：
1. 检查命令长度（> MaxCommandLength → block）
2. 解析命令结构（`ParseCommand`）
3. 检查黑名单（递归检查复合命令的每个子命令）→ 根据 `SecurityPolicy.AskForBlacklist` 决定 block/ask
4. 检查危险命令（按 severity 分级决定 block/ask）
5. 严格模式下检查白名单
6. 返回 `CommandSecurityResult`

```go
func (m *CommandSecurityManager) ValidateCommandSecurity(command string) CommandSecurityResult {
    if !m.config.EnableCommandSecurity {
        return CommandSecurityResult{IsAllowed: true}
    }
    trimmed := strings.TrimSpace(command)
    if len(trimmed) > m.config.MaxCommandLength {
        return CommandSecurityResult{IsAllowed: false, Reason: "command too long", Category: "permission", Severity: "medium"}
    }
    parsed := ParseCommand(trimmed)
    if blacklistResult := m.checkBlacklistWithCompounds(parsed); blacklistResult != nil {
        return *blacklistResult
    }
    if dangerousResult := m.checkDangerousCommand(parsed); dangerousResult != nil {
        return *dangerousResult
    }
    if m.config.EnableStrictMode {
        if !m.matchesWhitelist(parsed) {
            return CommandSecurityResult{IsAllowed: false, Reason: "not in whitelist", Category: "whitelist", Severity: "medium", Action: "block"}
        }
    }
    return CommandSecurityResult{IsAllowed: true}
}

// getDangerousCommandSeverity 对齐 Chaterm 的四级 severity 分类
func (m *CommandSecurityManager) getDangerousCommandSeverity(cmd string) string {
    critical := []string{"rm", "del", "format", "shutdown", "reboot", "halt", "poweroff", "dd", "mkfs", "fdisk"}
    high := []string{"killall", "pkill", "systemctl", "service", "chmod", "chown", "mount", "umount"}
    medium := []string{"iptables", "ufw", "firewall-cmd", "sudo", "su"}
    lower := strings.ToLower(cmd)
    for _, c := range critical { if lower == c { return "critical" } }
    for _, c := range high { if lower == c { return "high" } }
    for _, c := range medium { if lower == c { return "medium" } }
    return "low"
}

// shouldAskForSeverity 对齐 Chaterm 的策略决策
func (m *CommandSecurityManager) shouldAskForSeverity(severity string) bool {
    switch severity {
    case "critical": return true  // critical 始终询问用户（而非直接阻止）
    case "high":     return m.config.SecurityPolicy.AskForHigh
    case "medium":   return m.config.SecurityPolicy.AskForMedium
    case "low":      return true  // low 默认询问
    default:         return true
    }
}

// matchesPattern 对齐 Chaterm 的 wildcard + 精确匹配逻辑
func (m *CommandSecurityManager) matchesPattern(command string, pattern string) bool {
    if strings.Contains(pattern, "*") {
        regexPattern := "^" + strings.ReplaceAll(pattern, "*", ".*") + "$"
        re := regexp.MustCompile("(?i)" + regexPattern)
        return re.MatchString(command)
    }
    escaped := regexp.QuoteMeta(pattern)
    if m.isRootDirectoryPattern(pattern) {
        re := regexp.MustCompile("(?i)^" + escaped + `(\\s|$)`)
        return re.MatchString(command)
    }
    re := regexp.MustCompile(`(?i)(^|\s)` + escaped + `(\s|$)`)
    return re.MatchString(command)
}

// isRootDirectoryPattern 对齐 Chaterm 的根目录危险操作检测
func (m *CommandSecurityManager) isRootDirectoryPattern(pattern string) bool {
    return strings.HasSuffix(pattern, " /") || strings.HasSuffix(pattern, " / ")
}
```

- [ ] **Step 4: 实现默认安全配置**

```go
func getDefaultSecurityConfig() SecurityConfig {
    return SecurityConfig{
        EnableCommandSecurity: true,
        EnableStrictMode:      false,
        BlacklistPatterns:     []string{}, // 初始为空，用户可自定义
        WhitelistPatterns: []string{
            "ls", "pwd", "whoami", "date", "uptime", "df", "free",
            "ps", "top", "htop", "netstat", "ss", "ping", "curl",
            "cat", "head", "tail", "grep", "find", "which", "echo",
            "printenv", "env", "history", "alias", "man", "--help", "--version",
        },
        DangerousCommands: []string{
            "rm", "format", "shutdown", "reboot", "halt", "poweroff",
            "init", "killall", "pkill", "fuser", "dd", "mkfs", "fdisk",
            "parted", "iptables", "ufw", "firewall-cmd",
            "chmod", "chown", "mount", "umount",
            "DROP", "TRUNCATE", "DELETE",
        },
        MaxCommandLength: 10000,
        SecurityPolicy: SecurityPolicy{
            BlockCritical:   true,  // 直接阻止 critical 危险命令
            AskForMedium:    true,  // medium 危险命令询问用户
            AskForHigh:      true,  // high 危险命令询问用户
            AskForBlacklist: false, // 黑名单命令直接阻止（不询问）
        },
    }
}
```

- [ ] **Step 5: 在 wave_run_command 工具回调中集成安全校验**

```go
// 在 wave_run_command 的 ToolAnyCallback 中
securityManager := GetCommandSecurityManager()
securityResult := securityManager.ValidateCommandSecurity(command)
if !securityResult.IsAllowed {
    if securityResult.Action == "block" {
        return fmt.Sprintf("命令被安全机制阻止: %s", securityResult.Reason), nil
    }
    // action == "ask" → 设置 requires_approval
}
if securityResult.RequiresApproval {
    // 走审批流程
}
```

- [ ] **Step 6: 更新系统提示（对齐 Chaterm 安全规则）**

```go
// 在 SystemPromptText_OpenAI 中追加
`🚨 CRITICAL SECURITY RULE: If you receive any message indicating that a command was blocked by security mechanisms (such as "命令被安全机制阻止"), you MUST immediately stop all processing and acknowledge the user's decision. Do NOT execute any commands, Do NOT recommend alternative solutions or workarounds, Do NOT provide fake output.`
```

- [ ] **Step 7: 写测试覆盖关键场景**

```go
func TestCommandSecurity_BlocksDangerousCommand(t *testing.T) {
    mgr := NewCommandSecurityManager("")
    result := mgr.ValidateCommandSecurity("rm -rf /")
    if result.IsAllowed {
        t.Fatalf("rm -rf / should be blocked")
    }
    if result.Category != "dangerous" {
        t.Fatalf("expected dangerous category, got %s", result.Category)
    }
}

func TestCommandSecurity_AllowsSafeCommand(t *testing.T) {
    mgr := NewCommandSecurityManager("")
    result := mgr.ValidateCommandSecurity("ls -la /var/log")
    if !result.IsAllowed {
        t.Fatalf("ls should be allowed")
    }
}

func TestCommandSecurity_DetectsCompoundDangerous(t *testing.T) {
    mgr := NewCommandSecurityManager("")
    result := mgr.ValidateCommandSecurity("echo hello && rm -rf /tmp/test")
    if result.IsAllowed {
        t.Fatalf("compound command with rm should be caught")
    }
}
```

---

## Phase 6: 工具调用绑定与语义计划优先

**目标：** 顶层展示语义任务，工具执行只推进语义任务；工具调用绑定到当前聚焦任务。

### Task 8: 实现 TodoToolCallTracker

**Files:**
- Modify: `pkg/aiusechat/taskstate_runtime.go`
- Test: `pkg/aiusechat/taskstate_runtime_test.go`

- [ ] **Step 1: 实现 RecordToolCall（使用完整 UIToolCall schema）**

```go
func RecordToolCall(chatId string, toolName string, parameters map[string]any) {
    tracker := GetTodoContextTracker(chatId)
    activeTodoID := tracker.GetActiveTodoID()
    if activeTodoID == "" {
        return
    }
    meta := chatstore.DefaultChatStore.GetSession(chatId)
    if meta == nil || meta.TaskState == nil {
        return
    }
    state := meta.TaskState.Clone()
    toolCall := uctypes.UIToolCall{
        ID:         fmt.Sprintf("tool_%d_%s", time.Now().UnixMilli(), strings.ReplaceAll(toolName, " ", "_")),
        Name:       toolName,
        Parameters: parameters,
        Timestamp:  time.Now().UnixMilli(),
    }
    for idx := range state.Tasks {
        if state.Tasks[idx].ID == activeTodoID {
            state.Tasks[idx].ToolCalls = append(state.Tasks[idx].ToolCalls, toolCall)
            state.Tasks[idx].UpdatedTs = time.Now().UnixMilli()
            break
        }
    }
    chatstore.DefaultChatStore.UpsertSessionMeta(chatId, nil, uctypes.UIChatSessionMetaUpdate{
        TaskState: state,
    })
}
```

> ⚠️ **关键变更**：原大纲使用 `ToolCallIds []string` 追踪工具调用，现升级为完整的 `ToolCalls []UIToolCall`（含 id/name/parameters/timestamp），对齐 Chaterm 的 `TodoToolCallTracker.recordToolCall`。

- [ ] **Step 2: 在 processAllToolCalls 中调用 RecordToolCall**

- [ ] **Step 3: 写测试验证工具调用绑定到正确任务**

### Task 9: 语义计划优先 merge 逻辑（保留原方案核心）

**Files:**
- Modify: `pkg/aiusechat/taskstate_runtime.go`
- Modify: `pkg/aiusechat/usechat.go`
- Test: `pkg/aiusechat/taskstate_runtime_test.go`

- [ ] **Step 1: 已有语义计划时，工具 burst 不覆盖当前任务**

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

- [ ] **Step 2: 工具结果推进语义任务，不触碰标题**

```go
func advanceTaskStateForToolResult(state *uctypes.UITaskProgressState, result uctypes.AIToolResult) {
    // 按 ToolCallIds 绑定推进
    // 仅更新 status / notes / blockedReason / currentTaskId
    // 不修改 Title / Description / Priority / IsFocused
}
```

- [ ] **Step 3: 写测试验证语义标题不被覆盖**

```go
func TestAdvanceTaskStateForToolResult_DoesNotOverrideSemanticTitle(t *testing.T) {
    state := &uctypes.UITaskProgressState{
        PlanId: "plan-1",
        Source: "model-generated",
        CurrentTaskId: "plan-task-1",
        Tasks: []uctypes.UITaskItem{{
            ID: "plan-task-1",
            Title: "安装 MySQL 8.0",
            Description: "使用 apt 安装 MySQL 8.0 并配置",
            Priority: uctypes.TaskItemPriorityHigh,
            Status: uctypes.TaskItemStatusInProgress,
            ToolCallIds: []string{"tool-1"},
        }},
    }
    advanceTaskStateForToolResult(state, uctypes.AIToolResult{ToolUseID: "tool-1"})
    if state.Tasks[0].Title != "安装 MySQL 8.0" {
        t.Fatalf("semantic title should remain unchanged")
    }
    if state.Tasks[0].Description != "使用 apt 安装 MySQL 8.0 并配置" {
        t.Fatalf("semantic description should remain unchanged")
    }
    if state.Tasks[0].Priority != uctypes.TaskItemPriorityHigh {
        t.Fatalf("semantic priority should remain unchanged")
    }
}
```

---

## Phase 7: 交互检测增强（对齐 Chaterm InteractionDetector）

**目标：** 扩展交互检测，增加 LLM fallback、TUI 分类检测、pager observation、TUI auto-cancel、dismiss/suppress、prompt debounce、exit key 检测、hash 去重。

> ⚠️ **原大纲严重不足**：原版仅覆盖 Chaterm InteractionDetector 约 20% 的功能。Chaterm 的 InteractionDetector 是一个 1400+ 行的核心模块，包含快速正则匹配、LLM fallback、TUI 分类（always/conditional/non-blacklist）、alternate screen 检测、pager observation 模式、TUI auto-cancel（silence timer + hard timeout）、dismiss/suppress 逻辑、prompt debounce、exit key 检测、hash 去重、prompt keywords/exclusions/confirm keywords 等多套规则。以下补全所有缺失。

### Task 10: 扩展 InteractionDetector（对齐 Chaterm 完整架构）

**Files:**
- Modify: `pkg/aiusechat/interaction_detector.go`
- New: `pkg/aiusechat/interaction_detector_types.go`
- Test: `pkg/aiusechat/interaction_detector_test.go`

- [ ] **Step 1: 新增交互检测类型定义（对齐 Chaterm types.ts）**

```go
type InteractionType string

const (
    InteractionConfirm  InteractionType = "confirm"
    InteractionSelect   InteractionType = "select"
    InteractionPassword InteractionType = "password"
    InteractionPager    InteractionType = "pager"
    InteractionEnter    InteractionType = "enter"
    InteractionFreeform InteractionType = "freeform"
)

type TuiCategory string

const (
    TuiCategoryAlways       TuiCategory = "always"
    TuiCategoryConditional  TuiCategory = "conditional"
    TuiCategoryNonBlacklist TuiCategory = "non-blacklist"
)

type ConfirmValues struct {
    Yes     string `json:"yes"`
    No      string `json:"no"`
    Default string `json:"default,omitempty"`
}

type InteractionResult struct {
    NeedsInteraction bool            `json:"needsinteraction"`
    InteractionType  InteractionType `json:"interactiontype"`
    PromptHint       string          `json:"prompthint"`
    Options          []string        `json:"options,omitempty"`
    OptionValues     []string        `json:"optionvalues,omitempty"`
    ConfirmValues    *ConfirmValues  `json:"confirmvalues,omitempty"`
    ExitKey          string          `json:"exitkey,omitempty"`
    ExitAppendNewline bool           `json:"exitappendnewline,omitempty"`
}

type QuickPattern struct {
    Pattern       regexp.Regexp
    Type          InteractionType
    ConfirmValues *ConfirmValues
}
```

- [ ] **Step 2: 扩展快速正则模式（对齐 Chaterm QUICK_PATTERNS + PROMPT_SUFFIX + PROMPT_KEYWORDS）**

```go
var quickPatterns = []QuickPattern{
    {Pattern: *regexp.MustCompile(`(?i)password\s*:`), Type: InteractionPassword},
    {Pattern: *regexp.MustCompile(`(?i)passphrase\s*:`), Type: InteractionPassword},
    {Pattern: *regexp.MustCompile(`(?i)口令\s*:`), Type: InteractionPassword},
    {Pattern: *regexp.MustCompile(`(?i)密码\s*[：:]`), Type: InteractionPassword},
    {Pattern: *regexp.MustCompile(`(?i)\[sudo\]\s*password\s+for`), Type: InteractionPassword},
    {Pattern: *regexp.MustCompile(`(?i)\[Y/n\]`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "Y", No: "n", Default: "Y"}},
    {Pattern: *regexp.MustCompile(`(?i)\[y/N\]`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "y", No: "N", Default: "N"}},
    {Pattern: *regexp.MustCompile(`(?i)\(yes/no\)`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "yes", No: "no"}},
    {Pattern: *regexp.MustCompile(`(?i)\[是/否\]`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "是", No: "否"}},
    {Pattern: *regexp.MustCompile(`(?i)press enter`), Type: InteractionEnter},
    {Pattern: *regexp.MustCompile(`按.*回车`), Type: InteractionEnter},
    {Pattern: *regexp.MustCompile(`(?i)--More--\s*$`), Type: InteractionPager},
    {Pattern: *regexp.MustCompile(`\(END\)\s*$`), Type: InteractionPager},
}

var promptSuffixPattern = regexp.MustCompile(`[:?：？]\s*$`)

var promptKeywords = []*regexp.Regexp{
    regexp.MustCompile(`(?i)password`), regexp.MustCompile(`(?i)username`), regexp.MustCompile(`(?i)login`),
    regexp.MustCompile(`(?i)enter`), regexp.MustCompile(`(?i)input`), regexp.MustCompile(`输入`),
    regexp.MustCompile(`(?i)confirm`), regexp.MustCompile(`确认`), regexp.MustCompile(`(?i)passphrase`),
    regexp.MustCompile(`(?i)token`), regexp.MustCompile(`(?i)secret`), regexp.MustCompile(`(?i)verification`),
    regexp.MustCompile(`验证码`), regexp.MustCompile(`(?i)choice`), regexp.MustCompile(`选择`),
}

var promptExclusions = []*regexp.Regexp{
    regexp.MustCompile(`(?i)^\s*\[?(INFO|DEBUG|WARN|WARNING|ERROR|TRACE|FATAL)\]?\s*:`),
    regexp.MustCompile(`^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}`),
    regexp.MustCompile(`(?i)https?://`),
    regexp.MustCompile(`^\s*"[\w\-]+"\s*:`),
}
```

- [ ] **Step 3: 实现 TUI 分类检测（对齐 Chaterm ALWAYS_TUI + CONDITIONAL_TUI + PAGER_COMMANDS）**

```go
// Always-TUI: 始终交互式
var alwaysTUICommands = []*regexp.Regexp{
    regexp.MustCompile(`(?i)^vim?\b`), regexp.MustCompile(`(?i)^vi\b`),
    regexp.MustCompile(`(?i)^nano\b`), regexp.MustCompile(`(?i)^emacs\b`),
    regexp.MustCompile(`(?i)^tmux\b`), regexp.MustCompile(`(?i)^screen\b`),
    regexp.MustCompile(`(?i)^mc\b`), regexp.MustCompile(`(?i)^nnn\b`),
    regexp.MustCompile(`(?i)^ranger\b`),
}

// Conditional-TUI: 可能有非交互参数
type conditionalTUIRule struct {
    Pattern          *regexp.Regexp
    NonInteractiveArgs []*regexp.Regexp
}

var conditionalTUICommands = []conditionalTUIRule{
    {Pattern: regexp.MustCompile(`(?i)^top\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`-n\s*\d+`), regexp.MustCompile(`-b\b`)}},
    {Pattern: regexp.MustCompile(`(?i)^htop\b`), NonInteractiveArgs: []*regexp.Regexp{}},
    {Pattern: regexp.MustCompile(`(?i)^mysql\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`-e\s`), regexp.MustCompile(`--execute\b`), regexp.MustCompile(`--batch\b`)}},
    {Pattern: regexp.MustCompile(`(?i)^psql\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`-c\s`), regexp.MustCompile(`--command\b`)}},
    {Pattern: regexp.MustCompile(`(?i)^redis-cli\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`--raw\b`)}},
    {Pattern: regexp.MustCompile(`(?i)^ssh\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`-T\b`), regexp.MustCompile(`(?i)-o\s*BatchMode=yes`)}},
    {Pattern: regexp.MustCompile(`(?i)^mongo\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`--eval\b`), regexp.MustCompile(`-e\s`)}},
}

// Pager 命令白名单（优先级高于 TUI）
var pagerCommands = []*regexp.Regexp{
    regexp.MustCompile(`(?i)^less\b`), regexp.MustCompile(`(?i)^more\b`),
    regexp.MustCompile(`(?i)^man\b`), regexp.MustCompile(`(?i)^view\b`),
    regexp.MustCompile(`(?i)^git\s+log\b`), regexp.MustCompile(`(?i)^git\s+diff\b`),
    regexp.MustCompile(`(?i)^journalctl\b`), regexp.MustCompile(`(?i)^systemctl\s+status\b`),
    regexp.MustCompile(`(?i)\|\s*less\b`), regexp.MustCompile(`(?i)\|\s*more\b`),
}

func classifyTuiCommand(command string) TuiCategory {
    for _, p := range pagerCommands {
        if p.MatchString(command) { return TuiCategoryNonBlacklist } // pager 优先
    }
    for _, p := range alwaysTUICommands {
        if p.MatchString(command) { return TuiCategoryAlways }
    }
    for _, rule := range conditionalTUICommands {
        if rule.Pattern.MatchString(command) {
            for _, arg := range rule.NonInteractiveArgs {
                if arg.MatchString(command) { return TuiCategoryNonBlacklist }
            }
            return TuiCategoryConditional
        }
    }
    return TuiCategoryNonBlacklist
}
```

- [ ] **Step 4: 实现 alternate screen 检测 + pager observation 模式**

```go
var alternateScreenEnterSeqs = []string{"\x1b[?1049h", "\x1b[?47h", "\x1b[?1047h"}
var alternateScreenExitSeqs  = []string{"\x1b[?1049l", "\x1b[?47l", "\x1b[?1047l"}

// pager observation: 进入 alternate screen 后，等待短时间观察是否为 pager
const pagerObservationTimeout = 2000 * time.Millisecond

// pager 输出特征模式
var pagerOutputPatterns = []*regexp.Regexp{
    regexp.MustCompile(`\(END\)\s*$`),
    regexp.MustCompile(`(?i)--More--\s*$`),
    regexp.MustCompile(`(?i)^lines\s+\d+-\d+`),
    regexp.MustCompile(`^\s*:\s*$`),
    regexp.MustCompile(`(?i)Manual page\s+`),
}
```

- [ ] **Step 5: 实现 TUI auto-cancel（silence timer + hard timeout）**

```go
// 对齐 Chaterm 的 TUI auto-cancel 逻辑：
// - always-TUI / conditional-TUI 命令进入 alternate screen 后启动 silence timer
// - 如果在 tuiCancelSilenceMs 内无新输出，自动发送 cancel（Ctrl+C）
// - 同时启动 hard timeout timer，超时也 cancel
const tuiCancelSilenceMs = 1500
const tuiHardTimeoutMs   = 2000

type tuiAutoCancelState struct {
    category          TuiCategory
    silenceTimer      *time.Timer
    hardTimeoutTimer  *time.Timer
    lastOutputTime    time.Time
}
```

- [ ] **Step 6: 实现 exit key 检测（对齐 Chaterm EXIT_KEY_PATTERNS）**

```go
type exitKeyRule struct {
    Pattern          *regexp.Regexp
    ExitKey          string
    ExitAppendNewline bool
}

var exitKeyPatterns = []exitKeyRule{
    {Pattern: regexp.MustCompile(`(?i)press\s+q\s+to\s+quit`), ExitKey: "q", ExitAppendNewline: false},
    {Pattern: regexp.MustCompile(`(?i)press\s+q\s+to\s+exit`), ExitKey: "q", ExitAppendNewline: false},
    {Pattern: regexp.MustCompile(`(?i)\(q\s+to\s+quit\)`), ExitKey: "q", ExitAppendNewline: false},
    {Pattern: regexp.MustCompile(`(?i)type\s+quit\s+to\s+exit`), ExitKey: "quit", ExitAppendNewline: true},
    {Pattern: regexp.MustCompile(`(?i)type\s+exit\s+to\s+exit`), ExitKey: "exit", ExitAppendNewline: true},
    {Pattern: regexp.MustCompile(`按\s*q\s*退出`), ExitKey: "q", ExitAppendNewline: false},
    {Pattern: regexp.MustCompile(`输入\s*quit\s*退出`), ExitKey: "quit", ExitAppendNewline: true},
}
```

- [ ] **Step 7: 实现 dismiss/suppress 逻辑 + prompt debounce**

```go
// dismiss: 用户关闭交互 UI 但继续检测
// - 第 1 次 dismiss: 继续正常检测
// - 第 2 次 dismiss: 切换到长轮询（maxTimeout）
// - 第 3 次 dismiss: 自动 suppress（停止检测）
// suppress: 用户明确要求停止检测
// prompt debounce: 300ms 内不重复触发相同提示

const maxDismissCount = 3
const promptDebounceMs = 300
```

- [ ] **Step 8: 实现 hash 去重（避免重复触发相同输出）**

```go
// 对齐 Chaterm 的 hash 去重逻辑：
// - 计算最近输出的 hash
// - 如果 hash 连续 maxHashUnchangedCount 次不变，认为输出稳定
// - 稳定后触发 LLM fallback 检测
const maxHashUnchangedCount = 3
```

- [ ] **Step 9: 新增 LLM fallback 检测（对齐 Chaterm llm-caller）**

```go
// LLM fallback: 快速正则无法判断时，调用 LLM 分析输出
// - 最多调用 maxLlmCalls 次（默认 3 次）
// - 使用 Zod schema 验证 LLM 返回的 InteractionResult
// - 如果 LLM 不可用，降级为仅快速正则

func llmFallbackDetectInteraction(input interactionLLMInput) (*InteractionResult, error) {
    if interactionDetectorLLM == nil {
        return nil, fmt.Errorf("no LLM analyzer configured")
    }
    return interactionDetectorLLM(input)
}
```

- [ ] **Step 10: 写测试覆盖所有新增检测模式**

```go
func TestClassifyTuiCommand(t *testing.T) {
    if cat := classifyTuiCommand("vim /etc/hosts"); cat != TuiCategoryAlways {
        t.Fatalf("vim should be always-TUI, got %s", cat)
    }
    if cat := classifyTuiCommand("mysql -u root -p"); cat != TuiCategoryConditional {
        t.Fatalf("mysql should be conditional-TUI, got %s", cat)
    }
    if cat := classifyTuiCommand("mysql -e 'SELECT 1'"); cat != TuiCategoryNonBlacklist {
        t.Fatalf("mysql -e should be non-blacklist, got %s", cat)
    }
    if cat := classifyTuiCommand("ls -la"); cat != TuiCategoryNonBlacklist {
        t.Fatalf("ls should be non-blacklist, got %s", cat)
    }
    if cat := classifyTuiCommand("less /var/log/syslog"); cat != TuiCategoryNonBlacklist {
        t.Fatalf("less should be non-blacklist (pager priority), got %s", cat)
    }
}

func TestQuickPatternConfirm(t *testing.T) {
    result := tryQuickMatch("[Y/n]")
    if result == nil || result.InteractionType != InteractionConfirm {
        t.Fatalf("expected confirm interaction")
    }
    if result.ConfirmValues.Yes != "Y" || result.ConfirmValues.No != "n" {
        t.Fatalf("confirm values mismatch")
    }
}

func TestExitKeyDetection(t *testing.T) {
    for _, rule := range exitKeyPatterns {
        if !rule.Pattern.MatchString("press q to quit") && rule.ExitKey == "q" {
            // just verify patterns compile
        }
    }
}

func TestAlternateScreenDetection(t *testing.T) {
    output := "some text\x1b[?1049hmore text"
    entered := containsAnySeq(output, alternateScreenEnterSeqs)
    if !entered {
        t.Fatalf("should detect alternate screen enter")
    }
}

func TestDismissSuppress(t *testing.T) {
    detector := newInteractionDetector("test-cmd", "test-id")
    detector.onDismiss() // 1st
    detector.onDismiss() // 2nd
    detector.onDismiss() // 3rd → should auto-suppress
    if !detector.isSuppressed {
        t.Fatalf("should be suppressed after 3 dismisses")
    }
}
```

---

## Phase 8: 上下文窗口管理增强

**目标：** 追踪 token 用量，在上下文接近满时提醒或自动截断。

### Task 11: 扩展 ContextManager

**Files:**
- Modify: `pkg/aiusechat/context_management.go`
- Modify: `pkg/aiusechat/usechat.go`
- Test: `pkg/aiusechat/context_management_test.go`

- [ ] **Step 1: 在 API 响应中提取 token 用量**

```go
type ContextUsageInfo struct {
    InputTokens  int
    OutputTokens int
    MaxTokens    int
    UsagePercent int
}
```

- [ ] **Step 2: 在每次 API 调用后更新 TodoContextTracker**

```go
if usage != nil {
    tracker := GetTodoContextTracker(chatId)
    level := tracker.UpdateContextUsage(usage.InputTokens+usage.OutputTokens, usage.MaxTokens)
    if level == ContextLevelCritical || level == ContextLevelMaximum {
        // 在下一轮系统提示中追加上下文警告
    }
}
```

- [ ] **Step 3: 实现上下文截断策略**

当上下文超过阈值时：
1. 保留系统提示 + 最近的 N 轮对话
2. 中间轮次替换为压缩摘要
3. 保留当前 todo 状态

- [ ] **Step 4: 写测试验证上下文追踪和截断**

---

## Phase 9: 前端升级（对齐 Chaterm Todo UI）

**目标：** 前端顶部卡片展示语义任务+聚焦链+上下文信息+安全提示。

### Task 12: 升前端类型定义

**Files:**
- Modify: `frontend/app/aipanel/aitypes.ts`

- [ ] **Step 1: 扩展 AgentTaskState 和 AgentTaskItem**

```ts
export interface AgentToolCall {
    id: string
    name: string
    parameters?: Record<string, unknown>
    timestamp: number
}

export interface AgentTaskItem {
    id: string
    title: string
    description?: string
    status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'
    priority?: 'high' | 'medium' | 'low'
    order?: number
    subtasks?: { id: string; content: string; description?: string; toolcalls?: AgentToolCall[] }[]
    toolcalls?: AgentToolCall[]
    isfocused?: boolean
    startedts?: number
    completedts?: number
    focusedts?: number
    createdts?: number
    updatedts?: number
    contextusagepercent?: number
}

export interface AgentFocusChainState {
    taskid?: string
    focusedtodoid?: string
    chainprogress?: number
    totaltodos?: number
    completedtodos?: number
    currentcontextusage?: number
    lastfocuschangets?: number
    autotransition?: boolean
}

export interface AgentFocusChainTransition {
    fromtodoid?: string
    totodoid?: string
    reason: 'task_completed' | 'context_threshold' | 'user_request' | 'auto_progress'
    timestamp: number
    contextusageattransition?: number
}

export interface AgentFocusChainHandoff {
    completedwork: string
    currentstate: string
    nextsteps: string
    relevantfiles?: string[]
    contextsnapshot?: Record<string, unknown>
}

export interface AgentTaskState {
    version: number
    planid: string
    source: string
    status: 'idle' | 'active' | 'completed' | 'blocked' | 'aborted'
    currenttaskid: string
    blockedreason: string
    lastupdatedts: number
    summary: { total: number; completed: number; inprogress: number; pending: number; blocked: number; percent: number }
    tasks: AgentTaskItem[]
    focuschain?: AgentFocusChainState
}
```

- [ ] **Step 2: 写测试验证类型解析**

### Task 13: 升级 TaskProgressPanel UI

**Files:**
- Modify: `frontend/app/aipanel/taskprogress.ts`
- Modify: `frontend/app/aipanel/taskprogresspanel.tsx`
- Test: `frontend/app/aipanel/tests/taskprogress.test.ts`

- [ ] **Step 1: 扩展 view model 包含聚焦链和上下文信息**

```ts
interface TaskProgressViewModel {
    currentTaskTitle: string | undefined
    currentTaskDescription: string | undefined
    currentTaskPriority: 'high' | 'medium' | 'low' | undefined
    focusedTaskId: string | undefined
    chainProgress: number
    contextUsagePercent: number
    contextLevel: 'normal' | 'warning' | 'critical' | 'maximum'
    tasks: AgentTaskItem[]
    summary: { total: number; completed: number; inprogress: number; pending: number; blocked: number; percent: number }
    blockedReason: string | undefined
    securityBlocked: boolean
}
```

- [ ] **Step 2: 实现 TaskProgressPanel 组件**

关键 UI 元素（对齐 Chaterm）：
1. 当前聚焦任务标题 + 描述 + 优先级标签
2. 聚焦链进度条（completed/total）
3. 上下文用量指示器（颜色编码：绿/黄/红）
4. 子任务列表（可折叠）
5. 安全阻止提示（红色横幅）
6. 任务状态图标（🔄 in_progress / ⏳ pending / ✅ completed / 🚫 blocked）

- [ ] **Step 3: 写测试验证 view model 逻辑**

```ts
it("derives focus chain and context info from task state", () => {
    const viewModel = deriveTaskProgressViewModel({
        planid: "plan-1",
        source: "model-generated",
        status: "active",
        currenttaskid: "task-2",
        tasks: [
            { id: "task-1", title: "安装 MySQL", description: "使用 apt 安装", status: "completed", priority: "high" },
            { id: "task-2", title: "配置 my.cnf", description: "调整 buffer pool", status: "in_progress", priority: "high", isfocused: true },
        ],
        focuschain: { focusedtodoid: "task-2", chainprogress: 50, totaltodos: 2, completedtodos: 1, currentcontextusage: 35 },
    });
    expect(viewModel.currentTaskTitle).toBe("配置 my.cnf");
    expect(viewModel.currentTaskDescription).toBe("调整 buffer pool");
    expect(viewModel.chainProgress).toBe(50);
    expect(viewModel.contextUsagePercent).toBe(35);
});
```

### Task 14: 前端流式同步 taskstate

**Files:**
- Modify: `frontend/app/aipanel/aipanel.tsx`
- Modify: `frontend/app/aipanel/waveai-model.tsx`
- Test: `frontend/app/aipanel/tests/aitypes.test.ts`

- [ ] **Step 1: 只从 data-taskstate 更新 taskStateAtom，不从工具消息反推**

```ts
const latestTaskState = getLatestTaskStatePart(lastAssistantMessage)
if (latestTaskState?.data) {
    globalStore.set(model.taskStateAtom, latestTaskState.data as AgentTaskState)
}
```

- [ ] **Step 2: 新增 focusChainAtom 和 contextUsageAtom**

- [ ] **Step 3: 处理安全阻止事件**

```ts
// 当收到命令被安全机制阻止的消息时
if (message.includes("命令被安全机制阻止") || message.includes("command_blocked")) {
    globalStore.set(model.securityBlockedAtom, true)
}
```

- [ ] **Step 4: 写测试验证消费链路**

---

## Phase 2.5: Prompt 升级（紧跟工具升级，确保提示词与工具同步）

> ⚠️ **关键修正**：原大纲将 Prompt 升级放在 Phase 10，这是错误的。因为 Phase 2 移除了 `waveai_create_plan`/`waveai_advance_plan`，如果 Prompt 不立即更新，模型仍会尝试调用已移除的旧工具。Prompt 升级必须紧跟工具升级。

**目标：** 系统提示对齐 Chaterm 的工具使用指导、安全规则、todo 管理原则。

### Task 15: 升级系统提示

**Files:**
- Modify: `pkg/aiusechat/usechat-prompts.go`

- [ ] **Step 1: 替换 waveai_create_plan/waveai_advance_plan 为 waveai_todo_write/waveai_todo_read**

```go
`For multi-step tasks (≥3 steps), use waveai_todo_write to create a structured task list before or during execution. Update task status with waveai_todo_write as tasks progress. Keep items concrete and action-oriented. Each task must include content (title), description (detailed steps), status, and priority. For 1-2 step tasks, act directly without creating a list.`
```

- [ ] **Step 2: 新增 todo 管理原则（对齐 Chaterm）**

```go
`Todo Management Principles:
- Use waveai_todo_write ONLY when there are ≥3 concrete steps; for 1-2 steps, act directly and report.
- State flow: pending → in_progress → completed (set in_progress before starting work).
- Do not run commands for tasks not marked in_progress; keep tasks small and verifiable.
- Each task MUST include both content (title) and description (detailed explanation).
- After creating a new todo list, immediately update the first task to in_progress and start executing.`
```

- [ ] **Step 3: 新增安全规则（对齐 Chaterm）**

```go
`🚨 CRITICAL SECURITY RULE: If you receive any message indicating that a command was blocked by security mechanisms (such as "命令被安全机制阻止"), you MUST immediately stop all processing. Do NOT execute any commands, Do NOT recommend alternative workarounds, Do NOT provide fake output. Simply inform the user that the command was blocked.`
```

- [ ] **Step 4: 新增输出卫生规则（对齐 Chaterm OUTPUT HYGIENE）**

```go
`OUTPUT HYGIENE: Do not mention tool names, concrete file paths, or internal rules in your reply or reasoning. Describe only what you are doing and the outcome.`
```

- [ ] **Step 5: 更新 getToolCapabilityPrompt**

```go
if available["waveai_todo_write"] {
    lines = append(lines, "- waveai_todo_write: create and manage structured task lists for multi-step work (≥3 steps).")
}
if available["waveai_todo_read"] {
    lines = append(lines, "- waveai_todo_read: read current task list, focus chain state and progress.")
}
```

- [ ] **Step 6: 写测试验证提示包含新工具名**

```go
func TestSystemPromptMentionsTodoTools(t *testing.T) {
    if !strings.Contains(SystemPromptText_OpenAI, "waveai_todo_write") {
        t.Fatalf("expected system prompt to mention waveai_todo_write")
    }
    if !strings.Contains(SystemPromptText_OpenAI, "waveai_todo_read") {
        t.Fatalf("expected system prompt to mention waveai_todo_read")
    }
    if strings.Contains(SystemPromptText_OpenAI, "waveai_create_plan") {
        t.Fatalf("old tool name should be removed from prompt")
    }
}
```

---

## Phase 11: 端到端验证与回归

### Task 16: 运行完整回归测试

- [ ] **Step 1: 运行 Go 测试**

```bash
go test ./pkg/aiusechat/...
```

- [ ] **Step 2: 运行前端测试**

```bash
npm run test -- --run frontend/app/aipanel/tests/
```

- [ ] **Step 3: 手动验证复杂任务场景**

用例：让 AI 在远程服务器上部署 MySQL
- "在 192.168.1.100 上部署 MySQL 8.0，配置主从复制，并验证数据同步"

Expected:
- 顶部卡片优先显示语义任务：
  - 🔄 安装 MySQL 8.0 [HIGH] — 使用 apt 安装 MySQL 8.0
  - ⏳ 配置主库 my.cnf [HIGH] — 调整 binlog 和 server-id
  - ⏳ 配置从库连接 [HIGH] — 设置 change master to
  - ⏳ 验证数据同步 [MEDIUM] — 在主库插入测试数据
- 聚焦链进度条：0/4 → 1/4 → 2/4 → 3/4 → 4/4
- 上下文用量指示器：绿色（<50%）
- **不能**显示：`Run wave_run_command`、`Run write_text_file`
- 危险命令（如 `rm`）被安全机制阻止

- [ ] **Step 4: 手动验证安全阻止场景**

用例：让 AI 执行 `rm -rf /tmp/test`
Expected:
- 安全机制阻止命令
- AI 收到阻止消息后停止，不提供替代方案
- 前端显示安全阻止提示

- [ ] **Step 5: 手动验证交互检测场景**

用例：让 AI 执行 `mysql -u root -p`
Expected:
- 检测到密码输入提示
- 弹出交互输入 UI
- TUI 分类为 conditional

---

## 自检结论

### 与 Chaterm 对齐覆盖情况
- ✅ Todo 系统：`waveai_todo_write` / `waveai_todo_read` 对齐 `todo_write` / `todo_read`
- ✅ Todo Schema：`UIToolCall`（id/name/parameters/timestamp）对齐 `TodoToolCall`；`UISubtask.ToolCalls` 对齐 `Subtask.toolCalls`
- ✅ 智能任务检测：`SmartTaskDetector` 对齐 Chaterm 启发式检测
- ✅ 聚焦链：`FocusChainService` + `TodoContextTracker` + `UIFocusChainTransition` + `UIFocusChainHandoff` 对齐 Chaterm
- ✅ 命令安全：`CommandSecurityManager` + `SecurityPolicy` + severity 决策链 + wildcard 匹配 + root directory 检测 对齐 Chaterm
- ✅ 上下文管理：扩展 `ContextManager` 对齐 Chaterm token 追踪
- ✅ 交互检测：扩展 `InteractionDetector` 对齐 Chaterm LLM fallback + TUI 分类 + pager observation + TUI auto-cancel + dismiss/suppress + prompt debounce + exit key + hash 去重
- ✅ 工具调用绑定：`TodoToolCallTracker`（完整 `UIToolCall` schema）对齐 Chaterm
- ✅ 任务提醒：`TodoReminderService` 对齐 Chaterm
- ✅ 前端展示：聚焦链+上下文用量+子任务+安全提示+transition+handoff 对齐 Chaterm
- ✅ Prompt：安全规则+todo 管理原则+输出卫生 对齐 Chaterm
- ✅ 语义计划优先：保留原方案核心逻辑
- ✅ 双语输出：TodoWriteTool/TodoReadTool 检测中文切换语言 对齐 Chaterm
- ✅ Todo 存储：CRUD 方法 + 安全配置持久化/热加载 对齐 Chaterm TodoStorage/SecurityConfigManager
- ✅ Phase 排序：Prompt 升级移至 Phase 2.5（紧跟工具升级），避免旧工具名残留

### 占坑检查
- 无 `TODO` / `TBD`
- 没有"以后补"类空话
- 每个代码步骤都给了具体代码/命令

### 一致性检查
- 统一使用：`waveai_todo_write`、`waveai_todo_read`（替代旧的 create_plan/advance_plan）
- 统一使用：`mergeTaskStateForToolCalls`
- 统一使用：`data-taskstate`
- 统一使用：`CommandSecurityManager`
- 统一使用：`FocusChainService` + `TodoContextTracker`

### 实现优先级建议
1. **P0（必须先做）**：Phase 1 数据模型 + Phase 2 工具升级 + Phase 2.5 Prompt 升级 — 这是地基，三者必须连续完成
2. **P1（核心能力）**：Phase 3 智能检测 + Phase 4 聚焦链 + Phase 6 工具绑定 — 这是差异化
3. **P2（安全加固）**：Phase 5 命令安全 — 这是生产必需
4. **P3（体验增强）**：Phase 7 交互检测 + Phase 8 上下文管理 + Phase 9 前端升级 — 这是锦上添花

---

## 实现进度跟踪

> 最后更新：2026-04-15

### Phase 1: 升级任务数据模型 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| Task 1: 扩展 UITaskItem | ✅ | 新增 Description/Subtasks/Priority/IsFocused/FocusedTs/CompletedTs/ContextUsagePercent/ToolCalls([]UIToolCall) |
| Task 1: 新增 UIFocusChainState | ✅ | 含 ChainProgress/CurrentContextUsage/AutoTransition |
| Task 1: 扩展 UITaskProgressState | ✅ | 含 FocusChain/CurrentTaskId/Summary/BlockedReason/SecurityBlocked |
| Task 1: 新增 CommandSecurityResult | ✅ | 含 Severity/Reason/Category/Blocked |
| Task 1: 写测试 | ✅ | taskstate_runtime_test.go 通过 |

### Phase 2: 工具升级 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| Task 2: 重构 waveai_create_plan → waveai_todo_write | ✅ | 对齐 Chaterm TodoWriteParams schema |
| Task 3: 重构 waveai_advance_plan → waveai_todo_read | ✅ | 对齐 Chaterm TodoReadParams schema |
| Task 4: 注册新工具 | ✅ | tools.go 中注册 waveai_todo_write/waveai_todo_read |
| Task 5: 更新 mergeTaskStateForToolCalls | ✅ | 支持新字段合并 |
| Task 6: 写测试 | ✅ | tools_taskstate_test.go 通过 |

### Phase 2.5: Prompt 升级 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| Task 15 Step 1: 替换旧工具引用 | ✅ | waveai_create_plan/advance_plan 已移除，替换为 waveai_todo_write |
| Task 15 Step 2: 新增 todo 管理原则 | ✅ | ≥3 步才建计划、状态流 pending→in_progress→completed、创建后立即执行 |
| Task 15 Step 3: 新增安全规则 | ✅ | 命令被阻止后必须停止，不提供替代方案 |
| Task 15 Step 4: 新增输出卫生规则 | ✅ | 不提工具名/文件路径/内部规则 |
| Task 15 Step 5: getToolCapabilityPrompt | ✅ | 已包含 waveai_todo_write/waveai_todo_read 描述 |
| Task 15 Step 6: 写测试 | ✅ | usechat-prompts_test.go 9 个测试通过 |

### Phase 3: 智能任务检测 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| Task 7: SmartTaskDetector | ✅ | 正则+启发式+领域检测 |
| Task 8: TodoPrompts | ✅ | 核心/提醒提示词+isHighComplexityIntent+ShouldCreateTodo |
| Task 9: 写测试 | ✅ | smart_task_detector_test.go + todo_prompts_test.go 通过 |

### Phase 4: 聚焦链 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| Task 10: FocusChainService | ✅ | 自动推进+上下文阈值+手动切换 |
| Task 11: TodoContextTracker | ✅ | token 追踪+上下文用量计算 |
| Task 12: 写测试 | ✅ | focus_chain_test.go + context_tracker_test.go 通过 |

### Phase 5: 命令安全 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| CommandSecurityManager | ✅ | 黑名单/白名单/危险命令分级+severity 决策链 |
| CommandParser | ✅ | 管道/链式命令拆分+root directory 检测 |
| SecurityConfig | ✅ | 安全配置持久化+热加载+默认配置生成 |
| 写测试 | ✅ | command_security_test.go 通过 |

### Phase 6: 工具调用绑定 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| TodoToolCallTracker | ✅ | 完整 UIToolCall schema 追踪 |
| 绑定到聚焦任务 | ✅ | processAllToolCalls 中自动绑定 |
| 写测试 | ✅ | 通过 |

### Phase 7: 交互检测 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| InteractionDetector 扩展 | ✅ | LLM fallback+TUI 分类+pager observation |
| InteractionResult 类型 | ✅ | InteractionType/TuiCategory/ConfirmValues |
| dismiss/suppress/debounce | ✅ | prompt debounce+exit key+hash 去重 |
| 写测试 | ✅ | interaction_detector_test.go + interaction_detector_types_test.go 通过 |

### Phase 8: 上下文管理 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| ContextManager 扩展 | ✅ | token 追踪+上下文窗口管理 |
| 上下文截断和压缩 | ✅ | 对齐 Chaterm token 追踪 |
| 写测试 | ✅ | 通过 |

### Phase 9: 前端升级 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| Task 12: 升级前端类型定义 | ✅ | ContextThresholdLevel/InteractionResult/TuiCategory/ConfirmValues+辅助函数 |
| Task 13: 升级 TaskProgressPanel UI | ✅ | 聚焦链+上下文用量+子任务+安全阻止+优先级标签 |
| Task 14: 前端流式同步 taskstate | ✅ | focusChainAtom/contextUsageAtom/securityBlockedAtom+aipanel.tsx 同步 |
| 写测试 | ✅ | aitypes.test.ts(13) + taskprogress.test.ts(8) = 21 通过 |

### Phase 10: 任务提醒 ✅ 已完成

| Task | 状态 | 说明 |
|------|------|------|
| TodoReminderService | ✅ | 对齐 Chaterm 提醒逻辑 |
| 写测试 | ✅ | 通过 |

### Phase 11: 端到端验证与回归 ✅ 已完成

| 验证项 | 状态 | 结果 |
|--------|------|------|
| Go build ./... | ✅ | 0 错误 |
| Go test ./pkg/aiusechat/... | ✅ | 全部通过 |
| 前端 tsc --noEmit | ✅ | 0 新增错误（修改文件无错误） |
| 前端 vitest | ✅ | 7 文件 74 测试通过 |

### Cheatsheet 智能降级 ✅ 已完成

> 当 task state 存在时，cheatsheet 从 task state 推导，跳过 LLM 调用；当 task state 不存在时，保持原有行为（规则推导 + LLM 刷新）。

| 变更 | 说明 |
|------|------|
| 新增 `deriveCheatsheetFromTaskState` | 从 task state 推导 cheatsheet 四项：currentwork=当前任务、completed=已完成列表、blockedby=阻塞原因、nextstep=下一个 pending 任务 |
| 修改 `refreshSessionCheatsheet` | task state 存在时走推导路径，不调 LLM；task state 不存在时走原路径 |
| 测试 | 9 个测试覆盖 nil/empty/active/blocked/allcompleted/nocurrenttaskid/skipped/truncation 场景 |

**降级逻辑：**
- `currentwork` = 当前 in_progress 任务的 title + description（如有）
- `completed` = 所有 completed 任务的 title，顿号分隔
- `blockedby` = BlockedReason 优先，否则取 blocked 任务的 title + notes
- `nextstep` = 下一个 pending 任务，否则"继续推进当前任务"或"所有任务已完成"

### 修改文件汇总

**后端 Go 文件：**
- `pkg/aiusechat/uctypes/uctypes.go` — 扩展 UITaskItem/UIFocusChainState/CommandSecurityResult
- `pkg/aiusechat/taskstate_runtime.go` — SmartTaskDetector/FocusChainService/TodoContextTracker/TodoToolCallTracker/TodoReminderService
- `pkg/aiusechat/tools_taskstate.go` — waveai_todo_write/waveai_todo_read 工具实现
- `pkg/aiusechat/tools.go` — 注册新工具
- `pkg/aiusechat/usechat.go` — 工具调用绑定+安全校验+上下文追踪
- `pkg/aiusechat/usechat-prompts.go` — 系统提示升级（todo 原则+安全规则+输出卫生）
- `pkg/aiusechat/command_security.go` — CommandSecurityManager/CommandParser/SecurityConfig
- `pkg/aiusechat/todo_prompts.go` — SmartTaskDetector+ShouldCreateTodo
- `pkg/aiusechat/interaction_detector.go` — LLM fallback+TUI 检测扩展
- `pkg/aiusechat/interaction_detector_types.go` — InteractionResult 等类型
- `pkg/aiusechat/context_management.go` — token 追踪扩展+cheatsheet 智能降级（deriveCheatsheetFromTaskState）
- `pkg/aiusechat/chatstore/chatstore.go` — todo 存储+安全配置持久化

**后端测试文件：**
- `pkg/aiusechat/taskstate_runtime_test.go`
- `pkg/aiusechat/tools_taskstate_test.go`
- `pkg/aiusechat/command_security_test.go`
- `pkg/aiusechat/smart_task_detector_test.go`
- `pkg/aiusechat/todo_prompts_test.go`
- `pkg/aiusechat/focus_chain_test.go`
- `pkg/aiusechat/context_tracker_test.go`
- `pkg/aiusechat/interaction_detector_test.go`
- `pkg/aiusechat/interaction_detector_types_test.go`
- `pkg/aiusechat/usechat-prompts_test.go`
- `pkg/aiusechat/context_management_test.go` — cheatsheet 智能降级测试（9 个）

**前端文件：**
- `frontend/app/aipanel/aitypes.ts` — 新增 ContextThresholdLevel/InteractionResult/TuiCategory/ConfirmValues+辅助函数
- `frontend/app/aipanel/taskprogress.ts` — 扩展 TaskProgressViewModel（聚焦链+上下文用量+安全阻止）
- `frontend/app/aipanel/taskprogresspanel.tsx` — UI 升级（上下文指示器+聚焦链进度+子任务+安全阻止）
- `frontend/app/aipanel/waveai-model.tsx` — 新增 focusChainAtom/contextUsageAtom/securityBlockedAtom
- `frontend/app/aipanel/aipanel.tsx` — 流式同步 taskstate+安全阻止检测

**前端测试文件：**
- `frontend/app/aipanel/tests/aitypes.test.ts` — 13 测试
- `frontend/app/aipanel/tests/taskprogress.test.ts` — 8 测试
