// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
)

// ---------------------------------------------------------------------------
// SnapCompact — context compression for long conversations
// ---------------------------------------------------------------------------

const (
	// CompactionThresholdPercent is the context usage percentage that triggers compaction.
	// When context usage exceeds this percentage of MaxTokens, compaction is triggered.
	CompactionThresholdPercent = 75

	// CompactionKeepRecentTurns is the number of recent user-assistant turns to keep
	// intact during compaction. Older turns are compressed into a summary.
	CompactionKeepRecentTurns = 4

	// CompactionSummaryMaxLen is the maximum length of each message's summary text.
	CompactionSummaryMaxLen = 200

	// CompactionMinTurnsBeforeCompact is the minimum number of turns required before
	// compaction can be triggered. This prevents compacting very short conversations.
	CompactionMinTurnsBeforeCompact = 6
)

// CompactionResult holds the result of a compaction operation.
type CompactionResult struct {
	// Compacted indicates whether compaction was performed.
	Compacted bool
	// OriginalMessageCount is the number of messages before compaction.
	OriginalMessageCount int
	// CompactedMessageCount is the number of messages after compaction.
	CompactedMessageCount int
	// CompactedTurns is the number of turns that were compressed.
	CompactedTurns int
	// SummaryText is the generated summary of the compressed turns.
	SummaryText string
	// TokensSaved is the estimated number of tokens saved by compaction.
	TokensSaved int
}

// ShouldCompact determines whether compaction should be triggered based on
// the current token usage and conversation length.
func ShouldCompact(totalTokens int, maxTokens int, messageCount int) bool {
	if maxTokens <= 0 {
		return false
	}
	usagePercent := totalTokens * 100 / maxTokens
	if usagePercent < CompactionThresholdPercent {
		return false
	}
	// Need enough messages to make compaction worthwhile
	if messageCount < CompactionMinTurnsBeforeCompact*2 {
		// Each turn is roughly 2 messages (user + assistant)
		return false
	}
	return true
}

// CompactMessages performs compaction on a slice of ChatRequestMessage.
// It keeps the most recent turns intact and compresses older turns into
// a summary message.
//
// The compaction strategy:
// 1. Identify the boundary between "old" and "recent" messages
// 2. Generate a summary from the old messages
// 3. Replace old messages with a single summary message
// 4. Keep recent messages intact
//
// Returns the compacted messages and a CompactionResult.
func CompactMessages(messages []openaichat.ChatRequestMessage) ([]openaichat.ChatRequestMessage, CompactionResult) {
	result := CompactionResult{
		OriginalMessageCount: len(messages),
	}

	if len(messages) < CompactionMinTurnsBeforeCompact*2 {
		return messages, result
	}

	// Find the boundary: keep the last N user-assistant turns
	keepFromIndex := findCompactionBoundary(messages, CompactionKeepRecentTurns)
	if keepFromIndex <= 1 {
		// Not enough old messages to compact
		return messages, result
	}

	// Generate summary from old messages
	summaryText := generateCompactionSummary(messages[:keepFromIndex])
	if summaryText == "" {
		return messages, result
	}

	// Count compacted turns
	compactedTurns := 0
	for _, msg := range messages[:keepFromIndex] {
		if msg.Role == "user" || msg.Role == "assistant" {
			compactedTurns++
		}
	}

	// Build compacted message list:
	// 1. Summary message (as user message so LLM treats it as context)
	// 2. Recent messages (kept intact)
	summaryMsg := openaichat.ChatRequestMessage{
		Role:    "user",
		Content: summaryText,
	}

	compacted := make([]openaichat.ChatRequestMessage, 0, 1+len(messages)-keepFromIndex)
	compacted = append(compacted, summaryMsg)
	compacted = append(compacted, messages[keepFromIndex:]...)

	result.Compacted = true
	result.CompactedMessageCount = len(compacted)
	result.CompactedTurns = compactedTurns
	result.SummaryText = summaryText

	return compacted, result
}

// findCompactionBoundary finds the index from which to keep messages intact.
// It counts backwards from the end to find the start of the Nth-to-last
// user-assistant turn.
func findCompactionBoundary(messages []openaichat.ChatRequestMessage, keepTurns int) int {
	userAssistantCount := 0
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" || messages[i].Role == "assistant" {
			userAssistantCount++
			if userAssistantCount >= keepTurns*2 {
				// Each "turn" is roughly 2 messages (user + assistant)
				return i
			}
		}
	}
	return 0
}

