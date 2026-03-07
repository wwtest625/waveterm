# Terminal Agent (Codex) Todo Checklist

> 目的：把 [2026-03-04-terminal-agent-codex-implementation-v2.md](/C:/Users/sys49169/Downloads/Github/waveterm/docs/plans/2026-03-04-terminal-agent-codex-implementation-v2.md) 的目标，按“已完成 / 部分完成 / 未完成”重新整理成可勾选清单，方便后续逐项推进。

## 状态说明

- `[x]` 已完成：代码里已有实现，且从结构上看已经落地
- `[ ]` 未完成：还没做，或离目标效果还有明显差距，不能算完成
- `部分完成`：有实现基础，但体验、闭环或验收标准仍不达标

---

## 一、已完成

- [x] `BlockService` 已提供终端命令状态查询能力
  现状：`GetTerminalCommandStatus` 和相关测试已经存在，可返回 `status / lastcommand / exitcode / lastoutputts`。

- [x] `wsh mcpserve` 已具备完整终端循环的基础工具
  现状：已存在以下 MCP tools：
  `wave_read_current_terminal_context`
  `wave_read_terminal_scrollback`
  `wave_inject_terminal_command`
  `wave_get_terminal_command_status`
  `wave_wait_terminal_idle`

- [x] `localagent` 已支持流式输出与 UTF-8 安全切分
  现状：当前实现已使用 `StdoutPipe / StderrPipe` 逐步读取输出，并带有 UTF-8 decoder、timeout、idle timeout、output size cap。

- [x] `localagent` 已有基础 prompt budget / 多轮上下文处理
  现状：代码里已存在 recent turns 选择逻辑和相关测试，说明“只带有限上下文继续对话”这件事已经开始落地。

- [x] Auto Execute 基础安全规则已存在
  现状：`autoexecute-util.ts` 和测试已实现对危险链式命令、分隔符、非 allowlist 管道命令的拦截。

- [x] 前端 AI Panel 已能切换本地 Agent Provider
  现状：当前 UI 已支持 `Wave AI / Local Agent (Codex) / Local Agent (Claude Code)` 基础切换，也有 local health 检查。

---

## 二、部分完成

- [ ] P0 终端闭环“能用，但还不够好用”
  部分完成：read / inject / status / wait 这些零件基本齐了。
  未完成点：还缺一轮基于真实任务的稳定性验收，暂时不能证明它已经达到你想要的“顺手、可靠、像 qbit 一样”的效果。

- [ ] Local Agent 流式体验只完成了技术层，没完成产品层
  部分完成：后端已经能 streaming。
  未完成点：前端缺少对“正在读 / 正在执行 / 正在等待 / 卡住 / 超时”的清晰状态表达，用户控制感不够。

- [ ] Auto Execute 做了静态规则，但还没形成完整风险控制方案
  部分完成：已有 allowlist / denylist 风险过滤。
  未完成点：还没和 agent mode、用户活跃保护、审批反馈形成统一行为模型。

- [ ] Local Agent Provider 切换已存在，但“Agent 模式系统”还没真正建立
  部分完成：现在只有 provider 维度的切换。
  未完成点：`default / planning / auto-approve` 这套模式、权限、prompt、UI 提示还没有成系统落地。

- [ ] 测试已经覆盖部分底层能力，但缺少面向真实体验的验收测试
  部分完成：有 `localagent_stream_test.go`、`localagent_utf8_test.go`、`localagent_prompt_test.go`、`blockservice_terminal_status_test.go`、`autoexecute-util.test.ts`。
  未完成点：已有 proof 主要覆盖 mode/prompt 等基础行为；仍缺少针对完整 agent loop、前端反馈、人工审批路径的端到端验证。

---

## 三、未完成

### A. 现状审计与目标对齐

- [x] 逐项对表 `v2` 文档中的所有任务，标记为“完成 / 部分完成 / 未开始 / 做偏了”
- [x] 明确“你想要的效果”对应的 3 到 5 条验收标准
- [ ] 把“当前代码为什么不咋样”具体化成可执行的问题列表，而不是停留在感觉层

