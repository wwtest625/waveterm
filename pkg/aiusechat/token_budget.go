// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"os"
	"strconv"
	"strings"
)

const (
	defaultLocalPromptTokenBudget = 4000
	minLocalPromptTokenBudget     = 256
	localPromptBudgetEnvName      = "WAVETERM_LOCAL_AGENT_PROMPT_TOKEN_BUDGET"
)

func getLocalPromptTokenBudget() int {
	raw := strings.TrimSpace(os.Getenv(localPromptBudgetEnvName))
	if raw == "" {
		return defaultLocalPromptTokenBudget
	}
	budget, err := strconv.Atoi(raw)
	if err != nil || budget < minLocalPromptTokenBudget {
		return defaultLocalPromptTokenBudget
	}
	return budget
}

// estimateTokens returns a rough token estimate used for local prompt budgeting.
func estimateTokens(text string) int {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}

	words := len(strings.Fields(text))
	asciiCount := 0
	nonASCII := 0
	for _, r := range text {
		if r <= 0x7f {
			asciiCount++
		} else {
			nonASCII++
		}
	}
	charEstimate := (asciiCount+3)/4 + nonASCII
	if charEstimate < 1 {
		charEstimate = 1
	}
	if words > charEstimate {
		return words
	}
	return charEstimate
}
