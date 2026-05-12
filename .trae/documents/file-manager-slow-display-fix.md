# 文件管理器点击文件内容显示慢 - 问题诊断与修复计划

## 问题描述
在 waveterm 的文件管理器中，点击文件后内容显示非常慢。

## 当前状态分析

### 完整的点击文件显示流程
1. 用户双击文件 → `handleFileActivation()` ([preview-directory.tsx:371](frontend/app/view/preview/preview-directory.tsx#L371))
2. 调用 `openPreviewInNewBlock()` → 创建新 block ([previewutil.ts:21](frontend/util/previewutil.ts#L21))
3. 新 block 创建 `PreviewModel` ([preview-model.tsx:176](frontend/app/view/preview/preview-model.tsx#L176))
4. `PreviewView` 渲染 → 等待 `specializedView` 解析 → 渲染对应视图组件

### 发现的性能瓶颈（按严重程度排序）

#### 🔴 瓶颈 1：串行异步 Atom 依赖链（最关键）
[preview-model.tsx](frontend/app/view/preview/preview-model.tsx) 中的 atom 依赖链导致渲染必须等待多个串行异步操作：

```
statFile (FileInfoCommand RPC)
  → fileMimeType (派生自 statFile)
    → specializedView (依赖 fileMimeType + statFile)

fullFile (FileReadCommand RPC, 依赖 statFile 中的 path)
  → fileContent (base64 解码 fullFile)
```

**问题**：`specializedView` 和 `fileContent` 是串行解析的。必须等 `statFile` → `fileMimeType` → `specializedView` 全部完成后，才能确定渲染哪个视图组件；然后视图组件还需要等 `fileContent`（依赖 `fullFile`）完成。总延迟 = statFile延迟 + fileMimeType延迟 + specializedView延迟 + fullFile延迟。

#### 🔴 瓶颈 2：后端 `fileInfoInternal` 的 `checkIsReadOnly` 不必要 I/O
[wshremote_file.go:474](pkg/wshrpc/wshremote/wshremote_file.go#L474) 中 `fileInfoInternal(path, true)` 在 `extended=true` 时调用 `checkIsReadOnly`：

```go
func checkIsReadOnly(path string, fileInfo fs.FileInfo, exists bool) bool {
    if !exists || fileInfo.Mode().IsDir() {
        // 对目录：创建临时文件然后删除！
        randHexStr, _ := utilfn.RandomHexString(12)
        tmpFileName := filepath.Join(dirName, "wsh-tmp-"+randHexStr)
        fd, err := os.Create(tmpFileName)  // I/O 操作
        utilfn.GracefulClose(fd, ...)
        os.Remove(tmpFileName)              // I/O 操作
        return false
    }
    // 对文件：尝试以写模式打开
    file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0666)  // I/O 操作
    ...
}
```

**问题**：每次获取文件信息都会执行额外的文件 I/O 来检测只读属性，在网络文件系统上尤其慢。

#### 🔴 瓶颈 3：后端 `DetectMimeType(extended=true)` 读取文件内容
[fileutil.go:68](pkg/util/fileutil/fileutil.go#L68) 中，当 `extended=true` 时：

```go
func DetectMimeType(path string, fileInfo fs.FileInfo, extended bool) string {
    ...
    if !extended { return "" }
    fd, err := os.Open(path)           // 打开文件
    buf := make([]byte, 512)
    n, _ := io.ReadAtLeast(fd, buf, 512)  // 读取 512 字节
    rtn := http.DetectContentType(buf)     // 检测 MIME 类型
    ...
}
```

**问题**：每次 FileInfo 调用都会额外打开文件并读取 512 字节来检测 MIME 类型，即使扩展名已经能确定类型。

#### 🟡 瓶颈 4：文件被读取两次
- `statFile`（通过 `FileInfoCommand`）已经读取了 512 字节用于 MIME 检测
- `fullFile`（通过 `FileReadCommand`）再次读取整个文件内容
- 文件被重复打开和读取

#### 🟡 瓶颈 5：`ConnEnsureCommand` 60秒超时
[preview-model.tsx:424](frontend/app/view/preview/preview-model.tsx#L424)：
```typescript
await RpcApi.ConnEnsureCommand(TabRpcClient, { connname: connName }, { timeout: 60000 });
```
如果连接建立慢，整个预览流程会被阻塞。

#### 🟡 瓶颈 6：`preview.tsx` 中 useEffect 预取 fullFile
[preview.tsx:113](frontend/app/view/preview/preview.tsx#L113)：
```typescript
useEffect(() => {
    globalStore.get(model.fullFile).catch(() => {});
}, [model, refreshVersion]);
```
这会在 specializedView 确定之前就预取 fullFile，对于非文本文件（如目录、图片等）是浪费的。

## 修复方案

### 修复 1：优化 `DetectMimeType` - 扩展名优先，减少 extended 模式使用
**文件**: `pkg/util/fileutil/fileutil.go`

- 扩展 `StaticMimeTypeMap`，覆盖更多常见文件类型
- 在 `statToFileInfo` 中，对目录列表场景使用 `extended=false`（仅依赖扩展名）
- 只在真正需要时（单个文件预览）才使用 `extended=true`

### 修复 2：延迟/跳过 `checkIsReadOnly`
**文件**: `pkg/wshrpc/wshremote/wshremote_file.go`

- 在目录列表（`RemoteListEntriesCommand`）中不调用 `checkIsReadOnly`
- 只在用户实际进入编辑模式时才检测只读属性
- 或者使用文件权限位来推断只读属性，而不是实际尝试打开文件

### 修复 3：前端并行化 RPC 调用
**文件**: `frontend/app/view/preview/preview-model.tsx`

- 让 `fullFile` 不依赖 `statFile`，而是直接使用 `metaFilePath` 构造路径
- 让 `statFile` 和 `fullFile` 可以并行请求
- 这样 specializedView 和 fileContent 可以更快就绪

### 修复 4：合并 FileInfo 和 FileRead 为单次 RPC
**文件**: 后端 `wshremote_file.go` + 前端 `preview-model.tsx`

- 创建一个新的 RPC 命令，在一次调用中返回文件信息 + 文件内容
- 避免两次独立的网络往返

### 修复 5：移除不必要的 fullFile 预取
**文件**: `frontend/app/view/preview/preview.tsx`

- 移除 `useEffect` 中的 `globalStore.get(model.fullFile)` 预取
- 让 fileContent atom 按需获取

## 实施优先级

1. **修复 2**（跳过 checkIsReadOnly）- 影响最大，实现最简单
2. **修复 1**（优化 DetectMimeType）- 减少不必要的文件 I/O
3. **修复 5**（移除预取）- 简单修改，减少不必要请求
4. **修复 3**（并行化 RPC）- 需要重构 atom 依赖
5. **修复 4**（合并 RPC）- 影响最大但改动也最大

## 验证步骤

1. 在文件管理器中点击不同类型的文件，测量显示时间
2. 对比修改前后的性能
3. 确保文件只读检测仍然在编辑场景下正常工作
4. 确保所有文件类型的 MIME 检测仍然正确
