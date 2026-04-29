# Warp AI 面板借鉴改进计划

> **目标：** 参考 Warp 开源项目的 AI Agent 面板设计，对 waveterm aipanel 进行增量改进，提升流式体验、状态模型完整性和信息丰富度。

> **日期：** 2026-04-28

> **参考项目：** [warpdotdev/warp](https://github.com/warpdotdev/warp) (Rust, AGPL v3)

---

## 一、Warp vs Waveterm 架构对比

| 维度 | Warp | Waveterm | 差距 |
|------|------|----------|------|
| **UI 框架** | 自研 `warpui_core` (Rust GPU 渲染) | React + Tailwind | 无可比性，各自适配 |
| **流式协议** | SSE + Protobuf (base64url 编码) | SSE + Vercel AI SDK Data Stream Protocol | 等价，waveterm 更轻量 |
| **流式状态模型** | `AIBlockOutputStatus`: Pending / PartiallyReceived / Complete / Cancelled / Failed | `status`: streaming / ready | **Warp 更精细** |
| **取消原因** | `CancellationReason`: ManuallyCancelled / FollowUpSubmitted / UserCommandExecuted / Reverted / Deleted | 无 | **Warp 更丰富** |
| **推理展示** | `Reasoning { text, finished_duration }` 带耗时 | `reasoning` part 仅文本 | **Warp 信息更丰富** |
| **流式视觉** | `ShimmeringTextElement` GPU 闪烁动画 | 无动画 | **Warp 体验更好** |
| **工具调用类型** | 30+ 种 `AIAgentActionType` | 5 种工具 | Warp 更全，但 waveterm 可扩展 |
| **Markdown 渲染** | 自研 `markdown_parser` (nom) + `FormattedTextElement` (GPU) | `WaveStreamdown` (JS, 支持不完整 Markdown) | 各有优劣 |
| **Mermaid 图表** | `MermaidDiagram` 原生支持 | 不支持 | **Warp 有此能力** |
| **消息结构** | `AIAgentOutputMessage` 含 id + citations | `WaveUIMessagePart` 含 type + data | 结构类似 |
| **partial 机制** | `PartiallyReceived` 状态 + `Shared<AIAgentOutput>` 并发安全 | `partial` 字段 (刚实现) | ✅ 已对齐 |

---

## 二、改进计划

### 🔴 P0 — Shimmering 动画（流式体验视觉提升）

**Warp 实现**：`ShimmeringTextElement` — 使用余弦波在文本上从左到右移动高亮带，通过 `GlyphIndex` 精确到每个字形控制闪烁强度。

**Waveterm 现状**：流式接收文本时无任何视觉反馈，用户无法区分"AI 正在思考"和"AI 已停止输出"。

**改进方案**：

#### 方案 A：CSS Shimmer 动画（推荐，低成本高收益）

在流式文本末尾添加一个 CSS shimmer 光标动画，模拟打字光标效果：

```tsx
// aipanelmessages.tsx - StreamingTextBlock 组件增强
const StreamingTextBlock = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
    return (
        <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <div className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400/50" />
            <div className="whitespace-pre-wrap break-words pl-2 text-[13px] leading-6 text-zinc-100">
                {text}
                {isStreaming && (
                    <span className="inline-block w-2 h-4 ml-0.5 bg-emerald-400/80 animate-pulse rounded-sm align-text-bottom" />
                )}
            </div>
        </div>
    );
});
```

#### 方案 B：Shimmer 渐变扫光（更接近 Warp）

```css
/* shimmer-gradient.css */
@keyframes shimmer-sweep {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

.shimmer-text {
    background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.08) 50%,
        transparent 100%
    );
    background-size: 200% 100%;
    animation: shimmer-sweep 2s ease-in-out infinite;
}
```

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/app/aipanel/aipanelmessages.tsx` | `StreamingTextBlock` 添加 shimmer 光标 |
| `frontend/app/aipanel/aitooluse.tsx` | 工具调用 running 状态添加 shimmer 加载文案 |
| `frontend/app/aipanel/agentstatus.tsx` | Agent 状态栏添加 shimmer 效果 |

#### 验收标准

- [ ] 流式文本接收时，末尾有可见的脉冲光标或扫光动画
- [ ] 工具调用 running 状态有 shimmer 加载指示
- [ ] 流式完成后动画停止，无残留

---

### 🟡 P1 — CancellationReason（取消原因更清晰）

**Warp 实现**：

```rust
pub enum CancellationReason {
    ManuallyCancelled,
    FollowUpSubmitted { is_for_same_conversation: bool },
    UserCommandExecuted,
    Reverted,
    Deleted,
}
```

**Waveterm 现状**：用户取消时仅显示 "stopped"，无法区分取消原因。

**改进方案**：

1. 后端 `UIMessageDataToolUse` 增加 `cancellationreason` 字段
2. 前端 `WaveUIDataTypes.tooluse` 增加 `cancellationreason` 字段
3. 渲染层根据不同原因显示不同文案

```typescript
// aitypes.ts
tooluse: {
    // ...existing fields
    cancellationreason?: "manual" | "follow_up" | "user_command" | "timeout" | "error";
};

// aitooluse.tsx - 状态文案映射
const cancellationMessages: Record<string, string> = {
    manual: "用户手动取消",
    follow_up: "用户提交了新的问题，当前回复已取消",
    user_command: "用户执行了终端命令，当前回复已取消",
    timeout: "响应超时，已自动取消",
    error: "发生错误，回复已中断",
};
```

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `pkg/aiusechat/uctypes/uctypes.go` | `UIMessageDataToolUse` 增加 `CancellationReason` |
| `pkg/aiusechat/usechat.go` | 取消时设置原因 |
| `frontend/app/aipanel/aitypes.ts` | `tooluse` 增加 `cancellationreason` |
| `frontend/app/aipanel/aitooluse.tsx` | 渲染取消原因文案 |

#### 验收标准

- [ ] 用户手动停止时显示"用户手动取消"
- [ ] 提交新问题时旧回复显示"用户提交了新的问题"
- [ ] 超时取消时显示"响应超时"

---

### 🟡 P1 — Reasoning 带耗时（推理过程信息更丰富）

**Warp 实现**：

```rust
AIAgentOutputMessageType::Reasoning {
    text: AIAgentText,
    finished_duration: Option<Duration>,
}
```

**Waveterm 现状**：`reasoning` part 仅有文本内容，无耗时信息。

**改进方案**：

1. 后端在 `reasoning` part 的 data 中增加 `durationms` 字段
2. 前端在推理折叠区域显示耗时

```typescript
// aitypes.ts - reasoning part 增加 duration
reasoning: {
    text: string;
    state: "streaming" | "done";
    durationms?: number;  // 新增
};

// aipanelmessages.tsx - 推理展示
const thinkingLabel = useMemo(() => {
    if (state.state === "streaming") return "思考中...";
    const duration = state.durationms;
    if (duration != null) {
        if (duration < 1000) return `思考完成 (${duration}ms)`;
        return `思考完成 (${(duration / 1000).toFixed(1)}s)`;
    }
    return "思考完成";
}, [state]);
```

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `pkg/web/sse/ssehandler.go` | `AiMsgReasoningEnd` 增加 duration 参数 |
| `pkg/aiusechat/openai/openai-backend.go` | 传递 reasoning 耗时 |
| `pkg/aiusechat/anthropic/anthropic-backend.go` | 传递 reasoning 耗时 |
| `frontend/app/aipanel/aitypes.ts` | reasoning part 增加 `durationms` |
| `frontend/app/aipanel/aipanelmessages.tsx` | 推理折叠区显示耗时 |

#### 验收标准

- [ ] 推理折叠区显示"思考完成 (2.3s)"
- [ ] 流式中显示"思考中..."
- [ ] 无耗时时仅显示"思考完成"

---

### 🟡 P1 — Cancelled 状态（状态模型更完整）

**Warp 实现**：

```rust
pub enum AIBlockOutputStatus {
    Pending,
    PartiallyReceived { output: Shared<AIAgentOutput> },
    Complete { output: Shared<AIAgentOutput> },
    Cancelled { partial_output: Option<Shared<AIAgentOutput>>, reason: CancellationReason },
    Failed { partial_output: Option<Shared<AIAgentOutput>>, error: RenderableAIError },
}
```

**Waveterm 现状**：`status` 仅有 `"pending" | "running" | "error" | "completed"`，无 `cancelled` 状态。取消后回退到 `error` 或直接消失。

**改进方案**：

1. 后端 `UIMessageDataToolUse.Status` 增加 `"cancelled"` 常量
2. 前端 `status` 联合类型增加 `"cancelled"`
3. 渲染层区分 cancelled 和 error 的视觉样式

```go
// uctypes.go
const (
    ToolUseStatusPending   = "pending"
    ToolUseStatusRunning   = "running"
    ToolUseStatusCompleted = "completed"
    ToolUseStatusError     = "error"
    ToolUseStatusCancelled = "cancelled"  // 新增
)
```

```typescript
// aitypes.ts
status: "pending" | "running" | "error" | "completed" | "cancelled";

// aipanelmessages.tsx - deriveToolUseStatus
if (part.data.status === "cancelled") {
    return "failed";  // cancelled 映射为 failed，但视觉样式不同
}
```

```tsx
// aitooluse.tsx - 取消状态样式
const statusIcon = toolData.status === "cancelled"
    ? "⊘"           // 取消图标
    : toolData.status === "error"
      ? "✗"
      : ...;
const statusColor = toolData.status === "cancelled"
    ? "text-zinc-400"  // 灰色，非红色
    : toolData.status === "error"
      ? "text-error"
      : ...;
```

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `pkg/aiusechat/uctypes/uctypes.go` | 增加 `ToolUseStatusCancelled` 常量 |
| `pkg/aiusechat/usechat.go` | 取消场景设置 `Status = "cancelled"` |
| `frontend/app/aipanel/aitypes.ts` | `status` 增加 `"cancelled"` |
| `frontend/app/aipanel/aitooluse.tsx` | cancelled 状态图标和颜色 |
| `frontend/app/aipanel/aipanelmessages.tsx` | `deriveToolUseStatus` 处理 cancelled |

#### 验收标准

- [ ] 用户手动取消时，工具调用显示灰色取消图标
- [ ] 取消状态与错误状态视觉区分明显
- [ ] 取消后仍可查看已输出的部分内容

---

### 🟢 P2 — Mermaid 渲染（图表展示能力）

**Warp 实现**：

```rust
AIAgentTextSection::MermaidDiagram { diagram: AgentOutputMermaidDiagram }
```

Warp 在 `FormattedTextElement` 中原生支持 Mermaid 图表渲染。

**Waveterm 现状**：`WaveStreamdown` 不支持 Mermaid 语法，AI 输出的流程图等以代码块形式展示。

**改进方案**：

使用 `mermaid.js` 在 Markdown 渲染中识别 ` ```mermaid ` 代码块并渲染为 SVG。

```tsx
// streamdown 组件增强
import mermaid from "mermaid";

// 在 markdown 渲染后，查找 mermaid 代码块并替换为 SVG
useEffect(() => {
    if (!containerRef.current) return;
    const mermaidBlocks = containerRef.current.querySelectorAll("code.language-mermaid");
    mermaidBlocks.forEach(async (block) => {
        const id = `mermaid-${crypto.randomUUID().slice(0, 8)}`;
        const { svg } = await mermaid.render(id, block.textContent || "");
        const wrapper = block.parentElement?.parentElement;
        if (wrapper) {
            wrapper.innerHTML = svg;
        }
    });
}, [content]);
```

#### 依赖

- `mermaid` npm 包 (~1.5MB gzipped)

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/app/element/streamdown.tsx` | 识别 mermaid 代码块并渲染 |
| `frontend/package.json` | 添加 `mermaid` 依赖 |

#### 验收标准

- [ ] AI 输出 ` ```mermaid ` 代码块时渲染为流程图
- [ ] 渲染失败时 fallback 显示原始代码
- [ ] 暗色主题下图表配色正确

---

## 三、实施优先级

| 优先级 | 改进项 | 预估工作量 | 用户感知 |
|--------|--------|-----------|---------|
| 🔴 P0 | Shimmering 动画 | 小 (CSS/TSX) | 高 — 流式体验质变 |
| 🟡 P1 | CancellationReason | 小 (Go+TS) | 中 — 取消原因更清晰 |
| 🟡 P1 | Reasoning 带耗时 | 中 (Go+TS, 多 Provider) | 中 — 推理信息更丰富 |
| 🟡 P1 | Cancelled 状态 | 小 (Go+TS) | 中 — 状态模型更完整 |
| 🟢 P2 | Mermaid 渲染 | 中 (TSX + 依赖) | 低-中 — 图表展示能力 |

**建议实施顺序**：P0 Shimmering → P1 Cancelled 状态 → P1 CancellationReason → P1 Reasoning 带耗时 → P2 Mermaid

---

## 四、Warp 其他值得关注的特性（本次不实施，长期参考）

| 特性 | 说明 | 参考文件 |
|------|------|---------|
| **ResponseStream 重试** | SSE 断线自动重试（最多 3 次），已收到 ClientActions 则不重试 | `response_stream.rs` |
| **Agent Event Driver** | 编排/ambient agent 的独立 SSE 事件流，指数退避重连 | `driver.rs` |
| **Shared\<T\> 并发安全** | `Arc<RwLock<T>>` 保护流式输出，多消费者安全读取 | `mod.rs` |
| **Subagent 编排** | `SubagentCall` 支持子 Agent 调用和状态展示 | `action/mod.rs` |
| **Orchestration 消息** | Agent 间消息收发可视化 | `orchestration.rs` |
| **Todo 列表** | `TodoOperation` 集成到 AI 输出中 | `todos.rs` |
| **Artifact 产物** | `ArtifactCreatedData` 支持产物创建和展示 | `mod.rs` |
| **Skill 调用** | `InvokedSkill` 技能调用可视化 | `mod.rs` |
| **环境选择器** | `environment_selector.rs` 选择执行环境 | `agent_input_footer/` |
| **上下文芯片** | `chips.rs` 快速添加上下文信息 | `agent_input_footer/` |
