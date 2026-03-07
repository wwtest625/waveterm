# Terminal Agent (Codex) P0 Audit

> 审计日期：2026-03-07
>
> 目标：对照 [2026-03-04-terminal-agent-codex-implementation-v2.md](/C:/Users/sys49169/Downloads/Github/waveterm/docs/plans/2026-03-04-terminal-agent-codex-implementation-v2.md)，确认当前 P0 能力哪些已经落地，哪些只是底层半成品，哪些仍未开始。

## Completed

- `Terminal command status API` 已落地
  证据：`pkg/service/blockservice/blockservice.go` 已实现 `GetTerminalCommandStatus`，`pkg/service/blockservice/blockservice_terminal_status_test.go` 已覆盖空状态和运行中状态。

- `wsh mcpserve` 的终端闭环基础工具已落地
  证据：`cmd/wsh/cmd/wshcmd-mcpserve.go` 已包含：
  `wave_read_current_terminal_context`
  `wave_read_terminal_scrollback`
  `wave_inject_terminal_command`
  `wave_get_terminal_command_status`
  `wave_wait_terminal_idle`

- `localagent` 流式输出与 UTF-8 安全切分已落地
  证据：`pkg/aiusechat/localagent.go` 已使用 `StdoutPipe / StderrPipe`、`utf8StreamDecoder`、idle timeout、overall timeout、output size cap；测试文件已存在：
  `pkg/aiusechat/localagent_stream_test.go`
  `pkg/aiusechat/localagent_utf8_test.go`

- `token-budgeted conversation continuity` 已基本落地
  证据：`pkg/aiusechat/localagent.go` 已包含 recent turns budget 选择逻辑；`pkg/aiusechat/localagent_prompt_test.go` 已存在。

- `auto-execute` 的静态安全规则已落地
  证据：`frontend/app/aipanel/autoexecute-util.ts` 已实现 allowlist / denylist / operator blocking；`frontend/app/aipanel/autoexecute-util.test.ts` 已覆盖危险链式命令与只读命令。

- AI Panel 的本地 provider 切换已落地
  证据：`frontend/app/aipanel/waveai-model.tsx` 和 `frontend/app/aipanel/aipanelheader.tsx` 已支持 `Wave AI / Codex / Claude Code` 切换和 health 检查。

## Partially Completed

- `Stable terminal loop` 只完成了底层零件，未完成产品级闭环
  已有：context / scrollback / inject / status / wait。
  缺口：还没有证明这些能力组合后真的能稳定完成“读终端 -> 注入命令 -> 等待完成 -> 再读取输出”的实际工作流。

- `Local Agent UX` 只完成了后端流式能力，未完成前端状态透明度
  已有：`localagent.go` 可以流式传输文本。
  缺口：前端没有清楚展示 agent 当前是在分析、执行、等待、超时还是被阻止。

- `Safe auto-execute` 只完成了规则检查，未形成完整控制模型
  已有：自动执行命令的风险过滤。
  缺口：还没有和 agent mode、用户活跃保护、审批反馈整合为统一行为。

- `Prompt capability alignment` 只有局部基础，未完成“按模式真实描述能力”
  已有：local agent 已可连接 codex/claude-code，并具备 terminal loop 工具。
  缺口：当前尚未确认 prompt 是否会按 cloud/local、planning/default 等状态给出一致且真实的能力描述。

- `P0 verification` 只完成了单点测试，未完成真实场景验收
  已有：stream、utf8、prompt budget、terminal status、auto-execute 测试。
  缺口：没有覆盖完整 agent loop、mode 切换、被阻止执行、用户活跃冲突等场景。

## Not Started

- `Agent Mode` 系统未开始
  缺少：
  `default / planning / auto-approve`
  mode-aware 权限边界
  mode-aware prompt
  mode-aware UI 展示与切换

- `User activity protection` 未开始
  缺少：
  终端最近用户输入时间的跟踪
  注入前阻止逻辑
  override/force 语义
  UI 反馈

- `P0 acceptance criteria` 未固化
  缺少明确的 3 到 5 条验收标准，以及和测试对齐的判断依据。

- `真实任务验收` 未开始
  缺少基于真实任务的验证，例如：
  解释终端报错
  执行安全命令并等待结果
  planning mode 禁止执行
  用户正在输入时 agent 不抢终端

