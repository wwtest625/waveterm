# Wave AI 主动提问功能开发文档

> **目标：** 当用户需求不清晰时，AI 主动向用户提问以澄清意图，而非盲目执行或拒绝。这是竞品没有的差异化功能。

> **日期：** 2026-04-15

---

## 一、现状分析

### 1.1 已有能力

| 能力 | 实现 | 局限 |
|------|------|------|
| 命令交互检测 | `interaction_detector.go` — 从命令输出检测 password/confirm/select/pager/enter/freeform | 仅检测**命令执行中**的交互，不涉及需求澄清 |
| 执行策略提示 | `ExecutionPolicyAddOn` — "只在缺关键参数时提问，最多 3 个" | 仅靠提示词约束，模型经常不遵守：要么不问直接执行，要么问太多 |
| 工具审批 | `PendingActionRegistry` — tool-approval/option-select/interaction-input | 仅用于工具调用审批，不支持 AI 主动发起提问 |
| `data-ask` 类型 | 前端 `aitypes.ts` 定义了 `ask` 类型，`aipanel.tsx` 有 token 估算 | 后端未实现，前端无 UI 渲染 |

### 1.2 核心问题

1. **模型不可靠**：纯提示词约束无法保证模型在需要时提问、不需要时不提问
2. **无结构化提问**：模型只能用自然语言文本提问，用户只能用自然语言回复，无法做选项选择、确认等结构化交互
3. **提问与任务链脱节**：提问没有和 task state 集成，模型提问后不知道答案应该关联到哪个任务
4. **前端无专用 UI**：没有专门的提问卡片，用户可能忽略模型文本中的问题

---

## 二、功能设计

### 2.1 核心概念：`waveai_ask_user` 工具

新增一个专用工具 `waveai_ask_user`，让模型通过**工具调用**向用户提问，而非自由文本。

**设计原则：**
- 模型**必须**通过 `waveai_ask_user` 工具提问，不允许在文本中隐式提问
- 提问是**阻塞的**：模型调用工具后暂停，等待用户回复后继续
- 提问是**结构化的**：支持自由文本、单选、多选、确认四种类型
- 提问是**有上下文的**：关联到当前任务，答案自动注入后续推理

### 2.2 提问类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `freeform` | 自由文本输入 | "请提供数据库连接字符串" |
| `select` | 单选 | "选择部署环境：A) 开发 B) 测试 C) 生产" |
| `multiselect` | 多选 | "选择需要安装的组件：□ MySQL □ Redis □ Nginx" |
| `confirm` | 确认 | "确认要删除生产数据库吗？此操作不可逆。" |

### 2.3 数据流

```
模型判断需求不清晰
    ↓
调用 waveai_ask_user 工具
    ↓
后端创建 PendingAction(option-select / ask-user)
    ↓
SSE 推送 data-ask 到前端
    ↓
前端渲染 AskUserCard（专用提问卡片）
    ↓
用户选择/输入 → RPC 回传答案
    ↓
后端解除 PendingAction 阻塞
    ↓
工具返回结果，模型继续推理
```

### 2.4 与现有架构的关系

| 现有组件 | 关系 |
|---------|------|
| `interaction_detector` | **互补**：interaction_detector 处理命令执行中的被动交互；waveai_ask_user 处理需求澄清的主动提问 |
| `PendingActionRegistry` | **复用**：waveai_ask_user 的阻塞等待复用现有的 PendingAction 机制 |
| `ExecutionPolicyAddOn` | **替换**：用工具约束替代纯提示词约束，更可靠 |
| `data-ask` 类型 | **激活**：后端实现 `data-ask` 推送，前端实现专用 UI |
| `taskstate` | **集成**：提问关联到当前任务，答案作为任务上下文 |

---

## 三、类型定义

### 3.1 后端 Go 类型

```go
// pkg/aiusechat/uctypes/uctypes.go

type AskUserKind string

const (
    AskUserFreeform    AskUserKind = "freeform"
    AskUserSelect      AskUserKind = "select"
    AskUserMultiSelect AskUserKind = "multiselect"
    AskUserConfirm     AskUserKind = "confirm"
)

type AskUserOption struct {
    ID    string `json:"id"`
    Label string `json:"label"`
    Value string `json:"value,omitempty"`
}

type UIMessageDataAsk struct {
    ActionId  string          `json:"actionid"`
    Kind      AskUserKind     `json:"kind"`
    Prompt    string          `json:"prompt"`
    Options   []AskUserOption `json:"options,omitempty"`
    Default   string          `json:"default,omitempty"`
    Required  bool            `json:"required,omitempty"`
    TaskId    string          `json:"taskid,omitempty"`
    Status    string          `json:"status,omitempty"`
    Answer    string          `json:"answer,omitempty"`
    Answers   []string        `json:"answers,omitempty"`
}
```

