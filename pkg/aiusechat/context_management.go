// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const cheatsheetModelRefreshEveryUserTurns = 5

type cheatsheetRefreshState struct {
	LastAppliedSignature string
	LastAppliedState     string
	LastModelSignature   string
	LastModelUserTurns   int
}

type SessionCheatsheetRefreshStats struct {
	Refreshed bool
	UsedModel bool
}

var sessionCheatsheetRefreshGate = struct {
	mu    sync.Mutex
	state map[string]cheatsheetRefreshState
}{
	state: make(map[string]cheatsheetRefreshState),
}

func countUserTurns(messages []uctypes.UIMessage) int {
	count := 0
	for _, message := range messages {
		if message.Role == "user" {
			count++
		}
	}
	return count
}

func buildCheatsheetSignature(messages []uctypes.UIMessage) string {
	if len(messages) == 0 {
		return "0"
	}
	last := messages[len(messages)-1]
	partTypes := make([]string, 0, len(last.Parts))
	for _, part := range last.Parts {
		partTypes = append(partTypes, part.Type)
	}
	slices.Sort(partTypes)
	return fmt.Sprintf("%d:%s:%d:%s", len(messages), last.Role, len(last.Parts), strings.Join(partTypes, ","))
}

func shouldForceModelCheatsheet(lastState string) bool {
	switch strings.TrimSpace(lastState) {
	case "completed", "failed":
		return true
	default:
		return false
	}
}

func shouldUseModelCheatsheet(chatID string, signature string, userTurns int, lastState string) bool {
	sessionCheatsheetRefreshGate.mu.Lock()
	defer sessionCheatsheetRefreshGate.mu.Unlock()
	entry := sessionCheatsheetRefreshGate.state[chatID]
	if entry.LastAppliedSignature == signature && entry.LastAppliedState == lastState {
		return false
	}
	if shouldForceModelCheatsheet(lastState) {
		return entry.LastModelSignature != signature
	}
	if userTurns <= 0 || userTurns%cheatsheetModelRefreshEveryUserTurns != 0 {
		return false
	}
	if entry.LastModelUserTurns == userTurns && entry.LastModelSignature == signature {
		return false
	}
	return true
}

func markCheatsheetRefresh(chatID string, signature string, lastState string, usedModel bool, userTurns int) {
	sessionCheatsheetRefreshGate.mu.Lock()
	defer sessionCheatsheetRefreshGate.mu.Unlock()
	entry := sessionCheatsheetRefreshGate.state[chatID]
	entry.LastAppliedSignature = signature
	entry.LastAppliedState = lastState
	if usedModel {
		entry.LastModelSignature = signature
		entry.LastModelUserTurns = userTurns
	}
	sessionCheatsheetRefreshGate.state[chatID] = entry
}

func formatSessionCheatsheet(meta *uctypes.UIChatSessionMeta) string {
	if meta == nil || meta.Cheatsheet == nil {
		return ""
	}
	lines := []string{
		summarizeCheatsheetText(meta.Cheatsheet.CurrentWork, 120),
		summarizeCheatsheetText(meta.Cheatsheet.Completed, 120),
		summarizeCheatsheetText(meta.Cheatsheet.BlockedBy, 120),
		summarizeCheatsheetText(meta.Cheatsheet.NextStep, 120),
	}
	if lines[0] == "" && lines[1] == "" && lines[2] == "" && lines[3] == "" {
		return ""
	}
	return strings.TrimSpace(strings.Join([]string{
		"会话小抄：仅把下面四项当作当前任务状态，不要扩写，不要重置目标。",
		"现在在做什么：" + maxCheatsheetLine(lines[0]),
		"已经完成什么：" + maxCheatsheetLine(lines[1]),
		"当前卡点：" + maxCheatsheetLine(lines[2]),
		"下一步：" + maxCheatsheetLine(lines[3]),
	}, "\n"))
}

func maxCheatsheetLine(value string) string {
	if strings.TrimSpace(value) == "" {
		return "无"
	}
	return value
}

func composeSystemPromptWithCheatsheet(basePrompt []string, meta *uctypes.UIChatSessionMeta) []string {
	composed := append([]string(nil), basePrompt...)
	cheatsheetPrompt := formatSessionCheatsheet(meta)
	if cheatsheetPrompt == "" {
		return composed
	}
	return append(composed, cheatsheetPrompt)
}

