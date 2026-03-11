# Codex App Server Migration Plan

> 日期：2026-03-10
>
> 目标：把 Wave 当前基于 `codex exec` 的本地 agent 执行内核，迁移到 `codex app-server` 的 thread/turn/event 模型，同时尽量保留现有前端 SSE/UI 契约。

## 当前确认

- 现在的 Codex 路径在 `pkg/aiusechat/localagent.go`，核心模型是：
  `stdin prompt -> codex exec -> stdout/stderr -> 最终文本`
- 这条路径无法表达 app-server 的：
  - 长连接
  - `initialize / initialized`
  - `thread/start` / `thread/resume`
  - `turn/start`
  - `item/*` 事件流
  - approval 回调

## 迁移原则

- 先**保留外层产品壳**：
  - `WaveAILocalAgentPostMessageWrap(...)`
  - 现有 SSE 文本流
  - `data-toolprogress`
  - 现有 AI Panel phase/status 推导
- 先**重做 Codex provider 执行内核**，不要一开始就重写整个 AI panel。
- 第一阶段优先做**兼容适配层**，把 app-server 事件翻译成现有回调：
  - `onDelta`
  - `onPhase`

## 第一阶段落点

- 新增 `pkg/aiusechat/codex_appserver.go`
- 在 `localagent.go` 中增加 Codex app-server 分支
- 用环境变量控制切换，先 opt-in：
  - `WAVETERM_LOCAL_AGENT_CODEX_USE_APP_SERVER=1`
  - 可选覆盖命令：`WAVETERM_LOCAL_AGENT_CODEX_APP_SERVER_CMD`

## 第一阶段能力范围

- 启动 `codex app-server`
- 通过 stdio JSONL 发送/接收 JSON-RPC
- 完成最小握手：
  - `initialize`
  - `initialized`
- 启动一次新 thread：
  - `thread/start`
- 发起一次 turn：
  - `turn/start`
- 处理最小通知集合：
  - `item/agentMessage/delta` -> 映射到 SSE 文本 delta
  - `item/started` -> 映射到 `data-toolprogress`
  - `item/reasoning/*` / `turn/plan/updated` -> 映射到阶段状态
  - `turn/completed` -> 收尾

## 第一阶段暂不完整实现

- 不先暴露 app-server 原生 thread id 到前端
- 不先改 chat 存储结构来持久化 Codex thread
- 不先把所有 item 类型精细化映射成前端独立 UI
- approval 先不做完整桥接；若意外收到 approval request，后端明确报错并中止

## 后续阶段

### Phase 2

- 把 `item/commandExecution/requestApproval` / `item/fileChange/requestApproval`
  接入现有 `toolapproval.go`
- 将 app-server `requestId` / `itemId` 与 Wave `toolCallId` 建立映射
- 让前端能真实展示 `waiting-approval`

### Phase 3

- 引入 thread 恢复：将 Wave chat/session 与 Codex `thread.id` 绑定
- 支持 `thread/resume` / `thread/fork`
- 增强 plan、diff、reasoning、tool item 的前端可视化

## 兼容性与握手策略

- 不要把 `codex --version` 当成 app-server 协议能力的唯一判断依据。
- 对接时应以 `initialize` 的真实返回值和后续 RPC 行为为准。
- `initialize` 返回的 `userAgent` 代表 app-server 运行时/通道身份，不一定等于外层 CLI 或 npm 包版本。
- 实测中可能出现：
  - `codex --version = 0.114.0`
  - `initialize.result.userAgent = codex_vscode/0.108.0-alpha.12 (...)`
  - 同时 `thread/start` 仍只接受旧枚举：
    - `approvalPolicy = untrusted`
    - `sandbox = workspace-write`
- 因此 Wave 的 app-server 客户端应遵循“behavior-based compatibility”：
  - 优先根据 `initialize.userAgent` 判断是否需要 legacy enum
  - 若 `thread/start` 返回 `unknown variant unlessTrusted` / `workspaceWrite`，自动 fallback 到旧枚举并重试
  - 不要因为一次新枚举失败就直接向前端抛 fatal error

## 来自官方文档/文章的开发经验

- app-server 的核心价值是把内部底层执行流，稳定地转换成 thread / turn / item 事件模型；Wave 保留现有 SSE/UI 外壳、底层接 app-server，是合理路线。
- 协议设计目标是长期稳定、可恢复、可扩展，因此兼容层应该优先靠握手和实际行为探测，而不是靠硬编码版本假设。
- `initialize` / `initialized` 不只是形式上的握手，也应该作为能力判断和兼容策略分流点。
- 对老版本 app-server，建议把“兼容分支”集中在 provider client 层，不要把版本差异泄漏到 AI panel 或更外层 UI。

参考：
- OpenAI App Server 文档：<https://developers.openai.com/codex/app-server>
- OpenAI 文章《Unlocking the Codex Harness》：<https://openai.com/zh-Hans-CN/index/unlocking-the-codex-harness/>

## 这次代码变更的意义

- 它不是完整迁移完成。
- 它的作用是：
  - 把 `codex exec` 单次文本进程模型，切开成可扩展的 app-server 客户端层
  - 保持现有 UI/SSE 基本不动
  - 为下一步 approval / thread persistence / richer item UI 留下稳定接线点
