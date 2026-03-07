// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"
)

func TestMCPServeToolsIncludeStatusAndWait(t *testing.T) {
	tools := getMCPTools()
	toolNames := make(map[string]bool)
	for _, tool := range tools {
		toolNames[tool.Name] = true
	}

	for _, name := range []string{
		"wave_read_current_terminal_context",
		"wave_read_terminal_scrollback",
		"wave_inject_terminal_command",
		"wave_get_terminal_command_status",
		"wave_wait_terminal_idle",
	} {
		if !toolNames[name] {
			t.Fatalf("expected tool %q in tools/list", name)
		}
	}
}

func TestMCPServeStatusToolRequiresTabID(t *testing.T) {
	s := &mcpServerState{}
	result, err := s.handleToolCall(map[string]any{
		"name":      "wave_get_terminal_command_status",
		"arguments": map[string]any{},
	})
	if err != nil {
		t.Fatalf("handleToolCall() error: %v", err)
	}
	requireMCPToolErrorContains(t, result, "tab_id is required")
}

func TestMCPServeWaitToolValidatesTimeoutAndPoll(t *testing.T) {
	s := &mcpServerState{defaultTabId: "tab-123"}

	result, err := s.handleToolCall(map[string]any{
		"name": "wave_wait_terminal_idle",
		"arguments": map[string]any{
			"timeout_ms": "1000",
		},
	})
	if err != nil {
		t.Fatalf("handleToolCall() error: %v", err)
	}
	requireMCPToolErrorContains(t, result, "timeout_ms must be an integer number")

	result, err = s.handleToolCall(map[string]any{
		"name": "wave_wait_terminal_idle",
		"arguments": map[string]any{
			"timeout_ms": float64(5000),
			"poll_ms":    float64(0),
		},
	})
	if err != nil {
		t.Fatalf("handleToolCall() error: %v", err)
	}
	requireMCPToolErrorContains(t, result, "poll_ms must be >= 50")
}

func TestMCPServeStatusToolValidatesBlockIDType(t *testing.T) {
	s := &mcpServerState{defaultTabId: "tab-123"}

	result, err := s.handleToolCall(map[string]any{
		"name": "wave_get_terminal_command_status",
		"arguments": map[string]any{
			"block_id": float64(123),
		},
	})
	if err != nil {
		t.Fatalf("handleToolCall() error: %v", err)
	}
	requireMCPToolErrorContains(t, result, "block_id must be a non-empty string")
}

func TestMCPServeInjectToolAcceptsBooleanForce(t *testing.T) {
	s := &mcpServerState{defaultTabId: "tab-123"}

	result, err := s.handleToolCall(map[string]any{
		"name": "wave_inject_terminal_command",
		"arguments": map[string]any{
			"command": "pwd",
			"force":   "yes",
		},
	})
	if err != nil {
		t.Fatalf("handleToolCall() error: %v", err)
	}
	requireMCPToolErrorContains(t, result, "force must be a boolean")
}

func TestMCPServeInjectToolBlockedInPlanningMode(t *testing.T) {
	s := &mcpServerState{defaultTabId: "tab-123", agentMode: "planning"}

	result, err := s.handleToolCall(map[string]any{
		"name": "wave_inject_terminal_command",
		"arguments": map[string]any{
			"command": "pwd",
		},
	})
	if err != nil {
		t.Fatalf("handleToolCall() error: %v", err)
	}
	requireMCPToolErrorContains(t, result, "not allowed in planning mode")
}

func requireMCPToolErrorContains(t *testing.T, result map[string]any, wantSubstr string) {
	t.Helper()

	if result == nil {
		t.Fatalf("expected tool error response, got nil")
	}
	isError, ok := result["isError"].(bool)
	if !ok || !isError {
		t.Fatalf("expected isError=true, got: %#v", result["isError"])
	}
	content, ok := result["content"].([]map[string]any)
	if !ok || len(content) == 0 {
		t.Fatalf("expected non-empty content, got: %#v", result["content"])
	}
	text, _ := content[0]["text"].(string)
	if !strings.Contains(text, wantSubstr) {
		t.Fatalf("expected error to contain %q, got %q", wantSubstr, text)
	}
}