func buildSessionCheatsheetPrompt(messages []uctypes.UIMessage, lastState string, existing *uctypes.SessionCheatsheet) string {
	var lines []string
	lines = append(lines,
		"请把下面的会话状态压缩成严格四行，不要 markdown，不要解释。",
		"输出格式必须是：",
		"现在在做什么：...",
		"已经完成什么：...",
		"当前卡点：...",
		"下一步：...",
		"每行尽量短。没有内容时写“无”。",
	)
	if existing != nil {
		lines = append(lines,
			"",
			"已有小抄：",
			"现在在做什么："+maxCheatsheetLine(existing.CurrentWork),
			"已经完成什么："+maxCheatsheetLine(existing.Completed),
			"当前卡点："+maxCheatsheetLine(existing.BlockedBy),
			"下一步："+maxCheatsheetLine(existing.NextStep),
		)
	}
	lines = append(lines, "", "最新会话：")
	for _, message := range messages {
		roleLabel := "assistant"
		if message.Role == "user" {
			roleLabel = "user"
		}
		var parts []string
		for _, part := range message.Parts {
			switch part.Type {
			case "text":
				if strings.TrimSpace(part.Text) != "" {
					parts = append(parts, summarizeCheatsheetText(part.Text, 160))
				}
			case "data-tooluse":
				if toolUseData, ok := part.Data.(uctypes.UIMessageDataToolUse); ok {
					if strings.TrimSpace(toolUseData.ToolDesc) != "" {
						parts = append(parts, "工具:"+summarizeCheatsheetText(toolUseData.ToolDesc, 120))
					}
					if strings.TrimSpace(toolUseData.ErrorMessage) != "" {
						parts = append(parts, "错误:"+summarizeCheatsheetText(toolUseData.ErrorMessage, 120))
					}
					if toolUseData.AwaitingInput && strings.TrimSpace(toolUseData.PromptHint) != "" {
						parts = append(parts, "交互:"+summarizeCheatsheetText(toolUseData.PromptHint, 120))
					}
				}
			}
		}
		if len(parts) > 0 {
			lines = append(lines, roleLabel+": "+strings.Join(parts, " | "))
		}
	}
	if strings.TrimSpace(lastState) != "" {
		lines = append(lines, "当前状态: "+lastState)
	}
	return strings.Join(lines, "\n")
}

func parseSessionCheatsheetText(text string) *uctypes.SessionCheatsheet {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "：", ":")
	var cheatsheet uctypes.SessionCheatsheet
	found := 0
	for _, line := range strings.Split(normalized, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "现在在做什么:"):
			cheatsheet.CurrentWork = strings.TrimSpace(strings.TrimPrefix(line, "现在在做什么:"))
			found++
		case strings.HasPrefix(line, "已经完成什么:"):
			cheatsheet.Completed = strings.TrimSpace(strings.TrimPrefix(line, "已经完成什么:"))
			found++
		case strings.HasPrefix(line, "当前卡点:"):
			cheatsheet.BlockedBy = strings.TrimSpace(strings.TrimPrefix(line, "当前卡点:"))
			found++
		case strings.HasPrefix(line, "下一步:"):
			cheatsheet.NextStep = strings.TrimSpace(strings.TrimPrefix(line, "下一步:"))
			found++
		}
	}
	if found == 0 {
		return nil
	}
	return &cheatsheet
}

func summarizeSessionCheatsheetWithModel(ctx context.Context, chatOpts uctypes.WaveChatOpts, messages []uctypes.UIMessage, lastState string, existing *uctypes.SessionCheatsheet) *uctypes.SessionCheatsheet {
	prompt := buildSessionCheatsheetPrompt(messages, lastState, existing)
	if strings.TrimSpace(prompt) == "" {
		return nil
	}
	var summaryText string
	var err error
	switch chatOpts.Config.APIType {
	case uctypes.APIType_OpenAIChat:
		summaryText, err = openaichat.GenerateSessionCheatsheet(ctx, chatOpts.Config, prompt)
	case uctypes.APIType_OpenAIResponses:
		summaryText, err = openai.GenerateSessionCheatsheet(ctx, chatOpts.Config, prompt)
	}
	if err != nil || strings.TrimSpace(summaryText) == "" {
		return nil
	}
	return parseSessionCheatsheetText(summaryText)
}