- `Auto Input Mode` 未开始
  当前输入框仍未建立“命令 vs AI prompt”的明确分类与反馈。

## P0 Blockers

- 缺少统一的 `Agent Mode` 模型，导致能力、风险控制和 UI 都没有共同语义。
- 缺少 `user activity protection`，意味着 agent 与真人可能争用终端控制权。
- 缺少“agent 当前阶段”的前端可视状态，导致用户控制感弱，错误排查困难。
- 缺少真实任务验收，当前只能证明“接口存在”，不能证明“体验达标”。

## P0 Acceptance Criteria

- `Agent Mode is visible and enforced`
  完成标准：用户可以看到当前 mode，系统能区分 `default / planning / auto-approve`，且 `planning` 明确禁止执行写操作或终端注入。
  当前证明状态：`partially-verified`
  已有证据：mode-aware prompt 和 aiusechat tool policy 已有测试。

- `Panel shows agent runtime state`
  完成标准：AI Panel 至少能展示 provider、当前 mode、当前阶段，以及最近一次命令或被阻止原因。
  当前证明状态：`documented-only`
  已有证据：需求和 UI 方向已明确；完整验收仍需前端行为验证。

- `Agent does not inject while user is active`
  完成标准：用户最近几秒内有终端输入时，agent 自动注入会被阻止，并给出明确原因；显式 override 走单独路径。
  当前证明状态：`documented-only`

- `Local prompt truthfully describes capabilities`
  完成标准：cloud prompt 不夸大终端能力；local prompt 不再说“不能执行终端命令”；planning mode 不会暗示自己能直接执行。
  当前证明状态：`verified`
  已有证据：prompt-specific tests 已覆盖 cloud/local/planning/default 文案边界。

- `Terminal loop completes a real read/inject/wait/read flow`
  完成标准：至少有一条可重复验证的场景能证明 agent 可以读取终端上下文、注入一条安全命令、等待完成，并读取结果继续分析。
  当前证明状态：`host-implemented-not-verified-here`
  已有证据：host-side enforcement 和 MCP wiring 已存在，但这份 acceptance proof 还没有把它包装成完整端到端验收。

## Files Likely to Change During P0

- `pkg/aiusechat/agentmode.go`
- `pkg/aiusechat/agentmode_test.go`
- `pkg/aiusechat/usechat.go`
- `pkg/aiusechat/usechat-prompts.go`
- `pkg/aiusechat/usechat_prompts_test.go`
- `pkg/aiusechat/localagent.go`
- `pkg/aiusechat/localagent_loop_test.go`
- `frontend/app/aipanel/waveai-model.tsx`
- `frontend/app/aipanel/aipanelheader.tsx`
- `frontend/app/aipanel/aipanel.tsx`
- `frontend/app/aipanel/aimessage.tsx`
- `frontend/app/aipanel/agentstatus.tsx`
- `frontend/app/view/term/term-model.ts`
- `pkg/service/blockservice/blockservice.go`
- `pkg/service/blockservice/blockservice_activity_test.go`
- `cmd/wsh/cmd/wshcmd-mcpserve.go`

## Summary

当前状态不是“完全没做”，而是“P0 的底层通路已经搭出一半以上，但还没有形成你想要的 terminal agent 成品体验”。下一步 P0 应优先补齐：

1. `Agent Mode`
2. `前端 agent 状态反馈`
3. `user activity protection`
4. `真实任务验收`
---

## 2026-03-07 Verification Update

- Terminal loop verification is now exercised by `pkg/aiusechat/localagent_loop_test.go`.
- The test verifies the observed loop order:
  `wave_read_current_terminal_context`
  `wave_inject_terminal_command`
  `wave_wait_terminal_idle`
  `wave_read_terminal_scrollback`
- The test also verifies that a final assistant `text-delta` is emitted after the loop phases.

## 2026-03-07 Task 8 Completion Note

- The stale `read_dir` test assumptions were updated to match the current return shape: `entries` is `[]fileutil.DirEntryOut`, not `[]map[string]any`.
- Final targeted verification passed:
  `go test ./pkg/aiusechat ./pkg/service/blockservice ./cmd/wsh/cmd -count=1`
- With this verification gate green, the P0 implementation work tracked in this audit is complete.
