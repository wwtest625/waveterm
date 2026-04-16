// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestAgentMode_AllowsToolsInPlanningMode(t *testing.T) {
	for _, toolName := range []string{
		"write_text_file",
		"term_inject_command",
		"builder_list_files",
		"tsunami_getdata_deadbeef",
		"tsunami_getconfig_deadbeef",
		"term_command_output",
		"wave_run_command",
	} {
		if err := validateToolForAgentMode(AgentModePlanning, toolName); err != nil {
			t.Fatalf("expected planning mode to allow %s, got %v", toolName, err)
		}
	}
}

func TestAgentMode_DefaultAndAutoApprovePolicies(t *testing.T) {
	defaultApproval := applyAgentModeApprovalPolicy(AgentModeDefault, "write_text_file", uctypes.ApprovalNeedsApproval)
	if defaultApproval != uctypes.ApprovalNeedsApproval {
		t.Fatalf("expected default mode to keep approval, got %q", defaultApproval)
	}

	autoApproval := applyAgentModeApprovalPolicy(AgentModeAutoApprove, "write_text_file", uctypes.ApprovalNeedsApproval)
	if autoApproval != uctypes.ApprovalAutoApproved {
		t.Fatalf("expected auto-approve mode to auto approve write_text_file, got %q", autoApproval)
	}
	autoRunApproval := applyAgentModeApprovalPolicy(AgentModeAutoApprove, "wave_run_command", uctypes.ApprovalNeedsApproval)
	if autoRunApproval != uctypes.ApprovalAutoApproved {
		t.Fatalf("expected auto-approve mode to auto approve wave_run_command, got %q", autoRunApproval)
	}

	highRiskApproval := applyAgentModeApprovalPolicy(AgentModeAutoApprove, "term_inject_command", uctypes.ApprovalNeedsApproval)
	if highRiskApproval != uctypes.ApprovalNeedsApproval {
		t.Fatalf("expected high-risk actions to still require approval, got %q", highRiskApproval)
	}

	// Blocked commands should stay blocked regardless of mode
	blockedApproval := applyAgentModeApprovalPolicy(AgentModeAutoApprove, "wave_run_command", uctypes.ApprovalBlocked)
	if blockedApproval != uctypes.ApprovalBlocked {
		t.Fatalf("expected blocked commands to stay blocked, got %q", blockedApproval)
	}
}