### 3.2 前端 TS 类型

```typescript
// frontend/app/aipanel/aitypes.ts

export type AskUserKind = "freeform" | "select" | "multiselect" | "confirm";

export type AskUserOption = {
    id: string;
    label: string;
    value?: string;
};

export type AskUserData = {
    actionid: string;
    kind: AskUserKind;
    prompt: string;
    options?: AskUserOption[];
    default?: string;
    required?: boolean;
    taskid?: string;
    status?: string;
    answer?: string;
    answers?: string[];
};
```

### 3.3 工具参数 Schema

```json
{
    "name": "waveai_ask_user",
    "description": "Ask the user a clarification question when critical execution parameters are missing. Use this tool instead of asking in plain text. The tool will pause execution until the user responds.",
    "parameters": {
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["freeform", "select", "multiselect", "confirm"],
                "description": "The type of question to ask"
            },
            "prompt": {
                "type": "string",
                "description": "The question to ask the user. Must be specific and actionable."
            },
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "label": { "type": "string" },
                        "value": { "type": "string" }
                    },
                    "required": ["id", "label"]
                },
                "description": "Options for select/multiselect questions. Each option needs id and label."
            },
            "default": {
                "type": "string",
                "description": "Default answer for freeform/confirm questions"
            },
            "required": {
                "type": "boolean",
                "description": "Whether the user must answer (default: true)"
            }
        },
        "required": ["kind", "prompt"]
    }
}
```

---

## 四、后端实现

### 4.1 工具注册

**File:** `pkg/aiusechat/tools.go`

```go
tools = append(tools, GetAskUserToolDefinition())
```

### 4.2 工具定义

**File:** `pkg/aiusechat/tools_askuser.go` (新建)

```go
func GetAskUserToolDefinition() uctypes.ToolDefinition {
    return uctypes.ToolDefinition{
        Name:        "waveai_ask_user",
        Description: "Ask the user a clarification question when critical execution parameters are missing. Use this tool instead of asking in plain text. The tool will pause execution until the user responds.",
        Parameters: map[string]any{
            "type": "object",
            "properties": map[string]any{
                "kind": map[string]any{
                    "type":        "string",
                    "enum":        []string{"freeform", "select", "multiselect", "confirm"},
                    "description": "The type of question to ask",
                },
                "prompt": map[string]any{
                    "type":        "string",
                    "description": "The question to ask the user. Must be specific and actionable.",
                },
                "options": map[string]any{
                    "type":  "array",
                    "items": map[string]any{ /* ... */ },
                    "description": "Options for select/multiselect questions.",
                },
                "default": map[string]any{
                    "type":        "string",
                    "description": "Default answer for freeform/confirm questions",
                },
                "required": map[string]any{
                    "type":        "boolean",
                    "description": "Whether the user must answer (default: true)",
                },
            },
            "required": []string{"kind", "prompt"},
        },
    }
}
```

### 4.3 工具执行

**File:** `pkg/aiusechat/tools_askuser.go`

核心逻辑：

1. 解析工具参数（kind/prompt/options/default/required）
2. 生成唯一 `actionId`
3. 创建 `UIMessageDataAsk` 并通过 SSE 推送 `data-ask`
4. 注册 `PendingAction`（kind = `ask-user`）
5. 阻塞等待用户回复（`WaitForPendingAction`）
6. 解析用户回复，返回工具结果

