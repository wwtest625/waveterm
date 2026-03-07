// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"
)

func TestP0AcceptanceCriteria_DocumentsCriteriaRatherThanClaimingCompletion(t *testing.T) {
	criteria := GetTerminalAgentP0AcceptanceCriteria()
	if len(criteria) != 5 {
		t.Fatalf("expected 5 p0 acceptance criteria, got %d", len(criteria))
	}
	expectedKeys := []string{
		"agent-mode-visible-and-enforced",
		"panel-shows-agent-runtime-state",
		"user-activity-blocks-injection",
		"prompt-capabilities-are-truthful",
		"terminal-loop-read-inject-wait-read",
	}
	for idx, criterion := range criteria {
		if !criterion.Required {
			t.Fatalf("expected criterion %q to be required", criterion.Key)
		}
		if criterion.Key != expectedKeys[idx] {
			t.Fatalf("expected criterion key %q at index %d, got %q", expectedKeys[idx], idx, criterion.Key)
		}
	}
	expectedProofStatus := []string{
		"partially-verified",
		"documented-only",
		"documented-only",
		"verified",
		"host-implemented-not-verified-here",
	}
	for idx, criterion := range criteria {
		if criterion.ProofStatus != expectedProofStatus[idx] {
			t.Fatalf("expected proof status %q for %q, got %q", expectedProofStatus[idx], criterion.Key, criterion.ProofStatus)
		}
	}

	planningPrompt := getModeAwareSystemPromptText(true, "codex", AgentModePlanning)
	if !strings.Contains(planningPrompt, "planning mode") {
		t.Fatalf("expected planning prompt to mention planning mode, got %q", planningPrompt)
	}
	if !strings.Contains(planningPrompt, "Do not execute terminal commands") {
		t.Fatalf("expected planning prompt to forbid terminal execution, got %q", planningPrompt)
	}

	localPrompt := getModeAwareSystemPromptText(true, "codex", AgentModeDefault)
	if strings.Contains(localPrompt, "You cannot execute shell commands") {
		t.Fatalf("expected local default prompt not to deny terminal control, got %q", localPrompt)
	}

	cloudPrompt := getModeAwareSystemPromptText(false, "", AgentModeDefault)
	if !strings.Contains(cloudPrompt, "You cannot execute shell commands") {
		t.Fatalf("expected cloud prompt to deny shell execution, got %q", cloudPrompt)
	}
}

func TestP0AcceptanceCriteria_CurrentProofIsOnlyModeAndHostFoundations(t *testing.T) {
	criteria := GetTerminalAgentP0AcceptanceCriteria()
	for _, criterion := range criteria {
		if criterion.Key == "terminal-loop-read-inject-wait-read" && criterion.ProofStatus != "host-implemented-not-verified-here" {
			t.Fatalf("expected terminal loop proof to stay scoped to current host-side evidence, got %q", criterion.ProofStatus)
		}
		if criterion.Key == "panel-shows-agent-runtime-state" && criterion.ProofStatus != "documented-only" {
			t.Fatalf("expected panel runtime state to remain documented-only in this backend acceptance proof, got %q", criterion.ProofStatus)
		}
	}
}
