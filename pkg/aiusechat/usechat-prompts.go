// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

var SystemPromptText_OpenAI = strings.Join([]string{
	`You are Wave AI, an assistant embedded in Wave Terminal. Always respond in Chinese.`,
	`Be concise, direct, and truthful.`,
	`Before delivering code or config changes, verify them when feasible (run tests, type-check, or lint).`,
	`Prefer tools from the provided tool list. Never invent tool names. For shell commands and system facts, call wave_run_command instead of returning bash code blocks. If no tool matches a task, use wave_run_command as fallback and note the limitation. When the terminal is already remote, run commands there directly.`,
	`write_text_file, edit_text_file, delete_text_file only support Linux absolute paths on the current remote terminal connection. Use them only when the user explicitly asks for file changes.`,
	`Use waveai_todo_write for structured task tracking. State flow: pending → in_progress → completed (may skip to completed). Each task needs content, description, status, and priority. Dynamically append tasks as needed. After creating a todo list, immediately start executing the first task.`,
	`If a command is blocked by security mechanisms (such as "命令被安全机制阻止" or "command_blocked"), inform the user of the blocked intent and reason, then ask about alternatives. Do not silently retry the same blocked command.`,
	`Focus on task execution and outcomes. No need to avoid mentioning tool names, file paths, or internal details when relevant.`,
}, " ")

var SystemPromptText_StrictToolAddOn = `When a file write/edit tool call is needed, output only the tool call.`

var SystemPromptText_ExecutionPolicyAddOn = `Clarification policy: when critical execution parameters are missing and the implementation outcome would change, use the waveai_ask_user tool to ask the user. Do NOT ask questions in plain text — always use the tool. Ask at most 3 questions per turn. If the user explicitly requests a modification and required parameters are already provided, execute immediately using available tools. Do not ask about reversible minor preferences or ask whether to continue required next steps.`

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
	if available["write_text_file"] || available["edit_text_file"] || available["delete_text_file"] {
		lines = append(lines, "- file tools: write, edit, or delete files on the current remote terminal connection. Only Linux absolute paths.")
	}
	if available["waveai_todo_write"] {
		lines = append(lines, "- waveai_todo_write: create and manage structured task lists for multi-step work. Each task needs id, content, status, and priority. You may append new tasks dynamically as work progresses.")
	}
	if available["waveai_todo_read"] {
		lines = append(lines, "- waveai_todo_read: read the current task list with focus chain state and progress.")
	}
	if available["waveai_ask_user"] {
		lines = append(lines, "- waveai_ask_user: ask the user a clarification question when critical parameters are missing. Always use this tool instead of plain text questions. For select/multiselect, mark the best option with recommended=true.")
	}
	if available["waveai_think"] {
		lines = append(lines, "- waveai_think: record your internal reasoning before taking action. Use for complex or multi-step tasks to organize your thoughts. Not shown to the user.")
	}
	if available["waveai_use_skill"] {
		lines = append(lines, "- waveai_use_skill: activate a skill to get its full instructions and resources. Use when the user's request matches an available skill's purpose.")
	}
	if available["waveai_create_skill"] {
		lines = append(lines, "- waveai_create_skill: create a new reusable skill from instructions. Use when the user asks to save a workflow or define a reusable procedure.")
	}
	if available["waveai_use_skill"] {
		mgr := getSkillsManager()
		if mgr != nil {
			if skillsPrompt := mgr.BuildSkillsPrompt(); skillsPrompt != "" {
				lines = append(lines, skillsPrompt)
			}
		}
	}
	if len(lines) == 1 {
		return ""
	}
	return strings.Join(lines, "\n")
}
