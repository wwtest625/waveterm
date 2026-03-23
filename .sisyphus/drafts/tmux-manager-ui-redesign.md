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

### 10.1 Bug：终端被服务占用导致命令无效

#### 问题描述

当 tmux Window 中正在运行服务（如 `node server.js`、`python app.py`、`npm run dev` 等）时，通过 Tmux Manager 点击切换 Session 或 Window 会失败。

#### 问题原因

当前的命令发送机制是通过 `sendCommandToFocusedTerminal` 函数实现的，该函数的工作原理是：

1. 找到一个空闲的 shell 终端块
2. 向该终端发送按键数据（tmux 命令）
3. 终端接收并执行命令

**问题在于**：如果目标终端正在运行前台服务，发送的命令会被该服务进程接收和处理，而不是被 tmux 本身解释。

```
用户点击「进入 Session」
    ↓
Tmux Manager 发送命令: tmux switch-client -t session
    ↓
命令发送到终端
    ↓
终端正在运行 node server.js
    ↓
命令被 node 进程接收（无效）
    ↓
切换失败 ❌
```

#### 影响范围

- 所有 tmux 命令都可能受影响：
  - 进入 Session
  - 进入 Window
  - 创建 Session
  - 创建 Window
  - 重命名
  - Detach
  - Kill

#### 复现步骤

1. 在 tmux 中创建一个 Session
2. 在该 Session 的某个 Window 中运行一个前台服务（如 `node server.js`）
3. 打开 Tmux Manager
4. 尝试切换到其他 Session 或 Window
5. 观察：命令无效，无法切换

---

### 10.2 解决方案：专用隐藏终端

#### 方案概述

为 Tmux Manager 创建一个专用的、对用户不可见的隐藏终端块，专门用于发送 tmux 控制命令。

#### 工作原理

```
用户点击「进入 Session」
    ↓
Tmux Manager 获取专用命令终端
    ↓
向专用终端发送命令: tmux switch-client -t session
    ↓
专用终端始终处于 shell 状态（无前台进程）
    ↓
命令被 tmux 正确解释
    ↓
切换成功 ✅
```

#### 技术实现

**1. 添加状态管理**

```typescript
const [commandTerminalBlockId, setCommandTerminalBlockId] = useState<string | null>(null);
```

**2. 创建/获取命令终端函数**

```typescript
const getOrCreateCommandTerminal = useCallback(
  async (connection: string): Promise<string> => {
    // 检查现有终端是否有效
    if (commandTerminalBlockId) {
      const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", commandTerminalBlockId));
      const blockData = globalStore.get(blockAtom);
      if (
        blockData?.meta?.view === "term" &&
        blockData?.meta?.controller === "shell" &&
        blockData?.meta?.connection === connection
      ) {
        return commandTerminalBlockId;
      }
      setCommandTerminalBlockId(null);
    }

    // 创建新的隐藏终端
    const termBlockDef: BlockDef = {
      meta: {
        view: "term",
        controller: "shell",
        connection: connection,
      },
    };

    const blockId = await createBlock(termBlockDef);
    setCommandTerminalBlockId(blockId);
    return blockId;
  },
  [commandTerminalBlockId]
);
```

**3. 发送 tmux 命令函数**

```typescript
const sendTmuxCommand = useCallback(
  async (command: string, connection: string): Promise<boolean> => {
    try {
      const terminalId = await getOrCreateCommandTerminal(connection);
      const inputdata64 = stringToBase64(`${command}\n`);
      await RpcApi.ControllerInputCommand(TabRpcClient, {
        blockid: terminalId,
        inputdata64,
      });
      return true;
    } catch (err) {
      console.error("Failed to send tmux command:", err);
      return false;
    }
  },
  [getOrCreateCommandTerminal]
);
```

**4. 替换现有命令发送**

将所有 tmux 相关的命令发送从 `sendCommand` 替换为 `sendTmuxCommand`：

```typescript
// 原来的
const ok = await sendCommand(buildTmuxEnterSessionCommand(sessionName), `进入 Session ${sessionName}`);

// 改为
const ok = await sendTmuxCommand(buildTmuxEnterSessionCommand(sessionName), connection);
```

需要修改的函数：

- `enterSession`
- `enterWindow`
- `createSession`
- `createWindow`
- `renameSession`
- `renameWindow`
- `detachSession`
- `killSession`
- `killWindow`

#### 优势

| 优势       | 说明                                                        |
| ---------- | ----------------------------------------------------------- |
| **隔离性** | 命令终端只用于发送 tmux 命令，不会有用户在上面运行其他程序  |
| **可靠性** | 终端始终处于 shell 提示符状态，能够正确接收和解释 tmux 命令 |
| **透明性** | 对用户完全不可见，不影响他们的工作流程                      |
| **效率**   | 复用同一个终端块，避免频繁创建/销毁                         |

#### 注意事项

1. **终端清理**：组件卸载时是否需要清理命令终端（可选）
2. **连接变更**：如果连接发生变化，需要重新创建命令终端
3. **错误处理**：命令发送失败时的降级策略

---

### 10.3 备选方案（不推荐）

#### 方案 B：发送 Ctrl+C 中断前台进程

```typescript
const sendTmuxCommandSafe = async (command: string, connection: string) => {
  // 发送 Ctrl+C 中断可能的前台进程
  await sendCommand("C-c", connection);
  // 等待中断生效
  await new Promise((resolve) => setTimeout(resolve, 100));
  // 发送实际命令
  return await sendCommand(command, connection);
};
```

**风险**：

- 如果用户正在编辑文件，可能导致数据丢失
- 如果用户正在执行重要操作，可能造成意外中断
- 不推荐在生产环境使用

#### 方案 C：RPC 直接执行（需要后端支持）

通过 RPC 直接在服务器上执行 tmux 命令，不依赖终端。

**优点**：

- 最可靠，完全绕过终端
- 不受任何前台进程影响

**缺点**：

- 需要后端添加新的 RPC 接口
- 需要修改 Go 代码
- 实现复杂度较高

**实现步骤**：

1. 在 `pkg/wshrpc/wshserver/tmux.go` 中添加 `TmuxRunCommand` 方法
2. 在 `pkg/wshrpc/wshrpctypes.go` 中添加请求/响应类型
3. 在 `frontend/app/store/wshclientapi.ts` 中添加客户端函数
4. 修改前端使用新的 RPC

---

### 10.4 推荐实施计划

| 阶段        | 任务                                     | 优先级 |
| ----------- | ---------------------------------------- | ------ |
| **Phase 1** | 实现专用隐藏终端方案                     | 高     |
| **Phase 2** | 测试各种场景（服务运行中、编辑器打开等） | 高     |
| **Phase 3** | 考虑添加 RPC 直接执行（可选）            | 低     |
