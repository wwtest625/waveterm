// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
)

// ---------------------------------------------------------------------------
// ShouldCompact tests
// ---------------------------------------------------------------------------

func TestShouldCompact_BelowThreshold(t *testing.T) {
	// 50% usage — below 75% threshold
	if ShouldCompact(50000, 100000, 20) {
		t.Error("Should not compact when below threshold")
	}
}

func TestShouldCompact_AboveThreshold(t *testing.T) {
	// 80% usage — above 75% threshold, enough messages
	if !ShouldCompact(80000, 100000, 20) {
		t.Error("Should compact when above threshold with enough messages")
	}
}

func TestShouldCompact_TooFewMessages(t *testing.T) {
	// 80% usage but too few messages
	if ShouldCompact(80000, 100000, 4) {
		t.Error("Should not compact with too few messages")
	}
}

func TestShouldCompact_ZeroMaxTokens(t *testing.T) {
	if ShouldCompact(80000, 0, 20) {
		t.Error("Should not compact when maxTokens is 0")
	}
}

// ---------------------------------------------------------------------------
// CompactMessages tests
// ---------------------------------------------------------------------------

func TestCompactMessages_TooFewMessages(t *testing.T) {
	messages := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
	}
	compacted, result := CompactMessages(messages)
	if result.Compacted {
		t.Error("Should not compact with too few messages")
	}
	if len(compacted) != len(messages) {
		t.Error("Messages should be unchanged")
	}
}

func TestCompactMessages_EnoughMessages(t *testing.T) {
	// Create enough messages (12+ = 6 turns * 2 messages)
	messages := make([]openaichat.ChatRequestMessage, 0, 16)
	for i := 0; i < 8; i++ {
		messages = append(messages, openaichat.ChatRequestMessage{
			Role:    "user",
			Content: "Please do something " + string(rune('A'+i)),
		})
		messages = append(messages, openaichat.ChatRequestMessage{
			Role:    "assistant",
			Content: "Done with task " + string(rune('A'+i)),
		})
	}

	compacted, result := CompactMessages(messages)

	if !result.Compacted {
		t.Fatal("Should compact with enough messages")
	}
	if result.CompactedTurns <= 0 {
		t.Error("Should have compacted some turns")
	}
	if len(compacted) >= len(messages) {
		t.Errorf("Compacted messages (%d) should be fewer than original (%d)", len(compacted), len(messages))
	}
	if result.CompactedMessageCount != len(compacted) {
		t.Errorf("CompactedMessageCount mismatch: %d vs %d", result.CompactedMessageCount, len(compacted))
	}

	// First message should be the summary
	if compacted[0].Role != "user" {
		t.Errorf("First compacted message should be user (summary), got %s", compacted[0].Role)
	}
	if !containsSubstring(compacted[0].Content, "之前对话摘要") {
		t.Errorf("Summary should contain '之前对话摘要', got: %s", compacted[0].Content)
	}

	// Recent messages should be preserved
	lastOriginal := messages[len(messages)-1]
	lastCompacted := compacted[len(compacted)-1]
	if lastCompacted.Content != lastOriginal.Content {
		t.Error("Last message should be preserved")
	}

	t.Logf("Compacted: %d→%d messages, %d turns compressed",
		result.OriginalMessageCount, result.CompactedMessageCount, result.CompactedTurns)
	t.Logf("Summary preview: %s", truncateStrTest(compacted[0].Content, 200))
}

func TestCompactMessages_WithToolCalls(t *testing.T) {
	messages := make([]openaichat.ChatRequestMessage, 0, 16)
	for i := 0; i < 6; i++ {
		messages = append(messages, openaichat.ChatRequestMessage{
			Role:    "user",
			Content: "Run command " + string(rune('A'+i)),
		})
		messages = append(messages, openaichat.ChatRequestMessage{
			Role: "assistant",
			ToolCalls: []openaichat.ToolCall{
				{
					ID:   "call_" + string(rune('A'+i)),
					Type: "function",
					Function: openaichat.ToolFunctionCall{
						Name:      "wave_run_command",
						Arguments: `{"command": "ls -la /tmp"}`,
					},
				},
			},
		})
		messages = append(messages, openaichat.ChatRequestMessage{
			Role:       "tool",
			ToolCallID: "call_" + string(rune('A'+i)),
			Name:       "wave_run_command",
			Content:    "file1.txt\nfile2.txt",
		})
	}
	// Add a couple more turns to ensure enough messages
	messages = append(messages, openaichat.ChatRequestMessage{Role: "user", Content: "Thanks"})
	messages = append(messages, openaichat.ChatRequestMessage{Role: "assistant", Content: "You're welcome"})

	compacted, result := CompactMessages(messages)

	if !result.Compacted {
		t.Fatal("Should compact with enough messages")
	}

	// Summary should mention tool calls
	if !containsSubstring(compacted[0].Content, "wave_run_command") {
		t.Errorf("Summary should mention tool calls, got: %s", truncateStrTest(compacted[0].Content, 200))
	}

	t.Logf("Compacted with tool calls: %d→%d messages", result.OriginalMessageCount, result.CompactedMessageCount)
}

