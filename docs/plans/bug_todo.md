# Bug Todo

## 2026-03-26 - Container terminal quick input completion notification fails and can block command send

- Symptom:
  - 宿主机终端里，quick input 完成通知可以正常工作。
  - 容器里的终端 block 开启通知后，输入框命令可能先被挂起，看起来像被吞掉。
  - 即使命令最终发出，完成后也可能始终没有弹窗通知。
- Confirmed observations:
  - 该问题只在容器环境复现，宿主机同样流程正常。
  - DevTools 已看到 `[term-notify]` 日志能完成 arm，但容器场景下命令边界信号不稳定。
  - 现象不是 block 之间串扰，而是同一个 block 内 shell integration 没可靠给出新命令的开始/结束边界。
- What has already been tried:
  - 只在当前 block `runtimeInfoReady=true` 且 integration 状态已知后再处理通知。
  - 为 quick input 增加 block 级挂起队列，integration 未知或当前 block 仍在 `running-command` 时先排队。
  - 已把逻辑改成当前 block 仍忙时不立刻把新输入塞进终端，而是等回到 `ready` 后再发送。
  - 增加额外调试日志，记录通知 arm、开始计时、状态变化、退出码兜底和耗时。
- Current hypothesis:
  - 容器里的 shell integration 没有稳定发出完整的 OSC 16162 生命周期，尤其是 `C -> D -> A` 这条边界链不完整。
  - 前端因此无法可靠判断 queued quick input 何时真正开始执行、何时真正结束。
- Current debugging instrumentation:
  - Renderer logs with prefix `[term-notify]` in `frontend/app/view/term/term-model.ts`.
  - 重点关注容器场景里是否能稳定看到 `running-command`、`shell-ready`、`exit-code-fallback` 这些日志。
- Next step:
  - 在容器里直接验证 Wave shell integration 脚本是否加载成功，以及 OSC 16162 的 `C`、`D`、`A` 是否按顺序发出。
  - 如果容器里确实缺失 `ready`/prompt 边界，就优先修容器 shell integration，而不是继续堆前端兜底。

## 2026-03-17 - Files widget width does not respect configured `display:width`

- Symptom:
  - Sidebar `files` widget is configured to `33%`.
  - Width selection from the preview context menu writes `display:width` correctly into the active config file.
  - Reopening the `files` widget from the left sidebar still lands at an apparent `50/50` split.
- Confirmed runtime config:
  - Active local config file is `C:\Users\sys49169\.config\waveterm-dev\widgets.json`.
  - `defwidget@files` already contains `"display:width": 33`.
- What has already been tried:
  - Added widget config schema/types and Sidebar Widgets UI support for `display:width`.
  - Applied preferred width when focusing an already-open widget.
  - Persisted preview-menu width changes back to `widgets.json`.
  - Added fallback target-block selection when reopening a widget after close.
  - Added delayed post-create width reapplication (`0ms` and `50ms`) after widget creation.
- Current hypothesis:
  - The create/open path is reading the desired width, but some later layout step or state refresh is resetting the split back to equal widths.
- Current debugging instrumentation:
  - Renderer logs with prefix `[widget-width-debug]` in:
    - `frontend/app/workspace/widgets.tsx`
    - `frontend/app/view/preview/preview-model.tsx`
- Next step:
  - Reproduce with DevTools console open and capture `[widget-width-debug]` lines to identify which step last forces the width back to `50%`.