### B. Agent Mode 系统

- [ ] 增加 `default / planning / auto-approve` 三种 Agent Mode
- [ ] 为不同 mode 建立明确的工具权限边界
- [ ] 在 system prompt 中注入 mode 约束
- [ ] 在前端 AI Panel 明确展示当前 mode
- [ ] 为 mode 切换补测试

### C. 用户交互与控制感

- [ ] 在前端展示 agent 当前阶段
  目标：用户能明显看出它是在“分析 / 读取终端 / 注入命令 / 等待命令完成 / 请求批准 / 失败”。

- [ ] 展示最近一次 agent 注入的命令和结果摘要

- [ ] 给 Auto Execute / 阻止执行 / 等待审批 提供更明确的 UI 反馈

- [ ] 给超时、无输出、工具调用失败提供更可理解的错误信息

### D. User Activity Protection

- [ ] 定义“用户活跃中”的判定标准
- [ ] 当用户正在操作终端时，阻止或延迟 agent 自动注入命令
- [ ] 在 UI 中提示“为什么 agent 没有自动执行”
- [ ] 为用户活跃保护补测试

### E. Auto Input Mode

- [ ] 决定是否现在就做 Auto Input Mode
- [ ] 如果做，先确定保守策略还是激进策略
- [ ] 实现命令和 AI prompt 的分类规则
- [ ] 在前端输入框上体现分类结果和可预期行为
- [ ] 为分类误判场景补测试

### F. 安全与审批模型

- [ ] 把 auto-execute 规则和 agent mode 统一起来
- [ ] 明确哪些工具可自动批准，哪些必须人工确认
- [ ] 为风险命令提供更清楚的拦截原因
- [ ] 明确手动 click-to-run 与自动执行的行为差异

### G. 真实任务验收

- [ ] 跑通“读取终端上下文并解释报错”
- [ ] 跑通“执行一条安全命令并等待结果再继续分析”
- [ ] 跑通“planning mode 下只分析不执行”
- [ ] 跑通“危险命令被自动执行规则拦截”
- [ ] 跑通“用户正在输入时 agent 不抢终端”

### H. 文档与推进方式

- [ ] 把这份 checklist 持续维护成唯一推进面板
- [ ] 基于 checklist 写一版更贴近目标体验的新设计文档
- [ ] 再把设计文档拆成一版新的 implementation plan

---

## 四、建议优先级

### P0 必做

- [x] 完成现状审计
- [x] 定义目标体验验收标准
- [ ] 做 Agent Mode 系统
- [ ] 做前端 agent 状态反馈
- [ ] 做 user activity protection
- [ ] 跑一轮真实任务验收

### P1 重要

- [ ] 整理统一的审批与风险模型
- [ ] 补端到端或半端到端验证
- [ ] 优化 local agent 错误与超时体验

### P2 可延后

- [ ] Auto Input Mode
- [ ] 更高级的 operator ergonomics
- [ ] 更细粒度的并发与会话能力

---

## 五、下一步建议

- [x] 先完成“现状审计版”打勾，把每一项对应到实际文件或测试
- [ ] 然后只选一个主攻方向推进：
  `Agent Mode`
  `交互体验`
  `用户活跃保护`
---

## 2026-03-07 P0 Progress Note

- [x] Task 7 terminal loop validation is now covered by `pkg/aiusechat/localagent_loop_test.go`.
- [x] Verified read -> inject -> wait -> read loop phase ordering through SSE `data-toolprogress` events.
- [x] Verified final assistant output is emitted as a `text-delta` event after the loop phases.

## 2026-03-07 Task 8 Verification Update

- [x] Fixed the stale `read_dir` test contract in `pkg/aiusechat/tools_readdir_test.go`.
- [x] `go test ./pkg/aiusechat ./pkg/service/blockservice ./cmd/wsh/cmd -count=1`
- [x] P0 verification gate is green for the targeted backend packages.
