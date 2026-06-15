// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"strings"
	"sync"

	"github.com/pkoukk/tiktoken-go"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// ---------------------------------------------------------------------------
// TokenCounter — local token counting using tiktoken-go
// ---------------------------------------------------------------------------

// TokenCountResult holds the result of a token count operation.
type TokenCountResult struct {
	// TotalTokens is the total number of tokens across all counted content.
	TotalTokens int
	// ByRole breaks down token counts by message role.
	ByRole map[string]int
	// Model is the encoding model used for counting.
	Encoding string
}

// TokenCounter provides local token counting for AI chat messages.
// It uses tiktoken-go with caching to avoid re-initializing the encoder
// on every call.
type TokenCounter struct {
	mu       sync.Mutex
	encoders map[string]*tiktoken.Tiktoken
}

// NewTokenCounter creates a new TokenCounter.
func NewTokenCounter() *TokenCounter {
	return &TokenCounter{
		encoders: make(map[string]*tiktoken.Tiktoken),
	}
}

// DefaultTokenCounter is the global token counter instance.
var DefaultTokenCounter = NewTokenCounter()

// getEncoder returns a cached tiktoken encoder for the given model.
// If the model is not recognized, it falls back to cl100k_base.
func (tc *TokenCounter) getEncoder(model string) (*tiktoken.Tiktoken, string, error) {
	tc.mu.Lock()
	defer tc.mu.Unlock()

	// Resolve encoding name from model
	encodingName := resolveEncodingForModel(model)

	if enc, ok := tc.encoders[encodingName]; ok {
		return enc, encodingName, nil
	}

	enc, err := tiktoken.GetEncoding(encodingName)
	if err != nil {
		// Fallback to cl100k_base
		if encodingName != "cl100k_base" {
			if enc, ok := tc.encoders["cl100k_base"]; ok {
				return enc, "cl100k_base", nil
			}
			enc, err = tiktoken.GetEncoding("cl100k_base")
			if err != nil {
				return nil, "", err
			}
			tc.encoders["cl100k_base"] = enc
			return enc, "cl100k_base", nil
		}
		return nil, "", err
	}

	tc.encoders[encodingName] = enc
	return enc, encodingName, nil
}

// resolveEncodingForModel maps model names to tiktoken encoding names.
func resolveEncodingForModel(model string) string {
	m := strings.ToLower(model)

	// o200k_base models (GPT-4o, GPT-4.1, GPT-4.5)
	if strings.HasPrefix(m, "gpt-4o") || strings.HasPrefix(m, "gpt-4.1") || strings.HasPrefix(m, "gpt-4.5") {
		return "o200k_base"
	}

	// cl100k_base models (GPT-4, GPT-3.5-turbo)
	if strings.HasPrefix(m, "gpt-4") || strings.HasPrefix(m, "gpt-3.5") {
		return "cl100k_base"
	}

	// DeepSeek models — cl100k_base is a reasonable approximation
	if strings.Contains(m, "deepseek") {
		return "cl100k_base"
	}

	// Claude/Anthropic models — cl100k_base approximation
	if strings.Contains(m, "claude") {
		return "cl100k_base"
	}

	// Llama models — cl100k_base approximation
	if strings.Contains(m, "llama") {
		return "cl100k_base"
	}

	// Qwen models — cl100k_base approximation
	if strings.Contains(m, "qwen") {
		return "cl100k_base"
	}

	// Default to cl100k_base for unknown models
	return "cl100k_base"
}

// CountText counts the number of tokens in a plain text string.
func (tc *TokenCounter) CountText(text string, model string) (int, error) {
	if text == "" {
		return 0, nil
	}
	enc, _, err := tc.getEncoder(model)
	if err != nil {
		return 0, err
	}
	return len(enc.Encode(text, nil, nil)), nil
}

// CountMessages counts the number of tokens in a slice of ChatRequestMessage.
// This includes the per-message overhead tokens that OpenAI adds
// (role markers, separators, etc.).
func (tc *TokenCounter) CountMessages(messages []openaichat.ChatRequestMessage, model string) (*TokenCountResult, error) {
	if len(messages) == 0 {
		return &TokenCountResult{Encoding: resolveEncodingForModel(model)}, nil
	}

	enc, encodingName, err := tc.getEncoder(model)
	if err != nil {
		return nil, err
	}

	result := &TokenCountResult{
		ByRole:   make(map[string]int),
		Encoding: encodingName,
	}

	// Per-message overhead tokens (based on OpenAI's token counting docs)
	// Each message has ~4 tokens of overhead (role, separators)
	// Plus 3 tokens for the reply priming
	tokensPerMessage := 4

	for _, msg := range messages {
		msgTokens := tokensPerMessage

		// Count content tokens
		if msg.Content != "" {
			msgTokens += len(enc.Encode(msg.Content, nil, nil))
		}

		// Count content parts tokens
		for _, part := range msg.ContentParts {
			if part.Text != "" {
				msgTokens += len(enc.Encode(part.Text, nil, nil))
			}
		}

		// Count role tokens
		if msg.Role != "" {
			msgTokens += len(enc.Encode(msg.Role, nil, nil))
		}

		// Count name tokens
		if msg.Name != "" {
			msgTokens += len(enc.Encode(msg.Name, nil, nil))
		}

		// Count tool call tokens
		for _, tc := range msg.ToolCalls {
			msgTokens += len(enc.Encode(tc.Function.Name, nil, nil))
			if tc.Function.Arguments != "" {
				msgTokens += len(enc.Encode(tc.Function.Arguments, nil, nil))
			}
		}

		// Count tool_call_id tokens
		if msg.ToolCallID != "" {
			msgTokens += len(enc.Encode(msg.ToolCallID, nil, nil))
		}

		result.ByRole[msg.Role] += msgTokens
		result.TotalTokens += msgTokens
	}

	// Reply priming overhead
	result.TotalTokens += 3

	return result, nil
}

