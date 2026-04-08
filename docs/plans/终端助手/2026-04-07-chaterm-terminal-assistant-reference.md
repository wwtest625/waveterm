# Chaterm 终端助手代码参考

这份文档把 `Chaterm-main` 里和“终端助手”直接相关的代码路径、关键职责和可迁移模式整理出来，方便后续在 Wave AI 里对照实现。

## 1. 终端助手核心代码范围

### 主调度层
- `C:\Users\sys49169\Downloads\Github\Chaterm-main\src\main\agent\core\task\index.ts`
- 这是最重要的入口，负责：
  - 维护任务生命周期
  - 维护命令上下文注册表
  - 组织 API 请求与工具调用
  - 把历史消息保存到磁盘
  - 把命令执行、终端交互、历史回放串起来

### 消息合并层
- `C:\Users\sys49169\Downloads\Github\Chaterm-main\src\main\agent\shared\combineCommandSequences.ts`
- `C:\Users\sys49169\Downloads\Github\Chaterm-main\src\main\agent\shared\combineApiRequests.ts`
- 这两份代码主要是“历史整理/上下文压缩”，不是执行调度本身。

### 系统提示与执行规则
- `C:\Users\sys49169\Downloads\Github\Chaterm-main\src\main\agent\core\prompts\system.ts`
- 这里定义了工具调用约束、一次一个工具的策略、命令执行风格等。

### 前端 AiTab
- `C:\Users\sys49169\Downloads\Github\Chaterm-main\src\renderer\src\views\components\AiTab\index.vue`
- `C:\Users\sys49169\Downloads\Github\Chaterm-main\src\renderer\src\views\components\AiTab\composables\useSessionState.ts`
- `C:\Users\sys49169\Downloads\Github\Chaterm-main\src\renderer\src\views\components\AiTab\composables\useTabManagement.ts`
- `C:\Users\sys49169\Downloads\Github\Chaterm-main\src\renderer\src\views\components\AiTab\composables\useChatHistory.ts`

## 2. 关键职责拆分

### `task/index.ts` 的职责

这个文件不是单纯“跑一个命令”，而是一个完整的任务/会话状态机。

它做的事情包括：
- 把每个命令执行挂到 `commandId` 上
- 允许单个命令有自己的 `sendInput` / `cancel` / `forceTerminate`
- 在任务结束时清理该任务下的所有命令上下文
- 把 API 请求历史和 Chaterm 消息历史分别持久化
- 处理工具调用的顺序、审批、结果写回

这里最值得注意的是：
- 命令上下文是按 `commandId` 独立注册的
- `cmd` 模式下，命令会交给前端/终端异步跑，不是在这里同步阻塞到底
- 工具调用整体仍然是顺序推进的

### `combineCommandSequences.ts` 的职责

它把命令和命令输出合并成更适合上下文窗口和历史展示的消息。

它的作用更接近：
- 把 `command` + `command_output` 变成一条更容易读的历史
- 方便后续再喂给模型

它不是：
- 命令并行调度器
- 运行队列管理器

### `useTabManagement.ts` 的职责

这个 composable 管理：
- 新建 tab
- 从历史恢复 tab
- 删除 tab
- 重命名 tab
- tab 和 history 的联动

它是 Chaterm 前端“tab / history / 当前会话”三者关系的核心。

### `useChatHistory.ts` 的职责

这个 composable 负责：
- 加载历史列表
- 搜索、分页、收藏过滤
- 编辑标题
- 删除历史记录
- 删除时同步移除对应的打开 tab

### `useSessionState.ts` 的职责

这个 composable 保存：
- `chatTabs`
- `currentChatId`
- 每个 tab 的 session 状态
- 当前输入、消息、执行状态

它是前端会话状态的全局单例。

## 3. Chaterm 里值得直接借鉴的模式

### 模式 A：命令上下文独立化

Chaterm 会把每个执行中的命令单独挂在一个 registry 上，避免“整个任务只能靠一个大锁”。

适合迁移到 Wave 的点：
- `jobId` / `commandId` 独立状态
- 单条命令自己的取消、输入、终止
- UI 可以单独显示某条命令状态

### 模式 B：历史整理和执行调度分离

Chaterm 把“执行”和“展示给模型/用户看的历史”分开。

适合迁移到 Wave 的点：
- 先执行
- 再合并历史
- 再决定怎么回写上下文

### 模式 C：History 与 Tab 双向联动

Chaterm 的 history 删除会同步影响 tab 列表。

适合迁移到 Wave 的点：
- tab 可关闭
- history 仍可保留或删除，按语义分层处理
- 不把 UI 关闭和后端删除强绑定

## 4. 直接对照的关键片段

### 任务级命令注册

`task/index.ts` 里有一个静态 registry，按命令 ID 管理活动命令上下文。

伪结构大概是：

```ts
activeTasks: Map<commandId, CommandContext>
registerCommandContext(context)
unregisterCommandContext(commandId)
clearCommandContextsForTask(taskId)
```

### 命令执行的 cmd 分支

`handleExecuteCommandToolUse()` 中，`cmd` 模式下会在用户确认后直接返回，把后续执行交给前端/终端侧。

### 历史合并

`task/index.ts` 最终会把：

```ts
combineApiRequests(combineCommandSequences(this.chatermMessages.slice(1)))
```

作为整理后的历史流，用于上下文窗口和状态展示。

### history 删除与 tab 删除

`useChatHistory.ts` 在删除 history 时，会先移除本地 tab，再向主进程发送删除消息：

```ts
chatTabs.value.splice(tabIndex, 1)
window.api.sendToMain(...)
```

## 5. 建议在 Wave 里优先实现的部分

如果要把 Chaterm 的思路迁到 Wave，我建议优先做这三块：

1. 命令上下文 registry
2. 历史整理与执行调度分离
3. 前端 tab / history 的双向联动

后面如果你要，我可以继续把这份参考文档拆成：
- `wave-ai-architecture-notes.md`
- `wave-ai-parallel-execution-design.md`
- `wave-ai-tab-history-mapping.md`