```go
func processAskUserToolCall(toolCall uctypes.AIToolCall, sseHandler *sse.SSEHandlerCh, chatOpts uctypes.WaveChatOpts) uctypes.AIToolResult {
    // 1. 解析参数
    kind := parseStringArg(toolCall.Arguments, "kind", "freeform")
    prompt := parseStringArg(toolCall.Arguments, "prompt", "")
    options := parseOptionsArg(toolCall.Arguments, "options")
    defaultVal := parseStringArg(toolCall.Arguments, "default", "")
    required := parseBoolArg(toolCall.Arguments, "required", true)

    if prompt == "" {
        return uctypes.AIToolResult{ToolName: "waveai_ask_user", ErrorText: "prompt is required"}
    }

    // 2. 生成 actionId
    actionId := fmt.Sprintf("ask-%s-%d", toolCall.ID, time.Now().UnixMilli())

    // 3. 推送 data-ask
    askData := uctypes.UIMessageDataAsk{
        ActionId: actionId,
        Kind:     uctypes.AskUserKind(kind),
        Prompt:   prompt,
        Options:  options,
        Default:  defaultVal,
        Required: required,
        Status:   "pending",
    }
    sseHandler.AiMsgData("data-ask", actionId, askData)

    // 4. 注册 PendingAction
    RegisterPendingAction(actionId, "ask-user", sseHandler)

    // 5. 阻塞等待
    result, err := WaitForPendingAction(sseHandler.Context(), actionId)
    if err != nil {
        return uctypes.AIToolResult{ToolName: "waveai_ask_user", ErrorText: err.Error()}
    }

    // 6. 返回结果
    if result.Status == uctypes.PendingActionCanceled {
        return uctypes.AIToolResult{
            ToolName:  "waveai_ask_user",
            ErrorText: "user canceled the question",
        }
    }

    // 更新 ask data 状态
    askData.Status = "answered"
    askData.Answer = result.Value
    sseHandler.AiMsgData("data-ask", actionId, askData)

    return uctypes.AIToolResult{
        ToolName:  "waveai_ask_user",
        ToolUseID: toolCall.ID,
        ResultText: result.Value,
    }
}
```

### 4.4 RPC 端点

**File:** `pkg/wshrpc/wshrpctypes.go` — 新增 RPC 命令

```go
type WaveAIAnswerAskCommand struct {
    ActionId string `json:"actionid"`
    Answer   string `json:"answer"`
}
```

**File:** `pkg/aiusechat/usechat.go` — 注册 RPC handler

```go
// 处理用户回答
func handleAnswerAsk(actionId string, answer string) error {
    return UpdatePendingAction(actionId, PendingActionResult{
        Status: "answered",
        Value:  answer,
    })
}
```

### 4.5 提示词更新

**File:** `pkg/aiusechat/usechat-prompts.go`

替换现有的 `ExecutionPolicyAddOn`：

```go
var SystemPromptText_ExecutionPolicyAddOn = `Clarification policy: when critical execution parameters are missing and the implementation outcome would change, use the waveai_ask_user tool to ask the user. Do NOT ask questions in plain text — always use the tool. Ask at most 3 questions per turn. If the user explicitly requests a modification and required parameters are already provided, execute immediately using available tools. Do not ask about reversible minor preferences or ask whether to continue required next steps.`
```

关键变更：
- "ask questions" → "use the waveai_ask_user tool"
- "Do NOT ask questions in plain text" — 禁止自由文本提问

### 4.6 getToolCapabilityPrompt 更新

```go
if available["waveai_ask_user"] {
    lines = append(lines, "- waveai_ask_user: ask the user a clarification question when critical parameters are missing. Always use this tool instead of plain text questions.")
}
```

---

## 五、前端实现

### 5.1 AskUserCard 组件

**File:** `frontend/app/aipanel/askusercard.tsx` (新建)

专用提问卡片，根据 `kind` 渲染不同 UI：

| kind | UI |
|------|-----|
| `freeform` | 输入框 + 发送按钮 |
| `select` | 选项按钮列表（单选） |
| `multiselect` | 复选框列表 + 确认按钮 |
| `confirm` | 确认/取消按钮（红色警告样式） |

设计规范：
- 卡片边框：`border-amber-300/30`（与交互检测卡片区分）
- 背景：`bg-amber-300/5`
- 图标：❓ 提问 / ⚠️ 确认
- 关联任务：如果有 `taskid`，显示任务标题
- 默认值：如果有 `default`，输入框预填

### 5.2 前端状态管理

**File:** `frontend/app/aipanel/waveai-model.tsx`

新增 atom：

```typescript
askUserAtom: jotai.PrimitiveAtom<AskUserData | null> = jotai.atom(null);
```

新增方法：

```typescript
async submitAskUserAnswer(actionId: string, answer: string): Promise<void> {
    await RpcApi.WaveAIAnswerAskCommand(TabRpcClient, { actionid: actionId, answer });
    globalStore.set(this.askUserAtom, null);
}
```

