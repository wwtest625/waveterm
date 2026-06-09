// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestParseWaveCommandResultSnapshot(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantNil   bool
		wantJobId string
	}{
		{
			name:    "empty string",
			input:   "",
			wantNil: true,
		},
		{
			name:      "valid with job_id",
			input:     `{"jobid":"j1","status":"running"}`,
			wantNil:   false,
			wantJobId: "j1",
		},
		{
			name:    "no job_id",
			input:   `{"status":"running"}`,
			wantNil: true,
		},
		{
			name:    "invalid JSON",
			input:   `{invalid}`,
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, ok := parseWaveCommandResultSnapshot(tt.input)
			if tt.wantNil {
				if result != nil {
					t.Fatalf("expected nil result, got %+v", result)
				}
				if ok {
					t.Fatal("expected ok=false, got true")
				}
			} else {
				if result == nil {
					t.Fatal("expected non-nil result, got nil")
				}
				if !ok {
					t.Fatal("expected ok=true, got false")
				}
				if result.JobId != tt.wantJobId {
					t.Fatalf("expected JobId=%q, got %q", tt.wantJobId, result.JobId)
				}
			}
		})
	}
}

func TestParseWaveCommandJobID(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
		{
			name:  "job_id key",
			input: `{"job_id":"j1"}`,
			want:  "j1",
		},
		{
			name:  "jobid key",
			input: `{"jobid":"j2"}`,
			want:  "j2",
		},
		{
			name:  "trimmed job_id",
			input: `{"job_id":" j3 "}`,
			want:  "j3",
		},
		{
			name:  "invalid JSON",
			input: `{invalid}`,
			want:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseWaveCommandJobID(tt.input)
			if got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestApplyWaveCommandInteractionStateNil(t *testing.T) {
	toolUseData := &uctypes.UIMessageDataToolUse{
		AwaitingInput: true,
		PromptHint:    "some hint",
		InputOptions:  []string{"a", "b"},
		TuiDetected:   true,
		TuiSuppressed: true,
	}

	applyWaveCommandInteractionState(toolUseData, nil)

	if toolUseData.AwaitingInput {
		t.Fatal("expected AwaitingInput to be false")
	}
	if toolUseData.PromptHint != "" {
		t.Fatalf("expected PromptHint to be empty, got %q", toolUseData.PromptHint)
	}
	if toolUseData.InputOptions != nil {
		t.Fatalf("expected InputOptions to be nil, got %v", toolUseData.InputOptions)
	}
	if toolUseData.TuiDetected {
		t.Fatal("expected TuiDetected to be false")
	}
	if toolUseData.TuiSuppressed {
		t.Fatal("expected TuiSuppressed to be false")
	}
}

func TestApplyWaveCommandInteractionStateWithInteraction(t *testing.T) {
	interaction := &detectedInteraction{
		AwaitingInput: true,
		PromptHint:    "Enter password",
		InputOptions:  []string{"y", "n"},
		TuiDetected:   true,
		TuiSuppressed: false,
	}

	toolUseData := &uctypes.UIMessageDataToolUse{}
	applyWaveCommandInteractionState(toolUseData, interaction)

	if !toolUseData.AwaitingInput {
		t.Fatal("expected AwaitingInput to be true")
	}
	if toolUseData.PromptHint != "Enter password" {
		t.Fatalf("expected PromptHint=%q, got %q", "Enter password", toolUseData.PromptHint)
	}
	if len(toolUseData.InputOptions) != 2 || toolUseData.InputOptions[0] != "y" || toolUseData.InputOptions[1] != "n" {
		t.Fatalf("expected InputOptions=[y n], got %v", toolUseData.InputOptions)
	}
	if !toolUseData.TuiDetected {
		t.Fatal("expected TuiDetected to be true")
	}
	if toolUseData.TuiSuppressed {
		t.Fatal("expected TuiSuppressed to be false")
	}
}

func TestTruncateToolOutputText(t *testing.T) {
	t.Run("short text unchanged", func(t *testing.T) {
		input := "hello world"
		got := truncateToolOutputText(input)
		if got != input {
			t.Fatalf("expected %q, got %q", input, got)
		}
	})

	t.Run("long text truncated", func(t *testing.T) {
		longText := strings.Repeat("a", maxToolOutputTextLen+100)
		got := truncateToolOutputText(longText)
		if !strings.HasSuffix(got, "\n...[truncated]") {
			t.Fatalf("expected truncated suffix, got %q", got[len(got)-30:])
		}
		if len(got) > maxToolOutputTextLen+len("\n...[truncated]") {
			t.Fatalf("truncated text too long: %d", len(got))
		}
	})
}

func TestExtractToolOutputText(t *testing.T) {
	tests := []struct {
		name     string
		toolName string
		input    string
		want     string
	}{
		{
			name:     "empty string",
			toolName: "wave_run_command",
			input:    "",
			want:     "",
		},
		{
			name:     "plain text",
			toolName: "some_other_tool",
			input:    "  hello world  ",
			want:     "hello world",
		},
		{
			name:     "JSON with output key",
			toolName: "wave_run_command",
			input:    `{"output":"the output"}`,
			want:     "the output",
		},
		{
			name:     "JSON with error key no output",
			toolName: "wave_run_command",
			input:    `{"error":"something failed"}`,
			want:     "something failed",
		},
		{
			name:     "JSON with lines key",
			toolName: "wave_run_command",
			input:    `{"lines":["line1","line2","line3"]}`,
			want:     "line1\nline2\nline3",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractToolOutputText(tt.toolName, tt.input)
			if got != tt.want {
				t.Fatalf("expected %q, got %q", tt.want, got)
			}
		})
	}
}

func TestIsCommandChainTool(t *testing.T) {
	t.Run("wave_run_command returns true", func(t *testing.T) {
		if !isCommandChainTool("wave_run_command") {
			t.Fatal("expected isCommandChainTool('wave_run_command') to be true")
		}
	})

	t.Run("other tool returns false", func(t *testing.T) {
		if isCommandChainTool("wave_read_file") {
			t.Fatal("expected isCommandChainTool('wave_read_file') to be false")
		}
	})
}