// CountSystemPrompt counts tokens in the system prompt.
func (tc *TokenCounter) CountSystemPrompt(systemPrompt []string, model string) (int, error) {
	if len(systemPrompt) == 0 {
		return 0, nil
	}
	combined := strings.Join(systemPrompt, "\n\n")
	return tc.CountText(combined, model)
}

// CountToolDefinitions counts tokens in tool definitions.
func (tc *TokenCounter) CountToolDefinitions(tools []uctypes.ToolDefinition, model string) (int, error) {
	if len(tools) == 0 {
		return 0, nil
	}
	enc, _, err := tc.getEncoder(model)
	if err != nil {
		return 0, err
	}

	total := 0
	for _, tool := range tools {
		total += len(enc.Encode(tool.Name, nil, nil))
		total += len(enc.Encode(tool.Description, nil, nil))
		if tool.InputSchema != nil {
			schemaBytes, _ := jsonMarshal(tool.InputSchema)
			total += len(enc.Encode(string(schemaBytes), nil, nil))
		}
	}

	return total, nil
}

// CountChatContext counts the total tokens for a complete chat context:
// system prompt + tool definitions + messages.
// This gives the most accurate estimate of what will be sent to the LLM.
func (tc *TokenCounter) CountChatContext(
	systemPrompt []string,
	tools []uctypes.ToolDefinition,
	messages []openaichat.ChatRequestMessage,
	model string,
) (*TokenCountResult, error) {
	enc, encodingName, err := tc.getEncoder(model)
	if err != nil {
		return nil, err
	}

	result := &TokenCountResult{
		ByRole:   make(map[string]int),
		Encoding: encodingName,
	}

	// System prompt tokens
	if len(systemPrompt) > 0 {
		combined := strings.Join(systemPrompt, "\n\n")
		sysTokens := len(enc.Encode(combined, nil, nil))
		result.ByRole["system"] = sysTokens
		result.TotalTokens += sysTokens
	}

	// Tool definition tokens
	for _, tool := range tools {
		toolTokens := len(enc.Encode(tool.Name, nil, nil))
		toolTokens += len(enc.Encode(tool.Description, nil, nil))
		if tool.InputSchema != nil {
			schemaBytes, _ := jsonMarshal(tool.InputSchema)
			toolTokens += len(enc.Encode(string(schemaBytes), nil, nil))
		}
		result.TotalTokens += toolTokens
	}

	// Message tokens
	tokensPerMessage := 4
	for _, msg := range messages {
		msgTokens := tokensPerMessage
		if msg.Content != "" {
			msgTokens += len(enc.Encode(msg.Content, nil, nil))
		}
		for _, part := range msg.ContentParts {
			if part.Text != "" {
				msgTokens += len(enc.Encode(part.Text, nil, nil))
			}
		}
		if msg.Role != "" {
			msgTokens += len(enc.Encode(msg.Role, nil, nil))
		}
		if msg.Name != "" {
			msgTokens += len(enc.Encode(msg.Name, nil, nil))
		}
		for _, tc := range msg.ToolCalls {
			msgTokens += len(enc.Encode(tc.Function.Name, nil, nil))
			if tc.Function.Arguments != "" {
				msgTokens += len(enc.Encode(tc.Function.Arguments, nil, nil))
			}
		}
		if msg.ToolCallID != "" {
			msgTokens += len(enc.Encode(msg.ToolCallID, nil, nil))
		}
		result.ByRole[msg.Role] += msgTokens
		result.TotalTokens += msgTokens
	}

	result.TotalTokens += 3 // reply priming
	return result, nil
}

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

// CountTokensForChat is a convenience function that counts tokens for the
// current chat context using the global DefaultTokenCounter.
func CountTokensForChat(chatOpts uctypes.WaveChatOpts) (*TokenCountResult, error) {
	var messages []openaichat.ChatRequestMessage

	// Get messages from chatstore and convert to ChatRequestMessage format
	chat := chatstore.DefaultChatStore.GetContextWindow(chatOpts.ChatId, chatstore.DefaultContextWindowUserTurns)
	if chat != nil {
		for _, genMsg := range chat.NativeMessages {
			chatMsg, ok := genMsg.(*openaichat.StoredChatMessage)
			if !ok {
				continue
			}
			// Use the message directly (clean() is for API serialization,
			// for token counting we can use the raw message)
			messages = append(messages, chatMsg.Message)
		}
	}

	return DefaultTokenCounter.CountChatContext(
		chatOpts.SystemPrompt,
		append(chatOpts.Tools, chatOpts.TabTools...),
		messages,
		chatOpts.Config.Model,
	)
}

// EstimateTokenCount provides a quick estimate of token count for a text string.
// Uses the global DefaultTokenCounter with cl100k_base encoding.
// Useful when you don't know the model but need a rough count.
func EstimateTokenCount(text string) int {
	count, err := DefaultTokenCounter.CountText(text, "gpt-4")
	if err != nil {
		// Fallback: rough estimate of ~4 chars per token for English
		return len(text) / 4
	}
	return count
}

// jsonMarshal wraps json.Marshal for use in token counting.
var jsonMarshal = json.Marshal
