// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestDetectInteractionByRules(t *testing.T) {
	tests := []struct {
		name        string
		output      string
		wantType    string
		wantAwait   bool
		wantOptions int
	}{
		{
			name:      "password prompt",
			output:    "Username for 'https://github.com':\nPassword:",
			wantType:  "password",
			wantAwait: true,
		},
		{
			name:        "confirm prompt",
			output:      "Do you want to continue? [Y/n]",
			wantType:    "confirm",
			wantAwait:   true,
			wantOptions: 2,
		},
		{
			name:      "press enter prompt",
			output:    "Press Enter to continue",
			wantType:  "enter",
			wantAwait: true,
		},
		{
			name:        "pager prompt",
			output:      "log line\n--More--",
			wantType:    "pager",
			wantAwait:   true,
			wantOptions: 1,
		},
		{
			name:      "selection prompt",
			output:    "Select one option and enter number:",
			wantType:  "select",
			wantAwait: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := detectInteractionByRules(test.output)
			if got == nil {
				t.Fatalf("expected interaction, got nil")
			}
			if got.Interaction != test.wantType {
				t.Fatalf("unexpected interaction type: got %q, want %q", got.Interaction, test.wantType)
			}
			if got.AwaitingInput != test.wantAwait {
				t.Fatalf("unexpected awaiting input: got %v, want %v", got.AwaitingInput, test.wantAwait)
			}
			if test.wantOptions > 0 && len(got.InputOptions) != test.wantOptions {
				t.Fatalf("unexpected option count: got %d, want %d", len(got.InputOptions), test.wantOptions)
			}
		})
	}
}

func TestDetectCommandInteraction_UsesSnapshotFirst(t *testing.T) {
	snapshot := &wshrpc.CommandAgentGetCommandResultRtnData{
		Status:        "running",
		Output:        "Password:",
		AwaitingInput: true,
		PromptHint:    "Enter your token",
		InputOptions:  []string{"123456"},
	}

	got := detectCommandInteraction("git clone https://x", snapshot)
	if got == nil {
		t.Fatalf("expected detected interaction")
	}
	if got.Source != "snapshot" {
		t.Fatalf("expected snapshot source, got %q", got.Source)
	}
	if got.PromptHint != "Enter your token" {
		t.Fatalf("unexpected prompt hint: %q", got.PromptHint)
	}
	if len(got.InputOptions) != 1 || got.InputOptions[0] != "123456" {
		t.Fatalf("unexpected input options: %#v", got.InputOptions)
	}
}

func TestDetectInteractionWithLLMFallback_TriggerAndSkip(t *testing.T) {
	originalAnalyzer := interactionDetectorLLM
	defer func() {
		interactionDetectorLLM = originalAnalyzer
	}()

	llmCalls := 0
	interactionDetectorLLM = func(input interactionLLMInput) (*detectedInteraction, error) {
		llmCalls++
		return &detectedInteraction{
			AwaitingInput: true,
			PromptHint:    "LLM detected prompt",
			Interaction:   "freeform",
			Source:        "llm",
		}, nil
	}

	// Rule should win; no llm call.
	ruleSnapshot := &wshrpc.CommandAgentGetCommandResultRtnData{
		Status: "running",
		Output: "Password:",
	}
	gotRule := detectCommandInteraction("git clone https://x", ruleSnapshot)
	if gotRule == nil || gotRule.Interaction != "password" {
		t.Fatalf("expected rule-based password detection, got %#v", gotRule)
	}
	if llmCalls != 0 {
		t.Fatalf("expected llm not called when rules match, got %d", llmCalls)
	}

	// No rule; llm should trigger.
	llmSnapshot := &wshrpc.CommandAgentGetCommandResultRtnData{
		Status: "running",
		Output: "Enter value:",
	}
	gotLLM := detectCommandInteraction("custom-cli run", llmSnapshot)
	if gotLLM == nil {
		t.Fatalf("expected llm detection result")
	}
	if gotLLM.Source != "llm" {
		t.Fatalf("expected llm source, got %q", gotLLM.Source)
	}
	if llmCalls != 1 {
		t.Fatalf("expected exactly one llm call, got %d", llmCalls)
	}
}

func TestMakeInteractionDedupKey_Stable(t *testing.T) {
	one := &detectedInteraction{
		AwaitingInput: true,
		PromptHint:    "Enter password:",
		InputOptions:  []string{"a", "b"},
		Interaction:   "password",
	}
	two := &detectedInteraction{
		AwaitingInput: true,
		PromptHint:    "enter password:",
		InputOptions:  []string{"a", "b"},
		Interaction:   "password",
	}

	keyOne := makeInteractionDedupKey(one)
	keyTwo := makeInteractionDedupKey(two)
	if keyOne != keyTwo {
		t.Fatalf("expected same dedup key, got %q vs %q", keyOne, keyTwo)
	}
}
