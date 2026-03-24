# Tmux Manager UI 重设计方案（树形结构）

## 9. UI 重设计方案（树形结构）

### 9.1 设计目标

将现有的「Sessions 列表 + Windows 列表」双面板布局重新设计为「树形结构」，统一管理 Session 和 Window 的导航与进入。

### 9.2 设计原则

| 原则         | 说明                                               |
| ------------ | -------------------------------------------------- |
| **导航优先** | 树形结构专注于快速定位和进入，交互简洁             |
| **操作分离** | 导航（单击选中、Enter 进入）和管理（右键菜单）分离 |
| **信息精简** | 每个节点只显示必要信息，避免视觉干扰               |
| **复用组件** | 复用 Wave 现有的 TreeView 组件                     |

### 9.3 布局结构

```
┌─────────────────────────────────────────────┐
│ Tmux Manager                          🔄  │  ← Header
│ 连接：本机 | cwd: /home/user               │
├─────────────────────────────────────────────┤
│                                             │
│  📁 main                               ▼   │  ← Session（可展开）
│  │                                        │
│  ├─ 0:zsh                           ▼   │  ← Window
│  ├─ 1:vim                            ▼   │
│  └─ 2:node                           ▼   │
│                                             │
│  📁 dev                              ▼   │
│  │                                        │
│  ├─ 0:bash                            ▼   │
│  └─ 1:server                          ▼   │
│                                             │
│  📁 test                              ▼   │
│                                             │
├─────────────────────────────────────────────┤
│ [+ 新建 Session]  [+ 新建 Window]           │  ← 新建操作区
└─────────────────────────────────────────────┘
```

### 9.4 节点信息

| 节点类型    | 显示内容                                     |
| ----------- | -------------------------------------------- |
| **Session** | 📁 图标 + 名称 + (windows: N) + (clients: N) |
| **Window**  | ├/└ 图标 + index:名称 + (active) 状态标记    |

### 9.5 交互规范

| 操作             | 行为                                        |
| ---------------- | ------------------------------------------- |
| **单击 Session** | 选中该 Session，展开/折叠其 Windows         |
| **双击 Session** | 进入该 Session（切换 tmux session）         |
| **单击 Window**  | 选中该 Window                               |
| **双击 Window**  | 进入该 Window（切换 tmux session + window） |
| **Enter 键**     | 进入当前选中的节点（Session 或 Window）     |
| **右键 Session** | 显示 Session 管理菜单                       |
| **右键 Window**  | 显示 Window 管理菜单                        |
| **↑/↓ 键**       | 在树中上下导航                              |
| **←/→ 键**       | 折叠/展开当前节点                           |

### 9.6 右键菜单

**Session 右键菜单：**

- 进入该 Session
- 重命名 Session

---

- Detach Session
- Kill Session

**Window 右键菜单：**

- 进入该 Window
- 重命名 Window

---

- Kill Window

### 9.7 新建操作

保留独立输入框，位于树形结构下方：

```
┌──────────────────────────────────────────────────────────┐
│ [输入 Session 名称...]  [创建并进入]                      │
│ [输入 Window 名称...]   [创建并进入]                      │
└──────────────────────────────────────────────────────────┘
```

- Session 新建：输入名称 + 点击按钮，自动进入新 Session
- Window 新建：输入名称（可选）+ 点击按钮，自动进入新 Window
- 命名冲突处理：与现有逻辑一致，自动后缀递增

### 9.8 技术实现

| 方面         | 方案                                                    |
| ------------ | ------------------------------------------------------- |
| **树形组件** | 复用 `frontend/app/treeview/treeview.tsx`               |
| **数据映射** | Tmux Session/Window → TreeNodeData                      |
| **右键菜单** | 复用 `ContextMenuModel.getInstance().showContextMenu()` |
| **状态管理** | 使用 Jotai atoms 管理选中状态和展开状态                 |

### 9.9 与现有设计的对比

| 方面         | 现有设计                          | 新设计（树形）             |
| ------------ | --------------------------------- | -------------------------- |
| 布局         | 双面板（Sessions + Windows 分开） | 单一树形                   |
| Session 选中 | 单击选中                          | 单击选中 + 展开            |
| Session 进入 | 需要点击「进入」按钮              | 双击或 Enter 直接进入      |
| Window 进入  | 单击直接进入                      | 单击选中 + 双击/Enter 进入 |
| 操作入口     | 按钮组（进入/Detach/更多/Kill）   | 右键菜单                   |
| 视觉复杂度   | 较高（多个操作按钮）              | 较低（树形 + 右键）        |
| 新建操作     | 内嵌在面板中                      | 独立输入框区               |

