# Agent RPC Progress

更新时间是 2026-03-24。

这轮工作的目标，是让 `wsh agent` 在普通终端里也能工作，不再依赖 `WAVETERM_JWT`，并把常用 agent 子命令补到可实际使用的状态。

最开始的阻塞点有三处。第一处是 agent 模式初始化原先想沿用 token swap 的思路，但那个映射是进程内的，单独启动的 `wsh.exe` 看不到 `wavesrv` 进程里的 token，所以会在认证时失败。第二处是 standalone 场景下 socket 路径只会优先找正式目录，dev 实例实际监听在 `waveterm-dev`，导致命中了错误的 `wave.sock`。第三处是 `agent blocks list` 和 `agent getmeta` 这些命令虽然表面上已经接上了，但参数和数据来源还有旧路径残留，实跑时会碰到 `context token is required`、`no WAVETERM_BLOCKID env var set` 或直接返回 `null`。

现在非 JWT 的 agent 初始化链路已经改成服务端直接认证。`wsh agent` 会先连本机 socket，再调用 `agentauthenticate`，由服务端把当前连接提升成可信 leaf，并返回可继续使用的 RPC 上下文。这条链不再要求 `WAVETERM_JWT`。同时，agent 模式的 socket 解析已经支持自动尝试正式目录和 dev 目录，在没有 `WAVETERM_DATA_HOME` 的情况下也能找到正确的 `wave.sock`。

命令层现在已经补平了大部分实际使用路径。`wsh agent blocks list` 可以在普通终端直接列出当前可见 block。workspace 列表为空时，会自动回退到当前 workspace 的 block 查询，不再出现空结果被序列化成 `null`。`wsh agent getmeta` 现在同时支持 `--context-token` 和 `-b`，并且 `-b` 直接传裸 block UUID 也能工作，不再依赖 `WAVETERM_BLOCKID`。`wsh agent resolve-context` 也已经支持 `-b`。`wsh agent run-command` 已经可以从 block meta 里拿到连接和 cwd，在对应远端环境里起命令并回收结果。`wsh agent termscrollback` 的普通滚屏读取也已经补了后端兜底，不再强依赖前端 `feblock:*` 路由。

`termscrollback --lastcommand` 这条之前是最后一个缺口。原因不是命令行参数，而是旧实现完全依赖前端 block route，而外部 agent 场景通常没有这条路由。我这边已经把服务端补成了新的 `agenttermscrollback` RPC，它会按 block 反查 tab，再直接走后端的 terminal command result 能力。对应的 `wsh` 客户端和 agent 命令层也都已经接上了。

仓库代码层面的构建和验证已经完成。`go build -a -o wsh.exe cmd/wsh/main-wsh.go` 能通过。`go test ./cmd/wsh/... ./pkg/wshrpc/... ./pkg/service/blockservice/...` 能通过。`task build:backend:quickdev:windows` 也已经跑完，新的 `dist/bin/wavesrv.x64.exe` 和 Windows `wsh` 都已经生成。

命令实跑结果也已经确认过。`wsh agent blocks list` 正常返回当前三个终端 block。`wsh agent resolve-context -b <blockid>` 能正常生成 token。`wsh agent getmeta -b <blockid>` 和 `wsh agent getmeta --context-token <token>` 都能返回 block meta。`wsh agent run-command -b <blockid> -- /bin/sh -lc "pwd; echo __WAVE_OK__"` 可以成功执行并回收输出。`wsh agent termscrollback -b <blockid> --start 1 --end 20` 也已经能返回滚屏内容。

现在还差的不是代码，而是运行中的 dev 服务端进程切换。刚才实跑 `wsh agent termscrollback -b c25ae369-d19e-42c3-98ec-298372c955f1 --lastcommand` 时，返回的是 `command "agenttermscrollback" not found`。这说明当前终端连接到的还是旧的 `wavesrv` 进程，不是刚编好的新版本。只要把当前 dev 实例重启起来，让它吃到新的 `wavesrv.x64.exe`，这条命令就会走到刚补好的后端实现。

这轮实际改到的核心文件包括 `cmd/wsh/cmd/wshcmd-root.go`、`cmd/wsh/cmd/wshcmd-agent.go`、`cmd/wsh/cmd/wshcmd-agent_test.go`、`pkg/wshrpc/wshrpctypes.go`、`pkg/wshrpc/wshclient/wshclient.go`、`pkg/wshrpc/wshserver/wshserver.go`、`pkg/wshutil/wshrouter_controlimpl.go` 和 `emain/emain-window.ts`。其中前六个是 agent RPC 主链路，`wshrouter_controlimpl.go` 负责服务端控制面认证，`emain-window.ts` 是为了让 Windows quickdev 在慢一点的机器上不要因为 5 秒初始化超时而误判失败。
