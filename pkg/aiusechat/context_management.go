// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func summarizeText(text string, limit int) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	if normalized == "" {
		return ""
	}
	if limit <= 0 || len(normalized) <= limit {
		return normalized
	}
	if limit <= 3 {
		return normalized[:limit]
	}
	return normalized[:limit-3] + "..."
}

type ContextUsageInfo struct {
	InputTokens  int
	OutputTokens int
	MaxTokens    int
	UsagePercent int
}

func NewContextUsageInfo(inputTokens, outputTokens, maxTokens int) ContextUsageInfo {
	info := ContextUsageInfo{
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		MaxTokens:    maxTokens,
	}
	total := inputTokens + outputTokens
	if maxTokens > 0 {
		info.UsagePercent = min(100, total*100/maxTokens)
	}
	return info
}

func (info ContextUsageInfo) TotalTokens() int {
	return info.InputTokens + info.OutputTokens
}

func UpdateContextTrackerFromUsage(chatId string, usageInfo ContextUsageInfo) ContextThresholdLevel {
	tracker := GetTodoContextTracker(chatId)
	return tracker.UpdateContextUsage(usageInfo.TotalTokens(), usageInfo.MaxTokens)
}

func BuildContextWarningPrompt(level ContextThresholdLevel, usageInfo ContextUsageInfo) string {
	switch level {
	case ContextLevelMaximum:
		return fmt.Sprintf("⚠️ 上下文窗口已使用 %d%%（%d/%d tokens），即将达到上限。请立即总结当前进度并创建新任务。", usageInfo.UsagePercent, usageInfo.TotalTokens(), usageInfo.MaxTokens)
	case ContextLevelCritical:
		return fmt.Sprintf("⚠️ 上下文窗口已使用 %d%%（%d/%d tokens），建议尽快总结并创建新任务。", usageInfo.UsagePercent, usageInfo.TotalTokens(), usageInfo.MaxTokens)
	case ContextLevelWarning:
		return fmt.Sprintf("上下文窗口已使用 %d%%（%d/%d tokens），注意控制输出长度。", usageInfo.UsagePercent, usageInfo.TotalTokens(), usageInfo.MaxTokens)
	default:
		return ""
	}
}

const (
	truncationKeepRecentTurns = 4
	truncationSummaryMaxLen   = 200
)

type TruncationStrategy string

const (
	TruncationStrategyNone      TruncationStrategy = "none"
	TruncationStrategySummarize TruncationStrategy = "summarize"
	TruncationStrategyDrop      TruncationStrategy = "drop"
)

type TruncationPlan struct {
	Strategy       TruncationStrategy
	KeepFromIndex  int
	DroppedTurns   int
	SummaryText    string
	Reason         string
}

func ShouldTruncate(level ContextThresholdLevel) bool {
	return level == ContextLevelCritical || level == ContextLevelMaximum
}

func PlanTruncation(messages []uctypes.UIMessage, level ContextThresholdLevel) TruncationPlan {
	if !ShouldTruncate(level) {
		return TruncationPlan{Strategy: TruncationStrategyNone}
	}

	totalTurns := 0
	for _, msg := range messages {
		if msg.Role == "user" || msg.Role == "assistant" {
			totalTurns++
		}
	}

	if totalTurns <= truncationKeepRecentTurns {
		return TruncationPlan{Strategy: TruncationStrategyNone}
	}

	keepFrom := len(messages)
	userAssistantCount := 0
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" || messages[i].Role == "assistant" {
			userAssistantCount++
			if userAssistantCount >= truncationKeepRecentTurns {
				keepFrom = i
				break
			}
		}
	}

	droppedTurns := 0
	for i := 0; i < keepFrom; i++ {
		if messages[i].Role == "user" || messages[i].Role == "assistant" {
			droppedTurns++
		}
	}

	if droppedTurns == 0 {
		return TruncationPlan{Strategy: TruncationStrategyNone}
	}

	summaryParts := []string{}
	for i := 0; i < keepFrom; i++ {
		msg := messages[i]
		if msg.Role != "user" && msg.Role != "assistant" {
			continue
		}
		for _, part := range msg.Parts {
			if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
				summaryParts = append(summaryParts, summarizeText(part.Text, truncationSummaryMaxLen))
			}
			if part.Type == "data-tooluse" {
				if toolUseData, ok := part.Data.(uctypes.UIMessageDataToolUse); ok {
					desc := strings.TrimSpace(toolUseData.ToolDesc)
					if desc != "" {
						summaryParts = append(summaryParts, fmt.Sprintf("[%s] %s", msg.Role, summarizeText(desc, 80)))
					}
				}
			}
		}
	}

	summaryText := ""
	if len(summaryParts) > 0 {
		summaryText = "之前对话摘要：\n" + strings.Join(summaryParts, "\n")
	}

	return TruncationPlan{
		Strategy:      TruncationStrategySummarize,
		KeepFromIndex: keepFrom,
		DroppedTurns:  droppedTurns,
		SummaryText:   summaryText,
		Reason:        fmt.Sprintf("上下文使用超过阈值，截断前 %d 轮对话", droppedTurns),
	}
}

func ApplyTruncation(messages []uctypes.UIMessage, plan TruncationPlan) []uctypes.UIMessage {
	if plan.Strategy == TruncationStrategyNone {
		return messages
	}

	kept := make([]uctypes.UIMessage, 0, len(messages)-plan.KeepFromIndex+1)

	if plan.SummaryText != "" {
		kept = append(kept, uctypes.UIMessage{
			ID:   "truncation-summary",
			Role: "user",
			Parts: []uctypes.UIMessagePart{
				{Type: "text", Text: plan.SummaryText},
			},
		})
	}

	for i := plan.KeepFromIndex; i < len(messages); i++ {
		kept = append(kept, messages[i])
	}

	return kept
}