### 9.10 验收标准（补充）

8. Given 面板已打开，When 查看树形结构，Then 能看到所有 Session 和对应的 Windows。
9. Given 树形结构已加载，When 双击 Session 节点，Then 切换到该 tmux session。
10. Given 树形结构已加载，When 右键 Session 节点，Then 显示管理菜单（重命名/Detach/Kill）。
11. Given 在底部输入框输入名称并点击「创建」，When 完成后查看树，Then 新节点已出现并自动进入。
12. Given Session 下有多个 Window，When 单击展开该 Session，Then 看到所有 Window 列表。

---

## 原始需求确认记录

| 项目         | 选择                                |
| ------------ | ----------------------------------- |
| **布局**     | 树形结构（Session → Window）        |
| **Pane**     | 不显示                              |
| **导航交互** | 单击选中，Enter/双击进入            |
| **管理操作** | 右键菜单（重命名、删除、Detach 等） |
| **新建操作** | 独立输入框                          |
| **状态信息** | 显示（windows 数量、clients 数量）  |
| **头部信息** | 保留连接信息和刷新按钮              |
| **搜索**     | 不需要                              |
| **进入行为** | 进入 Session（切换 tmux session）   |

---

## 10. 已知问题与解决方案

### 10.1 Bug：终端被前台进程占用导致动作不可靠

#### 问题描述

当目标终端正在运行前台程序时，Tmux Manager 发送的 tmux 命令不一定会被 shell 接收和执行。

典型场景包括：

- `node server.js`
- `python app.py`
- `npm run dev`
- `vim`
- `less`
- 任何正在占用前台输入的交互式程序

#### 当前实现现状

当前 Tmux Manager 采用“**读状态走 RPC，写动作走终端输入**”的模式：

- Session / Window 列表：通过 RPC 从后端读取
- 进入 / 创建 / 重命名 / Detach / Kill：通过 `sendCommandToFocusedTerminal` 把 tmux 命令写入普通 shell 终端

这种设计的优点是 MVP 简单直观，但它依赖“目标终端此刻正停在 shell 提示符”这一前提。

#### 问题原因

当前动作链路可以概括为：

1. 面板构造 tmux 命令字符串
2. 找到一个同连接的普通 shell 终端块
3. 通过 `ControllerInputCommand` 向该终端写入文本
4. 由该终端当前前台程序决定如何处理这段输入

**问题在于**：终端输入只保证“字符被送进 PTY”，不保证“由 shell 解释为 tmux 命令”。

```
用户点击「进入 Session」
    ↓
Tmux Manager 发送命令: tmux switch-client -t session
    ↓
命令被写入终端 PTY
    ↓
当前前台进程是 node / vim / less / python ...
    ↓
输入被前台进程消费，而不是被 shell 执行
    ↓
动作失败或表现异常 ❌
```

#### 影响范围

理论上所有“写动作”都会受到影响：

- 进入 Session
- 进入 Window
- 创建并进入 Session
- 创建并进入 Window
- 重命名 Session / Window
- Detach Session
- Kill Session / Window

其中最敏感的是“进入类动作”，因为它们直接依赖 tmux client 的切换语义。

#### 复现步骤

1. 在 tmux 中创建一个 Session
2. 在某个 Window 内运行前台程序，例如 `node server.js`
3. 打开 Tmux Manager
4. 点击「进入 Session」或「进入 Window」
5. 观察：动作可能无效，或没有切到预期目标

---

### 10.2 方案评估：专用隐藏终端

#### 方案概述

创建一个专用的隐藏 shell 终端，Tmux Manager 始终把 tmux 命令发送到这个终端，而不是发送到用户当前正在使用的终端。

#### 这个方案能解决什么

它可以缓解一类问题：

- 隐藏终端通常停留在 shell 提示符
- 不容易被用户手动占用
- 对“纯管理类命令”更可靠，例如重命名、Kill、部分创建动作

#### 这个方案解决不了什么

它**不能作为通用主方案**，原因是 tmux 有一部分动作不是普通后台命令，而是和“当前 tmux client / 当前终端上下文”强绑定。

尤其是以下动作：

- 进入 Session
- 进入 Window
- 创建并进入 Session
- 创建并进入 Window

这些动作常见实现依赖：

- `tmux switch-client`
- `tmux attach-session`
- `tmux select-window`

如果命令从隐藏终端发出，风险包括：

- 切换的是隐藏终端对应的 tmux client，而不是用户当前可见终端
- `attach-session` 把会话附着到隐藏终端
- `switch-client` 在缺少正确 client 上下文时失败

