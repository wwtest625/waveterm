// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestParseWaveRunCommandToolInput_SplitsCommandWhenArgsOmitted(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "cat /proc/cpuinfo",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Command != "cat" {
		t.Fatalf("expected command to be split to cat, got %q", parsed.Command)
	}
	if len(parsed.Args) != 1 || parsed.Args[0] != "/proc/cpuinfo" {
		t.Fatalf("expected args to contain /proc/cpuinfo, got %#v", parsed.Args)
	}
}

func TestParseWaveRunCommandToolInput_AllowsMissingConnection(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"command": "uname -a",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Connection != "" {
		t.Fatalf("expected empty connection, got %q", parsed.Connection)
	}
	if parsed.Command != "uname" {
		t.Fatalf("expected command to be split to uname, got %q", parsed.Command)
	}
}

func TestParseWaveRunCommandToolInput_PreservesExplicitArgs(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "python3",
		"args":       []string{"-c", "print('ok')"},
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Command != "python3" {
		t.Fatalf("expected command to stay python3, got %q", parsed.Command)
	}
	if len(parsed.Args) != 2 || parsed.Args[0] != "-c" || parsed.Args[1] != "print('ok')" {
		t.Fatalf("expected args to stay unchanged, got %#v", parsed.Args)
	}
}

func TestParseWaveRunCommandToolInput_AcceptsStringArgs(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "python3",
		"args":       "-c",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if len(parsed.Args) != 1 || parsed.Args[0] != "-c" {
		t.Fatalf("expected string args to be preserved as a single arg, got %#v", parsed.Args)
	}
}

func TestParseWaveRunCommandToolInput_UsesShellForPipeline(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    `lscpu | grep "Model name"`,
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Command != "sh" {
		t.Fatalf("expected shell command to be sh, got %q", parsed.Command)
	}
	if len(parsed.Args) != 2 || parsed.Args[0] != "-lc" || parsed.Args[1] != `lscpu | grep "Model name"` {
		t.Fatalf("expected shell args [-lc, original], got %#v", parsed.Args)
	}
}

func TestParseWaveRunCommandToolInput_UsesShellForQuotedCommand(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    `python3 -c "print('ok')"`,
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Command != "sh" {
		t.Fatalf("expected quoted command to run via sh, got %q", parsed.Command)
	}
	if len(parsed.Args) != 2 || parsed.Args[0] != "-lc" {
		t.Fatalf("expected shell args prefix, got %#v", parsed.Args)
	}
}

func TestParseWaveGetCommandResultToolInput_AcceptsJobIdAlias(t *testing.T) {
	parsed, err := parseWaveGetCommandResultToolInput(map[string]any{
		"jobid": "job-123",
	})
	if err != nil {
		t.Fatalf("parseWaveGetCommandResultToolInput returned error: %v", err)
	}
	if parsed.JobId != "job-123" {
		t.Fatalf("expected job id alias to be accepted, got %q", parsed.JobId)
	}
}

func TestWaveRunCommandToolCallDescUsesNormalizedCommand(t *testing.T) {
	desc := GetWaveRunCommandToolDefinition().ToolCallDesc(map[string]any{
		"connection": "root@example",
		"cwd":        "/tmp",
		"command":    "cat /proc/cpuinfo",
	}, nil, nil)
	if !strings.Contains(desc, `running "cat /proc/cpuinfo" on root@example in /tmp`) {
		t.Fatalf("unexpected tool call description: %q", desc)
	}
}

func TestWaveRunCommandToolCallDescKeepsShellCommandReadable(t *testing.T) {
	desc := GetWaveRunCommandToolDefinition().ToolCallDesc(map[string]any{
		"connection": "root@example",
		"command":    `lscpu | grep "Model name"`,
	}, nil, nil)
	if !strings.Contains(desc, `lscpu | grep`) || !strings.Contains(desc, `on root@example`) {
		t.Fatalf("unexpected tool call description: %q", desc)
	}
}

func TestWaveRunCommandToolCallDescFallsBackToCurrentTerminal(t *testing.T) {
	desc := GetWaveRunCommandToolDefinition().ToolCallDesc(map[string]any{
		"command": "uname -a",
	}, nil, nil)
	if !strings.Contains(desc, `on current terminal`) {
		t.Fatalf("unexpected tool call description: %q", desc)
	}
}

func TestWaveRunCommandToolSchema_CommandOnlyRequired(t *testing.T) {
	schema := GetWaveRunCommandToolDefinition().InputSchema
	required, ok := schema["required"].([]string)
	if !ok {
		t.Fatalf("expected required to be []string, got %#v", schema["required"])
	}
	if len(required) != 1 || required[0] != "command" {
		t.Fatalf("expected only command to be required, got %#v", required)
	}
}

func TestWaveGetCommandResultToolSchema_IsPlainObjectAtTopLevel(t *testing.T) {
	schema := GetWaveGetCommandResultToolDefinition().InputSchema
	if schema["type"] != "object" {
		t.Fatalf("expected top-level schema type object, got %#v", schema["type"])
	}
	for _, forbiddenKey := range []string{"oneOf", "anyOf", "allOf", "enum", "not"} {
		if _, found := schema[forbiddenKey]; found {
			t.Fatalf("top-level schema must not include %s: %#v", forbiddenKey, schema[forbiddenKey])
		}
	}
}

func TestShouldReturnWaveCommandResult_WaitsBrieflyForLateOutput(t *testing.T) {
	now := time.Now()
	deadline := now.Add(30 * time.Second)
	var terminalSeenAt time.Time
	result := &wshrpc.CommandAgentGetCommandResultRtnData{
		Status: "done",
		Output: "",
	}

	if shouldReturnWaveCommandResult(result, now, deadline, &terminalSeenAt) {
		t.Fatalf("expected first empty done result to wait for output flush")
	}
	if terminalSeenAt.IsZero() {
		t.Fatalf("expected terminalSeenAt to be recorded")
	}
}

func TestShouldReturnWaveCommandResult_ReturnsWhenOutputPresent(t *testing.T) {
	now := time.Now()
	deadline := now.Add(30 * time.Second)
	var terminalSeenAt time.Time
	result := &wshrpc.CommandAgentGetCommandResultRtnData{
		Status: "done",
		Output: "Intel Xeon",
	}

	if !shouldReturnWaveCommandResult(result, now, deadline, &terminalSeenAt) {
		t.Fatalf("expected non-empty output to return immediately")
	}
}

func TestShouldReturnWaveCommandResult_ReturnsAfterGraceWindow(t *testing.T) {
	now := time.Now()
	deadline := now.Add(30 * time.Second)
	seenAt := now.Add(-6 * time.Second)
	result := &wshrpc.CommandAgentGetCommandResultRtnData{
		Status: "done",
		Output: "",
	}

	if !shouldReturnWaveCommandResult(result, now, deadline, &seenAt) {
		t.Fatalf("expected empty done result to return after grace window")
	}
}