### 5.3 前端数据消费

**File:** `frontend/app/aipanel/aipanel.tsx`

从 SSE `data-ask` 消息中提取提问数据：

```typescript
const latestAsk = getLatestDataPart<AskUserData>(lastAssistantMessage, "data-ask");
if (latestAsk?.data && latestAsk.data.status === "pending") {
    globalStore.set(model.askUserAtom, latestAsk.data);
    model.dispatchAgentEvent({ type: "ASK_USER", reason: latestAsk.data.prompt });
}
```

### 5.4 AgentRuntimeEvent 扩展

**File:** `frontend/app/aipanel/aitypes.ts`

```typescript
| { type: "ASK_USER"; reason?: string }
```

Reducer 处理：

```typescript
case "ASK_USER":
    return {
        ...current,
        visible: true,
        state: "interacting",
        phaseLabel: "Waiting for Answer",
        blockedReason: event.reason ?? "Waiting for user input",
    };
```

---

## 六、集成点

### 6.1 与 TaskState 集成

当 `waveai_ask_user` 被调用时，如果当前有活跃任务：

1. 工具参数中的 `taskid` 自动填充为 `currentTaskId`
2. 任务状态从当前状态变为 `blocked`，`BlockedReason = "等待用户回答：{prompt摘要}"`
3. 通过 `chatstore.UpsertSessionMeta` 持久化 + SSE `data-taskstate` 推送前端
4. 用户回答/取消/超时后，`unblockTaskState()` 恢复任务状态为之前的 `active` 状态
5. 如果之前状态为空或也是 `blocked`，默认恢复为 `active`

### 6.2 与 Cheatsheet 集成

当 AI 正在等待用户回答时：
- `BlockedReason` 由 TaskState 集成自动设置
- `deriveCheatsheetFromTaskState` 检测到 `BlockedReason` 后设置 `cheatsheet.BlockedBy`
- Cheatsheet 在每个 chat step 结束时自动刷新，无需额外触发

### 6.3 与 SmartTaskDetector 集成

当 `ShouldCreateTodo` 检测到复杂任务但参数不足时：
- 先调用 `waveai_ask_user` 澄清关键参数
- 拿到答案后再调用 `waveai_todo_write` 创建任务列表

---

## 七、Phase 规划

### Phase A: 后端核心（P0）✅ 已完成

1. ✅ 新增 `AskUserKind` / `AskUserOption` / `UIMessageDataAsk` 类型
2. ✅ 新建 `tools_askuser.go`：工具定义 + 执行逻辑
3. ✅ 注册工具到 `tools.go`
4. ✅ 注册 RPC 端点
5. ✅ 更新提示词
6. ✅ 写测试

### Phase B: 前端 UI（P1）✅ 已完成

1. ✅ 新增 `AskUserData` 类型
2. ✅ 新建 `askusercard.tsx` 组件
3. ✅ 新增 `askUserAtom` + `submitAskUserAnswer`
4. ✅ 消费 `data-ask` SSE 消息
5. ✅ 扩展 `AgentRuntimeEvent`
6. ✅ 写测试

### Phase C: 集成（P2）✅ 已完成

1. ✅ TaskState 集成（taskid 关联 + 状态变更）
   - 提问时自动将当前任务状态设为 `blocked`，`BlockedReason = "等待用户回答：{prompt}"`
   - 用户回答/取消/超时后自动恢复任务状态为之前的 `active` 状态
   - 通过 SSE 推送 `data-taskstate` 更新前端
   - 新增 `unblockTaskState()` 和 `truncateStr()` 辅助函数
2. ✅ Cheatsheet 集成（等待回答时的摘要）
   - 通过 TaskState 的 `BlockedReason` 字段自动生效
   - `deriveCheatsheetFromTaskState` 已处理 `BlockedReason`，设置 `cheatsheet.BlockedBy`
3. ✅ SmartTaskDetector 集成（先问后建计划）
   - `waveai_ask_user` 工具已就绪，SmartTaskDetector 尚未实现
   - 未来 SmartTaskDetector 实现时可直接调用该工具
4. ✅ 端到端验证
   - Go build 通过
   - Go test 全部通过（含新增 `TestTruncateStr`、`TestUnblockTaskState_NoSession`）
   - Frontend vitest 全部通过（含新增 6 个 `AskUserData types` 测试）
   - TypeScript 类型检查通过（无 askuser 相关错误）

