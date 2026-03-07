// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"
)

func TestLocalAgentPrompt_UsesRecentTurnsWithinBudget(t *testing.T) {
	history := []localPromptTurn{
		{
			Role:    "user",
			Content: "OLD-TURN-1 " + strings.Repeat("old ", 120),
		},
		{
			Role:    "assistant",
			Content: "OLD-TURN-2 " + strings.Repeat("older ", 120),
		},
		{
			Role:    "user",
			Content: "LATEST-TURN-1 short recent user input",
		},
		{
			Role:    "assistant",
			Content: "LATEST-TURN-2 short recent assistant reply",
		},
	}

	prompt := buildLocalAgentPromptWithBudget(
		"CURRENT-REQUEST please run tests and summarize result",
		"cwd=/repo",
		history,
		170,
	)

	if !strings.Contains(prompt, "CURRENT-REQUEST") {
		t.Fatalf("expected current request to be included")
	}
	if !strings.Contains(prompt, "LATEST-TURN-1") || !strings.Contains(prompt, "LATEST-TURN-2") {
		t.Fatalf("expected latest turns to be included, got prompt:\n%s", prompt)
	}
	if strings.Contains(prompt, "OLD-TURN-1") || strings.Contains(prompt, "OLD-TURN-2") {
		t.Fatalf("expected oldest turns to be dropped when budget exceeded, got prompt:\n%s", prompt)
	}
}

func TestLocalAgentPrompt_IncludesCommandExecutionGuidance(t *testing.T) {
	prompt := buildLocalAgentPromptWithBudget(
		"check remote terminal cpu model",
		"",
		nil,
		256,
	)

	if !strings.Contains(prompt, "first add a brief explanation sentence, then provide the command in a fenced shell code block") {
		t.Fatalf("expected prompt to instruct explanation + command block output, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Do not say you cannot execute commands or control the terminal") {
		t.Fatalf("expected prompt to avoid contradictory inability disclaimers, got prompt:\n%s", prompt)
	}
}