也就是说，隐藏终端适合作为“执行器”，但不天然适合作为“用户当前 tmux client 的代表”。

#### 结论

专用隐藏终端可以作为**局部兜底方案**或**过渡方案**考虑，但不应作为默认主方案，更不应假设它能正确覆盖所有 enter 类动作。

---

### 10.3 更合理的方向：Tmux Action RPC

#### 方案概述

在现有 tmux RPC 基础上，补充“写动作 RPC”，让前端不再把原始命令字符串塞进终端，而是调用后端的结构化 tmux 动作接口。

#### 为什么这个方向更合适

当前项目已经具备 tmux 读取能力：

- `TmuxListSessionsCommand`
- `TmuxListWindowsCommand`

说明：

- tmux 连接解析已存在
- 本地 / WSL / SSH 的 tmux CLI 调用链路已存在
- 错误建模（如 `missing_cli`、`no_server`）已存在

因此新增“写动作 RPC”不是从零开始，而是在现有 tmux RPC 体系上继续扩展。

#### 不建议的接口形式

不建议增加一个过于宽泛的：

```typescript
TmuxRunCommand(command: string)
```

原因：

- 前端仍要手写 shell 字符串
- quoting / 注入风险仍然存在
- 动作语义不清晰，测试粒度差
- 后端难以对不同动作做精确错误处理

#### 更推荐的接口形式

推荐新增结构化 action RPC，例如：

- `TmuxCreateSession`
- `TmuxRenameSession`
- `TmuxKillSession`
- `TmuxCreateWindow`
- `TmuxRenameWindow`
- `TmuxKillWindow`
- `TmuxDetachSession`
- `TmuxEnterSession`
- `TmuxEnterWindow`

或者提供统一的：

```typescript
TmuxActionCommand({
  connection,
  action,
  session,
  windowIndex,
  newName,
  targetBlockId,
})
```

其中 `action` 必须是受控枚举，而不是原始 shell 命令。

---

### 10.4 动作分层建议

#### A 类：适合优先 RPC 化的动作

这些动作更接近“tmux server 管理动作”，优先级最高：

- 重命名 Session / Window
- Kill Session / Window
- Detach Session
- 创建 Session
- 创建 Window

这类动作即使脱离用户当前可见终端，也通常仍有明确语义。

#### B 类：需要额外设计上下文的动作

这些动作不能简单理解为“在服务器上执行一条 tmux 命令”：

- 进入 Session
- 进入 Window
- 创建并进入 Session
- 创建并进入 Window

原因是它们依赖“目标 tmux client 是谁”。

如果未来要将这些动作也 RPC 化，需要额外传递能标识目标终端上下文的信息，例如：

- 当前可见 terminal block id
- 与该 terminal block 关联的 tmux client 标识
- 或其他足以让后端定位“要切换哪个 client”的上下文

在这部分设计完成前，不应假设“后台 RPC 直接执行 tmux 命令”就能正确替代当前终端执行。

---

### 10.5 不推荐方案

#### 方案 B：发送 Ctrl+C 中断前台进程

```typescript
const sendTmuxCommandSafe = async (command: string, connection: string) => {
  await sendCommand("C-c", connection);
  await new Promise((resolve) => setTimeout(resolve, 100));
  return await sendCommand(command, connection);
};
```

**风险**：

- 可能中断用户正在运行的重要程序
- 可能破坏编辑器、REPL、交互式任务现场
- 有潜在数据丢失风险

不建议在产品中采用。

#### 方案 C：隐藏终端作为通用执行器

可作为过渡手段验证部分管理动作，但不适合作为 enter 类动作的最终方案。

---

### 10.6 推荐实施计划

| 阶段        | 任务                                                         | 优先级 |
| ----------- | ------------------------------------------------------------ | ------ |
| **Phase 1** | 文档与实现对齐：明确当前是“读 RPC / 写终端输入”             | 高     |
| **Phase 2** | 新增 Tmux Action RPC，先覆盖 Rename / Kill / Detach / Create | 高     |
| **Phase 3** | 为 Enter 类动作设计目标 client / targetBlock 上下文         | 高     |
| **Phase 4** | 评估是否还需要隐藏终端作为局部 fallback                      | 中     |

#### 推荐结论

- **短期**：不要把“隐藏终端”作为主方案写进实施计划
- **中期**：优先补结构化 tmux action RPC
- **长期**：针对 enter 类动作单独设计“目标 client”语义，再决定是否完全替换当前终端执行模式