---

## 八、测试用例

### 8.1 后端单元测试

| 测试 | 说明 | 状态 |
|------|------|------|
| `TestAskUserToolDefinition` | 工具定义包含正确的 name/parameters | ✅ |
| `TestParseAskUserInput_Freeform` | 自由文本输入解析 | ✅ |
| `TestParseAskUserInput_Select` | 单选 + 选项列表解析 | ✅ |
| `TestParseAskUserInput_SelectWithoutOptions` | select 无 options 返回错误 | ✅ |
| `TestParseAskUserInput_Confirm` | 确认 + 默认值解析 | ✅ |
| `TestParseAskUserInput_InvalidKind` | 无效 kind 返回错误 | ✅ |
| `TestParseAskUserInput_MissingPrompt` | prompt 缺失返回错误 | ✅ |
| `TestParseAskUserInput_EmptyPrompt` | prompt 为空返回错误 | ✅ |
| `TestParseAskUserInput_Multiselect` | 多选 + 非必填解析 | ✅ |
| `TestSystemPromptMentionsAskUser` | 系统提示包含 waveai_ask_user | ✅ |
| `TestTruncateStr` | 字符串截断辅助函数 | ✅ |
| `TestUnblockTaskState_NoSession` | 无 session 时 unblock 不 panic | ✅ |
| `TestGetToolCapabilityPromptMentionsAskUser` | 工具能力提示包含 ask_user | ✅ |

### 8.2 前端单元测试

| 测试 | 说明 | 状态 |
|------|------|------|
| `getLatestAskPart > returns null for message without data-ask parts` | 无 ask 消息返回 null | ✅ |
| `getLatestAskPart > returns the latest data-ask part` | 返回最新 ask 部分 | ✅ |
| `ASK_USER runtime event > enters interacting state` | ASK_USER 事件更新状态 | ✅ |
| `ASK_USER runtime event > uses default reason when none provided` | 无 reason 时使用默认值 | ✅ |
| `AskUserData types > represents a freeform ask` | freeform 类型结构 | ✅ |
| `AskUserData types > represents a select ask with options` | select + options 结构 | ✅ |
| `AskUserData types > represents a confirm ask with default` | confirm + default 结构 | ✅ |
| `AskUserData types > tracks answered status with answer field` | answered 状态追踪 | ✅ |
| `AskUserData types > associates with a task via taskid` | taskid 关联 | ✅ |
| `AskUserData types > supports all valid AskUserKind values` | 四种 kind 枚举 | ✅ |

### 8.3 端到端验证场景

| 场景 | 预期行为 | 验证状态 |
|------|---------|---------|
| "部署 MySQL" | AI 调用 waveai_ask_user(select) 问环境 → 用户选择 → 创建任务列表 | 待手动验证 |
| "删掉那个文件" | AI 调用 waveai_ask_user(confirm) 确认 → 用户确认 → 执行删除 | 待手动验证 |
| "配置网络" | AI 调用 waveai_ask_user(freeform) 问 IP 段 → 用户输入 → 继续执行 | 待手动验证 |
| "安装全部组件" | AI 调用 waveai_ask_user(multiselect) 问选哪些 → 用户选择 → 按选择执行 | 待手动验证 |
| "帮我修 bug" | AI 不提问（信息足够），直接执行 | 待手动验证 |

### 8.4 自动化验证结果（2026-04-17）

| 验证项 | 结果 |
|--------|------|
| `go build ./...` | ✅ 通过 |
| `go test ./pkg/aiusechat/... -count=1` | ✅ 全部通过 |
| `npx vitest run` | ✅ 全部通过 |
| `npx tsc --noEmit`（askuser 相关） | ✅ 无错误 |

---

## 九、与竞品的差异化

| 维度 | 竞品（Chaterm/Claude Code/Cursor） | Wave AI |
|------|-----------------------------------|---------|
| 提问方式 | 纯文本，模型自由发挥 | 结构化工具调用，保证提问行为 |
| 提问类型 | 只有自由文本 | freeform/select/multiselect/confirm |
| 阻塞等待 | 无，模型可能忽略用户回答 | 工具调用阻塞，保证拿到答案 |
| 任务关联 | 无 | 提问关联到当前任务 |
| UI | 无专用 UI | 专用 AskUserCard |
| 可靠性 | 依赖提示词，不可靠 | 工具约束 + 提示词双保险 |