// generateCompactionSummary creates a summary from old messages.
// It extracts key information: user requests, tool calls, and AI responses.
func generateCompactionSummary(messages []openaichat.ChatRequestMessage) string {
	var summaryParts []string

	for _, msg := range messages {
		switch msg.Role {
		case "user":
			text := strings.TrimSpace(msg.Content)
			if text != "" {
				summaryParts = append(summaryParts, fmt.Sprintf("用户: %s", summarizeForCompaction(text, CompactionSummaryMaxLen)))
			}
		case "assistant":
			// Extract tool call descriptions
			if len(msg.ToolCalls) > 0 {
				for _, tc := range msg.ToolCalls {
					toolSummary := fmt.Sprintf("AI调用工具 %s", tc.Function.Name)
					if tc.Function.Arguments != "" {
						argsSummary := summarizeToolArgs(tc.Function.Name, tc.Function.Arguments)
						if argsSummary != "" {
							toolSummary = fmt.Sprintf("AI调用工具 %s(%s)", tc.Function.Name, argsSummary)
						}
					}
					summaryParts = append(summaryParts, toolSummary)
				}
			}
			// Also capture text content
			text := strings.TrimSpace(msg.Content)
			if text != "" {
				summaryParts = append(summaryParts, fmt.Sprintf("AI: %s", summarizeForCompaction(text, CompactionSummaryMaxLen)))
			}
		case "tool":
			// Tool results — include a brief summary
			name := msg.Name
			text := strings.TrimSpace(msg.Content)
			if text != "" && name != "" {
				summaryParts = append(summaryParts, fmt.Sprintf("工具结果(%s): %s", name, summarizeForCompaction(text, 80)))
			}
		}
	}

	if len(summaryParts) == 0 {
		return ""
	}

	return fmt.Sprintf("[之前对话摘要 - 共%d条记录]\n%s\n[摘要结束，以下是最近的对话]", len(summaryParts), strings.Join(summaryParts, "\n"))
}

// summarizeForCompaction truncates text to maxLen with ellipsis.
func summarizeForCompaction(text string, maxLen int) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if normalized == "" {
		return ""
	}
	if maxLen <= 0 || len(normalized) <= maxLen {
		return normalized
	}
	if maxLen <= 3 {
		return normalized[:maxLen]
	}
	return normalized[:maxLen-3] + "..."
}

// summarizeToolArgs extracts key arguments from tool call arguments JSON
// for display in the compaction summary.
func summarizeToolArgs(toolName string, argsJSON string) string {
	var args map[string]any
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return summarizeForCompaction(argsJSON, 60)
	}

	switch toolName {
	case "wave_run_command":
		if cmd, ok := args["command"].(string); ok {
			return summarizeForCompaction(cmd, 60)
		}
	case "write_text_file", "edit_text_file", "delete_text_file", "read_text_file":
		if filename, ok := args["filename"].(string); ok {
			return filename
		}
	case "kb_search":
		if query, ok := args["query"].(string); ok {
			return summarizeForCompaction(query, 60)
		}
	case "kb_read":
		if title, ok := args["title"].(string); ok {
			return title
		}
	default:
		// For unknown tools, show first string argument
		for _, v := range args {
			if s, ok := v.(string); ok && len(s) > 0 {
				return summarizeForCompaction(s, 60)
			}
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// Integration with AppendOnlyContextManager
// ---------------------------------------------------------------------------

// CompactContext performs compaction on the AppendOnlyContextManager's log
// when the token threshold is exceeded. Returns the compaction result.
func (m *AppendOnlyContextManager) CompactContext(model string, maxTokens int) (CompactionResult, error) {
	if !m.Prefix.Built() {
		return CompactionResult{}, nil
	}

	// Count current tokens
	tokenResult, err := m.CountTokens(model)
	if err != nil {
		return CompactionResult{}, fmt.Errorf("failed to count tokens for compaction: %w", err)
	}

	// Check if compaction is needed
	if !ShouldCompact(tokenResult.TotalTokens, maxTokens, m.Log.Len()) {
		return CompactionResult{}, nil
	}

	// Get current messages
	messages := m.GetMessages()

	// Perform compaction
	compacted, result := CompactMessages(messages)
	if !result.Compacted {
		return result, nil
	}

	// Estimate tokens saved
	afterResult, _ := DefaultTokenCounter.CountMessages(compacted, model)
	if afterResult != nil {
		result.TokensSaved = tokenResult.TotalTokens - afterResult.TotalTokens
	}

	// Replace the log with compacted messages
	m.Log.Clear()
	for _, msg := range compacted {
		m.Log.Append(msg)
	}
	m.lastSyncCount = len(compacted)
	m.syncedDigest = m.computeDigest(compacted)

	return result, nil
}
