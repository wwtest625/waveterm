// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
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

	planningPrompt := getModeAwareSystemPromptText("", AgentModePlanning)
	if !strings.Contains(planningPrompt, "Use only the tools actually provided to you.") {
		t.Fatalf("expected planning prompt to keep a short tools rule, got %q", planningPrompt)
	}
	if strings.Contains(planningPrompt, "Planning mode is read-only") {
		t.Fatalf("expected planning prompt to drop the read-only restriction, got %q", planningPrompt)
	}

	defaultPrompt := getModeAwareSystemPromptText("", AgentModeDefault)
	if !strings.Contains(defaultPrompt, "Use only the tools actually provided to you.") {
		t.Fatalf("expected default prompt to keep a short tools rule, got %q", defaultPrompt)
	}

	basePrompt := strings.Join(getSystemPrompt(uctypes.APIType_OpenAIResponses, "gpt-5", uctypes.AIProvider_Wave, false, true, false, AgentModeDefault, ""), " ")
	if strings.Contains(basePrompt, "cannot access the terminal") {
		t.Fatalf("expected Wave provider prompt to stay tool-capable, got %q", basePrompt)
	}
	if !strings.Contains(basePrompt, "Use tools when available") {
		t.Fatalf("expected base prompt to keep short tool guidance, got %q", basePrompt)
	}
	if !strings.Contains(basePrompt, "call wave_run_command or the relevant terminal tool") {
		t.Fatalf("expected base prompt to direct shell tasks to terminal tools, got %q", basePrompt)
	}
	if !strings.Contains(basePrompt, "short task chain") {
		t.Fatalf("expected base prompt to keep the short task-chain hint, got %q", basePrompt)
	}
	if !strings.Contains(basePrompt, "For file edits, prefer the latest file content") {
		t.Fatalf("expected base prompt to keep the edit workflow hint, got %q", basePrompt)
	}
	if strings.Contains(basePrompt, "minimize the number of separate commands") {
		t.Fatalf("expected base prompt to stay concise and omit old command-consolidation text, got %q", basePrompt)
	}
	if strings.Contains(basePrompt, "Do not wrap it in ssh") {
		t.Fatalf("expected base prompt to omit old ssh-specific guidance, got %q", basePrompt)
	}
	if strings.Contains(basePrompt, "Filesystem tools read the Wave host machine's local files only") {
		t.Fatalf("expected base prompt to omit filesystem-only wording after removing read-only file tools, got %q", basePrompt)
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
