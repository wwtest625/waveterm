# AI 面板视觉整体优化方案
 
## 目标
让真实产品在 Win11 + Electron + 125%/150% 缩放环境下，恢复 showcase (`aipanel-showcase.html`) 那种清晰的卡片层次和协调的配色。
**范围限定：纯视觉（className 层面），零逻辑改动。**
 
---
 
## 三大改动
 
### 改动 A：透明度提档（解决"层次糊掉"）
在分数缩放下，`/[0.015]`、`/[0.04]` 这类极低透明度会被亚像素渲染抹平，导致卡片贴在一起。
 
**全局规则**（机械替换，文件内全量）：
- `bg-white/[0.015]` → `bg-white/[0.04]`
- `border-white/[0.04]` → `border-white/[0.08]`
- `bg-white/[0.03]`（小按钮背景）→ `bg-white/[0.05]`
 
**涉及文件**（5 个）：
- `frontend/app/aipanel/ai-assistant-output.tsx`（L307、L311、L318、L384、L388 等）
- `frontend/app/aipanel/aipanelmessages.tsx`（L112 PanelHero 背景/边框）
- `frontend/app/aipanel/ai-taskchain.tsx`（多处 task-chain 容器）
- `frontend/app/aipanel/aipanelinput.tsx`（L295、L308）
- `frontend/app/aipanel/aiminorcomponents.tsx`
 
---
 
### 改动 B：面板常驻边框（解决"面板没边界"）
**文件**：`frontend/app/aipanel/aipanel.tsx` L192-194
 
**当前代码**：
```tsx
"rounded-tr-[12px] rounded-br-[12px] rounded-bl-[12px]",   // 缺左上角
isFocused ? "border border-white/[0.04]" : "border-none"   // 未聚焦时无任何边框
```
 
**改为**：
```tsx
"rounded-tr-[12px] rounded-br-[12px] rounded-bl-[12px] rounded-tl-[12px]",  // 补齐左上角
isFocused ? "border border-accent/30" : "border border-white/[0.08]"         // 常驻边框 + 聚焦态高亮
```
 
- 补齐 `rounded-tl-[12px]`：消除非对称圆角带来的"歪"感。
- 未聚焦态：`border-white/[0.08]` 常驻边框，面板永远有清晰边界。
- 聚焦态：`border-accent/30`，用主题色发光提示当前焦点（跟随 `--color-accent`）。
 
---
 
### 改动 C：统一配色到 `--color-accent`（解决"三种绿打架"）
把硬编码的 `lime-*` 和 `emerald-*` 全部迁移到 `accent` 工具类。
`--color-accent`（`tailwindsetup.css:36` = `rgb(88,193,66)`）通过 Tailwind v4 `@theme` 已自动生成 `bg-accent`/`text-accent`/`border-accent` 全套工具类，零基础设施成本。
 
**机械映射规则**：
| 旧（硬编码） | 新（跟随主题） |
|---|---|
| `lime-300` | `accent` |
| `lime-200` | `accent-200`（亮一档） |
| `lime-100` | `accent-100` |
| `emerald-300` | `accent-300` |
| `emerald-200` | `accent-200` |
| `emerald-100` | `accent-100` |
| `emerald-400` | `accent` |
| `emerald-500` | `accent-500` |
 
> 注意：`accent`（即 `accent-400`）与旧 `emerald-400`/`lime-300` 的实际 RGB 接近，视觉差异极小，但实现了"主题色可换"。
 
**保留不变的语义色**（**不迁移**，避免破坏功能含义）：
- `aipanel-context-chips.tsx` 的 `TYPE_STYLES`：`file=emerald` 只是文件类型的分类色编码（skill=amber/kb=blue/terminal=purple 等），**不是主色**。迁移会破坏视觉编码系统。
- `aitooluse.tsx` L265 的 `text-green-400`（diff `+` 号）：这是"新增行"语义色，与 `text-red-400`（删除行）配对，**保留**。
- `askusercard.tsx` 的 `blue-*`（非推荐选项）、`amber`（确认/警告）、`red`（拒绝）：状态语义色，**保留**。但其中的 `emerald-*`（推荐选项）**迁移**到 accent。
- `taskprogresspanel.tsx`：**已用 accent + 残留 1 处 emerald-400**，把残留的 L19 `text-emerald-400` 改为 `text-accent`，统一掉。
 
**迁移清单**（每处 file:line 都已在前置 Explore 报告中列出，共 44 处，分布在 8 个文件）：
1. `ai-assistant-output.tsx`（17 处）
2. `ai-taskchain.tsx`（15 处 + 2 处 zinc-400/70）
3. `aipanelinput.tsx`（3 处）
4. `aipanelmessages.tsx`（1 处）
5. `aipanel-queued-messages.tsx`（2 处）
6. `askusercard.tsx`（5 处 emerald，blue 保留）
7. `agentstatus.tsx`（1 处）
8. `taskprogresspanel.tsx`（1 处 emerald → accent）
 
---
 
## 不在本次范围（已和你确认排除）
- ❌ **TaskChain 长链折叠**（功能增强，~150 行逻辑改动，风险大）
- ❌ **字体引入**（Inter / JetBrains Mono 已通过 `fontutil.ts` FontFace API 加载，无需改动）
- ❌ **阴影分层、聚焦态发光等额外视觉打磨**（本轮只做三件事）
 
---
 
## 验证方式
1. **编译验证**：`cd frontend && npm run build`（或项目的标准构建命令）无 TS 错误。
2. **视觉验证**：
   - 启动应用，打开 AI 面板，确认：面板有清晰边界、用户卡/助手卡/任务链之间有明显层次、所有绿色色调一致（无 emerald/lime 混杂）。
   - 切换主题色（如果 UI 支持），确认 AI 面板主色跟随变化。
   - 在 Win11 125% 缩放下确认卡片仍可分辨（不再"糊在一起"）。
3. **回归验证**：
   - ContextChips 各类型仍保持不同颜色（file≠skill≠kb）。
   - askusercard 的推荐选项是绿色、普通选项仍是蓝色。
   - diff 预览的 `+`/`-` 仍是绿/红。
4. **现有单测**：`frontend/app/aipanel/tests/` 下测试全部通过（本改动不动逻辑，预期无影响）。
 
---
 
## 执行顺序（建议）
1. 先做 **改动 B（面板边框）** —— 单文件、改动最小、效果最直观，做完就能看到"面板有边界了"。
2. 再做 **改动 C（配色统一）** —— 按文件逐个迁移，每改完一个文件编译一次确认无 TS 错误。
3. 最后做 **改动 A（透明度提档）** —— 机械替换，覆盖 5 个文件。
4. 全部完成后跑一次完整构建 + 视觉回归。
 