# Wave Terminal - Code Wiki

> 版本: 0.15.0 | 许可证: Apache-2.0 | 语言: Go + TypeScript/React

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [Go 后端模块详解](#3-go-后端模块详解)
4. [Electron 主进程模块详解](#4-electron-主进程模块详解)
5. [前端模块详解](#5-前端模块详解)
6. [wsh 命令行系统](#6-wsh-命令行系统)
7. [通信协议与数据流](#7-通信协议与数据流)
8. [数据模型与对象系统](#8-数据模型与对象系统)
9. [依赖关系图](#9-依赖关系图)
10. [构建与运行](#10-构建与运行)
11. [项目目录结构](#11-项目目录结构)

---

## 1. 项目概述

**Wave Terminal** 是一个开源的、AI 原生的跨平台终端应用，支持 macOS、Linux 和 Windows。它将传统终端、AI 助手、远程连接和文件管理整合到一个统一的界面中。

### 核心特性

| 特性 | 说明 |
|------|------|
| Wave AI | 上下文感知的终端 AI 助手，支持 OpenAI/Claude/Gemini/Ollama 等多种模型 |
| 持久 SSH 会话 | 远程终端会话可存活网络中断和应用重启，自动重连 |
| 灵活布局 | 拖拽式界面，组织终端块、编辑器、浏览器和 AI 助手 |
| 内置编辑器 | 远程文件编辑，语法高亮，现代编辑器功能 |
| 文件预览 | Markdown/图片/视频/PDF/CSV/目录的行内预览 |
| 安全密钥存储 | 使用系统原生后端安全存储 API 密钥和凭证 |
| wsh 命令系统 | 从 CLI 管理工作区，在终端会话间共享数据 |

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 41+ |
| 前端 | React 19 + TypeScript + Jotai + TailwindCSS |
| 终端渲染 | xterm.js 6 |
| 代码编辑器 | Monaco Editor |
| 后端服务 | Go 1.25 (wavesrv) |
| 数据库 | SQLite (mattn/go-sqlite3) |
| 构建 | Taskfile + electron-vite + electron-builder |
| AI SDK | Vercel AI SDK + 各厂商 API |

---

## 2. 整体架构

Wave Terminal 采用 **Electron + Go 后端** 的混合架构，分为三个主要进程层：

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 主进程 (emain/)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ 窗口管理  │ │ IPC 通信  │ │ 菜单管理  │ │ 自动更新   │  │
│  └────┬─────┘ └────┬─────┘ └──────────┘ └───────────┘  │
│       │            │                                     │
│       │   ┌────────┴─────────┐                          │
│       │   │  wavesrv 进程管理  │                          │
│       │   │  (启动/停止/监控)  │                          │
│       │   └────────┬─────────┘                          │
└───────┼────────────┼────────────────────────────────────┘
        │            │ stdin/stdout + Unix Domain Socket
┌───────┼────────────┼────────────────────────────────────┐
│       │   Go 后端 (wavesrv)                              │
│  ┌────┴────────────┴──────────────────────────────────┐ │
│  │              Web Server (HTTP + WebSocket)           │ │
│  │  ┌──────────┐ ┌──────────┐ ┌─────────────────────┐ │ │
│  │  │ REST API  │ │  WS 事件  │ │  Service 层 (RPC)   │ │ │
│  │  └──────────┘ └──────────┘ └─────────────────────┘ │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │ │
│  │  │ wstore   │ │ wps      │ │ wshrpc   │ │ wcore │ │ │
│  │  │ (SQLite) │ │ (PubSub) │ │ (RPC)    │ │ (核心) │ │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────┘ │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │ │
│  │  │ AI 聊天   │ │ SSH/远程  │ │ 作业管理  │ │ 文件  │ │ │
│  │  │ (aiusechat)│ │ (remote) │ │(jobctrl) │ │(fstore)│ │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────┘ │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
        │
┌───────┼─────────────────────────────────────────────────┐
│       │   渲染进程 (frontend/)                            │
│  ┌────┴──────────────────────────────────────────────┐  │
│  │              React App (Jotai 状态管理)             │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐          │  │
│  │  │ 工作区    │ │ 标签页    │ │ 块视图    │          │  │
│  │  │workspace │ │  tab     │ │  block   │          │  │
│  │  └──────────┘ └──────────┘ └──────────┘          │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐          │  │
│  │  │ 终端     │ │ AI 面板   │ │ 布局系统  │          │  │
│  │  │  term    │ │ aipanel  │ │ layout   │          │  │
│  │  └──────────┘ └──────────┘ └──────────┘          │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐          │  │
│  │  │ 编辑器   │ │ 预览     │ │ WebView  │          │  │
│  │  │ monaco   │ │ preview  │ │ webview  │          │  │
│  │  └──────────┘ └──────────┘ └──────────┘          │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 通信路径

| 路径 | 协议 | 说明 |
|------|------|------|
| 渲染进程 → Go 后端 | WebSocket + HTTP REST | 前端通过 WS 接收事件推送，通过 HTTP 调用 Service API |
| Electron 主进程 → Go 后端 | stdin/stdout + Unix Socket | 主进程启动 wavesrv 子进程，通过 stdin 传递认证密钥，通过 Unix Socket 进行 RPC |
| 渲染进程 → Electron 主进程 | IPC (ipcMain/ipcRenderer) | 窗口操作、文件下载、系统对话框等 |
| Go 后端 → Electron 主进程 | stderr 事件流 | wavesrv 通过 stderr 输出 `WAVESRV-ESTART` 和 `WAVESRV-EVENT` 消息 |
| wsh CLI → Go 后端 | Unix Domain Socket | wsh 命令通过 Unix Socket 与 wavesrv 通信 |

---

## 3. Go 后端模块详解

### 3.1 入口与初始化 (`cmd/server/`)

**文件**: `cmd/server/main-server.go`

`main()` 函数的启动流程：

```
main()
 ├── grabAndRemoveEnvVars()        // 从环境变量提取认证密钥，清除敏感信息
 ├── service.ValidateServiceMap()  // 验证所有 Service 注册
 ├── wavebase.EnsureWaveDirs()     // 确保数据/配置/缓存目录存在
 ├── wavebase.AcquireWaveLock()    // 获取单实例锁
 ├── filestore.InitFilestore()     // 初始化文件存储
 ├── wstore.InitWStore()           // 初始化数据库 (SQLite)
 ├── wcore.EnsureInitialData()     // 确保初始数据 (Client/Window/Workspace)
 ├── wcore.InitMainServer()        // 初始化主服务器
 ├── createMainWshClient()         // 创建 WSH RPC 客户端和路由
 ├── startConfigWatcher()          // 启动配置文件监视器
 ├── aiusechat.InitAIModeConfigWatcher() // AI 模式配置监视
 ├── blocklogger.InitBlockLogger() // 块日志器
 ├── jobcontroller.InitJobController()   // 作业控制器
 ├── blockcontroller.InitBlockController() // 块控制器
 ├── web.MakeTCPListener("web")    // HTTP 监听器
 ├── web.MakeTCPListener("websocket") // WebSocket 监听器
 ├── web.MakeUnixListener()        // Unix Socket 监听器
 ├── web.RunWebSocketServer()      // 启动 WS 服务 (goroutine)
 ├── wshutil.RunWshRpcOverListener() // 启动 RPC 服务 (goroutine)
 └── web.RunWebServer()            // 启动 HTTP 服务 (阻塞)
```

### 3.2 核心框架层

#### 3.2.1 `pkg/wcore/` — 核心业务逻辑

协调存储层、PubSub 系统和 RPC 系统。

| 函数 | 说明 |
|------|------|
| `EnsureInitialData() (bool, error)` | 首次启动时创建 Client、Window、Workspace、Tab 等初始数据 |
| `CreateClient(ctx) (*waveobj.Client, error)` | 创建客户端对象 |
| `GetClientData(ctx) (*ClientData, error)` | 获取客户端完整数据（窗口、工作区、标签页、块） |
| `SendWaveObjUpdate(updates)` | 发送对象更新事件到 PubSub 系统 |
| `ResolveBlockIdFromPrefix(prefix) (string, error)` | 通过前缀解析块 ID |
| `InitMainServer() error` | 初始化主服务器对象 |
| `InitTabIndicatorStore()` | 初始化标签指示器存储 |

**工作区管理** (`pkg/wcore/workspace.go`):

| 函数 | 说明 |
|------|------|
| `CreateWorkspace(ctx, opts) (*waveobj.Workspace, error)` | 创建工作区 |
| `UpdateWorkspace(ctx, wsId, meta) error` | 更新工作区元数据 |
| `DeleteWorkspace(ctx, wsId) error` | 删除工作区 |
| `CreateTab(ctx, windowId, wsId, opts) (*waveobj.Tab, error)` | 创建标签页 |
| `DeleteTab(ctx, tabId) error` | 删除标签页 |

#### 3.2.2 `pkg/waveobj/` — 波对象类型系统

定义了所有核心数据对象及其类型系统。

**核心接口**:

```go
type WaveObj interface {
    GetORef() ORef
    GetOType() string
    SetMeta(key string, val any)
    GetMeta(key string) any
    GetMetaMap() MetaMapType
}
```

**对象类型** (`wtype.go`):

| 类型 | 常量 | 说明 |
|------|------|------|
| `Client` | `"client"` | 客户端实例，包含版本、平台信息 |
| `Window` | `"window"` | 应用窗口，关联工作区 |
| `Workspace` | `"workspace"` | 工作区，包含名称和元数据 |
| `Tab` | `"tab"` | 标签页，包含布局信息 |
| `Block` | `"block"` | 块/视图，包含视图类型和元数据 |
| `MainServer` | `"mainserver"` | 主服务器对象 |
| `Job` | `"job"` | 作业/进程 |

**ORef (对象引用)**:

```go
type ORef struct {
    OType string `json:"otype"`
    OID   string `json:"oid"`
}
```

格式: `"otype:oid"`，如 `"block:abc123"`, `"tab:def456"`

#### 3.2.3 `pkg/wstore/` — 数据持久化层

基于 SQLite 的对象存储，使用 `jmoiron/sqlx` 和 `golang-migrate`。

| 函数 | 说明 |
|------|------|
| `InitWStore() error` | 初始化数据库连接和迁移 |
| `GetClientId() string` | 获取客户端 ID |
| `DBGet[T](ctx, oid) (*T, error)` | 泛型获取对象 |
| `DBGetCount[T](ctx) (int64, error)` | 获取对象计数 |
| `DBUpdateMeta(ctx, oref, meta) error` | 更新对象元数据 |
| `DBGetBlockViewCounts(ctx) (map[string]int, error)` | 获取块视图计数 |

#### 3.2.4 `pkg/wps/` — 波 PubSub 系统

发布/订阅事件系统，驱动前后端数据同步。

| 函数 | 说明 |
|------|------|
| `Subscribe(routeId, eventType, opts) (string, error)` | 订阅事件 |
| `Unsubscribe(subId) error` | 取消订阅 |
| `Publish(eventType, data) error` | 发布事件 |
| `ReadHistory(subId, opts) ([]Event, error)` | 读取历史事件 |

**主要事件类型**:

| 事件 | 说明 |
|------|------|
| `Event_WaveObjUpdate` | 波对象更新（增/删/改） |
| `Event_Rpc` | RPC 调用事件 |

#### 3.2.5 `pkg/wconfig/` — 配置管理

管理应用配置，支持热重载。

| 函数 | 说明 |
|------|------|
| `GetWatcher() *ConfigWatcher` | 获取配置监视器 |
| `ReadFullConfig() FullConfigType` | 读取完整配置 |
| `SetBaseConfigValue(key, val) error` | 设置配置值 |

**配置结构** (`FullConfigType`):

```
FullConfigType
 ├── Settings      — 全局设置（遥测、窗口透明等）
 ├── AiPresets     — AI 预设配置
 ├── AiModes       — AI 模式配置
 ├── CustomWidgets — 自定义小部件
 └── KeyBindings   — 键盘绑定
```

#### 3.2.6 `pkg/eventbus/` — 事件总线

用于 Go 后端内部和与 Electron 主进程之间的事件传递。

| 事件常量 | 说明 |
|----------|------|
| `WSEvent_ElectronNewWindow` | 请求 Electron 创建新窗口 |
| `WSEvent_ElectronCloseWindow` | 请求 Electron 关闭窗口 |
| `WSEvent_ElectronUpdateActiveTab` | 更新活跃标签页 |
| `WSEvent_ElectronMoveTabToNewWindow` | 移动标签页到新窗口 |
| `WSEvent_Rpc` | RPC 事件 |

**关键函数**:

| 函数 | 说明 |
|------|------|
| `SendEventToElectron(event)` | 通过 stderr 向 Electron 发送事件 |
| `RegisterWSChannel(connId, routeId, ch)` | 注册 WebSocket 通道 |
| `UnregisterWSChannel(connId)` | 注销 WebSocket 通道 |

### 3.3 Service 层 (`pkg/service/`)

基于反射的 Service 调用框架，将 Go 方法暴露为 HTTP API。

**注册的服务**:

| 服务名 | 实例 | 说明 |
|--------|------|------|
| `"block"` | `BlockServiceInstance` | 块管理（创建、删除、更新块） |
| `"object"` | `ObjectService{}` | 通用对象 CRUD |
| `"client"` | `ClientService{}` | 客户端管理 |
| `"window"` | `WindowService{}` | 窗口管理 |
| `"workspace"` | `WorkspaceService{}` | 工作区管理 |
| `"userinput"` | `UserInputService{}` | 用户输入处理（AI AskUser） |
| `"knowledgebase"` | `KnowledgeBaseService{}` | 知识库管理 |

**调用流程**:

```
前端 HTTP POST → web.CallServiceHandler → service.CallService(WebCallType)
  → 反射查找 ServiceMap[service] 的 Method → 参数类型转换 → 方法调用 → 返回 WebReturnType
```

**数据结构**:

```go
type WebCallType struct {
    Service   string      `json:"service"`    // 服务名
    Method    string      `json:"method"`     // 方法名
    UIContext *UIContext   `json:"uicontext"`  // UI 上下文
    Args      []any       `json:"args"`       // 参数列表
}

type WebReturnType struct {
    Success bool              `json:"success"`
    Error   string            `json:"error"`
    Data    any               `json:"data"`
    Updates []WaveObjUpdate   `json:"updates"`  // 对象更新推送
}
```

### 3.4 Web 层 (`pkg/web/`)

#### 3.4.1 HTTP 服务器

提供 REST API 端点，处理 Service 调用和文件操作。

| 路由 | 说明 |
|------|------|
| `POST /api/service` | Service 方法调用 |
| `GET /api/file/{...}` | 文件读取 |
| `POST /api/file/{...}` | 文件写入 |
| `GET /api/suggest` | 命令建议 |

#### 3.4.2 WebSocket 服务器 (`pkg/web/ws.go`)

处理实时双向通信，推送事件到前端。

| 功能 | 说明 |
|------|------|
| 连接管理 | 管理多个 WebSocket 连接，每个窗口一个连接 |
| 事件推送 | 将 wps 事件推送到对应窗口 |
| RPC 调用 | 支持通过 WebSocket 进行 RPC 调用 |
| 路由管理 | 根据 routeId 将消息路由到正确的处理器 |

### 3.5 AI 系统 (`pkg/aiusechat/`)

Wave Terminal 的 AI 功能核心，支持多种 AI 提供商和工具调用。

#### 3.5.1 核心聊天逻辑 (`usechat.go`)

| 函数/类型 | 说明 |
|-----------|------|
| `RunAIChat(ctx, opts) error` | 运行 AI 聊天主循环 |
| `WaveAIPostMessageWrap()` | 消息包装器 |
| `UseChatType` | 聊天状态结构体，包含消息历史、工具状态等 |

#### 3.5.2 AI 后端 (`usechat-backend.go`)

支持多种 AI 提供商的抽象后端：

| 提供商 | 包路径 | 说明 |
|--------|--------|------|
| OpenAI | `pkg/aiusechat/openai/` | GPT-4o、GPT-4 等模型 |
| Anthropic | `pkg/aiusechat/openai/` (兼容模式) | Claude 系列模型 |
| Google Gemini | `pkg/aiusechat/gemini/` | Gemini Pro/Ultra |
| Ollama | `pkg/aiusechat/openai/` (兼容模式) | 本地模型 |

#### 3.5.3 AI 工具 (`tools.go`)

| 工具名 | 说明 |
|--------|------|
| `write_text_file` | 写入文件（需用户批准） |
| `edit_text_file` | 编辑文件（需用户批准） |
| `wave_run_command` | 运行命令（需用户批准） |
| `read_file` | 读取文件内容 |
| `ask_user` | 向用户提问 |
| `think` | 思考/推理工具 |
| `knowledgebase_search` | 搜索知识库 |
| `skills` | 技能系统 |

#### 3.5.4 Agent 模式 (`agentmode.go`)

| 模式 | 说明 |
|------|------|
| `no-agent` | 无代理，仅聊天 |
| `interactive` | 交互模式，工具调用需用户确认 |
| `strict` | 严格模式，自动执行工具 |

#### 3.5.5 其他 AI 子模块

| 子模块 | 说明 |
|--------|------|
| `chatstore/` | 聊天记录持久化 |
| `skills/` | AI 技能管理 |
| `uctypes/` | UseChat 类型定义 |
| `focus_chain.go` | 焦点链管理 |

### 3.6 远程连接 (`pkg/remote/`)

#### 3.6.1 SSH 客户端 (`sshclient.go`)

| 函数 | 说明 |
|------|------|
| `NewSSHClient(connStr) (*SSHClient, error)` | 创建 SSH 客户端 |
| `Connect() error` | 建立 SSH 连接 |
| `RunCommand(cmd) (string, error)` | 执行远程命令 |
| `GetSession() *ssh.Session` | 获取 SSH 会话 |

#### 3.6.2 连接解析 (`connparse/`)

解析连接字符串格式：`ssh://user@host:port`、`wsl://distro`

#### 3.6.3 通用连接 (`genconn/`)

统一 SSH 和 WSL 连接的抽象接口：

| 实现 | 说明 |
|------|------|
| `ssh-impl.go` | SSH 连接实现 |
| `wsl-impl.go` | WSL 连接实现 |

#### 3.6.4 文件共享 (`fileshare/`)

| 子模块 | 说明 |
|--------|------|
| `wshfs/` | WSH 文件系统，支持远程文件操作 |
| `fspath/` | 文件系统路径处理 |
| `fsutil/` | 文件系统工具 |

### 3.7 作业与进程管理

#### 3.7.1 `pkg/jobmanager/` — 作业管理器

管理进程的执行环境和进程间通信。

| 类型/函数 | 说明 |
|-----------|------|
| `JobManager` | 作业管理器，管理 PTY 进程 |
| `StartJob(opts) error` | 启动作业 |
| `StopJob() error` | 停止作业 |
| `ConnectJob() error` | 重连作业 |
| `CirBuf` | 环形缓冲区，存储终端输出 |
| `StreamManager` | 流管理器，处理数据流 |

#### 3.7.2 `pkg/jobcontroller/` — 作业控制器

管理终端命令执行的完整生命周期。

| 函数 | 说明 |
|------|------|
| `InitJobController()` | 初始化作业控制器 |
| `GetNumJobsRunning() int` | 获取运行中的作业数 |
| `GetNumJobsConnected() int` | 获取已连接的作业数 |

#### 3.7.3 `pkg/blockcontroller/` — 块控制器

管理所有类型的块控制器（shell、命令等）。

| 函数 | 说明 |
|------|------|
| `InitBlockController()` | 初始化块控制器 |
| `ResyncController(blockId) error` | 重新同步控制器 |
| `SendInput(blockId, input) error` | 向块发送输入 |
| `StopAllBlockControllersForShutdown()` | 关闭时停止所有控制器 |

### 3.8 数据流与流管理 (`pkg/streamclient/`)

| 类型 | 说明 |
|------|------|
| `StreamBroker` | 流代理，管理客户端和服务器之间的双向数据流 |
| `StreamReader` | 流读取器 |
| `StreamWriter` | 流写入器 |

### 3.9 其他核心包

| 包 | 说明 |
|-----|------|
| `pkg/shellexec/` | Shell 执行引擎，支持多种终端模式 |
| `pkg/filestore/` | 块级文件存储，支持读写、缓存和流处理 |
| `pkg/suggestion/` | 命令建议系统，基于历史和文件路径 |
| `pkg/knowledgebase/` | 知识库系统，支持文件搜索和 AI 上下文 |
| `pkg/secretstore/` | 安全密钥存储，使用系统原生后端 |
| `pkg/authkey/` | 认证密钥管理，生成和验证 JWT |
| `pkg/schema/` | JSON Schema 生成，用于配置验证 |
| `pkg/ijson/` | 增量 JSON 解析器 |
| `pkg/telemetry/` | 遥测数据收集和上报 |
| `pkg/filebackup/` | 文件备份和清理 |
| `pkg/faviconcache/` | 网站图标缓存 |
| `pkg/panichandler/` | Panic 处理和恢复 |
| `pkg/blocklogger/` | 块操作日志 |
| `pkg/baseds/` | 基础数据存储接口 |
| `pkg/trimquotes/` | 引号修剪工具 |
| `pkg/gogen/` | Go 代码生成器 |
| `pkg/tsgen/` | TypeScript 类型生成器（从 Go 类型自动生成） |

### 3.10 数据库 (`db/`)

使用嵌入式 SQL 迁移文件：

| 迁移目录 | 说明 |
|----------|------|
| `migrations-filestore/` | 文件存储相关迁移 |
| `migrations-wstore/` | 波对象存储相关迁移 |

---

## 4. Electron 主进程模块详解

### 4.1 入口 (`emain/emain.ts`)

主进程入口，负责：

- 应用生命周期管理（`app.whenReady()`）
- 启动 wavesrv 子进程
- 创建主窗口
- 初始化 IPC 通道
- 设置全局事件监听

### 4.2 wavesrv 管理 (`emain/emain-wavesrv.ts`)

| 函数 | 说明 |
|------|------|
| `startWaveSrv()` | 启动 wavesrv 子进程，传入认证密钥 |
| `stopWaveSrv()` | 停止 wavesrv 进程 |
| `handleWaveSrvOutput()` | 解析 wavesrv 的 stderr 输出 |

**启动协议**: wavesrv 启动后通过 stderr 输出 `WAVESRV-ESTART ws:<addr> web:<addr>` 告知监听地址。

### 4.3 IPC 通信 (`emain/emain-ipc.ts`)

| IPC 通道 | 方向 | 说明 |
|----------|------|------|
| `download-file` | 渲染→主 | 下载文件 |
| `save-image` | 渲染→主 | 保存图片 |
| `open-external` | 渲染→主 | 打开外部链接 |
| `window-focus` | 渲染→主 | 窗口焦点变化 |
| `window-blur` | 渲染→主 | 窗口失焦 |
| `keyboard-input` | 渲染→主 | 键盘输入 |
| `context-menu` | 渲染→主 | 上下文菜单 |
| `update-window-state` | 渲染→主 | 更新窗口状态 |

### 4.4 窗口管理 (`emain/emain-window.ts`)

| 函数 | 说明 |
|------|------|
| `createMainWindow()` | 创建主窗口 |
| `createWindow(opts)` | 创建新窗口 |
| `closeWindow(windowId)` | 关闭窗口 |
| `updateWindowPosition(windowId, pos)` | 更新窗口位置 |
| `updateWindowSize(windowId, size)` | 更新窗口大小 |

### 4.5 其他模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 事件 | `emain-events.ts` | 全局 EventEmitter 实例 |
| 菜单 | `emain-menu.ts` | 应用菜单和上下文菜单管理 |
| 平台 | `emain-platform.ts` | 平台相关路径和配置 |
| WSH 客户端 | `emain-wsh.ts` | WSH RPC 客户端初始化 |
| 日志 | `emain-log.ts` | Winston 日志封装 |
| 标签视图 | `emain-tabview.ts` | 标签页的 BrowserView/WebView 管理 |
| 活动跟踪 | `emain-activity.ts` | 用户活动状态监控 |
| 认证密钥 | `authkey.ts` | 认证密钥生成和注入 |
| 预加载 | `preload.ts` | 渲染进程预加载脚本 |
| WebView 预加载 | `preload-webview.ts` | WebView 预加载脚本 |
| 启动设置 | `launchsettings.ts` | 启动参数解析 |
| 自动更新 | `updater.ts` | electron-updater 自动更新 |

---

## 5. 前端模块详解

### 5.1 入口与初始化

#### `frontend/wave.ts`

前端入口文件，初始化全局变量和 React 渲染。

#### `frontend/app/app.tsx`

主应用组件，职责：

- 初始化全局状态 (Jotai)
- 处理全局键盘事件
- 管理上下文菜单
- 渲染 Workspace 组件

### 5.2 状态管理 (`frontend/app/store/`)

使用 **Jotai** 作为主要状态管理库，采用原子化状态模式。

#### 5.2.1 全局状态

| 文件 | 说明 |
|------|------|
| `global-model.ts` | `GlobalModel` 类，管理窗口和工作区的全局状态原子 |
| `global.ts` | 全局状态初始化和更新函数 |
| `global-atoms.ts` | Jotai 原子定义 |
| `jotaiStore.ts` | Jotai Store 实例 |

#### 5.2.2 工作区与标签页

| 文件 | 说明 |
|------|------|
| `wps.ts` | WPS (Wave PubSub) RPC 客户端，订阅后端事件 |
| `ws.ts` | 工作区状态管理，创建/切换工作区和标签页 |
| `tab-model.ts` | `TabModel` 类，管理标签页状态和原子缓存 |
| `client-model.ts` | `ClientModel` 类，管理客户端数据 |

#### 5.2.3 通信层

| 文件 | 说明 |
|------|------|
| `wshclient.ts` | `WshClient` 类，WSH RPC 客户端实现 |
| `wshclientapi.ts` | WSH 客户端 API 定义，所有 RPC 命令的 TypeScript 封装 |
| `wshrouter.ts` | `WshRouter` 类，RPC 消息路由 |
| `wshrpcutil.ts` | WSH RPC 工具函数 |
| `wshrpcutil-base.ts` | WSH RPC 基础工具 |

#### 5.2.4 功能模块

| 文件 | 说明 |
|------|------|
| `services.ts` | 后端 Service 封装，调用 block/object/client/window/workspace 等 Service |
| `focusManager.ts` | `FocusManager`，管理焦点类型（节点/AI 面板）和焦点切换 |
| `kb-model.ts` | 知识库模型，定义文件和目录数据类型 |
| `kb-api.ts` | 知识库 API 调用封装 |
| `contextmenu.ts` | 上下文菜单状态管理 |
| `modalmodel.ts` | 模态框状态管理 |
| `keymodel.ts` | 键盘快捷键模型 |
| `counters.ts` | 计数器管理 |
| `windowtype.ts` | 窗口类型定义 |
| `wos.ts` | Wave 对象存储 |

### 5.3 布局系统 (`frontend/layout/`)

基于树结构的灵活布局系统，支持拖拽和调整大小。

| 文件 | 说明 |
|------|------|
| `lib/types.ts` | 布局类型定义（LayoutNode, SplitType, Direction 等） |
| `lib/layoutModel.ts` | 布局模型，管理布局节点的原子状态 |
| `lib/layoutTree.ts` | 布局树，实现节点结构管理和算法 |
| `lib/layoutNode.ts` | 布局节点操作 |
| `lib/TileLayout.tsx` | 瓦片布局 React 组件 |
| `lib/layoutAtom.ts` | 布局相关 Jotai 原子 |
| `lib/nodeRefMap.ts` | 节点引用映射 |
| `lib/utils.ts` | 布局工具函数 |

### 5.4 块系统 (`frontend/app/block/`)

块是 Wave Terminal 的核心 UI 单元，每个块对应一个视图。

| 文件 | 说明 |
|------|------|
| `block-model.ts` | `BlockModel`，管理块高亮和状态 |
| `block.tsx` | `Block` 组件，根据视图类型渲染对应子组件 |
| `blocktypes.ts` | 块类型定义（NodeModel, BlockComponentModel, ViewModel） |
| `blockframe.tsx` | 块框架组件 |
| `blockutil.tsx` | 块工具函数 |
| `block.scss` | 块样式 |

**块视图类型**:

| 视图 | 组件路径 | 说明 |
|------|----------|------|
| `term` | `view/term/term.tsx` | 终端视图 |
| `waveai` | `view/waveai/waveai.tsx` | Wave AI 视图 |
| `webview` | `view/webview/webview.tsx` | 网页视图 |
| `preview` | `view/preview/preview.tsx` | 文件预览 |
| `docker` | `view/docker/docker.tsx` | Docker 视图 |
| `network` | `view/network/network.tsx` | 网络视图 |
| `sysinfo` | `view/sysinfo/sysinfo.tsx` | 系统信息视图 |
| `tmux` | `view/tmux/tmux.tsx` | Tmux 视图 |

### 5.5 终端视图 (`frontend/app/view/term/`)

| 文件 | 说明 |
|------|------|
| `term.tsx` | 终端组件，渲染 xterm.js 终端 |
| `term-model.ts` | 终端模型，管理终端数据和状态 |
| `term-wsh.tsx` | 终端 WSH 集成 |
| `termwrap.ts` | xterm.js 封装 |
| `termtheme.ts` | 终端主题管理 |
| `termutil.ts` | 终端工具函数 |
| `ijson.tsx` | 增量 JSON 解析 |

### 5.6 AI 面板 (`frontend/app/aipanel/`)

| 文件 | 说明 |
|------|------|
| `aipanel.tsx` | AI 面板主组件 |
| `aitypes.ts` | AI 相关类型定义 |
| `aimessage.tsx` | AI 消息组件 |
| `aipanelinput.tsx` | AI 输入组件 |
| `aipanel-hooks.ts` | AI 面板 React Hooks |
| `aipanel-i18n.ts` | AI 面板国际化 |
| `aimode.tsx` | AI 模式选择组件 |
| `waveai-model.tsx` | Wave AI 模型管理 |
| `waveai-utils.ts` | Wave AI 工具函数 |
| `ai-utils.ts` | AI 通用工具 |
| `ai-taskchain.tsx` | AI 任务链组件 |
| `agentstatus.tsx` | Agent 状态组件 |
| `aitooluse.tsx` | AI 工具使用组件 |
| `askusercard.tsx` | AskUser 卡片组件 |
| `taskprogress.ts` | 任务进度管理 |

### 5.7 UI 组件 (`frontend/app/element/`)

| 组件 | 说明 |
|------|------|
| `ansiline.tsx` | ANSI 转义序列渲染 |
| `button.tsx` | 按钮组件 |
| `copybutton.tsx` | 复制按钮 |
| `flyoutmenu.tsx` | 弹出菜单 |
| `iconbutton.tsx` | 图标按钮 |
| `input.tsx` | 输入框 |
| `linkbutton.tsx` | 链接按钮 |
| `magnify.tsx` | 放大镜组件 |
| `markdown.tsx` | Markdown 渲染 |
| `menubutton.tsx` | 菜单按钮 |
| `modal.tsx` | 模态框 |
| `popover.tsx` | 弹出框 |
| `progressbar.tsx` | 进度条 |
| `search.tsx` | 搜索组件 |
| `streamdown.tsx` | 流式 Markdown |
| `toggle.tsx` | 开关组件 |
| `tooltip.tsx` | 工具提示 |

### 5.8 其他前端模块

| 模块 | 说明 |
|------|------|
| `app/tab/` | 标签页组件和标签栏 |
| `app/workspace/` | 工作区组件和 Widget 系统 |
| `app/modals/` | 模态对话框（关于、连接、提示等） |
| `app/monaco/` | Monaco 编辑器集成 |
| `app/treeview/` | 树形视图组件 |
| `app/hook/` | 自定义 React Hooks |
| `app/shadcn/` | shadcn/ui 组件库 |
| `util/` | 工具函数（颜色、字体、键盘、平台等） |
| `types/` | TypeScript 类型定义（Go 类型映射、事件类型等） |

---

## 6. wsh 命令行系统

`wsh` 是 Wave Terminal 的命令行工具，允许用户从终端管理工作区。

### 6.1 入口 (`cmd/wsh/main-wsh.go`)

通过 Unix Domain Socket 与 wavesrv 通信。

### 6.2 命令列表

| 命令 | 文件 | 说明 |
|------|------|------|
| `wsh run` | `wshcmd-run.go` | 运行命令 |
| `wsh term` | `wshcmd-term.go` | 终端操作 |
| `wsh ai` | `wshcmd-ai.go` | AI 交互 |
| `wsh agent` | `wshcmd-agent.go` | Agent 模式 |
| `wsh blocks` | `wshcmd-blocks.go` | 块管理 |
| `wsh createblock` | `wshcmd-createblock.go` | 创建块 |
| `wsh deleteblock` | `wshcmd-deleteblock.go` | 删除块 |
| `wsh focusblock` | `wshcmd-focusblock.go` | 聚焦块 |
| `wsh conn` | `wshcmd-conn.go` | 连接管理 |
| `wsh connserver` | `wshcmd-connserver.go` | 连接服务器 |
| `wsh file` | `wshcmd-file.go` | 文件操作 |
| `wsh readfile` | `wshcmd-readfile.go` | 读取文件 |
| `wsh editconfig` | `wshcmd-editconfig.go` | 编辑配置 |
| `wsh setconfig` | `wshcmd-setconfig.go` | 设置配置 |
| `wsh getvar` | `wshcmd-getvar.go` | 获取变量 |
| `wsh setvar` | `wshcmd-setvar.go` | 设置变量 |
| `wsh getmeta` | `wshcmd-getmeta.go` | 获取元数据 |
| `wsh setmeta` | `wshcmd-setmeta.go` | 设置元数据 |
| `wsh secret` | `wshcmd-secret.go` | 密钥管理 |
| `wsh ssh` | `wshcmd-ssh.go` | SSH 操作 |
| `wsh wsl` | `wshcmd-wsl.go` | WSL 操作 |
| `wsh view` | `wshcmd-view.go` | 视图操作 |
| `wsh workspace` | `wshcmd-workspace.go` | 工作区操作 |
| `wsh editor` | `wshcmd-editor.go` | 编辑器操作 |
| `wsh web` | `wshcmd-web.go` | Web 操作 |
| `wsh notify` | `wshcmd-notify.go` | 通知 |
| `wsh version` | `wshcmd-version.go` | 版本信息 |
| `wsh token` | `wshcmd-token.go` | Token 管理 |
| `wsh debug` | `wshcmd-debug.go` | 调试工具 |
| `wsh setbg` | `wshcmd-setbg.go` | 设置背景 |
| `wsh tabindicator` | `wshcmd-tabindicator.go` | 标签指示器 |
| `wsh wavepath` | `wshcmd-wavepath.go` | Wave 路径 |
| `wsh launch` | `wshcmd-launch.go` | 启动应用 |
| `wsh rcfiles` | `wshcmd-rcfiles.go` | RC 文件管理 |
| `wsh jobmanager` | `wshcmd-jobmanager.go` | 作业管理 |
| `wsh jobdebug` | `wshcmd-jobdebug.go` | 作业调试 |
| `wsh shell` | `wshcmd-shell-*.go` | Shell 操作（平台特定） |

---

## 7. 通信协议与数据流

### 7.1 WebSocket 协议

前端通过 WebSocket 与 Go 后端保持实时连接。

**连接建立**:

```
前端 → GET /ws?routeId=<windowId>&authKey=<key>
Go 后端 → 101 Switching Protocols
```

**消息格式** (JSON):

```json
{
  "type": "event|rpc|rpcresponse",
  "data": { ... }
}
```

### 7.2 HTTP Service API

```
POST /api/service
Content-Type: application/json

{
  "service": "block",
  "method": "CreateBlock",
  "uicontext": { "windowId": "...", "tabId": "...", "blockId": "..." },
  "args": [{ "view": "term", "meta": {} }]
}
```

### 7.3 RPC 通信

WSH RPC 使用 Unix Domain Socket 进行进程间通信：

```
wsh CLI → Unix Socket → wshutil.WshRouter → wshremote.RemoteRpcServerImpl → wavesrv
```

**RPC 类型定义** (`pkg/wshrpc/wshrpctypes.go`):

定义了 `WshRpcInterface` 接口，包含所有 RPC 方法声明，如：
- `CommandAuthenticate`
- `CommandCreateBlock`
- `CommandDeleteBlock`
- `CommandRun`
- `CommandAi`
- `CommandFile*`
- `CommandConn*`
- 等等

### 7.4 事件推送流程

```
Go 后端状态变更
  → wcore.SendWaveObjUpdate(updates)
  → wps.Publish(Event_WaveObjUpdate, updates)
  → WebSocket 连接推送
  → 前端 wps.ts 接收事件
  → Jotai 原子更新
  → React 组件重渲染
```

---

## 8. 数据模型与对象系统

### 8.1 核心对象关系

```
Client (单例)
 └── Window[]
      └── activeWorkspaceId → Workspace
           └── Tab[]
                └── Block[]
                     └── view: term|waveai|webview|preview|...
```

### 8.2 对象引用 (ORef)

所有对象通过 `ORef` (格式: `"otype:oid"`) 引用，支持：

- 类型安全的对象查找
- 前后端统一的引用格式
- 元数据 (Meta) 附加

### 8.3 对象更新 (WaveObjUpdate)

```go
type WaveObjUpdate struct {
    ORef    ORef      `json:"oref"`
    OType   string    `json:"otype"`
    OID     string    `json:"oid"`
    Op      string    `json:"op"`     // "set" | "del" | "update"
    Data    WaveObj   `json:"data"`
    Meta    map[string]any `json:"meta"`
}
```

### 8.4 UI 上下文 (UIContext)

```go
type UIContext struct {
    WindowId   string `json:"windowId"`
    TabId      string `json:"tabId"`
    BlockId    string `json:"blockId"`
    Conn       string `json:"conn"`
}
```

---

## 9. 依赖关系图

### 9.1 Go 后端包依赖

```
cmd/server
 ├── wcore ──┬── wstore ─── db (SQLite)
 │            ├── wps ────── eventbus
 │            ├── wshrpc ─── wshutil
 │            └── waveobj
 ├── service ──┬── blockservice ── blockcontroller ── jobcontroller ── jobmanager
 │              ├── windowservice ── wcore
 │              ├── workspaceservice ── wcore
 │              ├── clientservice ── wcore
 │              ├── objectservice ── wstore
 │              ├── kbservice ── knowledgebase
 │              └── userinputservice ── userinput
 ├── aiusechat ──┬── openai / gemini / anthropic
 │                ├── chatstore
 │                ├── skills
 │                └── uctypes
 ├── remote ──┬── sshclient ── genconn
 │             ├── connparse
 │             └── fileshare ── wshfs
 ├── web ──┬── ws (WebSocket)
 │          └── service handler
 ├── wconfig ── schema
 ├── filestore
 ├── secretstore
 ├── authkey
 ├── telemetry ── wcloud
 └── shellexec
```

### 9.2 前端模块依赖

```
app.tsx
 ├── store/ ──┬── global-model ── global-atoms ── jotaiStore
 │             ├── wps ── wshclient ── wshclientapi ── wshrouter
 │             ├── ws ── services
 │             ├── tab-model
 │             ├── client-model
 │             ├── focusManager
 │             ├── kb-model ── kb-api
 │             ├── contextmenu
 │             ├── modalmodel
 │             └── keymodel
 ├── workspace.tsx ── widgets ── widgetwidth
 ├── tab.tsx ── tabbar ── vtabbar
 ├── block.tsx ── block-model ── blocktypes
 │    ├── view/term ── term-model ── xterm
 │    ├── view/waveai ── aipanel
 │    ├── view/webview
 │    ├── view/preview
 │    └── view/docker / network / sysinfo / tmux
 └── layout/ ──┬── layoutModel ── layoutAtom
                ├── layoutTree ── layoutNode
                └── TileLayout
```

### 9.3 关键外部依赖

**Go 依赖**:

| 依赖 | 用途 |
|------|------|
| `gorilla/websocket` | WebSocket 服务器 |
| `gorilla/mux` | HTTP 路由 |
| `mattn/go-sqlite3` | SQLite 驱动 (CGO) |
| `jmoiron/sqlx` | SQL 扩展 |
| `golang-migrate/migrate` | 数据库迁移 |
| `spf13/cobra` | CLI 框架 (wsh) |
| `sashabaranov/go-openai` | OpenAI API 客户端 |
| `google/generative-ai-go` | Google Gemini API |
| `golang-jwt/jwt` | JWT 认证 |
| `golang.org/x/crypto` | SSH 协议 |
| `shirou/gopsutil` | 系统信息 |
| `fsnotify/fsnotify` | 文件系统监视 |
| `invopop/jsonschema` | JSON Schema 生成 |

**前端依赖**:

| 依赖 | 用途 |
|------|------|
| `react` / `react-dom` | UI 框架 |
| `jotai` | 原子化状态管理 |
| `@xterm/xterm` | 终端渲染 |
| `monaco-editor` | 代码编辑器 |
| `@ai-sdk/react` / `ai` | Vercel AI SDK |
| `react-dnd` | 拖拽功能 |
| `react-markdown` | Markdown 渲染 |
| `mermaid` | 图表渲染 |
| `shiki` | 代码高亮 |
| `@milkdown/*` | 富文本编辑器 |
| `@tanstack/react-table` | 表格组件 |
| `@tanstack/react-virtual` | 虚拟滚动 |
| `recharts` | 图表 |
| `papaparse` | CSV 解析 |
| `ws` | WebSocket 客户端 |
| `immer` | 不可变数据 |
| `rxjs` | 响应式编程 |
| `tailwindcss` | CSS 框架 |

---

## 10. 构建与运行

### 10.1 前置条件

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Go | 1.25+ | 后端编译 |
| Node.js | 22 LTS | 前端编译 |
| Task | 最新 | 构建任务运行器 (https://taskfile.dev) |
| Zig | 最新 | CGO 静态链接 (Linux/Windows) |

### 10.2 初始化

```bash
task init
# 等价于: npm install && go mod tidy && cd docs && npm install
```

### 10.3 开发模式

```bash
# 带热重载的开发服务器
task dev

# 无热重载的独立运行
task start

# 快速开发 (macOS arm64, 跳过代码生成)
task electron:quickdev

# 快速开发 (Windows amd64)
task electron:winquickdev
```

### 10.4 构建

```bash
# 构建前端 (开发模式)
task build:frontend:dev

# 构建后端 (wavesrv + wsh)
task build:backend

# 仅构建 wavesrv
task build:server

# 仅构建 wsh
task build:wsh

# 生成 TypeScript 绑定
task generate

# 生产构建 + 打包
task package
```

### 10.5 测试

```bash
# 前端测试
npm test

# 前端测试 + 覆盖率
npm run coverage

# TypeScript 类型检查
task check:ts

# Go 测试
go test ./pkg/...
```

### 10.6 构建产物

| 产物 | 路径 | 说明 |
|------|------|------|
| wavesrv | `dist/bin/wavesrv.*` | Go 后端二进制 |
| wsh | `dist/bin/wsh-*` | WSH CLI 工具 (多平台) |
| 前端 | `dist/frontend/` | 前端构建产物 |
| Electron 主进程 | `dist/main/` | Electron 主进程构建 |
| 预加载脚本 | `dist/preload/` | Electron 预加载脚本 |
| 安装包 | `make/` | 平台安装包 |

### 10.7 开发数据目录

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/waveterm-dev/` |
| Linux | `~/.local/share/waveterm-dev/` |
| Windows | `%LOCALAPPDATA%\waveterm-dev\Data\` |

### 10.8 日志

| 日志 | 路径 |
|------|------|
| 前端 + Go 后端 | `~/.waveterm-dev/waveapp.log` |
| Go 后端 (stderr) | Electron 主进程捕获 |

---

## 11. 项目目录结构

```
waveterm/
 ├── cmd/                    # Go 命令入口
 │   ├── server/             # wavesrv 主服务器
 │   ├── wsh/                # wsh CLI 工具
 │   │   └── cmd/            # wsh 子命令
 │   ├── generatets/         # TypeScript 类型生成器
 │   ├── generatego/         # Go 代码生成器
 │   ├── packfiles/          # 文件打包工具
 │   ├── test*/              # 各种测试工具
 │   └── testai/             # AI 测试工具
 ├── pkg/                    # Go 核心包
 │   ├── wcore/              # 核心业务逻辑
 │   ├── waveobj/            # 波对象类型系统
 │   ├── wstore/             # 数据持久化 (SQLite)
 │   ├── wps/                # PubSub 事件系统
 │   ├── wconfig/            # 配置管理
 │   ├── wshrpc/             # RPC 类型定义
 │   ├── wshutil/            # WSH 工具
 │   ├── service/            # Service 层框架
 │   │   ├── blockservice/   # 块服务
 │   │   ├── clientservice/  # 客户端服务
 │   │   ├── windowservice/  # 窗口服务
 │   │   ├── workspaceservice/ # 工作区服务
 │   │   ├── objectservice/  # 对象服务
 │   │   ├── kbservice/     # 知识库服务
 │   │   └── userinputservice/ # 用户输入服务
 │   ├── web/                # HTTP/WS 服务器
 │   ├── aiusechat/          # AI 聊天系统
 │   │   ├── openai/         # OpenAI 后端
 │   │   ├── gemini/         # Gemini 后端
 │   │   ├── chatstore/      # 聊天存储
 │   │   ├── skills/         # AI 技能
 │   │   └── uctypes/        # UseChat 类型
 │   ├── remote/             # 远程连接
 │   │   ├── connparse/      # 连接解析
 │   │   ├── conncontroller/ # 连接控制器
 │   │   └── fileshare/      # 文件共享
 │   │       ├── wshfs/      # WSH 文件系统
 │   │       ├── fspath/     # 路径处理
 │   │       └── fsutil/     # 文件系统工具
 │   ├── genconn/            # 通用连接 (SSH/WSL)
 │   ├── blockcontroller/    # 块控制器
 │   ├── jobcontroller/      # 作业控制器
 │   ├── jobmanager/         # 作业管理器
 │   ├── streamclient/       # 流客户端
 │   ├── shellexec/          # Shell 执行
 │   ├── filestore/          # 文件存储
 │   ├── suggestion/         # 命令建议
 │   ├── knowledgebase/      # 知识库
 │   ├── secretstore/        # 密钥存储
 │   ├── authkey/            # 认证密钥
 │   ├── schema/             # Schema 生成
 │   ├── ijson/              # 增量 JSON
 │   ├── telemetry/          # 遥测
 │   ├── eventbus/           # 事件总线
 │   ├── filebackup/         # 文件备份
 │   ├── faviconcache/       # 图标缓存
 │   ├── panichandler/       # Panic 处理
 │   ├── blocklogger/        # 块日志
 │   ├── baseds/             # 基础数据存储
 │   ├── tsgen/              # TS 代码生成
 │   ├── gogen/              # Go 代码生成
 │   ├── userinput/          # 用户输入
 │   ├── trimquotes/         # 工具
 │   └── util/               # 通用工具
 │       ├── daystr/         # 日期字符串
 │       ├── dbutil/         # 数据库工具
 │       ├── ds/             # 数据结构
 │       ├── envutil/        # 环境变量
 │       └── fileutil/       # 文件工具
 ├── emain/                  # Electron 主进程
 ├── frontend/               # 前端 React 应用
 │   ├── app/                # 应用代码
 │   │   ├── store/          # 状态管理
 │   │   ├── block/          # 块组件
 │   │   ├── view/           # 视图组件
 │   │   │   ├── term/       # 终端
 │   │   │   ├── waveai/     # AI
 │   │   │   ├── webview/    # 网页
 │   │   │   ├── preview/    # 预览
 │   │   │   ├── docker/     # Docker
 │   │   │   ├── network/    # 网络
 │   │   │   ├── sysinfo/    # 系统信息
 │   │   │   └── tmux/       # Tmux
 │   │   ├── aipanel/        # AI 面板
 │   │   ├── element/        # UI 组件
 │   │   ├── tab/            # 标签页
 │   │   ├── workspace/      # 工作区
 │   │   ├── modals/         # 模态框
 │   │   ├── monaco/         # 编辑器
 │   │   ├── treeview/       # 树视图
 │   │   ├── hook/           # React Hooks
 │   │   ├── shadcn/         # shadcn/ui
 │   │   └── asset/          # 静态资源
 │   ├── layout/             # 布局系统
 │   ├── preview/            # 组件预览
 │   ├── types/              # 类型定义
 │   └── util/               # 工具函数
 ├── db/                     # 数据库迁移
 ├── docs/                   # 文档站点 (Docusaurus)
 ├── build/                  # 构建资源 (图标等)
 ├── assets/                 # 项目资源
 ├── aiprompts/              # AI 提示词文档
 ├── tsunami/                # Tsunami 框架 (实验性)
 ├── .github/                # GitHub CI/CD
 ├── Taskfile.yml            # 构建任务定义
 ├── electron.vite.config.ts # Vite 配置
 ├── electron-builder.config.cjs # 打包配置
 ├── go.mod / go.sum         # Go 依赖
 ├── package.json            # Node 依赖
 └── BUILD.md                # 构建文档
```

---

> 本文档基于 waveterm v0.15.0 源码分析生成，最后更新: 2026-06-08
