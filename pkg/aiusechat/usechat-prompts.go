// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// 基础系统提示词尽量短。
// 只保留角色、工具边界、任务链和输出格式这几件最值钱的事。
var SystemPromptText_OpenAI = strings.Join([]string{
	// 先把角色说死，避免模型跑偏。
	`You are Wave AI, an assistant embedded in Wave Terminal. always response in chinese.`,
	// 回答要短，别铺陈。
	`Be concise, direct, and truthful,Deliverables must be tested before being delivered to users.`,
	// 任务按短链路思考，不要发散成大段解释。
	`Think in a short task chain: current step, next step, result.`,
	// 能用工具就用工具，不要空讲。
	`Use tools when available instead of describing them. For shell commands, terminal inspection, and system facts, call wave_run_command or the relevant terminal tool instead of returning a bash code block. When the current terminal is already remote, run the command there by default instead of suggesting a separate SSH hop.`,
	// 工具名必须来自当前提供列表，禁止杜撰。
	`Tool-calling hard rule: only call tools that are explicitly present in the provided tool list for the current request. Never invent tool names, aliases, or pseudo-tools (for example: "think").`,
	// 文件写入必须由用户明确提出，避免擅自落盘。
	`Do not call write_text_file, edit_text_file, or delete_text_file unless the user explicitly asks to save or modify local files. Do not fall back to bash heredocs or shell redirection for file writes when file tools are available.`,
	// 多步骤任务优先建立简短计划，并在执行中持续推进。
	`For multi-step tasks, create a short plan with waveai_create_plan before or during execution, then update it with waveai_advance_plan as tasks complete or become blocked. Keep plan items concrete and action-oriented.`,
}, " ")

// 只在确实需要写文件类工具时追加，避免把主提示词撑太大。
var SystemPromptText_StrictToolAddOn = `When a file write/edit tool call is needed, output only the tool call.`

// 只给文件编辑工具的短提示，提醒模型先看最新内容，再做小步修改。
var SystemPromptText_EditWorkflowAddOn = `For file edits, prefer the latest file content, keep each change small, and retry with fewer replacements when one misses.`

// read_text_file 工具的使用指导
var SystemPromptText_ReadFileWorkflowAddOn = `For reading files, use read_text_file instead of shell commands like "cat". When reading large files, use offset and limit parameters to read specific portions. For logs or command output, reading from the tail (offset = total_lines - limit) is often more useful than reading from the beginning.`

// 单一澄清策略：只在缺关键执行参数时提问，信息足够就直接执行。
var SystemPromptText_ExecutionPolicyAddOn = `Execution policy: ask questions only when critical execution parameters are missing and the implementation outcome would change. Ask at most 3 concrete questions. If the user explicitly requests a modification and required parameters are already provided, execute immediately using available tools. Do not ask about reversible minor preferences or ask whether to continue required next steps.`

func getModeAwareSystemPromptText(mode AgentMode) string {
	mode = resolveAgentMode(string(mode))
	if mode == AgentModeAutoApprove {
		return "Auto-approve mode may skip approval for safe actions."
	}
	return ""
}

func getToolCapabilityPrompt(tools []uctypes.ToolDefinition) string {
	if len(tools) == 0 {
		return ""
	}
	available := make(map[string]bool, len(tools))
	for _, tool := range tools {
		available[tool.Name] = true
	}
	var lines []string
	lines = append(lines, "Current tool capabilities:")
	if available["wave_run_command"] {
		lines = append(lines, "- wave_run_command: execute shell commands on the current Wave connection or current terminal target.")
	}
	if available["term_command_output"] {
		lines = append(lines, "- terminal output tools: inspect terminal scrollback and recent command output (start with a small recent slice, do not fetch full history by default).")
	}
	if available["write_text_file"] || available["edit_text_file"] || available["delete_text_file"] {
		lines = append(lines, "- file tools: write, edit, or delete local files when the user explicitly asks for file changes.")
	}
	if available["read_text_file"] {
		lines = append(lines, "- read_text_file: read local files with offset/limit support. Preferred over shell commands like 'cat' for file inspection.")
	}
	if available["capture_screenshot"] {
		lines = append(lines, "- capture_screenshot: inspect the visible widget when visual context is needed.")
	}
	if available["waveai_create_plan"] {
		lines = append(lines, "- waveai_create_plan: create a short task plan for multi-step work.")
	}
	if available["waveai_advance_plan"] {
		lines = append(lines, "- waveai_advance_plan: advance or block the active task plan as work progresses.")
	}
	if len(lines) == 1 {
		return ""
	}
	return strings.Join(lines, "\n")
}
