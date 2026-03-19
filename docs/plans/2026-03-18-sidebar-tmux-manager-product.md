# 侧边栏 Tmux Manager（tmux 按钮）— 精简产品文档

## 1. 背景

老大希望在 Wave 里更方便管理 tmux 会话与窗口，但实际命令执行仍在终端内进行。
目标是提供一个侧边栏管理面板，覆盖 Session + Window 的常见管理动作，并避免手动记忆 tmux 命令。

## 2. 目标（MVP）

- 侧边栏新增 **tmux 按钮**，点击打开 **Tmux Manager 面板**（widget）。
- 支持 **Session + Window** 管理：
  - Session：列出 / 创建并进入 / 进入 / 重命名 / Detach / Kill
  - Window（基于选中的 session）：列出 / 新建并进入 / 进入 / 重命名 / Kill
- 默认一键进入 session 名：`main`。
- 面板动作统一为“发送命令到当前聚焦普通终端执行”，不在面板中直接执行 tmux。

## 3. 非目标

- 不在面板里承载命令执行结果流。
- 不新增“自动创建或自动聚焦终端”行为。
- 不在 MVP 阶段实现命令重试、队列或回滚机制。

## 4. 入口与信息架构

### 4.1 入口

- 侧边栏 Widgets 增加 `tmux` 图标（与 terminal/files/web 同列）。
- 点击：打开/关闭 Tmux Manager 面板。

### 4.2 面板结构

- 顶部栏：标题 `Tmux` + 当前 `connection / cwd` + `Refresh`
- 主区：
  1. Sessions
  2. Windows（选中 session 后显示）

## 5. 核心交互

### 5.1 统一执行语义

- 所有“进入/新建/重命名/Detach/Kill”动作均由按钮触发。
- 面板只负责生成并发送 tmux 命令。
- 命令发送目标固定为当前聚焦普通终端（`view=term` 且 `controller=shell`）。
- 若无可用目标终端，或终端连接与面板连接不一致，则阻止发送并提示。

### 5.2 创建与命名

- Session：输入 session 名（默认 `main`），按钮“创建并进入”。
- Session 命名冲突时自动后缀递增：`main` -> `main-1` -> `main-2`。
- Window：在选中 session 下输入 window 名（可选），按钮“新建并进入”。

### 5.3 危险操作

- Detach / Kill 属于危险操作，均需二次确认。
- 二次确认文案必须包含完整目标：`connection + session + window(如有) + 操作类型`。

### 5.4 实时刷新

- 面板自动轮询刷新，周期 2 秒。
- 保留手动 `Refresh`，用于立即刷新。

## 6. 错误与边界

- tmux 未安装 / 无权限 / 连接不可用：顶部错误条显示可读错误摘要。
- 当前连接没有 tmux server：Session 列表为空（非致命）；进入/创建动作允许继续并在终端内触发自动拉起。
- 面板不兜底终端执行失败，仅通过下一轮刷新反映状态变化。

## 7. 验收标准（Given / When / Then）

1. Given 已进入工作区，When 打开侧边栏，Then 能看到 `tmux` 按钮并打开 Tmux Manager。
2. Given 面板已打开，When 等待刷新周期，Then Sessions/Windows 会在 2 秒级别内反映最新状态。
3. Given 当前聚焦块不是普通终端，When 点击“进入/新建/重命名/Detach/Kill”，Then 动作被阻止并提示先聚焦普通终端。
4. Given 面板连接与当前终端连接不一致，When 点击任一执行动作，Then 动作被阻止并提示切到同连接终端。
5. Given 已存在 `main`，When 再次使用默认名创建 Session，Then 实际创建名为 `main-1`（继续冲突则递增）。
6. Given 触发 Kill 或 Detach，When 确认弹窗出现，Then 能看到完整目标信息并且未确认前不发送命令。
7. Given 成功点击执行动作，When 查看当前终端，Then 可看到对应 tmux 命令已被发送并执行。

## 8. 默认策略

- 当前终端定义：当前聚焦普通 shell 终端块。
- 连接不一致策略：阻止发送并提示。
- 自动刷新周期：2 秒。
- 面板职责：管理入口，不承担执行结果展示与重试。