// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type AgentMode string

const (
	AgentModeDefault     AgentMode = "default"
	AgentModePlanning    AgentMode = "planning"
	AgentModeAutoApprove AgentMode = "auto-approve"
)

type TerminalAgentP0AcceptanceCriterion struct {
	Key         string
	Description string
	Required    bool
	ProofStatus string
}

func GetTerminalAgentP0AcceptanceCriteria() []TerminalAgentP0AcceptanceCriterion {
	return []TerminalAgentP0AcceptanceCriterion{
		{
			Key:         "agent-mode-visible-and-enforced",
			Description: "Agent mode is visible and enforced",
			Required:    true,
			ProofStatus: "partially-verified",
		},
		{
			Key:         "panel-shows-agent-runtime-state",
			Description: "Panel shows agent runtime state",
			Required:    true,
			ProofStatus: "documented-only",
		},
		{
			Key:         "user-activity-blocks-injection",
			Description: "Agent does not inject while user is active",
			Required:    true,
			ProofStatus: "documented-only",
		},
		{
			Key:         "prompt-capabilities-are-truthful",
			Description: "Local prompt truthfully describes capabilities",
			Required:    true,
			ProofStatus: "verified",
		},
		{
			Key:         "terminal-loop-read-inject-wait-read",
			Description: "Terminal loop completes a real read/inject/wait/read flow",
			Required:    true,
			ProofStatus: "host-implemented-not-verified-here",
		},
	}
}

func resolveAgentMode(raw string) AgentMode {
	switch AgentMode(strings.TrimSpace(strings.ToLower(raw))) {
	case AgentModePlanning:
		return AgentModePlanning
	case AgentModeAutoApprove:
		return AgentModeAutoApprove
	default:
		return AgentModeDefault
	}
}

func isReadOnlyAgentTool(toolName string) bool {
	if toolName == "" {
		return false
	}
	if strings.HasPrefix(toolName, "tsunami_getdata_") || strings.HasPrefix(toolName, "tsunami_getconfig_") {
		return true
	}
	switch toolName {
	case "capture_screenshot", "term_command_output", "builder_list_files":
		return true
	default:
		return false
	}
}

func isMediumRiskAgentTool(toolName string) bool {
	switch toolName {
	case "write_text_file", "edit_text_file":
		return true
	default:
		return false
	}
}

func validateToolForAgentMode(mode AgentMode, toolName string) error {
	return nil
}

func applyAgentModeApprovalPolicy(mode AgentMode, toolName string, approval string) string {
	if resolveAgentMode(string(mode)) != AgentModeAutoApprove {
		return approval
	}
	if approval != uctypes.ApprovalNeedsApproval {
		return approval
	}
	if isReadOnlyAgentTool(toolName) || isMediumRiskAgentTool(toolName) {
		return uctypes.ApprovalAutoApproved
	}
	return approval
}