func summarizeCheatsheetText(text string, limit int) string {
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

func deriveSessionCheatsheet(messages []uctypes.UIMessage, lastState string) *uctypes.SessionCheatsheet {
	var latestUserText string
	var latestAssistantText string
	var latestCompletedTool string
	var latestToolError string
	var latestInteractionPrompt string

	for msgIdx := len(messages) - 1; msgIdx >= 0; msgIdx-- {
		message := messages[msgIdx]
		if message.Role == "user" && latestUserText == "" {
			var textParts []string
			for _, part := range message.Parts {
				if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
					textParts = append(textParts, part.Text)
				}
			}
			latestUserText = summarizeCheatsheetText(strings.Join(textParts, "\n"), 80)
		}
		if message.Role == "assistant" && latestAssistantText == "" {
			var textParts []string
			for _, part := range message.Parts {
				if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
					textParts = append(textParts, part.Text)
				}
			}
			latestAssistantText = summarizeCheatsheetText(strings.Join(textParts, "\n"), 80)
		}
		for _, part := range message.Parts {
			if part.Type != "data-tooluse" {
				continue
			}
			toolUseData, ok := part.Data.(uctypes.UIMessageDataToolUse)
			if !ok {
				continue
			}
			if latestCompletedTool == "" && toolUseData.Status == uctypes.ToolUseStatusCompleted && strings.TrimSpace(toolUseData.ToolDesc) != "" {
				latestCompletedTool = summarizeCheatsheetText(toolUseData.ToolDesc, 80)
			}
			if latestToolError == "" && strings.TrimSpace(toolUseData.ErrorMessage) != "" {
				latestToolError = summarizeCheatsheetText(toolUseData.ErrorMessage, 80)
			}
			if latestInteractionPrompt == "" && toolUseData.AwaitingInput && strings.TrimSpace(toolUseData.PromptHint) != "" {
				latestInteractionPrompt = summarizeCheatsheetText(toolUseData.PromptHint, 80)
			}
		}
	}

	cheatsheet := &uctypes.SessionCheatsheet{}
	cheatsheet.CurrentWork = latestUserText
	if cheatsheet.CurrentWork == "" {
		cheatsheet.CurrentWork = latestAssistantText
	}
	if latestCompletedTool != "" {
		cheatsheet.Completed = latestCompletedTool
	} else if lastState == "completed" {
		cheatsheet.Completed = latestAssistantText
	}
	if latestToolError != "" {
		cheatsheet.BlockedBy = latestToolError
	} else if latestInteractionPrompt != "" {
		cheatsheet.BlockedBy = latestInteractionPrompt
	}

	switch {
	case latestInteractionPrompt != "":
		cheatsheet.NextStep = "先补充当前交互输入"
	case lastState == "failed":
		cheatsheet.NextStep = "先解决当前卡点后重试"
	case lastState == "completed":
		cheatsheet.NextStep = "根据当前结果决定下一步"
	default:
		cheatsheet.NextStep = "继续推进当前任务"
	}

	if cheatsheet.CurrentWork == "" && cheatsheet.Completed == "" && cheatsheet.BlockedBy == "" {
		return nil
	}
	return cheatsheet
}

func refreshSessionCheatsheet(backend UseChatBackend, chatOpts uctypes.WaveChatOpts) SessionCheatsheetRefreshStats {
	if backend == nil || strings.TrimSpace(chatOpts.ChatId) == "" {
		return SessionCheatsheetRefreshStats{}
	}
	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return SessionCheatsheetRefreshStats{}
	}
	uiChat, err := backend.ConvertAIChatToUIChat(*chat)
	if err != nil || uiChat == nil {
		return SessionCheatsheetRefreshStats{}
	}
	lastState := ""
	var existing *uctypes.SessionCheatsheet
	if chat.SessionMeta != nil {
		lastState = chat.SessionMeta.LastTaskState
		existing = chat.SessionMeta.Cheatsheet
	}
	signature := buildCheatsheetSignature(uiChat.Messages)
	userTurns := countUserTurns(uiChat.Messages)
	useModel := shouldUseModelCheatsheet(chatOpts.ChatId, signature, userTurns, lastState)
	var cheatsheet *uctypes.SessionCheatsheet
	modelUsed := false
	if useModel {
		cheatsheet = summarizeSessionCheatsheetWithModel(context.Background(), chatOpts, uiChat.Messages, lastState, existing)
		modelUsed = cheatsheet != nil
	}
	if cheatsheet == nil {
		cheatsheet = deriveSessionCheatsheet(uiChat.Messages, lastState)
	}
	markCheatsheetRefresh(chatOpts.ChatId, signature, lastState, modelUsed, userTurns)
	chatstore.DefaultChatStore.UpsertSessionMeta(chatOpts.ChatId, &chatOpts.Config, uctypes.UIChatSessionMetaUpdate{
		Cheatsheet: cheatsheet,
	})
	return SessionCheatsheetRefreshStats{
		Refreshed: true,
		UsedModel: modelUsed,
	}
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
				summaryParts = append(summaryParts, summarizeCheatsheetText(part.Text, truncationSummaryMaxLen))
			}
			if part.Type == "data-tooluse" {
				if toolUseData, ok := part.Data.(uctypes.UIMessageDataToolUse); ok {
					desc := strings.TrimSpace(toolUseData.ToolDesc)
					if desc != "" {
						summaryParts = append(summaryParts, fmt.Sprintf("[%s] %s", msg.Role, summarizeCheatsheetText(desc, 80)))
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
