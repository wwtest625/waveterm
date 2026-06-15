// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// ---------------------------------------------------------------------------
// TokenCounter tests
// ---------------------------------------------------------------------------

func TestTokenCounter_CountText(t *testing.T) {
	tc := NewTokenCounter()

	// Basic English text
	count, err := tc.CountText("Hello, world!", "gpt-4")
	if err != nil {
		t.Fatalf("CountText failed: %v", err)
	}
	if count <= 0 {
		t.Errorf("Token count should be positive, got %d", count)
	}
	t.Logf("CountText('Hello, world!', gpt-4) = %d tokens", count)

	// Empty text
	count, err = tc.CountText("", "gpt-4")
	if err != nil {
		t.Fatalf("CountText failed for empty text: %v", err)
	}
	if count != 0 {
		t.Errorf("Empty text should have 0 tokens, got %d", count)
	}

	// Chinese text
	count, err = tc.CountText("你好世界", "gpt-4")
	if err != nil {
		t.Fatalf("CountText failed for Chinese text: %v", err)
	}
	if count <= 0 {
		t.Errorf("Chinese text token count should be positive, got %d", count)
	}
	t.Logf("CountText('你好世界', gpt-4) = %d tokens", count)
}

func TestTokenCounter_CountText_DifferentModels(t *testing.T) {
	tc := NewTokenCounter()

	text := "Hello, world! This is a test of token counting."

	// GPT-4 (cl100k_base)
	count4, err := tc.CountText(text, "gpt-4")
	if err != nil {
		t.Fatalf("CountText for gpt-4 failed: %v", err)
	}

	// GPT-4o (o200k_base)
	count4o, err := tc.CountText(text, "gpt-4o")
	if err != nil {
		t.Fatalf("CountText for gpt-4o failed: %v", err)
	}

	// GPT-3.5-turbo (cl100k_base) — should match GPT-4
	count35, err := tc.CountText(text, "gpt-3.5-turbo")
	if err != nil {
		t.Fatalf("CountText for gpt-3.5-turbo failed: %v", err)
	}

	t.Logf("gpt-4: %d, gpt-4o: %d, gpt-3.5-turbo: %d", count4, count4o, count35)

	// cl100k_base models should agree
	if count4 != count35 {
		t.Errorf("gpt-4 and gpt-3.5-turbo should use same encoding, got %d vs %d", count4, count35)
	}
}

func TestTokenCounter_CountMessages(t *testing.T) {
	tc := NewTokenCounter()

	messages := []openaichat.ChatRequestMessage{
		{Role: "system", Content: "You are a helpful assistant."},
		{Role: "user", Content: "Hello!"},
		{Role: "assistant", Content: "Hi there! How can I help you?"},
	}

	result, err := tc.CountMessages(messages, "gpt-4")
	if err != nil {
		t.Fatalf("CountMessages failed: %v", err)
	}

	if result.TotalTokens <= 0 {
		t.Errorf("TotalTokens should be positive, got %d", result.TotalTokens)
	}

	// Should have tokens for each role
	if result.ByRole["system"] <= 0 {
		t.Error("Should have system tokens")
	}
	if result.ByRole["user"] <= 0 {
		t.Error("Should have user tokens")
	}
	if result.ByRole["assistant"] <= 0 {
		t.Error("Should have assistant tokens")
	}

	t.Logf("CountMessages: total=%d, byRole=%v, encoding=%s", result.TotalTokens, result.ByRole, result.Encoding)
}

func TestTokenCounter_CountMessages_WithToolCalls(t *testing.T) {
	tc := NewTokenCounter()

	messages := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "Read the file test.txt"},
		{
			Role: "assistant",
			ToolCalls: []openaichat.ToolCall{
				{
					ID:   "call_123",
					Type: "function",
					Function: openaichat.ToolFunctionCall{
						Name:      "read_file",
						Arguments: `{"path": "/tmp/test.txt"}`,
					},
				},
			},
		},
		{Role: "tool", ToolCallID: "call_123", Name: "read_file", Content: "Hello from the file!"},
	}

	result, err := tc.CountMessages(messages, "gpt-4")
	if err != nil {
		t.Fatalf("CountMessages with tool calls failed: %v", err)
	}

	if result.TotalTokens <= 0 {
		t.Errorf("TotalTokens should be positive, got %d", result.TotalTokens)
	}
	if result.ByRole["tool"] <= 0 {
		t.Error("Should have tool tokens")
	}

	t.Logf("CountMessages (with tools): total=%d, byRole=%v", result.TotalTokens, result.ByRole)
}

func TestTokenCounter_CountSystemPrompt(t *testing.T) {
	tc := NewTokenCounter()

	prompt := []string{
		"You are Wave AI, an assistant embedded in Wave Terminal.",
		"Be concise, direct, and truthful.",
	}

	count, err := tc.CountSystemPrompt(prompt, "gpt-4")
	if err != nil {
		t.Fatalf("CountSystemPrompt failed: %v", err)
	}
	if count <= 0 {
		t.Errorf("System prompt token count should be positive, got %d", count)
	}
	t.Logf("CountSystemPrompt: %d tokens", count)
}