func TestCompactMessages_PreservesRecentTurns(t *testing.T) {
	messages := make([]openaichat.ChatRequestMessage, 0, 20)
	for i := 0; i < 10; i++ {
		messages = append(messages, openaichat.ChatRequestMessage{
			Role:    "user",
			Content: "User message " + string(rune('A'+i)),
		})
		messages = append(messages, openaichat.ChatRequestMessage{
			Role:    "assistant",
			Content: "Assistant reply " + string(rune('A'+i)),
		})
	}

	compacted, result := CompactMessages(messages)

	if !result.Compacted {
		t.Fatal("Should compact")
	}

	// The last few messages should be preserved exactly
	recentCount := CompactionKeepRecentTurns * 2 // user + assistant
	compactedRecent := compacted[len(compacted)-recentCount:]
	for i, msg := range compactedRecent {
		// Even indices should be user, odd should be assistant
		if i%2 == 0 && msg.Role != "user" {
			t.Errorf("Expected user at position %d, got %s", i, msg.Role)
		}
		if i%2 == 1 && msg.Role != "assistant" {
			t.Errorf("Expected assistant at position %d, got %s", i, msg.Role)
		}
	}
}

// ---------------------------------------------------------------------------
// findCompactionBoundary tests
// ---------------------------------------------------------------------------

func TestFindCompactionBoundary(t *testing.T) {
	messages := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "1"},
		{Role: "assistant", Content: "2"},
		{Role: "user", Content: "3"},
		{Role: "assistant", Content: "4"},
		{Role: "user", Content: "5"},
		{Role: "assistant", Content: "6"},
		{Role: "user", Content: "7"},
		{Role: "assistant", Content: "8"},
	}

	// Keep last 2 turns (4 messages)
	boundary := findCompactionBoundary(messages, 2)
	if boundary != 4 {
		t.Errorf("Expected boundary at 4, got %d", boundary)
	}
}

func TestFindCompactionBoundary_AllMessages(t *testing.T) {
	messages := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "1"},
		{Role: "assistant", Content: "2"},
	}

	// Keep last 4 turns — but only 1 turn exists
	boundary := findCompactionBoundary(messages, 4)
	if boundary != 0 {
		t.Errorf("Expected boundary at 0 (all messages), got %d", boundary)
	}
}

// ---------------------------------------------------------------------------
// generateCompactionSummary tests
// ---------------------------------------------------------------------------

func TestGenerateCompactionSummary_UserAssistant(t *testing.T) {
	messages := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "Read the file config.yaml"},
		{Role: "assistant", Content: "Here's the content of config.yaml..."},
		{Role: "user", Content: "Now edit it to add debug mode"},
		{Role: "assistant", Content: "Done, I've added debug: true"},
	}

	summary := generateCompactionSummary(messages)
	if summary == "" {
		t.Fatal("Summary should not be empty")
	}
	if !containsSubstring(summary, "用户") {
		t.Error("Summary should contain user messages")
	}
	if !containsSubstring(summary, "AI") {
		t.Error("Summary should contain AI messages")
	}
	t.Logf("Summary: %s", truncateStrTest(summary, 300))
}

func TestGenerateCompactionSummary_ToolCalls(t *testing.T) {
	messages := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "List files"},
		{Role: "assistant", ToolCalls: []openaichat.ToolCall{
			{Function: openaichat.ToolFunctionCall{Name: "wave_run_command", Arguments: `{"command": "ls -la"}`}},
		}},
		{Role: "tool", Name: "wave_run_command", Content: "file1.txt\nfile2.txt"},
	}

	summary := generateCompactionSummary(messages)
	if !containsSubstring(summary, "wave_run_command") {
		t.Error("Summary should mention tool call")
	}
	if !containsSubstring(summary, "ls -la") {
		t.Error("Summary should include command from arguments")
	}
}

// ---------------------------------------------------------------------------
// AppendOnlyContextManager.CompactContext integration test
// ---------------------------------------------------------------------------

func TestAppendOnlyContextManager_CompactContext_BelowThreshold(t *testing.T) {
	mgr := NewAppendOnlyContextManager()
	mgr.Build([]string{"test"}, nil)

	// Add a few messages — not enough to trigger compaction
	mgr.SyncMessages([]openaichat.ChatRequestMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
	})

	result, err := mgr.CompactContext("gpt-4", 128000) // 128K max tokens
	if err != nil {
		t.Fatalf("CompactContext failed: %v", err)
	}
	if result.Compacted {
		t.Error("Should not compact when below threshold")
	}
}

// ---------------------------------------------------------------------------
// summarizeToolArgs tests
// ---------------------------------------------------------------------------

func TestSummarizeToolArgs_WaveRunCommand(t *testing.T) {
	result := summarizeToolArgs("wave_run_command", `{"command": "ls -la /tmp"}`)
	if result != "ls -la /tmp" {
		t.Errorf("Expected 'ls -la /tmp', got %q", result)
	}
}

func TestSummarizeToolArgs_WriteTextFile(t *testing.T) {
	result := summarizeToolArgs("write_text_file", `{"filename": "/app/config.yaml", "content": "..."}`)
	if result != "/app/config.yaml" {
		t.Errorf("Expected '/app/config.yaml', got %q", result)
	}
}

func TestSummarizeToolArgs_UnknownTool(t *testing.T) {
	result := summarizeToolArgs("custom_tool", `{"query": "search term"}`)
	if result != "search term" {
		t.Errorf("Expected 'search term', got %q", result)
	}
}

func TestSummarizeToolArgs_InvalidJSON(t *testing.T) {
	result := summarizeToolArgs("wave_run_command", `not json`)
	// Should not crash, return truncated raw text
	if result == "" {
		t.Error("Should return something even for invalid JSON")
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		(len(s) > 0 && len(sub) > 0 && findSubstring(s, sub)))
}

func findSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func truncateStrTest(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
