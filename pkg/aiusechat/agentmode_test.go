// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestAgentMode_PlanningBlocksWriteActions(t *testing.T) {
	err := validateToolForAgentMode(AgentModePlanning, "write_text_file")
	if err == nil {
		t.Fatalf("expected planning mode to block write_text_file")
	}

	err = validateToolForAgentMode(AgentModePlanning, "term_inject_command")
	if err == nil {
		t.Fatalf("expected planning mode to block term_inject_command")
	}

	if err := validateToolForAgentMode(AgentModePlanning, "read_dir"); err != nil {
		t.Fatalf("expected planning mode to allow read_dir, got %v", err)
	}
	if err := validateToolForAgentMode(AgentModePlanning, "builder_list_files"); err != nil {
		t.Fatalf("expected planning mode to allow builder_list_files, got %v", err)
	}
	if err := validateToolForAgentMode(AgentModePlanning, "tsunami_getdata_deadbeef"); err != nil {
		t.Fatalf("expected planning mode to allow tsunami_getdata_*, got %v", err)
	}
	if err := validateToolForAgentMode(AgentModePlanning, "tsunami_getconfig_deadbeef"); err != nil {
		t.Fatalf("expected planning mode to allow tsunami_getconfig_*, got %v", err)
	}
	if err := validateToolForAgentMode(AgentModePlanning, "term_command_output"); err != nil {
		t.Fatalf("expected planning mode to allow term_command_output, got %v", err)
	}
	if err := validateToolForAgentMode(AgentModePlanning, "wave_get_command_result"); err != nil {
		t.Fatalf("expected planning mode to allow wave_get_command_result, got %v", err)
	}
	if err := validateToolForAgentMode(AgentModePlanning, "wave_run_command"); err == nil {
		t.Fatalf("expected planning mode to block wave_run_command")
	}
	if err := validateToolForAgentMode(AgentModePlanning, "web_navigate"); err == nil {
		t.Fatalf("expected planning mode to block web_navigate")
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
}
