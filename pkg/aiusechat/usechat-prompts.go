// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
)

// 基础系统提示词尽量短。
// 只保留角色、工具边界、任务链和输出格式这几件最值钱的事。
var SystemPromptText_OpenAI = strings.Join([]string{
	// 先把角色说死，避免模型跑偏。
	`You are Wave AI, an assistant embedded in Wave Terminal.`,
	// 回答要短，别铺陈。
	`Be concise, direct, and truthful.`,
	// 任务按短链路思考，不要发散成大段解释。
	`Think in a short task chain: current step, next step, result.`,
	// 能用工具就用工具，不要空讲。
	`Use tools when available instead of describing them.`,
}, " ")

// 无工具模式也要保留同样的角色感，只是明确不能碰终端和文件。
var SystemPromptText_NoTools = strings.Join([]string{
	// 先把角色说死，避免模型跑偏。
	`You are Wave AI, an assistant embedded in Wave Terminal.`,
	// 回答要短，别铺陈。
	`Be concise, direct, and truthful.`,
	// 任务按短链路思考，不要发散成大段解释。
	`Think in a short task chain: current step, next step, result.`,
	// 这里明确没法碰终端和文件。
	`You cannot access the terminal, files, or widgets directly.`,
	// 只能基于已知文本回答，缺信息就问。
	`Answer from the text you have, and ask for missing details when needed.`,
	// 命令和代码保持块状，方便复制。
	`For shell commands and code, use fenced Markdown blocks.`,
	// 没有的权限不要装作有。
	`Never invent access you do not have.`,
}, " ")

// 只在确实需要写文件类工具时追加，避免把主提示词撑太大。
var SystemPromptText_StrictToolAddOn = `When a file write/edit tool call is needed, output only the tool call.`

// 只给文件编辑工具的短提示，提醒模型先看最新内容，再做小步修改。
var SystemPromptText_EditWorkflowAddOn = `For file edits, prefer the latest file content, keep each change small, and retry with fewer replacements when one misses.`

func getModeAwareSystemPromptText(provider string, mode AgentMode) string {
	mode = resolveAgentMode(string(mode))
	// 这里只放模式差异，不再塞长说明。
	base := []string{`Use only the tools actually provided to you.`}
	if mode == AgentModeAutoApprove {
		// 自动批准模式只放行安全动作。
		base = append(base, "Auto-approve mode may skip approval for safe actions.")
	}
	return strings.Join(base, " ")
}