func TestTokenCounter_CountToolDefinitions(t *testing.T) {
	tc := NewTokenCounter()

	tools := []uctypes.ToolDefinition{
		{
			Name:        "wave_run_command",
			Description: "Execute a shell command on the current Wave connection",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command": map[string]any{
						"type":        "string",
						"description": "The command to execute",
					},
				},
				"required": []string{"command"},
			},
		},
		{
			Name:        "write_text_file",
			Description: "Write content to a file",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Absolute file path",
					},
					"content": map[string]any{
						"type":        "string",
						"description": "File content",
					},
				},
				"required": []string{"path", "content"},
			},
		},
	}

	count, err := tc.CountToolDefinitions(tools, "gpt-4")
	if err != nil {
		t.Fatalf("CountToolDefinitions failed: %v", err)
	}
	if count <= 0 {
		t.Errorf("Tool definition token count should be positive, got %d", count)
	}
	t.Logf("CountToolDefinitions (2 tools): %d tokens", count)
}

func TestTokenCounter_CountChatContext(t *testing.T) {
	tc := NewTokenCounter()

	systemPrompt := []string{"You are a helpful assistant."}
	tools := []uctypes.ToolDefinition{
		{Name: "test_tool", Description: "A test tool"},
	}
	messages := []openaichat.ChatRequestMessage{
		{Role: "user", Content: "Hello!"},
		{Role: "assistant", Content: "Hi there!"},
	}

	result, err := tc.CountChatContext(systemPrompt, tools, messages, "gpt-4")
	if err != nil {
		t.Fatalf("CountChatContext failed: %v", err)
	}

	if result.TotalTokens <= 0 {
		t.Errorf("TotalTokens should be positive, got %d", result.TotalTokens)
	}
	if result.ByRole["system"] <= 0 {
		t.Error("Should have system tokens")
	}
	if result.ByRole["user"] <= 0 {
		t.Error("Should have user tokens")
	}

	t.Logf("CountChatContext: total=%d, byRole=%v, encoding=%s", result.TotalTokens, result.ByRole, result.Encoding)
}

func TestTokenCounter_EncoderCaching(t *testing.T) {
	tc := NewTokenCounter()

	// First call — should create encoder
	_, err := tc.CountText("Hello", "gpt-4")
	if err != nil {
		t.Fatalf("First CountText failed: %v", err)
	}

	// Second call — should use cached encoder
	_, err = tc.CountText("World", "gpt-4")
	if err != nil {
		t.Fatalf("Second CountText failed: %v", err)
	}

	// Different model — should create new encoder
	_, err = tc.CountText("Hello", "gpt-4o")
	if err != nil {
		t.Fatalf("CountText for different model failed: %v", err)
	}

	// Verify encoders are cached
	tc.mu.Lock()
	encoderCount := len(tc.encoders)
	tc.mu.Unlock()

	if encoderCount < 2 {
		t.Errorf("Should have at least 2 cached encoders, got %d", encoderCount)
	}
}

func TestTokenCounter_FallbackForUnknownModel(t *testing.T) {
	tc := NewTokenCounter()

	// Unknown model should fall back to cl100k_base
	count, err := tc.CountText("Hello, world!", "unknown-model-xyz")
	if err != nil {
		t.Fatalf("CountText for unknown model failed: %v", err)
	}
	if count <= 0 {
		t.Errorf("Token count should be positive even for unknown model, got %d", count)
	}
}

func TestEstimateTokenCount(t *testing.T) {
	count := EstimateTokenCount("Hello, world! This is a test.")
	if count <= 0 {
		t.Errorf("EstimateTokenCount should return positive count, got %d", count)
	}
	t.Logf("EstimateTokenCount: %d", count)
}

// ---------------------------------------------------------------------------
// AppendOnlyContextManager.CountTokens test
// ---------------------------------------------------------------------------

func TestAppendOnlyContextManager_CountTokens(t *testing.T) {
	mgr := NewAppendOnlyContextManager()

	prompt := []string{"You are a helpful assistant."}
	tools := []uctypes.ToolDefinition{{Name: "test_tool", Description: "A test tool"}}

	mgr.Build(prompt, tools)
	mgr.SyncMessages([]openaichat.ChatRequestMessage{
		{Role: "user", Content: "Hello!"},
		{Role: "assistant", Content: "Hi there!"},
	})

	result, err := mgr.CountTokens("gpt-4")
	if err != nil {
		t.Fatalf("CountTokens failed: %v", err)
	}
	if result.TotalTokens <= 0 {
		t.Errorf("TotalTokens should be positive, got %d", result.TotalTokens)
	}
	t.Logf("AppendOnlyContextManager.CountTokens: total=%d, byRole=%v", result.TotalTokens, result.ByRole)
}

// ---------------------------------------------------------------------------
// Comparison test: local counting vs LLM-reported usage
// ---------------------------------------------------------------------------

func TestTokenCountAccuracy_KnownTexts(t *testing.T) {
	tc := NewTokenCounter()

	tests := []struct {
		text     string
		model    string
		minToken int
		maxToken int
	}{
		// OpenAI's documented example: "tiktoken is great!" = 5 tokens with cl100k_base
		{"tiktoken is great!", "gpt-4", 4, 6},
		// Single word
		{"hello", "gpt-4", 1, 2},
		// Longer text
		{"The quick brown fox jumps over the lazy dog.", "gpt-4", 8, 12},
	}

	for _, tt := range tests {
		count, err := tc.CountText(tt.text, tt.model)
		if err != nil {
			t.Errorf("CountText(%q, %s) failed: %v", tt.text, tt.model, err)
			continue
		}
		if count < tt.minToken || count > tt.maxToken {
			t.Errorf("CountText(%q, %s) = %d, expected %d-%d", tt.text, tt.model, count, tt.minToken, tt.maxToken)
		} else {
			t.Logf("CountText(%q, %s) = %d (expected %d-%d) ✓", tt.text, tt.model, count, tt.minToken, tt.maxToken)
		}
	}
}
