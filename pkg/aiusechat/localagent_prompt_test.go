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
			Content: "OLD-TURN-1 " + strings.Repeat("old ", 260),
		},
		{
			Role:    "assistant",
			Content: "OLD-TURN-2 " + strings.Repeat("older ", 260),
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
		700,
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

	if !strings.Contains(prompt, "=== TERMINAL QUERY RULES ===") {
		t.Fatalf("expected prompt to include terminal query rules, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "you MUST:") {
		t.Fatalf("expected prompt to use strong mandatory language, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Execute real terminal commands and use their actual output") {
		t.Fatalf("expected prompt to require real command execution, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, preferredWaveWSHPath+" agent termscrollback -b <blockid> --lastcommand") {
		t.Fatalf("expected prompt to mention wsh termscrollback guidance, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, preferredWaveWSHPath+" file write") {
		t.Fatalf("expected prompt to mention wsh file write guidance, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Run bare wsh inside the remote shell") {
		t.Fatalf("expected prompt to forbid remote bare wsh usage, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "tool-discovery detours") {
		t.Fatalf("expected prompt to forbid tool-discovery detours, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Use direct ssh/scp from the local host") {
		t.Fatalf("expected prompt to forbid direct ssh/scp fallback, got prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Example workflow:") {
		t.Fatalf("expected prompt to include example workflow, got prompt:\n%s", prompt)
	}
	if strings.Contains(prompt, "wave_inject_terminal_command") || strings.Contains(prompt, "wave_read_current_terminal_context") {
		t.Fatalf("expected pure wsh prompt to avoid legacy wave_* tool instructions, got prompt:\n%s", prompt)
	}
	if strings.Contains(prompt, "first add a brief explanation sentence, then provide the command in a fenced shell code block") {
		t.Fatalf("expected local agent prompt not to prefer shell code block output, got prompt:\n%s", prompt)
	}
	if strings.Contains(prompt, "Do not say you cannot execute commands or control the terminal") {
		t.Fatalf("expected prompt to avoid contradictory disclaimers, got prompt:\n%s", prompt)
	}
}
